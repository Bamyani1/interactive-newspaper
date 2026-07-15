import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  type ConsoleMessage,
  type Page,
  type Request,
  type Response,
  type Route,
} from "@playwright/test";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FirstPaintExpectation } from "./routes";

export const AUDIT_FULL_DIR = path.resolve("audit-evidence/full");

export interface BrowserStorageSeed {
  localStorage?: Record<string, string>;
  sessionStorage?: Record<string, string>;
}

export interface ApiMock {
  url: string | RegExp;
  method?: string;
  status?: number;
  headers?: Record<string, string>;
  contentType?: string;
  json?: unknown;
  text?: string;
  delayMs?: number;
}

export interface BrowserDiagnostics {
  consoleErrors: string[];
  consoleWarnings: string[];
  httpErrors: FulfilledHttpError[];
  hydrationErrors: string[];
  pageErrors: string[];
  requestFailures: string[];
  cumulativeLayoutShift: number;
}

export interface FulfilledHttpError {
  method: string;
  resourceType: string;
  status: number;
  url: string;
}

export const EMPTY_DIAGNOSTICS: BrowserDiagnostics = {
  consoleErrors: [],
  consoleWarnings: [],
  httpErrors: [],
  hydrationErrors: [],
  pageErrors: [],
  requestFailures: [],
  cumulativeLayoutShift: 0,
};

export function createBrowserDiagnostics(): BrowserDiagnostics {
  return {
    consoleErrors: [],
    consoleWarnings: [],
    httpErrors: [],
    hydrationErrors: [],
    pageErrors: [],
    requestFailures: [],
    cumulativeLayoutShift: 0,
  };
}

function consoleMessageText(message: ConsoleMessage): string {
  const location = message.location().url;
  return `${message.type()}: ${message.text()}${location ? ` [${location}]` : ""}`;
}

/**
 * A Next image-optimizer request that fails with `net::ERR_ABORTED` is a benign
 * browser responsive-candidate cancellation: the browser preloads one srcset
 * width, then aborts it after choosing a different width. Confirmed to occur
 * non-deterministically, mobile-only, on objects that ARE present in R2
 * (HTTP 200) — never a real failure. Only this exact combination is ignored.
 * Missing objects still surface as image 404s through the `onResponse`
 * httpErrors path, and every other request failure stays fatal: non-image
 * aborts (document/script/fetch), non-abort image errors
 * (`ERR_CONNECTION_REFUSED`, `ERR_TIMED_OUT`, `ERR_NAME_NOT_RESOLVED`, …), and
 * all console/page/hydration diagnostics.
 */
export function isIgnorableOptimizedImageAbort(input: {
  resourceType: string;
  url: string;
  errorText: string;
}): boolean {
  const isImageOptimizerRequest =
    input.resourceType === "image" || input.url.includes("/_next/image");
  return isImageOptimizerRequest && input.errorText.includes("ERR_ABORTED");
}

