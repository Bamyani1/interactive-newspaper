import { test, expect } from "../fixtures";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  auditR2ImageObjectUrl,
  auditViewport,
  captureAuditScreenshot,
  consumeExpectedDocumentHttpError,
  consumeExpectedOptimizedImageFailure,
  discoverLocalEditionDates,
  evidencePath,
  expectNoUnexpectedDiagnostics,
  expectVisibleNonEmptyFirstPaint,
  resetBrowserDiagnostics,
  waitForSettledUi,
  writeAuditJson,
  type BrowserDiagnostics,
} from "../support/harness";
import { DEEP_TEST_EDITIONS, FIRST_PAINT } from "../support/routes";

interface LiveEdition {
  date?: unknown;
}

interface PrerenderManifest {
  routes?: Record<string, unknown>;
}

const EDITION_PATH = /^\/edition\/(\d{4}-\d{2}-\d{2})$/;

// ASSET-001: the one intentionally-missing external R2 object.
const ASSET_001_EDITION = "1989-10-25";
const ASSET_001_OBJECT = "0004_Page 4_img1.webp";

// ASSET-001's aborted responsive candidate fires a late, non-deterministic
// `requestfailed` event that can surface in a LATER edition's diagnostics, so
// consume that exact object (tolerant, no-op otherwise) before every edition
// gate. Every other asset/diagnostic failure stays fatal.
function assertEditionDiagnostics(diagnostics: BrowserDiagnostics): void {
  consumeExpectedOptimizedImageFailure(diagnostics, {
    editionDate: ASSET_001_EDITION,
    object: ASSET_001_OBJECT,
  });
  expectNoUnexpectedDiagnostics(diagnostics);
}

async function productionPrerenderInventory() {
  expect(
    process.env.PLAYWRIGHT_SERVER_MODE,
    "edition reconciliation must run against a fresh production build",
  ).toBe("production");

  const buildIdPath = path.resolve(".next/BUILD_ID");
  const manifestPath = path.resolve(".next/prerender-manifest.json");
  const [buildId, manifestText, buildIdStats, manifestStats] = await Promise.all([
    readFile(buildIdPath, "utf8"),
    readFile(manifestPath, "utf8"),
    stat(buildIdPath),
    stat(manifestPath),
  ]);
  expect(buildId.trim(), "production BUILD_ID must be nonempty").not.toBe("");
  expect(
    manifestStats.mtimeMs,
    "prerender manifest must be written by the active production build",
  ).toBeGreaterThanOrEqual(buildIdStats.mtimeMs);

  const manifest = JSON.parse(manifestText) as PrerenderManifest;
  const routes = Object.keys(manifest.routes ?? {});
  const datePaths = routes.filter((route) => EDITION_PATH.test(route)).sort();
  const dates = datePaths.map((route) => route.match(EDITION_PATH)![1]);
  return {
    buildId: buildId.trim(),
    dates,
    datePaths,
    hasIndex: routes.includes("/edition"),
    manifestModifiedAt: manifestStats.mtime.toISOString(),
  };
}

function editionDatesFromApi(value: unknown): string[] {
  if (!value || typeof value !== "object" || !("editions" in value)) return [];
  const editions = (value as { editions?: LiveEdition[] }).editions;
  if (!Array.isArray(editions)) return [];
  return editions
    .map((edition) => edition.date)
    .filter((date): date is string =>
      typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date),
    );
}

