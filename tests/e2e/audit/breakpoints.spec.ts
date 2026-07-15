import { test, expect, type Page } from "../fixtures";
import {
  analyzeAccessibility,
  captureAuditScreenshot,
  consumeExpectedDocumentHttpError,
  expectNoUnexpectedDiagnostics,
  expectVisibleNonEmptyFirstPaint,
  resetBrowserDiagnostics,
  routeSlug,
  waitForSettledUi,
  writeAuditJson,
  type BrowserDiagnostics,
} from "../support/harness";
import {
  DEEP_TEST_EDITIONS,
  FIRST_PAINT,
  STATIC_AUDIT_ROUTES,
  type AuditRoute,
} from "../support/routes";

interface BreakpointProbe {
  axe: boolean;
  height: number;
  name: string;
  width: number;
}

interface TargetAuditEntry {
  cursor: string;
  descriptor: string;
  exceptionAttribute: string | null;
  exceptionAttributeValue: string | null;
  exceptionJustification: string | null;
  height: number;
  tag: string;
  width: number;
}

const BREAKPOINT_PROBES: BreakpointProbe[] = [
  { axe: true, height: 844, name: "below-640", width: 639 },
  { axe: false, height: 844, name: "above-640", width: 641 },
  { axe: false, height: 900, name: "below-768", width: 767 },
  { axe: true, height: 900, name: "above-768", width: 769 },
  { axe: false, height: 900, name: "below-1024", width: 1023 },
  { axe: true, height: 900, name: "above-1024", width: 1025 },
];

const DEEP_EDITION_ROUTES: AuditRoute[] = DEEP_TEST_EDITIONS.map((date) => ({
  name: `edition-${date}`,
  path: `/edition/${date}`,
  firstPaint: FIRST_PAINT.edition,
}));

const BREAKPOINT_ROUTES = [
  ...STATIC_AUDIT_ROUTES,
  ...DEEP_EDITION_ROUTES,
];

const INTERACTIVE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button",
  "input:not([type='hidden'])",
  "select",
  "textarea",
  "summary",
  "[contenteditable='true']",
  "[onclick]",
  "[role='button']",
  "[role='checkbox']",
  "[role='link']",
  "[role='menuitem']",
  "[role='menuitemcheckbox']",
  "[role='menuitemradio']",
  "[role='option']",
  "[role='radio']",
  "[role='switch']",
  "[role='tab']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