export function observeBrowserDiagnostics(
  page: Page,
  diagnostics: BrowserDiagnostics,
): () => void {
  let mayConsumeDocumentBootMotionWarning = true;
  let documentBootTimer: ReturnType<typeof setTimeout> | undefined;
  const openDocumentBootWindow = () => {
    mayConsumeDocumentBootMotionWarning = true;
    if (documentBootTimer) clearTimeout(documentBootTimer);
    documentBootTimer = undefined;
  };
  const onConsole = (message: ConsoleMessage) => {
    const text = consoleMessageText(message);
    if (message.type() === "error") diagnostics.consoleErrors.push(text);
    if (
      message.type() === "warning" &&
      mayConsumeDocumentBootMotionWarning &&
      isExpectedFramerMotionReducedMotionDevWarning(text)
    ) {
      mayConsumeDocumentBootMotionWarning = false;
      if (documentBootTimer) clearTimeout(documentBootTimer);
      return;
    }
    if (message.type() === "warning") {
      diagnostics.consoleWarnings.push(text);
    }
    if (/hydration|did not match|server rendered html/i.test(text)) {
      diagnostics.hydrationErrors.push(text);
    }
  };
  const onLoad = () => {
    // Motion's reduced-motion effect runs just after the load event. Keep the
    // exception one-shot per full document and close its boot window before
    // settled assertions. Client-side navigations never reopen this window.
    documentBootTimer = setTimeout(() => {
      mayConsumeDocumentBootMotionWarning = false;
    }, 250);
  };
  const onRequest = (request: Request) => {
    if (
      request.isNavigationRequest() &&
      request.resourceType() === "document" &&
      request.frame() === page.mainFrame()
    ) {
      openDocumentBootWindow();
    }
  };
  const onPageError = (error: Error) => {
    diagnostics.pageErrors.push(error.stack ?? error.message);
  };
  const onRequestFailed = (request: Request) => {
    const errorText = request.failure()?.errorText ?? "unknown failure";
    // A Next image-optimizer request aborted mid-flight is a benign browser
    // responsive-candidate cancellation, not a real failure — never record it.
    // Image 404s (missing objects) still surface via `onResponse`, and every
    // other request failure stays fatal. See isIgnorableOptimizedImageAbort.
    if (
      isIgnorableOptimizedImageAbort({
        resourceType: request.resourceType(),
        url: request.url(),
        errorText,
      })
    ) {
      return;
    }
    diagnostics.requestFailures.push(
      `${request.method()} ${request.url()} — ${errorText}`,
    );
  };
  const onResponse = (response: Response) => {
    if (response.status() < 400) return;
    const request = response.request();
    diagnostics.httpErrors.push({
      method: request.method(),
      resourceType: request.resourceType(),
      status: response.status(),
      url: response.url(),
    });
  };

  page.on("console", onConsole);
  page.on("load", onLoad);
  page.on("request", onRequest);
  page.on("pageerror", onPageError);
  page.on("requestfailed", onRequestFailed);
  page.on("response", onResponse);

  return () => {
    page.off("console", onConsole);
    page.off("load", onLoad);
    page.off("request", onRequest);
    page.off("pageerror", onPageError);
    page.off("requestfailed", onRequestFailed);
    page.off("response", onResponse);
    if (documentBootTimer) clearTimeout(documentBootTimer);
  };
}

export function resetBrowserDiagnostics(
  diagnostics: BrowserDiagnostics,
): void {
  diagnostics.consoleErrors.length = 0;
  diagnostics.consoleWarnings.length = 0;
  diagnostics.httpErrors.length = 0;
  diagnostics.hydrationErrors.length = 0;
  diagnostics.pageErrors.length = 0;
  diagnostics.requestFailures.length = 0;
  diagnostics.cumulativeLayoutShift = 0;
}

export async function installBrowserStorage(
  page: Page,
  seed: BrowserStorageSeed,
): Promise<void> {
  await page.addInitScript((initialStorage) => {
    window.localStorage.clear();
    window.sessionStorage.clear();

    for (const [key, value] of Object.entries(
      initialStorage.localStorage ?? {},
    )) {
      window.localStorage.setItem(key, value);
    }
    for (const [key, value] of Object.entries(
      initialStorage.sessionStorage ?? {},
    )) {
      window.sessionStorage.setItem(key, value);
    }
  }, seed);
}

export async function installApiMocks(
  page: Page,
  mocks: ApiMock[],
): Promise<void> {
  for (const mock of mocks) {
    await page.route(mock.url, async (route: Route) => {
      if (
        mock.method &&
        route.request().method().toUpperCase() !== mock.method.toUpperCase()
      ) {
        await route.fallback();
        return;
      }

      if (mock.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, mock.delayMs));
      }

      const headers = {
        "cache-control": "no-store",
        ...mock.headers,
      };

      if (mock.json !== undefined) {
        await route.fulfill({
          status: mock.status ?? 200,
          headers,
          json: mock.json,
        });
        return;
      }

      await route.fulfill({
        status: mock.status ?? 200,
        headers,
        contentType: mock.contentType ?? "text/plain; charset=utf-8",
        body: mock.text ?? "",
      });
    });
  }
}

