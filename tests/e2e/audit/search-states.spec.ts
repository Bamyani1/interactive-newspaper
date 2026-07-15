import type { Locator, Route } from "@playwright/test";
import { expect, test, type Page } from "../fixtures";
import { DEFAULT_STORAGE_SEED } from "../support/deterministic";
import {
  expectNoSeriousOrCriticalAxeViolations,
  expectNoUnexpectedDiagnostics,
  waitForSettledUi,
  type BrowserDiagnostics,
} from "../support/harness";

const RESULT = {
  id: "search-audit-1",
  editionDate: "1960-01-13",
  category: "News",
  headline: "Students Open a New Semester",
  summary: "A deterministic archive-search result.",
  byline: "Transcript Staff",
  snippet: "Students returned to <mark>campus</mark> for the new term.",
  rank: 1,
};

function searchPayload({
  results = [RESULT],
  total = results.length,
  offset = 0,
  hasMore = false,
}: {
  results?: Array<typeof RESULT>;
  total?: number;
  offset?: number;
  hasMore?: boolean;
} = {}) {
  return {
    query: "campus",
    results,
    pagination: {
      total,
      limit: 20,
      offset,
      hasMore,
    },
  };
}

async function fulfillSearch(
  route: Route,
  payload: unknown = searchPayload(),
  status = 200,
) {
  await route.fulfill({
    status,
    headers: { "cache-control": "no-store" },
    json: payload,
  });
}

async function expectMinimumTarget(locator: Locator, label: string) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  expect(box, `${label} must have a rendered box`).not.toBeNull();
  expect(box!.width, `${label} width`).toBeGreaterThanOrEqual(43.99);
  expect(box!.height, `${label} height`).toBeGreaterThanOrEqual(43.99);
}

async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  expect(widths.body).toBeLessThanOrEqual(widths.viewport);
}

async function resolveColorToken(page: Page, token: string) {
  return page.evaluate((property) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${property})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);
}

async function expectSearchStateHealthy(
  page: Page,
  diagnostics: BrowserDiagnostics,
  extraTargets: Array<{ locator: Locator; label: string }> = [],
) {
  const targets = [
    {
      locator: page.getByRole("textbox", { name: "Search the archive" }),
      label: "search input",
    },
    { locator: page.getByLabel("Category"), label: "category filter" },
    { locator: page.getByLabel("From date"), label: "start-date filter" },
    { locator: page.getByLabel("To date"), label: "end-date filter" },
    ...extraTargets,
  ];

  const clear = page.getByRole("button", { name: "Clear search" });
  if (await clear.isVisible().catch(() => false)) {
    targets.push({ locator: clear, label: "clear-search button" });
  }

  for (const target of targets) {
    await expectMinimumTarget(target.locator, target.label);
  }
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousOrCriticalAxeViolations(page);
  expectNoUnexpectedDiagnostics(diagnostics);
}

