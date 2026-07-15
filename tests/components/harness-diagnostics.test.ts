import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FRAMER_MOTION_REDUCED_MOTION_DEV_WARNING,
  FIREFOX_FRAME_ANCESTORS_COMPATIBILITY_WARNING,
  auditR2ImageObjectUrl,
  consumeExpectedOptimizedImageFailure,
  createBrowserDiagnostics,
  expectNoUnexpectedDiagnostics,
  isExpectedFramerMotionReducedMotionDevWarning,
  isIgnorableOptimizedImageAbort,
  type FulfilledHttpError,
} from "../e2e/support/harness";

const UPSTREAM_SOURCE =
  "http://127.0.0.1:3000/_next/static/chunks/node_modules_next_dist_1ybzpk2._.js";
const upstreamWarning = `${FRAMER_MOTION_REDUCED_MOTION_DEV_WARNING} [${UPSTREAM_SOURCE}]`;

function diagnosticsWithWarning(warning: string) {
  const diagnostics = createBrowserDiagnostics();
  diagnostics.consoleWarnings.push(warning);
  return diagnostics;
}

function diagnosticsWithFailure(
  kind: "consoleErrors" | "requestFailures",
  failure: string,
) {
  const diagnostics = createBrowserDiagnostics();
  diagnostics[kind].push(failure);
  return diagnostics;
}

describe("browser diagnostics warning exceptions", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("recognizes the exact boot-time upstream warning without weakening the final gate", () => {
    expect(isExpectedFramerMotionReducedMotionDevWarning(upstreamWarning)).toBe(
      true,
    );
    expect(() =>
      expectNoUnexpectedDiagnostics(diagnosticsWithWarning(upstreamWarning)),
    ).toThrow();
  });

  it.each([
    `application prefix: ${upstreamWarning}`,
    `${FRAMER_MOTION_REDUCED_MOTION_DEV_WARNING} application suffix [${UPSTREAM_SOURCE}]`,
    `${FRAMER_MOTION_REDUCED_MOTION_DEV_WARNING} [http://127.0.0.1:3000/_next/static/chunks/src_app_search_page_tsx.js]`,
    `${FRAMER_MOTION_REDUCED_MOTION_DEV_WARNING} [https://example.com/_next/static/chunks/node_modules_next_dist.js]`,
  ])("rejects altered or application-sourced warnings: %s", (warning) => {
    expect(isExpectedFramerMotionReducedMotionDevWarning(warning)).toBe(false);
    expect(() =>
      expectNoUnexpectedDiagnostics(diagnosticsWithWarning(warning)),
    ).toThrow();
  });

  it("never suppresses the warning against a production server", () => {
    vi.stubEnv("PLAYWRIGHT_SERVER_MODE", "production");
    expect(isExpectedFramerMotionReducedMotionDevWarning(upstreamWarning)).toBe(
      false,
    );
    expect(() =>
      expectNoUnexpectedDiagnostics(diagnosticsWithWarning(upstreamWarning)),
    ).toThrow();
  });

  it("accepts only Firefox's exact frame-ancestors compatibility warning", () => {
    expect(() =>
      expectNoUnexpectedDiagnostics(
        diagnosticsWithWarning(FIREFOX_FRAME_ANCESTORS_COMPATIBILITY_WARNING),
      ),
    ).not.toThrow();
    expect(() =>
      expectNoUnexpectedDiagnostics(
        diagnosticsWithWarning(
          `${FIREFOX_FRAME_ANCESTORS_COMPATIBILITY_WARNING} altered`,
        ),
      ),
    ).toThrow();
  });

  it.each([
    {
      kind: "consoleErrors" as const,
      value:
        "error: Failed to load resource: 404 (Not Found) [http://127.0.0.1:3000/_vercel/insights/script.js]",
    },
    {
      kind: "consoleErrors" as const,
      value:
        "error: application prefix /_vercel/insights/script.js application suffix",
    },
    {
      kind: "consoleErrors" as const,
      value:
        "error: Content-Security-Policy blocked va.vercel-scripts.com/v1/script.debug.js [http://127.0.0.1:3000/_next/static/chunks/src_app_page.js]",
    },
    {
      kind: "requestFailures" as const,
      value:
        "GET http://127.0.0.1:3000/_vercel/insights/script.js — csp",
    },
    {
      kind: "requestFailures" as const,
      value:
        "GET https://va.vercel-scripts.com/v1/script.debug.js — csp",
    },
  ])("never suppresses Analytics-shaped $kind: $value", ({ kind, value }) => {
    expect(() =>
      expectNoUnexpectedDiagnostics(diagnosticsWithFailure(kind, value)),
    ).toThrow();
  });
});