export async function installCumulativeLayoutShiftObserver(
  page: Page,
): Promise<void> {
  await page.addInitScript(() => {
    const auditWindow = window as Window & {
      __auditCls?: number;
      __auditClsSamples?: Array<{
        sources: Array<{
          currentRect: DOMRectReadOnly;
          node: string;
          previousRect: DOMRectReadOnly;
        }>;
        value: number;
      }>;
    };
    auditWindow.__auditCls = 0;
    auditWindow.__auditClsSamples = [];

    if (!("PerformanceObserver" in window)) return;
    if (
      Array.isArray(PerformanceObserver.supportedEntryTypes) &&
      !PerformanceObserver.supportedEntryTypes.includes("layout-shift")
    ) {
      return;
    }

    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const layoutShift = entry as PerformanceEntry & {
            hadRecentInput: boolean;
            value: number;
          };
          if (!layoutShift.hadRecentInput) {
            auditWindow.__auditCls =
              (auditWindow.__auditCls ?? 0) + layoutShift.value;
            const sources = (
              layoutShift as PerformanceEntry & {
                sources?: Array<{
                  currentRect: DOMRectReadOnly;
                  node?: Node | null;
                  previousRect: DOMRectReadOnly;
                }>;
              }
            ).sources ?? [];
            auditWindow.__auditClsSamples?.push({
              value: layoutShift.value,
              sources: sources.map((source) => {
                const element =
                  source.node instanceof Element ? source.node : null;
                return {
                  currentRect: source.currentRect,
                  node: element
                    ? element.id
                      ? `#${element.id}`
                      : `${element.tagName.toLowerCase()}${
                          element.classList.length > 0
                            ? `.${[...element.classList].join(".")}`
                            : ""
                        }`
                    : "unknown",
                  previousRect: source.previousRect,
                };
              }),
            });
          }
        }
      });
      observer.observe({ type: "layout-shift", buffered: true });
    } catch {
      // Older engines may not expose LayoutShift entries.
    }
  });
}

export async function readCumulativeLayoutShiftSamples(page: Page) {
  return page.evaluate(() => {
    const auditWindow = window as Window & {
      __auditClsSamples?: Array<{
        sources: Array<{
          currentRect: DOMRectReadOnly;
          node: string;
          previousRect: DOMRectReadOnly;
        }>;
        value: number;
      }>;
    };
    return auditWindow.__auditClsSamples ?? [];
  });
}

export async function readCumulativeLayoutShift(page: Page): Promise<number> {
  return page.evaluate(() => {
    const auditWindow = window as Window & { __auditCls?: number };
    return auditWindow.__auditCls ?? 0;
  });
}

export async function waitForSettledUi(
  page: Page,
  settleMs = 250,
): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await page
    .waitForLoadState("networkidle", { timeout: 5_000 })
    .catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(settleMs);
}

export async function analyzeAccessibility(page: Page) {
  return new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
}

export async function expectNoSeriousOrCriticalAxeViolations(
  page: Page,
): Promise<void> {
  const results = await analyzeAccessibility(page);
  const blocking = results.violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );

  expect(
    blocking.map(({ id, impact, help, nodes }) => ({
      id,
      impact,
      help,
      targets: nodes.map((node) => node.target),
    })),
  ).toEqual([]);
}

export const FRAMER_MOTION_REDUCED_MOTION_DEV_WARNING =
  "warning: You have Reduced Motion enabled on your device. Animations may not appear as expected.. For more information and steps for solving, visit https://motion.dev/troubleshooting/reduced-motion-disabled";

export const FIREFOX_FRAME_ANCESTORS_COMPATIBILITY_WARNING =
  "warning: [JavaScript Warning: \"Content-Security-Policy: Ignoring ‘x-frame-options’ because of ‘frame-ancestors’ directive.\"]";

/**
 * Framer Motion 12 emits this development-only warning while the first
 * document boots whenever the browser explicitly prefers reduced motion, even
 * when MotionConfig correctly uses `reducedMotion="user"`. The observer uses
 * this predicate only once during the initial load's tightly bounded boot
 * window. The final diagnostics gate remains strict so an application cannot
 * impersonate it after the UI settles.
 */
