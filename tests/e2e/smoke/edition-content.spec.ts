import type { Locator, Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import {
  expectNoUnexpectedDiagnostics,
  expectVisibleNonEmptyFirstPaint,
  waitForSettledUi,
} from "../support/harness";
import { FIRST_PAINT } from "../support/routes";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function sectionControl(page: Page, label: string): Promise<Locator> {
  const exactName = new RegExp(`^${escapeRegExp(label)}(?:\\s|$)`, "i");
  const visibleControl = page.getByRole("button", { name: exactName }).first();
  if (await visibleControl.isVisible()) return visibleControl;

  await page.getByRole("button", { name: "More sections" }).click();
  return page.getByRole("menuitem", { name: label, exact: true });
}

async function expectNoHorizontalOverflow(page: Page) {
  const documentFits = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );
  const feedFits = await page.locator(".edition-feed-surface").evaluate(
    (element) => element.scrollWidth <= element.clientWidth + 1,
  );
  expect(documentFits).toBe(true);
  expect(feedFits).toBe(true);
}

test.describe("representative edition content", () => {
  test("loads context only at desktop width", async ({ page, diagnostics }) => {
    const contextRequests: string[] = [];
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (
        pathname === "/api/weather" ||
        pathname === "/top-10-music/chart-1950-2010.json"
      ) {
        contextRequests.push(pathname);
      }
    });

    const response = await page.goto("/edition/2006-04-20");
    expect(response?.status()).toBe(200);
    await expectVisibleNonEmptyFirstPaint(
      page,
      FIRST_PAINT.edition,
      "representative edition first paint",
    );
    await waitForSettledUi(page);

    if ((page.viewportSize()?.width ?? 0) >= 1024) {
      await expect(page.locator("[data-context-sidebar]")).toBeVisible();
      await expect.poll(() => contextRequests).toContain("/api/weather");
      await expect.poll(() => contextRequests).toContain(
        "/top-10-music/chart-1950-2010.json",
      );
    } else {
      await expect(page.locator("[data-context-sidebar]")).toHaveCount(0);
      expect(contextRequests).toEqual([]);
    }

    await expectNoHorizontalOverflow(page);
    expectNoUnexpectedDiagnostics(diagnostics);
  });

  test("native Enter opens a representative news section", async ({
    page,
    diagnostics,
  }) => {
    await page.goto("/edition/2006-04-20");
    const sports = await sectionControl(page, "Sports");
    await sports.focus();
    await sports.press("Enter");

    if ((page.viewportSize()?.width ?? 0) < 640) {
      await page.getByRole("button", { name: "More sections" }).click();
      await expect(
        page.getByRole("menuitem", { name: "Sports", exact: true }),
      ).toHaveAttribute("aria-current", "page");
    } else {
      await expect(sports).toHaveAttribute("aria-current", /^(true|page)$/);
    }
    await expect(page.locator(".edition-feed-surface article").first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expectNoUnexpectedDiagnostics(diagnostics);
  });

  test("renders display ads and classifieds without responsive overflow", async ({
    page,
    diagnostics,
  }) => {
    await page.goto("/edition/1994-01-19");

    const ads = await sectionControl(page, "Ads");
    await ads.click();
    await expect(page.getByRole("heading", { name: "Display Ads" })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const classifieds = await sectionControl(page, "Classifieds");
    await classifieds.click();
    await expect(
      page.getByRole("heading", { name: "Classified Listings" }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expectNoUnexpectedDiagnostics(diagnostics);
  });
});
