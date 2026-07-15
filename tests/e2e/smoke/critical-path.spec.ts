import { test, expect } from "../fixtures";
import {
  consumeExpectedDocumentHttpError,
  createBrowserDiagnostics,
  expectNoUnexpectedDiagnostics,
  expectNoUnexpectedNoJsDiagnostics,
  expectVisibleNonEmptyFirstPaint,
  observeBrowserDiagnostics,
  waitForSettledUi,
} from "../support/harness";
import { FIXED_ASK_SESSION_ID } from "../support/deterministic";
import { CRITICAL_ROUTES, FIRST_PAINT } from "../support/routes";

test.describe("critical route smoke", () => {
  for (const route of CRITICAL_ROUTES) {
    test(`${route.name} renders coherent document content`, async ({
      page,
      diagnostics,
    }) => {
      const response = await page.goto(route.path);

      expect(response, `${route.path} should return a response`).not.toBeNull();
      expect(response?.status(), `${route.path} should not return 5xx`).toBeLessThan(500);
      await expectVisibleNonEmptyFirstPaint(
        page,
        route.firstPaint,
        `${route.name} first paint`,
      );
      await waitForSettledUi(page);
      expectNoUnexpectedDiagnostics(diagnostics);
    });
  }

  test("Ask deep link is fulfilled by the local stream fixture", async ({
    page,
    diagnostics,
  }) => {
    const streamResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/ask" &&
        response.request().method() === "POST"
      );
    });

    const response = await page.goto(
      "/ask?q=Who%20edited%20the%20paper%3F",
    );
    expect(response?.status()).toBe(200);
    await expectVisibleNonEmptyFirstPaint(
      page,
      FIRST_PAINT.ask,
      "Ask deep-link first paint",
    );

    const mockedResponse = await streamResponse;
    expect(mockedResponse.headers()["x-audit-fixture"]).toBe(
      "deterministic-ask-stream",
    );
    expect(mockedResponse.headers()["content-type"]).toContain(
      "text/event-stream",
    );
    expect(mockedResponse.request().postDataJSON()).toMatchObject({
      question: "Who edited the paper?",
      sessionId: FIXED_ASK_SESSION_ID,
    });
    await waitForSettledUi(page);
    await expectVisibleNonEmptyFirstPaint(
      page,
      FIRST_PAINT.ask,
      "Ask deep-link settled paint",
    );
    expectNoUnexpectedDiagnostics(diagnostics);
  });

  test("landing keeps core content available without JavaScript", async ({
    browser,
    browserName,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    const diagnostics = createBrowserDiagnostics();
    const stopObserving = observeBrowserDiagnostics(page, diagnostics);
    const response = await page.goto("/");

    expect(response?.status()).toBe(200);
    await expectVisibleNonEmptyFirstPaint(
      page,
      FIRST_PAINT.landing,
      "JavaScript-disabled landing first paint",
    );
    expectNoUnexpectedNoJsDiagnostics(diagnostics, {
      browserName,
      origin: new URL(response!.url()).origin,
    });
    stopObserving();
    await context.close();
  });

  const noJavaScriptRoutes = [
    { name: "Search", path: "/search", firstPaint: FIRST_PAINT.search },
    { name: "About", path: "/about", firstPaint: FIRST_PAINT.about },
    { name: "Contact", path: "/contact", firstPaint: FIRST_PAINT.contact },
    {
      name: "deep edition",
      path: "/edition/1960-01-13",
      firstPaint: FIRST_PAINT.edition,
    },
    {
      name: "not found",
      path: "/__audit-no-js-missing",
      firstPaint: FIRST_PAINT.notFound,
      status: 404,
    },
  ] as const;

  for (const route of noJavaScriptRoutes) {
    test(`${route.name} keeps core content available without JavaScript`, async ({
      browser,
      browserName,
    }) => {
      const context = await browser.newContext({ javaScriptEnabled: false });
      const page = await context.newPage();
      const diagnostics = createBrowserDiagnostics();
      const stopObserving = observeBrowserDiagnostics(page, diagnostics);

      try {
        const response = await page.goto(route.path);
        expect(response?.status()).toBe("status" in route ? route.status : 200);
        await expectVisibleNonEmptyFirstPaint(
          page,
          route.firstPaint,
          `JavaScript-disabled ${route.name} first paint`,
        );

        if ("status" in route && route.status === 404) {
          consumeExpectedDocumentHttpError(diagnostics, {
            status: 404,
            url: response!.url(),
          });
        }
        expectNoUnexpectedNoJsDiagnostics(diagnostics, {
          browserName,
          origin: new URL(response!.url()).origin,
        });
      } finally {
        stopObserving();
        await context.close();
      }
    });
  }
});