export function isExpectedFramerMotionReducedMotionDevWarning(
  warning: string,
): boolean {
  if (process.env.PLAYWRIGHT_SERVER_MODE === "production") return false;

  const prefix = `${FRAMER_MOTION_REDUCED_MOTION_DEV_WARNING} [`;
  if (!warning.startsWith(prefix) || !warning.endsWith("]")) return false;

  const source = warning.slice(prefix.length, -1);
  try {
    const url = new URL(source);
    const isLocalDevelopmentSource =
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost");
    return (
      isLocalDevelopmentSource &&
      /^\/_next\/static\/chunks\/node_modules_[A-Za-z0-9._-]+\.js$/.test(
        url.pathname,
      )
    );
  } catch {
    return false;
  }
}

function isExpectedBrowserCompatibilityWarning(warning: string): boolean {
  // Keeping X-Frame-Options alongside CSP frame-ancestors is intentional
  // defense in depth for legacy clients. Firefox reports that it is using the
  // modern directive; it is not an application warning or a failed policy.
  return warning === FIREFOX_FRAME_ANCESTORS_COMPATIBILITY_WARNING;
}

export function expectNoUnexpectedDiagnostics(
  diagnostics: BrowserDiagnostics,
): void {
  const appConsoleWarnings = diagnostics.consoleWarnings.filter(
    (warning) => !isExpectedBrowserCompatibilityWarning(warning),
  );

  expect({
    consoleErrors: diagnostics.consoleErrors,
    consoleWarnings: appConsoleWarnings,
    httpErrors: diagnostics.httpErrors,
    hydrationErrors: diagnostics.hydrationErrors,
    pageErrors: diagnostics.pageErrors,
    requestFailures: diagnostics.requestFailures,
  }).toEqual({
    consoleErrors: [],
    consoleWarnings: [],
    httpErrors: [],
    hydrationErrors: [],
    pageErrors: [],
    requestFailures: [],
  });
}

function isSameOriginChromiumNoJsChunkCspFailure(
  failure: string,
  origin: string,
): boolean {
  const match = failure.match(/^GET (\S+) — csp$/i);
  if (!match) return false;

  try {
    const url = new URL(match[1]);
    return (
      url.origin === new URL(origin).origin &&
      /^\/_next\/static\/chunks\/.+\.js$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

/**
 * JavaScript-disabled Chromium reports its own same-origin Next chunk requests
 * as CSP failures. This allowance is deliberately isolated from the normal
 * diagnostics gate so CSP failures can never disappear from JavaScript-on
 * coverage or from another browser.
 */
export function expectNoUnexpectedNoJsDiagnostics(
  diagnostics: BrowserDiagnostics,
  {
    browserName,
    origin,
  }: {
    browserName: string;
    origin: string;
  },
): void {
  const requestFailures =
    browserName === "chromium"
      ? diagnostics.requestFailures.filter(
          (failure) =>
            !isSameOriginChromiumNoJsChunkCspFailure(failure, origin),
        )
      : diagnostics.requestFailures;

  expectNoUnexpectedDiagnostics({ ...diagnostics, requestFailures });
}

/** Consume one explicitly expected top-level HTTP error before the strict gate. */
export function consumeExpectedDocumentHttpError(
  diagnostics: BrowserDiagnostics,
  {
    status,
    url,
  }: {
    status: number;
    url: string;
  },
): void {
  const matchingHttpErrors = diagnostics.httpErrors
    .map((failure, index) => ({ failure, index }))
    .filter(
      ({ failure }) =>
        failure.method === "GET" &&
        failure.resourceType === "document" &&
        failure.status === status &&
        failure.url === url,
    );

  expect(
    matchingHttpErrors,
    `expected one fulfilled document HTTP ${status} for ${url}`,
  ).toHaveLength(1);
  diagnostics.httpErrors.splice(matchingHttpErrors[0].index, 1);

  const consoleErrorIndex = diagnostics.consoleErrors.findIndex(
    (error) =>
      error.startsWith("error: Failed to load resource:") &&
      error.includes(`${status} (`) &&
      error.endsWith(`[${url}]`),
  );
  if (consoleErrorIndex !== -1) {
    diagnostics.consoleErrors.splice(consoleErrorIndex, 1);
  }
}

// The one R2 object that was never uploaded (see ASSET-001). The `<host>`
// half of a `_next/image` optimizer URL carries the server port, which varies
// per run, so the deferral keys on the decoded `url` query parameter — the
// stable R2 object address — never on the outer optimizer host or width.
const AUDIT_R2_IMAGE_HOST =
  "https://pub-6b4b0bceb63e48c1af6578ad09beb2e5.r2.dev";

export function auditR2ImageObjectUrl(
  editionDate: string,
  object: string,
): string {
  return `${AUDIT_R2_IMAGE_HOST}/${editionDate}/images/${object}`;
}

function isOptimizedImageRequestForObject(
  rawUrl: string,
  exactObjectUrl: string,
): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.pathname !== "/_next/image") return false;
  // `URLSearchParams` percent-decodes, so the encoded R2 address collapses back
  // to its exact object string (spaces and all) for a strict equality check.
  return url.searchParams.get("url") === exactObjectUrl;
}

function bracketedSourceUrl(consoleError: string): string | null {
  if (!consoleError.endsWith("]")) return null;
  const open = consoleError.lastIndexOf("[");
  if (open === -1) return null;
  return consoleError.slice(open + 1, -1);
}

function spliceMatching<T>(items: T[], predicate: (item: T) => boolean): void {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) items.splice(index, 1);
  }
}

