import { expect, test } from "../fixtures";
import { DEFAULT_STORAGE_SEED } from "../support/deterministic";
import {
  createBrowserDiagnostics,
  expectNoUnexpectedDiagnostics,
  expectNoUnexpectedNoJsDiagnostics,
  expectVisibleNonEmptyFirstPaint,
  observeBrowserDiagnostics,
  waitForSettledUi,
} from "../support/harness";
import { FIRST_PAINT, type FirstPaintExpectation } from "../support/routes";

const INITIALIZER_ID = "theme-mode-initializer";
const ROUTES: Array<{
  path: string;
  firstPaint: FirstPaintExpectation;
}> = [
  { path: "/", firstPaint: FIRST_PAINT.landing },
  { path: "/search", firstPaint: FIRST_PAINT.search },
  { path: "/edition/1960-01-13", firstPaint: FIRST_PAINT.edition },
];

function initializerCount(markup: string): number {
  return markup.match(new RegExp(`id=["']${INITIALIZER_ID}["']`, "g"))?.length ?? 0;
}

test.describe("one-shot prepaint theme initializer", () => {
  test.use({
    storageSeed: {
      ...DEFAULT_STORAGE_SEED,
      localStorage: {
        ...DEFAULT_STORAGE_SEED.localStorage,
        "transcript-mode": "dark",
      },
    },
  });

  test("streams one head initializer and keeps saved mode stable", async ({
    page,
    diagnostics,
  }) => {
    await page.addInitScript(() => {
      const auditWindow = window as Window & { __themeModeSamples?: string[] };
      const samples: string[] = [];
      auditWindow.__themeModeSamples = samples;

      const observeDocumentElement = () => {
        const documentElement = document.documentElement;
        if (!documentElement) return false;
        const record = () => {
          const mode = documentElement.getAttribute("data-mode");
          if (mode) samples.push(mode);
        };
        record();
        new MutationObserver(record).observe(documentElement, {
          attributes: true,
          attributeFilter: ["data-mode"],
        });
        return true;
      };

      if (!observeDocumentElement()) {
        const documentObserver = new MutationObserver(() => {
          if (!observeDocumentElement()) return;
          documentObserver.disconnect();
        });
        documentObserver.observe(document, { childList: true });
      }
    });

    for (const route of ROUTES) {
      const rawResponse = await page.request.get(route.path);
      expect(rawResponse.status(), `${route.path} raw document status`).toBe(200);
      const markup = await rawResponse.text();
      const head = markup.match(/<head(?:\s[^>]*)?>([\s\S]*?)<\/head>/i)?.[1] ?? "";
      const body = markup.match(/<body(?:\s[^>]*)?>([\s\S]*?)<\/body>/i)?.[1] ?? "";

      expect(initializerCount(markup), `${route.path} complete document`).toBe(1);
      expect(initializerCount(head), `${route.path} document head`).toBe(1);
      expect(initializerCount(body), `${route.path} document body`).toBe(0);

      const response = await page.goto(route.path, { waitUntil: "domcontentloaded" });
      expect(response?.status()).toBe(200);
      await expectVisibleNonEmptyFirstPaint(
        page,
        route.firstPaint,
        `${route.path} dark first paint`,
      );
      await waitForSettledUi(page);
      await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
      const samples = await page.evaluate(
        () =>
          (window as Window & { __themeModeSamples?: string[] })
            .__themeModeSamples ?? [],
      );
      expect(samples.length, `${route.path} should record its saved mode`).toBeGreaterThan(0);
      expect(new Set(samples), `${route.path} mode mutations`).toEqual(new Set(["dark"]));
    }

    expectNoUnexpectedDiagnostics(diagnostics);
  });

  test("retains meaningful light-fallback documents without JavaScript", async ({
    browser,
    browserName,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });

    try {
      for (const route of ROUTES) {
        const page = await context.newPage();
        const diagnostics = createBrowserDiagnostics();
        const stopObserving = observeBrowserDiagnostics(page, diagnostics);

        try {
          const response = await page.goto(route.path);
          expect(response?.status()).toBe(200);
          await expectVisibleNonEmptyFirstPaint(
            page,
            route.firstPaint,
            `${route.path} JavaScript-disabled first paint`,
          );
          await expect(page.locator("html")).not.toHaveAttribute("data-mode");
          expectNoUnexpectedNoJsDiagnostics(diagnostics, {
            browserName,
            origin: new URL(response!.url()).origin,
          });
        } finally {
          stopObserving();
          await page.close();
        }
      }
    } finally {
      await context.close();
    }
  });
});
