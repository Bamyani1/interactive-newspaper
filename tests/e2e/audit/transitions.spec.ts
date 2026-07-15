import type { Page, Request, Route } from "@playwright/test";
import { test, expect } from "../fixtures";
import { DETERMINISTIC_ASK_STREAM } from "../support/deterministic";
import {
  auditViewport,
  captureFilmstrip,
  evidencePath,
  expectNoUnexpectedDiagnostics,
  expectOneOfFirstPaint,
  expectVisibleNonEmptyFirstPaint,
  readCumulativeLayoutShift,
  readCumulativeLayoutShiftSamples,
  resetBrowserDiagnostics,
  waitForSettledUi,
  writeAuditJson,
} from "../support/harness";
import { FIRST_PAINT, PRIMARY_TRANSITIONS } from "../support/routes";

const NAVIGATION_DELAY_MS = 650;
const API_DELAY_MS = 650;

function isTargetRouteRequest(request: Request, targetPath: string): boolean {
  const url = new URL(request.url());
  if (url.pathname !== targetPath) return false;
  return (
    request.resourceType() === "document" ||
    url.searchParams.has("_rsc") ||
    request.headers().rsc === "1"
  );
}

async function disableViewportPrefetch(page: Page) {
  await page.addInitScript(() => {
    class AuditIntersectionObserver implements IntersectionObserver {
      readonly root = null;
      readonly rootMargin = "0px";
      readonly thresholds = [0];
      disconnect() {}
      observe() {}
      unobserve() {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }

    Object.defineProperty(window, "IntersectionObserver", {
      configurable: true,
      value: AuditIntersectionObserver,
      writable: true,
    });
  });
}

test.describe("primary navigation transition filmstrips", () => {
  expect(PRIMARY_TRANSITIONS).toHaveLength(9);

  for (const transition of PRIMARY_TRANSITIONS) {
    test(`${transition.name} stays coherent under a delayed route response`, async ({
      page,
      diagnostics,
    }, testInfo) => {
      let delayedDocumentRequests = 0;
      let delayedRscRequests = 0;
      let releasedTargetRequests = 0;

      await disableViewportPrefetch(page);
      await page.goto(transition.from, { waitUntil: "domcontentloaded" });
      await expectVisibleNonEmptyFirstPaint(
        page,
        transition.fromFirstPaint,
        `${transition.name} source first paint`,
      );
      const link = page.getByRole("link", { name: transition.linkName }).first();
      await expect(link).toBeVisible();
      await waitForSettledUi(page);
      await expect
        .poll(() =>
          link.evaluate((element) =>
            Object.keys(element).some((key) => key.startsWith("__reactProps$")),
          ),
        )
        .toBe(true);
      expectNoUnexpectedDiagnostics(diagnostics);
      resetBrowserDiagnostics(diagnostics);

      await page.route("**/*", async (route) => {
        const request = route.request();
        if (!isTargetRouteRequest(request, transition.to)) {
          await route.fallback();
          return;
        }

        if (request.resourceType() === "document") delayedDocumentRequests += 1;
        else delayedRscRequests += 1;
        await new Promise((resolve) => setTimeout(resolve, NAVIGATION_DELAY_MS));
        releasedTargetRequests += 1;
        await route.continue();
      });

      const layoutShiftBefore = await readCumulativeLayoutShift(page);
      const viewport = auditViewport(testInfo.project.name);
      const outputDir = evidencePath({
        file: "",
        route: transition.name,
        state: "transition",
        viewport,
      });
      const frames = await captureFilmstrip(
        page,
        () => link.click({ noWaitAfter: true }),
        {
          assertFrame: (elapsedMs) =>
            expectOneOfFirstPaint(
              page,
              [transition.fromFirstPaint, transition.toFirstPaint],
              `${transition.name} frame at measured ${elapsedMs}ms`,
            ),
          outputDir,
          prefix: "frame",
        },
      );

      await expect
        .poll(() => new URL(page.url()).pathname, {
          message: `${transition.name} target pathname`,
        })
        .toBe(transition.to);
      await expectVisibleNonEmptyFirstPaint(
        page,
        transition.toFirstPaint,
        `${transition.name} target first paint`,
      );
      await waitForSettledUi(page);
      const layoutShiftAfter = await readCumulativeLayoutShift(page);
      const layoutShiftSamples = await readCumulativeLayoutShiftSamples(page);
      const transitionLayoutShift = Math.max(
        0,
        layoutShiftAfter - layoutShiftBefore,
      );
      await writeAuditJson(
        evidencePath({
          file: "metrics.json",
          route: transition.name,
          state: "transition",
          viewport,
        }),
        {
          transition: {
            ...transition,
            linkName: transition.linkName.toString(),
          },
          delayMs: NAVIGATION_DELAY_MS,
          delayedDocumentRequests,
          delayedRscRequests,
          releasedTargetRequests,
          frames,
          layoutShiftBefore,
          layoutShiftAfter,
          layoutShiftSamples,
          transitionLayoutShift,
        },
      );

      expect(
        delayedRscRequests,
        `${transition.name} must exercise a delayed client RSC request`,
      ).toBeGreaterThan(0);
      expect(releasedTargetRequests).toBeGreaterThan(0);
      expect(delayedDocumentRequests).toBe(0);
      expect(transitionLayoutShift).toBeLessThanOrEqual(0.01);
      expectNoUnexpectedDiagnostics(diagnostics);
    });
  }
});

test("delayed Search API keeps its stable shell until results are ready", async ({
  page,
  diagnostics,
}, testInfo) => {
  let requestStartedAt = 0;
  let requestReleasedAt = 0;
  await page.route("**/api/search**", async (route: Route) => {
    requestStartedAt = performance.now();
    await new Promise((resolve) => setTimeout(resolve, API_DELAY_MS));
    requestReleasedAt = performance.now();
    await route.fulfill({
      status: 200,
      headers: { "cache-control": "no-store" },
      json: {
        query: "campus",
        results: [
          {
            id: "transition-search-result",
            editionDate: "1960-01-13",
            category: "News",
            headline: "Students Open a New Semester",
            summary: "A deterministic transition fixture.",
            byline: "Transcript Staff",
            snippet: "Students returned to campus.",
            rank: 1,
          },
        ],
        pagination: { total: 1, limit: 20, offset: 0, hasMore: false },
      },
    });
  });

  await page.goto("/search");
  await waitForSettledUi(page);
  const input = page.getByRole("textbox", { name: "Search the archive" });
  const frames = await captureFilmstrip(
    page,
    () => input.fill("campus"),
    {
      assertFrame: async () => {
        await expectVisibleNonEmptyFirstPaint(
          page,
          FIRST_PAINT.search,
          "delayed Search API shell",
        );
        await expect(input).toBeVisible();
      },
      outputDir: evidencePath({
        file: "",
        route: "search-api",
        state: "delayed-response",
        viewport: auditViewport(testInfo.project.name),
      }),
      prefix: "frame",
    },
  );
  await expect(
    page.getByRole("link", { name: "Students Open a New Semester" }),
  ).toBeVisible();
  expect(requestStartedAt).toBeGreaterThan(0);
  expect(requestReleasedAt - requestStartedAt).toBeGreaterThanOrEqual(
    API_DELAY_MS - 10,
  );
  expect(frames.map((frame) => frame.requestedMs)).toEqual([
    0, 50, 100, 250, 500, 1_000,
  ]);
  expectNoUnexpectedDiagnostics(diagnostics);
});

test("delayed Ask API keeps the hydrated workspace visible", async ({
  page,
  diagnostics,
}) => {
  let requestStartedAt = 0;
  let requestReleasedAt = 0;
  await page.route("**/api/ask**", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    requestStartedAt = performance.now();
    await new Promise((resolve) => setTimeout(resolve, API_DELAY_MS));
    requestReleasedAt = performance.now();
    await route.fulfill({
      status: 200,
      headers: {
        "cache-control": "no-store",
        "content-type": "text/event-stream; charset=utf-8",
        "x-audit-fixture": "delayed-deterministic-ask-stream",
      },
      body: DETERMINISTIC_ASK_STREAM,
    });
  });

  await page.goto("/ask?q=Who%20edited%20the%20paper%3F");
  await expect.poll(() => requestStartedAt).toBeGreaterThan(0);
  await page.waitForTimeout(250);
  await expectVisibleNonEmptyFirstPaint(
    page,
    FIRST_PAINT.ask,
    "delayed Ask API workspace",
  );
  await expect(page.locator("main#main-content")).toBeVisible();
  await expect(page.locator(".ask-transcript")).toBeVisible();
  await expect(page.locator(".ask-composer")).toBeVisible();
  await expect(page.getByText(/local Playwright fixture/i)).toBeVisible();
  expect(requestReleasedAt - requestStartedAt).toBeGreaterThanOrEqual(
    API_DELAY_MS - 10,
  );
  expectNoUnexpectedDiagnostics(diagnostics);
});