/**
 * Tolerantly consume the responsive-candidate failures Next's image optimizer
 * emits for a single R2 object that is absent upstream (ASSET-001). Desktop and
 * mobile request different candidate widths for the same object, so this keys
 * on the exact decoded R2 object address rather than any width. It splices every
 * matching entry and no-ops when none are present, so restoring the R2 object
 * cannot break the suite. Any other asset failure — a different object, date,
 * host, non-image resource, non-404 status, or a plain (non-`_next/image`) URL —
 * is left untouched so the strict diagnostics gate stays fatal.
 */
export function consumeExpectedOptimizedImageFailure(
  diagnostics: BrowserDiagnostics,
  {
    editionDate,
    object,
  }: {
    editionDate: string;
    object: string;
  },
): void {
  const exactObjectUrl = auditR2ImageObjectUrl(editionDate, object);

  spliceMatching(
    diagnostics.httpErrors,
    (failure) =>
      failure.method === "GET" &&
      failure.resourceType === "image" &&
      failure.status === 404 &&
      isOptimizedImageRequestForObject(failure.url, exactObjectUrl),
  );

  spliceMatching(diagnostics.consoleErrors, (error) => {
    if (!error.startsWith("error: Failed to load resource:")) return false;
    if (!error.includes("404 (")) return false;
    const source = bracketedSourceUrl(error);
    return (
      source !== null &&
      isOptimizedImageRequestForObject(source, exactObjectUrl)
    );
  });

  spliceMatching(diagnostics.requestFailures, (failure) => {
    const match = /^GET (\S+) — (.+)$/.exec(failure);
    if (!match || !match[2].includes("ERR_ABORTED")) return false;
    return isOptimizedImageRequestForObject(match[1], exactObjectUrl);
  });
}

interface FirstPaintSnapshot {
  content: string;
  height: number;
  hiddenAncestor: string | null;
  visible: boolean;
  width: number;
}

async function readFirstPaintSnapshot(
  page: Page,
  expectation: FirstPaintExpectation,
): Promise<FirstPaintSnapshot | null> {
  const locator = page.locator(expectation.selector).first();
  if ((await locator.count()) === 0) return null;

  return locator.evaluate((element) => {
    const htmlElement = element as HTMLElement;
    const text = (htmlElement.textContent ?? "").replace(/\s+/g, " ").trim();
    const value =
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
        ? element.value
        : "";
    const content =
      text ||
      value ||
      element.getAttribute("placeholder") ||
      element.getAttribute("aria-label") ||
      element.getAttribute("alt") ||
      "";
    const rect = htmlElement.getBoundingClientRect();
    let hiddenAncestor: string | null = null;
    let ancestor: Element | null = element;

    while (ancestor) {
      const style = window.getComputedStyle(ancestor);
      const opacity = Number.parseFloat(style.opacity || "1");
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse" ||
        opacity <= 0.01
      ) {
        hiddenAncestor =
          ancestor.id ||
          ancestor.getAttribute("class") ||
          ancestor.tagName.toLowerCase();
        break;
      }
      ancestor = ancestor.parentElement;
    }

    return {
      content,
      height: rect.height,
      hiddenAncestor,
      visible: !hiddenAncestor && rect.width > 0 && rect.height > 0,
      width: rect.width,
    };
  });
}