test("reconciles and sweeps the complete production/local edition union", async ({
  page,
  diagnostics,
}, testInfo) => {
  test.setTimeout(2 * 60 * 60 * 1_000);

  const localDates = await discoverLocalEditionDates();
  const liveResponse = await page.request.get("/api/editions?limit=500");
  expect(liveResponse.ok(), "live edition inventory should load").toBeTruthy();
  const liveDateRows = editionDatesFromApi(await liveResponse.json());
  const liveDates = [...new Set(liveDateRows)].sort();
  const generated = await productionPrerenderInventory();
  const generatedDates = generated.dates;
  const localOnlyDates = localDates.filter(
    (date) => !generatedDates.includes(date),
  );
  const generatedOnlyDates = generatedDates.filter(
    (date) => !localDates.includes(date),
  );
  const unionDates = [...new Set([...generatedDates, ...localDates])].sort();
  const generatedFailures: Array<{ date: string; reason: string }> = [];
  const localOnlyFailures: Array<{ date: string; reason: string }> = [];
  const deferredAssets: Array<{
    date: string;
    object: string;
    url: string;
    deferralId: string;
  }> = [];
  const viewport = auditViewport(testInfo.project.name);

  expect(liveDateRows).toHaveLength(351);
  expect(liveDates).toHaveLength(351);
  expect(generatedDates).toHaveLength(351);
  expect(generated.datePaths).toHaveLength(351);
  expect(generated.hasIndex).toBe(true);
  expect(generated.datePaths.length + Number(generated.hasIndex)).toBe(352);
  expect(localDates).toHaveLength(373);
  expect(localOnlyDates).toHaveLength(22);
  expect(generatedOnlyDates).toEqual([]);
  expect(unionDates).toHaveLength(373);
  expect(generatedDates).toEqual(liveDates);
  expect(generatedDates).toEqual(expect.arrayContaining([...DEEP_TEST_EDITIONS]));

  await writeAuditJson(
    evidencePath({
      file: "inventory.json",
      route: "edition-inventory",
      state: "reconciliation",
      viewport,
    }),
    {
      localCount: localDates.length,
      apiCount: liveDates.length,
      generatedCount: generatedDates.length,
      generatedPathCountIncludingIndex:
        generated.datePaths.length + Number(generated.hasIndex),
      localOnlyCount: localOnlyDates.length,
      localOnly404s: localOnlyDates,
      generatedOnly: generatedOnlyDates,
      unionCount: unionDates.length,
      productionBuild: generated,
      deepTestEditions: DEEP_TEST_EDITIONS,
    },
  );

  for (const date of unionDates) {
    const response = await page.goto(`/edition/${date}`);
    const isGenerated = generatedDates.includes(date);

    if (!isGenerated) {
      if (response?.status() !== 404) {
        localOnlyFailures.push({
          date,
          reason: response ? `HTTP ${response.status()}` : "no response",
        });
      } else {
        consumeExpectedDocumentHttpError(diagnostics, {
          status: 404,
          url: response.url(),
        });
        await expectVisibleNonEmptyFirstPaint(
          page,
          FIRST_PAINT.notFound,
          `local-only edition ${date} 404 first paint`,
        );
        await waitForSettledUi(page, 100);
        await captureAuditScreenshot(
          page,
          evidencePath({
            file: "page.png",
            route: `edition-${date}`,
            state: "local-only-404",
            viewport,
          }),
        );
      }
      assertEditionDiagnostics(diagnostics);
      resetBrowserDiagnostics(diagnostics);
      continue;
    }

    if (!response || response.status() >= 400) {
      generatedFailures.push({
        date,
        reason: response ? `HTTP ${response.status()}` : "no response",
      });
      assertEditionDiagnostics(diagnostics);
      resetBrowserDiagnostics(diagnostics);
      continue;
    }

    await expectVisibleNonEmptyFirstPaint(
      page,
      FIRST_PAINT.edition,
      `edition ${date} first paint`,
    );
    await waitForSettledUi(page, 100);
    await captureAuditScreenshot(
      page,
      evidencePath({
        file: "page.png",
        route: `edition-${date}`,
        state: "settled",
        viewport,
      }),
    );
    if (date === ASSET_001_EDITION) {
      // ASSET-001: the jpg→webp rewrite targets an R2 object that was never
      // uploaded, so Next's optimizer 404s and aborts its responsive candidates.
      // Restoring the object is outside front-end scope; the fallback and
      // screenshot stay visible. Record the deferral once; the optimizer
      // failures are consumed at every edition gate (see assertEditionDiagnostics).
      const object = ASSET_001_OBJECT;
      const missingObjectUrl = auditR2ImageObjectUrl(date, object);
      deferredAssets.push({
        date,
        object,
        url: missingObjectUrl,
        deferralId: "ASSET-001",
      });
      await writeAuditJson(
        evidencePath({
          file: "asset-001-deferred-image.json",
          route: "edition-1989-10-25",
          state: "settled",
          viewport,
        }),
        {
          editionId: "1989-10-25",
          missingObject: object,
          missingObjectUrl,
          reason:
            "External R2 object absent; restoring it is outside front-end scope.",
          deferralId: "ASSET-001",
        },
      );
    }
    assertEditionDiagnostics(diagnostics);
    resetBrowserDiagnostics(diagnostics);
  }

  await writeAuditJson(
    evidencePath({
      file: "failures.json",
      route: "edition-inventory",
      state: "reconciliation",
      viewport,
    }),
    { generatedFailures, localOnlyFailures, deferredAssets },
  );
  expect(generatedFailures).toEqual([]);
  expect(localOnlyFailures).toEqual([]);
});