test.describe("deterministic Search states", () => {
  test("pristine state is quiet, mode-aware, and accessible", async ({
    page,
    diagnostics,
  }) => {
    let requestCount = 0;
    await page.route("**/api/search**", async (route) => {
      requestCount += 1;
      await fulfillSearch(route, searchPayload({ results: [], total: 0 }));
    });

    const response = await page.goto("/search");
    expect(response?.status()).toBe(200);
    await waitForSettledUi(page);
    await expect(
      page
        .getByRole("region", { name: "Search results" })
        .getByText("Enter a search term to explore the archive.", { exact: true }),
    ).toBeVisible();
    expect(requestCount).toBe(0);

    const category = page.getByLabel("Category");
    const startDate = page.getByLabel("From date");
    await expect(category).toHaveCSS("border-radius", "2px");
    await expect(category).toHaveCSS("color-scheme", "light");
    await expect(startDate).toHaveCSS("color-scheme", "light");
    const lightFilterColors = await category.evaluate((element) => ({
      border: getComputedStyle(element).borderTopColor,
      bodyText: getComputedStyle(document.body).color,
    }));
    expect(lightFilterColors.border).toBe(lightFilterColors.bodyText);

    await page.getByRole("button", { name: "Toggle color theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
    await expect(category).toHaveCSS("color-scheme", "dark");
    await expect(startDate).toHaveCSS("color-scheme", "dark");

    await expectSearchStateHealthy(page, diagnostics);
  });

  test("debounces the query, exposes reduced-motion loading, then renders results", async ({
    page,
    diagnostics,
  }) => {
    let requestCount = 0;
    let releaseSearch!: () => void;
    const blocked = new Promise<void>((resolve) => {
      releaseSearch = resolve;
    });

    await page.route("**/api/search**", async (route) => {
      requestCount += 1;
      await blocked;
      await fulfillSearch(route);
    });

    await page.goto("/search");
    const input = page.getByRole("textbox", { name: "Search the archive" });

    try {
      await input.fill("campus");
      await page.waitForTimeout(150);
      expect(requestCount).toBe(0);
      await expect.poll(() => requestCount).toBe(1);

      const spinner = page.locator(".animate-spin");
      await expect(spinner).toBeVisible();
      await expect(spinner).toHaveCSS("animation-name", "none");
      releaseSearch();

      const resultLink = page.getByRole("link", {
        name: RESULT.headline,
      });
      await expect(resultLink).toBeVisible();
      await expect(page.getByText("1 result found", { exact: true })).toHaveCSS("opacity", "1");
      await expect(page.getByText(RESULT.editionDate)).toHaveCSS("opacity", "1");
      await expectSearchStateHealthy(page, diagnostics, [
        { locator: resultLink, label: "search-result link" },
      ]);
    } finally {
      releaseSearch();
    }
  });

  test("renders an accessible empty state", async ({ page, diagnostics }) => {
    await page.route("**/api/search**", (route) =>
      fulfillSearch(route, searchPayload({ results: [], total: 0 })),
    );
    await page.goto("/search");
    await page.getByRole("textbox", { name: "Search the archive" }).fill("missing");
    await expect(
      page
        .getByRole("region", { name: "Search results" })
        .getByText(/No results found for “missing”/),
    ).toBeVisible();
    await expectSearchStateHealthy(page, diagnostics);
  });

  test("renders an explained API error without stale results", async ({
    page,
    diagnostics,
  }) => {
    await page.route("**/api/search**", (route) =>
      fulfillSearch(route, { error: "deterministic failure" }, 500),
    );
    await page.goto("/search");
    await page.getByRole("textbox", { name: "Search the archive" }).fill("broken");
    await expect(
      page
        .getByRole("region", { name: "Search results" })
        .getByText("Search failed. Please try again.", { exact: true }),
    ).toBeVisible();

    const expectedResourceError = diagnostics.consoleErrors.findIndex(
      (entry) =>
        entry.includes("Failed to load resource") &&
        entry.includes("500") &&
        entry.includes("/api/search"),
    );
    if (expectedResourceError !== -1) {
      diagnostics.consoleErrors.splice(expectedResourceError, 1);
    }
    const expectedHttpError = diagnostics.httpErrors.findIndex(
      (entry) => entry.status === 500 && entry.url.includes("/api/search"),
    );
    expect(expectedHttpError).toBeGreaterThanOrEqual(0);
    diagnostics.httpErrors.splice(expectedHttpError, 1);
    await expectSearchStateHealthy(page, diagnostics);
  });

  test("refetches with category and date filters", async ({
    page,
    diagnostics,
  }) => {
    const requests: URL[] = [];
    await page.route("**/api/search**", async (route) => {
      requests.push(new URL(route.request().url()));
      await fulfillSearch(route);
    });

    await page.goto("/search");
    await page.getByRole("textbox", { name: "Search the archive" }).fill("campus");
    await expect(page.getByRole("link", { name: RESULT.headline })).toBeVisible();

    const categoryResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/search" && url.searchParams.get("category") === "News";
    });
    await page.getByLabel("Category").selectOption("News");
    await categoryResponse;

    const startResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/search" && url.searchParams.get("start_date") === "1960-01-01";
    });
    await page.getByLabel("From date").fill("1960-01-01");
    await startResponse;

    const endResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/search" && url.searchParams.get("end_date") === "1960-12-31";
    });
    await page.getByLabel("To date").fill("1960-12-31");
    await endResponse;

    const last = requests.at(-1);
    expect(last?.searchParams.get("q")).toBe("campus");
    expect(last?.searchParams.get("category")).toBe("News");
    expect(last?.searchParams.get("start_date")).toBe("1960-01-01");
    expect(last?.searchParams.get("end_date")).toBe("1960-12-31");
    expect(last?.searchParams.get("offset")).toBe("0");
    await expectSearchStateHealthy(page, diagnostics, [
      {
        locator: page.getByRole("link", { name: RESULT.headline }),
        label: "filtered-result link",
      },
    ]);
  });

  test("appends the next result page without replacing prior results", async ({
    page,
    diagnostics,
  }) => {
    const firstPage = Array.from({ length: 20 }, (_, index) => ({
      ...RESULT,
      id: `search-audit-${index + 1}`,
      headline: `Campus result ${index + 1}`,
    }));
    const finalResult = {
      ...RESULT,
      id: "search-audit-21",
      headline: "Campus result 21",
    };

    await page.route("**/api/search**", async (route) => {
      const offset = Number(new URL(route.request().url()).searchParams.get("offset"));
      await fulfillSearch(
        route,
        offset === 20
          ? searchPayload({ results: [finalResult], total: 21, offset: 20 })
          : searchPayload({ results: firstPage, total: 21, hasMore: true }),
      );
    });

    await page.goto("/search");
    await page.getByRole("textbox", { name: "Search the archive" }).fill("campus");
    await expect(page.locator("article")).toHaveCount(20);

    const loadMore = page.getByRole("button", { name: "Load More" });
    await expectMinimumTarget(loadMore, "load-more button");
    const secondPage = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/search" && url.searchParams.get("offset") === "20";
    });
    await loadMore.click();
    await secondPage;

    await expect(page.locator("article")).toHaveCount(21);
    await expect(
      page.getByRole("link", { name: "Campus result 1", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: finalResult.headline })).toBeVisible();
    await expect(loadMore).toBeHidden();
    await expectSearchStateHealthy(page, diagnostics, [
      {
        locator: page.getByRole("link", { name: finalResult.headline }),
        label: "appended-result link",
      },
    ]);
  });

  test("navigates a result through the client-side edition link", async ({
    page,
    diagnostics,
  }) => {
    await page.route("**/api/search**", (route) => fulfillSearch(route));
    await page.goto("/search");
    await page.getByRole("textbox", { name: "Search the archive" }).fill("campus");
    const resultLink = page.getByRole("link", { name: RESULT.headline });
    await expect(resultLink).toHaveAttribute("href", "/edition/1960-01-13");
    await expectSearchStateHealthy(page, diagnostics, [
      { locator: resultLink, label: "edition-result link" },
    ]);

    await resultLink.click();
    await expect(page).toHaveURL(/\/edition\/1960-01-13$/);
    await expect(page.getByText("Vol. 93 · No. 13")).toBeVisible();
    await waitForSettledUi(page);
    await expectNoHorizontalOverflow(page);
    await expectNoSeriousOrCriticalAxeViolations(page);
    expectNoUnexpectedDiagnostics(diagnostics);
  });
});