async function auditVisiblePointerTargets(
  page: Page,
): Promise<TargetAuditEntry[]> {
  return page.locator(INTERACTIVE_SELECTOR).evaluateAll((elements) =>
    elements.flatMap((element): TargetAuditEntry[] => {
      if (!(element instanceof HTMLElement)) return [];
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const root = element.getRootNode();
      const shadowHost = root instanceof ShadowRoot ? root.host : null;
      const isInjectedNextDevelopmentTool =
        element.id === "next-logo" ||
        Boolean(shadowHost?.closest("nextjs-portal"));
      const isRendered =
        rect.width > 0 &&
        rect.height > 0 &&
        rect.right > 0 &&
        rect.left <
          Math.max(document.documentElement.scrollWidth, window.innerWidth) &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.visibility !== "collapse" &&
        Number.parseFloat(style.opacity || "1") > 0.01 &&
        style.pointerEvents !== "none" &&
        !element.closest("[inert]") &&
        !isInjectedNextDevelopmentTool;
      if (!isRendered) return [];

      const label =
        element.getAttribute("aria-label") ??
        element.getAttribute("title") ??
        (element.textContent ?? "").replace(/\s+/g, " ").trim() ??
        element.id;
      const descriptor = `${element.tagName.toLowerCase()}${
        element.id ? `#${element.id}` : ""
      }${label ? ` \"${label.slice(0, 100)}\"` : ""}`;

      const exceptionAttribute = "data-audit-inline-text-link";
      const exceptionAttributeValue = element.getAttribute(exceptionAttribute);
      const exceptionJustification = exceptionAttributeValue?.trim() ?? "";
      // No structural inference is allowed here. An inline-link exception is
      // valid only when that exact anchor carries a nonempty justification.
      const isExplicitInlineTextLink =
        element.tagName === "A" && exceptionJustification.length > 0;

      return [
        {
          cursor: style.cursor,
          descriptor,
          exceptionAttribute:
            exceptionAttributeValue === null ? null : exceptionAttribute,
          exceptionAttributeValue,
          exceptionJustification: isExplicitInlineTextLink
            ? exceptionJustification
            : null,
          height: rect.height,
          tag: element.tagName.toLowerCase(),
          width: rect.width,
        },
      ];
    }),
  );
}

async function expectNoHorizontalOverflow(page: Page, label: string) {
  const widths = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(widths.document, `${label}: document overflow ${JSON.stringify(widths)}`).toBeLessThanOrEqual(
    widths.viewport,
  );
  expect(widths.body, `${label}: body overflow ${JSON.stringify(widths)}`).toBeLessThanOrEqual(
    widths.viewport,
  );
}

function expectStrictDiagnostics(
  diagnostics: BrowserDiagnostics,
  label: string,
) {
  expect(
    {
      consoleErrors: diagnostics.consoleErrors,
      consoleWarnings: diagnostics.consoleWarnings,
      httpErrors: diagnostics.httpErrors,
      hydrationErrors: diagnostics.hydrationErrors,
      pageErrors: diagnostics.pageErrors,
      requestFailures: diagnostics.requestFailures,
    },
    `${label}: browser diagnostics`,
  ).toEqual({
    consoleErrors: [],
    consoleWarnings: [],
    httpErrors: [],
    hydrationErrors: [],
    pageErrors: [],
    requestFailures: [],
  });
}

test.describe("route-wide breakpoint boundary audit", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/weather**", (route) =>
      route.fulfill({
        status: 200,
        headers: { "cache-control": "no-store" },
        json: {
          record: null,
          reason: "No deterministic weather record for this audit fixture.",
        },
      }),
    );
  });

  for (const probe of BREAKPOINT_PROBES) {
    test(`${probe.name}: ${probe.width}px`, async ({
      page,
      diagnostics,
    }) => {
      test.setTimeout(15 * 60 * 1_000);
      await page.setViewportSize({ width: probe.width, height: probe.height });

      for (const route of BREAKPOINT_ROUTES) {
        const label = `${route.name} at ${probe.width}x${probe.height}`;
        const response = await page.goto(route.path);
        const status = response?.status() ?? 0;
        const acceptedStatuses = route.acceptedStatuses ?? [200];
        expect(acceptedStatuses, `${label}: HTTP ${status}`).toContain(status);

        await expectVisibleNonEmptyFirstPaint(
          page,
          route.firstPaint,
          `${label} primary content`,
        );
        await waitForSettledUi(page, 100);
        const main = page.locator("main").first();
        await expect(main, `${label}: main landmark`).toBeVisible();
        expect(
          await main.evaluate((element) =>
            (element.textContent ?? "").replace(/\s+/g, " ").trim(),
          ),
          `${label}: nonempty main landmark`,
        ).not.toBe("");

        await expectNoHorizontalOverflow(page, label);
        const targets = await auditVisiblePointerTargets(page);
        const invalidExceptionMarkers = targets.filter(
          (target) =>
            target.exceptionAttribute !== null &&
            target.exceptionJustification === null,
        );
        expect(
          invalidExceptionMarkers,
          `${label}: inline-link exception markers require a nonempty justification on an anchor`,
        ).toEqual([]);
        const undersized = targets.filter(
          (target) =>
            !target.exceptionJustification &&
            (target.width < 43.99 || target.height < 43.99),
        );
        expect(
          undersized,
          `${label}: every rendered pointer target must be at least 44x44px`,
        ).toEqual([]);

        const evidenceRoot = `after/breakpoints/${routeSlug(route.name)}/${probe.width}x${probe.height}`;
        await Promise.all([
          captureAuditScreenshot(page, `${evidenceRoot}/page.png`, {
            fullPage: false,
          }),
          writeAuditJson(`${evidenceRoot}/pointer-targets.json`, {
            inlineTextLinkExceptions: targets.filter(
              (target) => target.exceptionJustification,
            ),
            minimumTargetPx: 44,
            probe,
            route: route.path,
            targetCount: targets.length,
            violations: undersized,
          }),
        ]);

        if (probe.axe) {
          const axe = await analyzeAccessibility(page);
          const blocking = axe.violations.filter(
            (violation) =>
              violation.impact === "serious" ||
              violation.impact === "critical",
          );
          await writeAuditJson(`${evidenceRoot}/axe.json`, {
            checkedAtRepresentativeWidth: true,
            violations: blocking.map(({ help, id, impact, nodes }) => ({
              help,
              id,
              impact,
              targets: nodes.map((node) => node.target),
            })),
          });
          expect(blocking, `${label}: serious/critical axe findings`).toEqual([]);
        }

        if (status === 404 && acceptedStatuses.includes(404)) {
          consumeExpectedDocumentHttpError(diagnostics, {
            status: 404,
            url: response!.url(),
          });
        }
        expectStrictDiagnostics(diagnostics, label);
        expectNoUnexpectedDiagnostics(diagnostics);
        resetBrowserDiagnostics(diagnostics);
      }
    });
  }
});