function snapshotMatches(
  snapshot: FirstPaintSnapshot | null,
  expectation: FirstPaintExpectation,
): boolean {
  if (!snapshot?.visible || !snapshot.content.trim()) return false;
  if (!expectation.expectedText) return true;
  return typeof expectation.expectedText === "string"
    ? snapshot.content.includes(expectation.expectedText)
    : expectation.expectedText.test(snapshot.content);
}

export async function expectVisibleNonEmptyFirstPaint(
  page: Page,
  expectation: FirstPaintExpectation,
  label: string,
): Promise<void> {
  await expect(
    page.locator(expectation.selector).first(),
    `${label}: expected first-paint selector ${expectation.selector}`,
  ).toBeAttached({ timeout: 1_000 });
  const snapshot = await readFirstPaintSnapshot(page, expectation);

  expect(
    snapshotMatches(snapshot, expectation),
    `${label}: first paint must be visible and nonempty (${JSON.stringify(snapshot)})`,
  ).toBe(true);
}

export async function expectOneOfFirstPaint(
  page: Page,
  expectations: FirstPaintExpectation[],
  label: string,
): Promise<void> {
  let snapshots: Array<FirstPaintSnapshot | null> = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      // Read every candidate in one browser task. Separate locator evaluations
      // can straddle an atomic App Router commit and falsely report that both
      // the outgoing and incoming surfaces were absent.
      snapshots = await page.evaluate((selectors) => {
        const read = (selector: string): FirstPaintSnapshot | null => {
          const element = document.querySelector(selector);
          if (!element) return null;
          const htmlElement = element as HTMLElement;
          const text = (htmlElement.textContent ?? "")
            .replace(/\s+/g, " ")
            .trim();
          const value =
            element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement ||
            element instanceof HTMLSelectElement
              ? element.value
              : "";
          const content =
            text ||
            value ||
            element.getAttribute("placeholder") ||
            element.getAttribute("aria-label") ||
            element.getAttribute("alt") ||
            "";
          const rect = htmlElement.getBoundingClientRect();
          let hiddenAncestor: string | null = null;
          let ancestor: Element | null = element;
          while (ancestor) {
            const style = window.getComputedStyle(ancestor);
            const opacity = Number.parseFloat(style.opacity || "1");
            if (
              style.display === "none" ||
              style.visibility === "hidden" ||
              style.visibility === "collapse" ||
              opacity <= 0.01
            ) {
              hiddenAncestor =
                ancestor.id ||
                ancestor.getAttribute("class") ||
                ancestor.tagName.toLowerCase();
              break;
            }
            ancestor = ancestor.parentElement;
          }
          return {
            content,
            height: rect.height,
            hiddenAncestor,
            visible: !hiddenAncestor && rect.width > 0 && rect.height > 0,
            width: rect.width,
          };
        };
        return selectors.map(read);
      }, expectations.map((expectation) => expectation.selector));
      break;
    } catch (error) {
      if (
        attempt === 2 ||
        !/execution context was destroyed|navigation/i.test(String(error))
      ) {
        throw error;
      }
      await page.waitForTimeout(10);
    }
  }
  const matched = expectations.some((expectation, index) =>
    snapshotMatches(snapshots[index], expectation),
  );

  expect(
    matched,
    `${label}: expected one coherent route surface (${JSON.stringify(snapshots)})`,
  ).toBe(true);
}

export function routeSlug(route: string): string {
  if (route === "/") return "landing";
  return route
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .toLowerCase();
}

export type EvidencePhase = "before" | "after";