describe("ASSET-001 optimized image deferral (consumeExpectedOptimizedImageFailure)", () => {
  const DEFERRED_DATE = "1989-10-25";
  const DEFERRED_OBJECT = "0004_Page 4_img1.webp";
  const DEFERRED_R2_URL = auditR2ImageObjectUrl(DEFERRED_DATE, DEFERRED_OBJECT);

  function optimizerUrl(targetUrl: string, width: number, quality = 75): string {
    return `http://127.0.0.1:3000/_next/image?url=${encodeURIComponent(
      targetUrl,
    )}&w=${width}&q=${quality}`;
  }

  function imageHttpError(
    url: string,
    overrides: Partial<FulfilledHttpError> = {},
  ): FulfilledHttpError {
    return {
      method: "GET",
      resourceType: "image",
      status: 404,
      url,
      ...overrides,
    };
  }

  function loadFailureConsoleError(url: string, status = 404): string {
    return `error: Failed to load resource: the server responded with a status of ${status} (Not Found) [${url}]`;
  }

  function abortedRequestFailure(url: string): string {
    return `GET ${url} — net::ERR_ABORTED`;
  }

  function consumeDeferred(diagnostics: ReturnType<typeof createBrowserDiagnostics>) {
    consumeExpectedOptimizedImageFailure(diagnostics, {
      editionDate: DEFERRED_DATE,
      object: DEFERRED_OBJECT,
    });
  }

  it("consumes the exact mobile-observed optimizer failure triple", () => {
    const diagnostics = createBrowserDiagnostics();
    diagnostics.httpErrors.push(imageHttpError(optimizerUrl(DEFERRED_R2_URL, 640)));
    diagnostics.consoleErrors.push(
      loadFailureConsoleError(optimizerUrl(DEFERRED_R2_URL, 640)),
    );
    diagnostics.requestFailures.push(
      abortedRequestFailure(optimizerUrl(DEFERRED_R2_URL, 256)),
    );

    consumeDeferred(diagnostics);

    expect(() => expectNoUnexpectedDiagnostics(diagnostics)).not.toThrow();
  });

  it("consumes desktop responsive candidate widths for the same object", () => {
    const diagnostics = createBrowserDiagnostics();
    for (const width of [828, 1200]) {
      diagnostics.httpErrors.push(
        imageHttpError(optimizerUrl(DEFERRED_R2_URL, width)),
      );
      diagnostics.consoleErrors.push(
        loadFailureConsoleError(optimizerUrl(DEFERRED_R2_URL, width)),
      );
    }
    diagnostics.requestFailures.push(
      abortedRequestFailure(optimizerUrl(DEFERRED_R2_URL, 1080)),
    );

    consumeDeferred(diagnostics);

    expect(() => expectNoUnexpectedDiagnostics(diagnostics)).not.toThrow();
  });

  it.each([
    {
      name: "different edition date",
      error: imageHttpError(
        optimizerUrl(
          auditR2ImageObjectUrl("1989-10-26", DEFERRED_OBJECT),
          640,
        ),
      ),
    },
    {
      name: "different page filename",
      error: imageHttpError(
        optimizerUrl(
          auditR2ImageObjectUrl(DEFERRED_DATE, "0004_Page 5_img1.webp"),
          640,
        ),
      ),
    },
    {
      name: "different image index",
      error: imageHttpError(
        optimizerUrl(
          auditR2ImageObjectUrl(DEFERRED_DATE, "0005_Page 4_img1.webp"),
          640,
        ),
      ),
    },
    {
      name: "different host",
      error: imageHttpError(
        optimizerUrl(
          `https://cdn.example.com/${DEFERRED_DATE}/images/${DEFERRED_OBJECT}`,
          640,
        ),
      ),
    },
    {
      name: "non-image resource type",
      error: imageHttpError(optimizerUrl(DEFERRED_R2_URL, 640), {
        resourceType: "document",
      }),
    },
    {
      name: "forbidden status",
      error: imageHttpError(optimizerUrl(DEFERRED_R2_URL, 640), { status: 403 }),
    },
    {
      name: "server error status",
      error: imageHttpError(optimizerUrl(DEFERRED_R2_URL, 640), { status: 500 }),
    },
    {
      name: "unoptimized direct R2 url",
      error: imageHttpError(DEFERRED_R2_URL),
    },
  ])("keeps other asset failures fatal: $name", ({ error }) => {
    const diagnostics = createBrowserDiagnostics();
    diagnostics.httpErrors.push(error);

    consumeDeferred(diagnostics);

    expect(() => expectNoUnexpectedDiagnostics(diagnostics)).toThrow();
  });

  it("leaves a different edition's aborted candidate intact", () => {
    // The gate consumes ASSET-001's abort at every edition; a genuinely
    // different edition's abort must survive so its own gate stays fatal.
    const diagnostics = createBrowserDiagnostics();
    diagnostics.requestFailures.push(
      abortedRequestFailure(
        optimizerUrl(auditR2ImageObjectUrl("1989-10-26", DEFERRED_OBJECT), 256),
      ),
    );

    consumeDeferred(diagnostics);

    expect(diagnostics.requestFailures).toHaveLength(1);
    expect(() => expectNoUnexpectedDiagnostics(diagnostics)).toThrow();
  });
});

