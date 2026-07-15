import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import {
  DEFAULT_STORAGE_SEED,
} from "../support/deterministic";
import {
  consumeExpectedDocumentHttpError,
  expectNoSeriousOrCriticalAxeViolations,
  expectNoUnexpectedDiagnostics,
  installApiMocks,
  waitForSettledUi,
  type ApiMock,
} from "../support/harness";

type TrackTuple = [string, string, string];

const CHART_URL = "**/top-10-music/chart-1950-2010.json";

function packedMonth(
  month: string,
  tracks: TrackTuple[] | null,
): { start: string; end: string; months: Array<TrackTuple[] | null> } {
  const [year, monthNumber] = month.split("-").map(Number);
  const months = new Array<TrackTuple[] | null>(monthNumber).fill(null);
  months[monthNumber - 1] = tracks;
  return { start: `${year}-01`, end: `${year}-12`, months };
}

function weatherMock(date: string, record: unknown): ApiMock {
  return {
    url: new RegExp(`/api/weather\\?date=${date}$`),
    json: { record, reason: record ? null : "NO_DATA" },
  };
}

function editionDateText(page: Page, dateLabel: RegExp): Locator {
  return page.getByText(dateLabel).first();
}

async function expectCoherentEdition(
  page: Page,
  dateLabel: RegExp,
): Promise<void> {
  await expect(page.locator(".edition-feed-surface")).toBeVisible();
  await expect(page.getByRole("heading", { name: "The Transcript" })).toBeVisible();
  await expect(editionDateText(page, dateLabel)).toBeVisible();
  const fits = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );
  expect(fits).toBe(true);
}