export function evidencePhase(): EvidencePhase {
  const phase = process.env.AUDIT_PHASE ?? "after";
  if (phase !== "before" && phase !== "after") {
    throw new Error(`AUDIT_PHASE must be before or after, received: ${phase}`);
  }
  return phase;
}

export function auditViewport(projectName: string): string {
  if (projectName === "chromium-desktop") return "desktop-1440x900";
  if (projectName === "chromium-mobile") return "mobile-390x844";
  if (projectName === "firefox-smoke") return "firefox-1440x900";
  if (projectName === "webkit-smoke") return "webkit-1440x900";
  return routeSlug(projectName);
}

export function evidencePath({
  file,
  phase = evidencePhase(),
  route,
  state,
  viewport,
}: {
  file: string;
  phase?: EvidencePhase;
  route: string;
  state: string;
  viewport: string;
}): string {
  return path.join(
    phase,
    routeSlug(route),
    routeSlug(state),
    routeSlug(viewport),
    file,
  );
}

function portableAuditPath(outputPath: string): string {
  return path.relative(process.cwd(), outputPath).split(path.sep).join("/");
}

export async function captureAuditScreenshot(
  page: Page,
  relativePath: string,
  { fullPage = true }: { fullPage?: boolean } = {},
): Promise<string> {
  const outputPath = path.resolve(AUDIT_FULL_DIR, relativePath);
  if (!outputPath.startsWith(`${AUDIT_FULL_DIR}${path.sep}`)) {
    throw new Error(`Audit output escapes audit-evidence/full: ${relativePath}`);
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  // Avoid Playwright's default temporary `caret-color: transparent` mutation
  // manufacturing a React hydration mismatch during transition capture.
  await page.screenshot({ path: outputPath, fullPage, caret: "initial" });
  return portableAuditPath(outputPath);
}

export async function writeAuditJson(
  relativePath: string,
  value: unknown,
): Promise<string> {
  const outputPath = path.resolve(AUDIT_FULL_DIR, relativePath);
  if (!outputPath.startsWith(`${AUDIT_FULL_DIR}${path.sep}`)) {
    throw new Error(`Audit output escapes audit-evidence/full: ${relativePath}`);
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return portableAuditPath(outputPath);
}

interface FilmstripOptions {
  assertFrame?: (elapsedMs: number) => Promise<void>;
  outputDir: string;
  prefix: string;
  requestedTimes?: number[];
}

export interface FilmstripFrame {
  elapsedMs: number;
  path: string;
  requestedMs: number;
}

export async function captureFilmstrip(
  page: Page,
  trigger: () => Promise<unknown>,
  {
    outputDir,
    prefix,
    requestedTimes = [0, 50, 100, 250, 500, 1_000],
    assertFrame,
  }: FilmstripOptions,
): Promise<FilmstripFrame[]> {
  const startedAt = performance.now();
  const action = trigger();
  const frames: FilmstripFrame[] = [];

  for (const [index, requestedMs] of requestedTimes.entries()) {
    const remaining = requestedMs - (performance.now() - startedAt);
    if (remaining > 0) await page.waitForTimeout(remaining);
    const elapsedMs = Math.max(0, Math.round(performance.now() - startedAt));
    await assertFrame?.(elapsedMs);
    const screenshotPath = await captureAuditScreenshot(
      page,
      path.join(
        outputDir,
        `${prefix}-${String(index).padStart(2, "0")}-${elapsedMs}ms.png`,
      ),
    );
    frames.push({ elapsedMs, path: screenshotPath, requestedMs });
  }

  await action;
  return frames;
}

const EDITION_DATE = /^\d{4}-\d{2}-\d{2}$/;

async function editionDirectories(directory: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return [];
  }

  const dates: string[] = [];
  for (const entry of entries) {
    if (!EDITION_DATE.test(entry)) continue;
    const entryStats = await stat(path.join(directory, entry));
    if (entryStats.isDirectory()) dates.push(entry);
  }
  return dates;
}

export async function discoverLocalEditionDates(): Promise<string[]> {
  const dates = await Promise.all([
    editionDirectories(path.resolve("public/editions")),
    editionDirectories(path.resolve("gold")),
  ]);
  return [...new Set(dates.flat())].sort();
}
