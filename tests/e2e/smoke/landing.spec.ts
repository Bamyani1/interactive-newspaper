import { test, expect } from "../fixtures";
import {
  createBrowserDiagnostics,
  expectNoUnexpectedDiagnostics,
  expectNoUnexpectedNoJsDiagnostics,
  observeBrowserDiagnostics,
  readCumulativeLayoutShift,
  resetBrowserDiagnostics,
  waitForSettledUi,
} from "../support/harness";

test("landing keeps both core paths coherent without JavaScript", async ({
  browser,
  browserName,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const diagnostics = createBrowserDiagnostics();
  const stopObserving = observeBrowserDiagnostics(page, diagnostics);

  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.locator(".cinema-paper")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "The Transcript Archive" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Ask the archive" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open this issue" })).toHaveAttribute(
    "href",
    /\/edition\/\d{4}-\d{2}-\d{2}$/,
  );
  await expect(page.locator(".cinema-paper")).toHaveCSS("opacity", "1");

  const hasHorizontalOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth > window.innerWidth ||
      document.body.scrollWidth > window.innerWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
  expectNoUnexpectedNoJsDiagnostics(diagnostics, {
    browserName,
    origin: new URL(response!.url()).origin,
  });

  stopObserving();
  await context.close();
});

test("landing stops its ambient and ticker motion for reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await waitForSettledUi(page);

  await expect(page.locator(".cinema-ticker-track").first()).toHaveCSS(
    "transform",
    "none",
  );
  await expect(page.locator(".cathedral-ambient")).toHaveCSS(
    "animation-name",
    "none",
  );
  await expect(page.locator(".cathedral-mote").first()).toHaveCSS(
    "animation-name",
    "none",
  );
  await expect(page.locator(".cinema-paper")).toHaveCSS(
    "animation-name",
    "none",
  );

  await expect
    .poll(async () =>
      page.locator(".cathedral-glass object").evaluate((element) => {
        const document = (element as HTMLObjectElement).contentDocument;
        const panel = document?.querySelector<SVGGElement>(".glass-panel");
        const path = panel?.querySelector<SVGPathElement>("path");
        return {
          panelOpacity: panel?.style.opacity,
          pathOpacity: path?.style.fillOpacity,
          animations: document?.getAnimations().length,
        };
      }),
    )
    .toEqual({ panelOpacity: "1", pathOpacity: "0.8", animations: 0 });
});

test("edition picker has valid tabpanels and 44px targets", async ({ page }) => {
  await page.goto("/");
  await waitForSettledUi(page);

  await page
    .getByRole("button", { name: /selected edition:.*activate to change/i })
    .click();
  const activeTab = page.getByRole("tab", { selected: true });
  const panel = page.getByRole("tabpanel");
  await expect(activeTab).toBeVisible();
  await expect(panel).toBeVisible();
  expect(await activeTab.getAttribute("aria-controls")).toBe(
    await panel.getAttribute("id"),
  );
  expect(await panel.getAttribute("aria-labelledby")).toBe(
    await activeTab.getAttribute("id"),
  );

  const targets = page.locator(
    ".ep-decade-tab:visible, .ep-date-item:visible, .ep-close-btn:visible",
  );
  const targetCount = await targets.count();
  expect(targetCount).toBeGreaterThan(2);
  for (let index = 0; index < targetCount; index += 1) {
    const target = targets.nth(index);
    const metrics = await target.evaluate((element) => ({
      renderedHeight: element.getBoundingClientRect().height,
      computedMinHeight: Number.parseFloat(getComputedStyle(element).minHeight),
    }));
    expect(
      metrics.computedMinHeight,
      `picker target ${index} computed min-height`,
    ).toBeGreaterThanOrEqual(44);
    // Chromium can report a sub-pixel float such as 43.99994 for a
    // computed 44px box. Keep the rendered-size guard strict enough to
    // catch real regressions while tolerating that representation noise.
    expect(
      metrics.renderedHeight,
      `picker target ${index} rendered height`,
    ).toBeGreaterThanOrEqual(43.99);
  }
});

test("landing fits its canvas across responsive boundaries", async ({
  page,
  diagnostics,
  isMobile,
}) => {
  test.skip(isMobile, "One Chromium project performs the explicit boundary sweep.");

  const viewports = [
    { width: 390, height: 844 },
    { width: 639, height: 900 },
    { width: 641, height: 900 },
    { width: 767, height: 900 },
    { width: 769, height: 900 },
    { width: 1023, height: 900 },
    { width: 1025, height: 900 },
    { width: 1440, height: 900 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await waitForSettledUi(page, 100);

    const metrics = await page.evaluate(() => {
      const paper = document.querySelector<HTMLElement>(".cinema-paper");
      const paperRect = paper?.getBoundingClientRect();
      return {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        paperLeft: paperRect?.left ?? -1,
        paperRight: paperRect?.right ?? Number.POSITIVE_INFINITY,
        paperTop: paperRect?.top ?? -1,
        paperBottom: paperRect?.bottom ?? Number.POSITIVE_INFINITY,
      };
    });

    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.bodyWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.paperLeft).toBeGreaterThanOrEqual(0);
    expect(metrics.paperRight).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.paperTop).toBeGreaterThanOrEqual(0);
    expect(metrics.paperBottom).toBeLessThanOrEqual(metrics.viewportHeight);
    expect(
      await readCumulativeLayoutShift(page),
      `CLS at ${viewport.width}x${viewport.height}`,
    ).toBeLessThanOrEqual(0.01);
    expectNoUnexpectedDiagnostics(diagnostics);
    resetBrowserDiagnostics(diagnostics);
  }
});