async function selectSection(page: Page, name: string): Promise<void> {
  const desktop = page
    .locator("button.nav-fleuron-row")
    .filter({ has: page.locator(".nav-fleuron-name", { hasText: new RegExp(`^${name}$`) }) });
  if (await desktop.isVisible()) {
    await desktop.click();
    return;
  }

  const direct = page.getByRole("button", { name, exact: true }).first();
  if (await direct.isVisible()) {
    await direct.click();
    return;
  }

  await page.getByRole("button", { name: "More sections" }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

test.use({ contextOptions: { reducedMotion: "no-preference" } });

test.describe("deep edition state matrix", () => {
  test.describe("2006 context loaded", () => {
    test("keeps the route, theme, context, sections, and photo viewer coherent", async ({
      page,
      diagnostics,
      isMobile,
    }) => {
      await installApiMocks(page, [
        weatherMock("2006-04-20", {
          tmax_c: 22,
          tmin_c: 10,
          is_estimated: false,
        }),
        {
          url: CHART_URL,
          json: packedMonth("2006-04", [
            ["Archive Song", "Fixture Artist", ""],
            ["Second Song", "Second Artist", ""],
          ]),
        },
      ]);
      const contextRequests: string[] = [];
      page.on("request", (request) => {
        const pathname = new URL(request.url()).pathname;
        if (pathname === "/api/weather" || pathname === "/top-10-music/chart-1950-2010.json") {
          contextRequests.push(pathname);
        }
      });

      const response = await page.goto("/edition/2006-04-20");
      expect(response?.status()).toBe(200);
      await expectCoherentEdition(page, /Thursday, April 20, 2006/);
      await waitForSettledUi(page);
      await expect(page.locator("html")).toHaveAttribute("data-mode", "light");

      if (isMobile) {
        await expect(page.locator("[data-context-sidebar]")).toHaveCount(0);
        expect(contextRequests).toEqual([]);
      } else {
        await expect(page.getByText("72°", { exact: true })).toBeVisible();
        await expect(page.getByText("/ 50°", { exact: true })).toBeVisible();
        await expect(page.getByText("April 2006 Top 10")).toBeVisible();
        await expect(page.getByText("Archive Song").first()).toBeVisible();
        expect(contextRequests).toEqual(
          expect.arrayContaining([
            "/api/weather",
            "/top-10-music/chart-1950-2010.json",
          ]),
        );
      }

      await selectSection(page, "Sports");
      await expect(page.locator(".edition-feed-surface article").first()).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-mode", "light");

      const photo = page.getByRole("button", { name: /^Expand photo:/ }).first();
      await photo.focus();
      await photo.press("Enter");
      const dialog = page.getByRole("dialog", { name: "Photo viewer" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Close photo viewer" })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(photo).toBeFocused();

      await page.getByRole("button", { name: "Toggle color theme" }).click();
      await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
      expect(
        await page.evaluate(() => localStorage.getItem("transcript-mode")),
      ).toBe("dark");
      await expectCoherentEdition(page, /Thursday, April 20, 2006/);
      await expectNoSeriousOrCriticalAxeViolations(page);
      expectNoUnexpectedDiagnostics(diagnostics);
    });
  });

  test.describe("1994 context empty", () => {
    test("renders empty context plus display ads and classifieds", async ({
      page,
      diagnostics,
      isMobile,
    }) => {
      await installApiMocks(page, [
        weatherMock("1994-01-19", null),
        { url: CHART_URL, json: packedMonth("1994-01", null) },
      ]);
      await page.goto("/edition/1994-01-19");
      await expectCoherentEdition(page, /Wednesday, January 19, 1994/);
      await waitForSettledUi(page);

      if (!isMobile) {
        await expect(page.getByText("Weather data unavailable")).toBeVisible();
        await expect(
          page.getByText("No chart data was found for this month."),
        ).toBeVisible();
      }

      await selectSection(page, "Ads");
      await expect(page.getByRole("heading", { name: "Display Ads" })).toBeVisible();
      await selectSection(page, "Classifieds");
      await expect(
        page.getByRole("heading", { name: "Classified Listings" }),
      ).toBeVisible();
      await expectCoherentEdition(page, /Wednesday, January 19, 1994/);
      expectNoUnexpectedDiagnostics(diagnostics);
    });
  });

  test.describe("1960 context error", () => {
    test.use({
      storageSeed: {
        ...DEFAULT_STORAGE_SEED,
        localStorage: {
          ...DEFAULT_STORAGE_SEED.localStorage,
          "transcript-mode": "dark",
        },
      },
    });

    test("distinguishes failed context from absent historical data", async ({
      page,
      diagnostics,
      isMobile,
    }) => {
      await installApiMocks(page, [
        {
          url: new RegExp("/api/weather\\?date=1960-01-13$"),
          contentType: "application/json",
          text: "{",
        },
        { url: CHART_URL, contentType: "application/json", text: "{" },
      ]);
      await page.goto("/edition/1960-01-13");
      await expectCoherentEdition(page, /Wednesday, January 13, 1960/);
      await waitForSettledUi(page);
      await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");

      if (!isMobile) {
        await expect(
          page.getByText("Unable to load weather data right now"),
        ).toBeVisible();
        await expect(
          page.getByText("Unable to load monthly chart data right now."),
        ).toBeVisible();
        await expect(page.getByText("Weather data unavailable")).toHaveCount(0);
        await expect(
          page.getByText("No chart data was found for this month."),
        ).toHaveCount(0);
      }

      await expectNoSeriousOrCriticalAxeViolations(page);
      expectNoUnexpectedDiagnostics(diagnostics);
    });
  });
});

test("next-edition pending state preserves the current edition until the delayed RSC swap", async ({
  page,
  diagnostics,
}) => {
  test.setTimeout(60_000);
  const sourceDate = "1994-01-19";
  const inventory = await page.request.get("/api/editions?limit=500");
  expect(inventory.ok()).toBe(true);
  const payload = (await inventory.json()) as {
    editions: Array<{ date: string }>;
  };
  const dates = payload.editions.map(({ date }) => date).sort();
  const sourceIndex = dates.indexOf(sourceDate);
  expect(sourceIndex).toBeGreaterThanOrEqual(0);
  const targetDate = dates[(sourceIndex + 1) % dates.length];

  let releaseTarget!: () => void;
  const targetMayResolve = new Promise<void>((resolve) => {
    releaseTarget = resolve;
  });
  let delayedRequestSeen = false;
  await page.route(`**/edition/${targetDate}**`, async (route) => {
    const url = new URL(route.request().url());
    if (!url.searchParams.has("_rsc")) {
      await route.fallback();
      return;
    }
    delayedRequestSeen = true;
    await targetMayResolve;
    await route.continue();
  });

  await page.goto(`/edition/${sourceDate}`);
  await expectCoherentEdition(page, /Wednesday, January 19, 1994/);
  const next = page.getByRole("button", { name: "See Next Edition" });
  await next.scrollIntoViewIfNeeded();
  await next.click();

  await expect.poll(() => delayedRequestSeen).toBe(true);
  const pending = page.getByRole("button", { name: "Opening Edition…" });
  await expect(pending).toBeVisible();
  await expect(pending).toBeDisabled();
  await expect(pending).toHaveAttribute("aria-busy", "true");
  await expect(page).toHaveURL(new RegExp(`/edition/${sourceDate}$`));
  await expectCoherentEdition(page, /Wednesday, January 19, 1994/);

  releaseTarget();
  await expect(page).toHaveURL(new RegExp(`/edition/${targetDate}$`));
  await expect(editionDateText(page, /Wednesday, January 19, 1994/)).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "See Next Edition" })).toBeEnabled();
  expectNoUnexpectedDiagnostics(diagnostics);
});

test("invalid edition dates render the shared 404 without leaking route details", async ({
  page,
  diagnostics,
}) => {
  const response = await page.goto("/edition/not-a-date");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page Not Found" })).toBeVisible();
  await expect(page.getByText("not-a-date", { exact: false })).toHaveCount(0);
  consumeExpectedDocumentHttpError(diagnostics, {
    status: 404,
    url: response!.url(),
  });
  expectNoUnexpectedDiagnostics(diagnostics);
});
