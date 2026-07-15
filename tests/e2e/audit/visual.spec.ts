import { test, expect } from "../fixtures";
import {
  analyzeAccessibility,
  auditViewport,
  captureAuditScreenshot,
  consumeExpectedDocumentHttpError,
  evidencePath,
  expectNoSeriousOrCriticalAxeViolations,
  expectNoUnexpectedDiagnostics,
  expectVisibleNonEmptyFirstPaint,
  waitForSettledUi,
} from "../support/harness";
import { STATIC_AUDIT_ROUTES } from "../support/routes";

test.describe("settled route visual audit", () => {
  for (const route of STATIC_AUDIT_ROUTES) {
    test(`${route.name} settled state`, async ({
      page,
      diagnostics,
    }, testInfo) => {
      const response = await page.goto(route.path);
      const status = response?.status() ?? 0;
      const acceptedStatuses = route.acceptedStatuses ?? [200];

      expect(acceptedStatuses, `${route.path} returned ${status}`).toContain(status);
      await expectVisibleNonEmptyFirstPaint(
        page,
        route.firstPaint,
        `${route.name} first paint`,
      );
      await waitForSettledUi(page);

      const screenshot = await captureAuditScreenshot(
        page,
        evidencePath({
          file: "page.png",
          route: route.name,
          state: "settled",
          viewport: auditViewport(testInfo.project.name),
        }),
      );
      await testInfo.attach("settled-page", {
        path: screenshot,
        contentType: "image/png",
      });

      const axe = await analyzeAccessibility(page);
      await testInfo.attach("axe-results", {
        body: Buffer.from(JSON.stringify(axe, null, 2)),
        contentType: "application/json",
      });

      await expectNoSeriousOrCriticalAxeViolations(page);
      if (status === 404 && acceptedStatuses.includes(404)) {
        expect(response?.request().resourceType()).toBe("document");
        consumeExpectedDocumentHttpError(diagnostics, {
          status: 404,
          url: response!.url(),
        });
      }
      expectNoUnexpectedDiagnostics(diagnostics);
    });
  }
});
