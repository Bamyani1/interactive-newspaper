import { test, expect } from "../fixtures";
import {
  consumeExpectedDocumentHttpError,
  expectNoUnexpectedDiagnostics,
  expectVisibleNonEmptyFirstPaint,
  waitForSettledUi,
} from "../support/harness";
import { FIRST_PAINT } from "../support/routes";

test("development gallery is available only outside production", async ({
  page,
  diagnostics,
}) => {
  const productionServer =
    process.env.PLAYWRIGHT_SERVER_MODE === "production";
  const response = await page.goto("/dev/primitives");

  expect(response?.status()).toBe(productionServer ? 404 : 200);
  await expectVisibleNonEmptyFirstPaint(
    page,
    productionServer ? FIRST_PAINT.notFound : FIRST_PAINT.primitives,
    productionServer
      ? "production primitives 404 first paint"
      : "development primitives gallery first paint",
  );
  await waitForSettledUi(page);
  if (process.env.VERCEL !== "1") {
    await expect(
      page.locator('script[src*="/_vercel/insights/script.js"]'),
    ).toHaveCount(0);
    expect(
      diagnostics.httpErrors.filter((failure) =>
        failure.url.includes("/_vercel/insights/script.js"),
      ),
      "local runs must not make a known-failing Vercel Analytics request",
    ).toEqual([]);
  }
  if (productionServer) {
    consumeExpectedDocumentHttpError(diagnostics, {
      status: 404,
      url: response!.url(),
    });
  } else {
    await expect(page.locator('[data-audit-fixture="loading"]')).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(page.locator('[data-audit-fixture="empty"]')).toContainText(
      "No matching editions",
    );
    await expect(page.locator('[data-audit-fixture="error"]')).toContainText(
      "Something went wrong",
    );
  }
  expectNoUnexpectedDiagnostics(diagnostics);
});