describe("optimized-image abort exception (isIgnorableOptimizedImageAbort)", () => {
  it.each([
    {
      name: "image resource aborted",
      input: {
        resourceType: "image",
        url: "http://127.0.0.1:3219/_next/image?url=%2F2001-10-10%2Fimages%2F0007_Page%207_img1.webp&w=256&q=75",
        errorText: "net::ERR_ABORTED",
      },
    },
    {
      name: "optimizer URL aborted regardless of resourceType",
      input: {
        resourceType: "other",
        url: "http://127.0.0.1:3219/_next/image?url=%2F2001-10-10%2Fimages%2F0007_Page%207_img1.webp&w=640&q=75",
        errorText: "net::ERR_ABORTED",
      },
    },
  ])("ignores $name", ({ input }) => {
    expect(isIgnorableOptimizedImageAbort(input)).toBe(true);
  });

  it.each([
    {
      name: "document abort",
      input: {
        resourceType: "document",
        url: "http://127.0.0.1:3219/edition/2001-10-10",
        errorText: "net::ERR_ABORTED",
      },
    },
    {
      name: "script abort",
      input: {
        resourceType: "script",
        url: "http://127.0.0.1:3219/_next/static/chunks/main.js",
        errorText: "net::ERR_ABORTED",
      },
    },
    {
      name: "fetch abort",
      input: {
        resourceType: "fetch",
        url: "http://127.0.0.1:3219/api/ask",
        errorText: "net::ERR_ABORTED",
      },
    },
    {
      name: "xhr abort",
      input: {
        resourceType: "xhr",
        url: "http://127.0.0.1:3219/api/search",
        errorText: "net::ERR_ABORTED",
      },
    },
    {
      name: "image connection refused",
      input: {
        resourceType: "image",
        url: "http://127.0.0.1:3219/_next/image?url=%2F2001-10-10%2Fimages%2F0007_Page%207_img1.webp&w=256&q=75",
        errorText: "net::ERR_CONNECTION_REFUSED",
      },
    },
    {
      name: "image timed out",
      input: {
        resourceType: "image",
        url: "http://127.0.0.1:3219/_next/image?url=%2F2001-10-10%2Fimages%2F0007_Page%207_img1.webp&w=256&q=75",
        errorText: "net::ERR_TIMED_OUT",
      },
    },
    {
      name: "non-image non-abort error",
      input: {
        resourceType: "script",
        url: "http://127.0.0.1:3219/_next/static/chunks/main.js",
        errorText: "net::ERR_NAME_NOT_RESOLVED",
      },
    },
  ])("keeps $name fatal", ({ input }) => {
    expect(isIgnorableOptimizedImageAbort(input)).toBe(false);
  });

  it("only filters at collection: a hand-built non-image abort still fails the gate", () => {
    // The predicate runs when the harness records a `requestfailed` event, not
    // inside `expectNoUnexpectedDiagnostics`. Any requestFailure that reaches
    // the gate — like a genuine non-image abort — must still be fatal.
    const diagnostics = createBrowserDiagnostics();
    diagnostics.requestFailures.push(
      "GET http://127.0.0.1:3219/edition/2001-10-10 — net::ERR_ABORTED",
    );

    expect(() => expectNoUnexpectedDiagnostics(diagnostics)).toThrow();
  });
});