test.describe("saved dark Search results", () => {
  test.use({
    storageSeed: {
      ...DEFAULT_STORAGE_SEED,
      localStorage: {
        ...DEFAULT_STORAGE_SEED.localStorage,
        "transcript-mode": "dark",
      },
    },
  });

  test("keeps result and pagination accents semantic", async ({
    page,
    diagnostics,
  }) => {
    const firstPage = Array.from({ length: 20 }, (_, index) => ({
      ...RESULT,
      id: `dark-search-${index + 1}`,
      headline: `Dark result ${index + 1}`,
    }));
    const finalResult = {
      ...RESULT,
      id: "dark-search-21",
      headline: "Dark result 21",
    };

    await page.route("**/api/search**", (route) => {
      const offset = Number(new URL(route.request().url()).searchParams.get("offset"));
      return fulfillSearch(
        route,
        offset === 20
          ? searchPayload({ results: [finalResult], total: 21, offset: 20 })
          : searchPayload({ results: firstPage, total: 21, hasMore: true }),
      );
    });

    await page.goto("/search");
    await page.getByRole("textbox", { name: "Search the archive" }).fill("campus");
    await expect(page.locator("article")).toHaveCount(20);
    await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");

    const accentText = await resolveColorToken(page, "--color-accent-text");
    const category = page.locator("article").first().getByText("News", {
      exact: true,
    });
    const loadMore = page.getByRole("button", { name: "Load More" });
    const activeSearch = page.getByRole("link", {
      name: "Search the archive",
    });
    await expect(category).toHaveCSS("color", accentText);
    await expect(loadMore).toHaveCSS("color", accentText);
    await expect(loadMore).toHaveCSS("border-top-color", accentText);
    await expect(activeSearch).toHaveCSS("color", accentText);
    await expectMinimumTarget(loadMore, "dark load-more button");

    const nextPage = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/search" && url.searchParams.get("offset") === "20";
    });
    await loadMore.click();
    await nextPage;
    await expect(page.getByRole("link", { name: finalResult.headline })).toBeVisible();

    await expectSearchStateHealthy(page, diagnostics, [
      {
        locator: page.getByRole("link", { name: finalResult.headline }),
        label: "dark appended-result link",
      },
    ]);
  });
});
