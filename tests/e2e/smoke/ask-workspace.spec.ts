import { test, expect, type Page } from "../fixtures";
import type { Locator } from "@playwright/test";
import {
  createBrowserDiagnostics,
  expectNoSeriousOrCriticalAxeViolations,
  expectNoUnexpectedNoJsDiagnostics,
  observeBrowserDiagnostics,
  readCumulativeLayoutShift,
  waitForSettledUi,
} from "../support/harness";
import {
  DELAYED_ASK_ANSWER,
  DELAYED_ASK_PARTIAL_ANSWER,
  DELAYED_ASK_QUESTION,
  DELAYED_ASK_STREAM_EVENTS,
  DETERMINISTIC_ASK_ANSWER,
  DETERMINISTIC_ASK_STREAM,
  EMPTY_ASK_SESSION,
  EXPIRED_ASK_SESSION,
  FIXED_ASK_SESSION_ID,
  RETURNING_ASK_ANSWER,
  RETURNING_ASK_QUESTION,
  RETURNING_ASK_SESSION,
  RETURNING_ASK_STORAGE_SEED,
  SECOND_ASK_ANSWER,
  SECOND_ASK_QUESTION,
  SECOND_ASK_SESSION_ID,
  THREAD_SWITCH_STORAGE_SEED,
  VISUAL_ASK_ANSWER,
  VISUAL_ASK_EDITION,
  VISUAL_ASK_SOURCE_HEADLINE,
  VISUAL_ASK_STORAGE_SEED,
} from "../support/deterministic";

interface ElementBox {
  height: number;
  width: number;
  x: number;
  y: number;
}

interface ControlledAskStreamState {
  advance: () => void;
  postCount: number;
  question: string | null;
  remaining: number;
}

async function elementBox(page: Page, selector: string): Promise<ElementBox> {
  const box = await page.locator(selector).boundingBox();
  expect(box, `${selector} should have stable rendered geometry`).not.toBeNull();
  return box as ElementBox;
}

function expectStableBox(before: ElementBox, after: ElementBox): void {
  for (const key of ["height", "width", "x", "y"] as const) {
    expect(
      Math.abs(after[key] - before[key]),
      `${key} changed from ${before[key]} to ${after[key]}`,
    ).toBeLessThanOrEqual(1);
  }
}

async function expectMinimumTarget(
  locator: Locator,
  label: string,
): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  expect(box, `${label} should have rendered geometry`).not.toBeNull();
  expect(box!.width, `${label} width`).toBeGreaterThanOrEqual(43.99);
  expect(box!.height, `${label} height`).toBeGreaterThanOrEqual(43.99);
}

async function expectMinimumFontSize(
  locator: Locator,
  label: string,
): Promise<void> {
  const fontSize = await locator.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).fontSize),
  );
  expect(fontSize, `${label} computed font size`).toBeGreaterThanOrEqual(12);
}

function parseRgb(value: string): [number, number, number] {
  const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length !== 3) {
    throw new Error(`Expected an RGB color, received ${value}`);
  }
  return channels as [number, number, number];
}

function relativeLuminance([red, green, blue]: [number, number, number]) {
  const linear = [red, green, blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

async function expectTextContrast(
  locator: Locator,
  label: string,
  minimum = 4.5,
): Promise<void> {
  const colors = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, foreground: style.color };
  });
  const foreground = relativeLuminance(parseRgb(colors.foreground));
  const background = relativeLuminance(parseRgb(colors.background));
  const ratio =
    (Math.max(foreground, background) + 0.05) /
    (Math.min(foreground, background) + 0.05);
  expect(
    ratio,
    `${label}: ${colors.foreground} on ${colors.background}`,
  ).toBeGreaterThanOrEqual(minimum);
}

async function submitQuestion(page: Page, question: string): Promise<void> {
  const composer = page.getByLabel("Ask a question");
  await expect(composer).toBeEnabled();
  await composer.fill(question);
  await page.getByRole("button", { name: "Send question" }).click();
}

function visibleConversationAction(
  page: Page,
  projectName: string,
  name: RegExp,
) {
  const container = page.locator(
    projectName === "chromium-mobile"
      ? ".ask-mobile-actions"
      : ".ask-sidebar",
  );
  return container.getByRole("button", { name });
}

async function installControlledAskStream(page: Page): Promise<void> {
  await page.addInitScript(
    ({ events }) => {
      type AuditWindow = Window & {
        __auditAskStream?: ControlledAskStreamState;
      };

      const auditWindow = window as AuditWindow;
      const originalFetch = window.fetch.bind(window);

      window.fetch = async (input, init) => {
        const request = input instanceof Request ? input : null;
        const rawUrl = request?.url ?? String(input);
        const url = new URL(rawUrl, window.location.href);
        const method = (init?.method ?? request?.method ?? "GET").toUpperCase();

        if (url.pathname !== "/api/ask" || method !== "POST") {
          return originalFetch(input, init);
        }

        const body =
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as { question?: string })
            : {};
        const encoder = new TextEncoder();
        let cursor = 0;
        let streamController: ReadableStreamDefaultController<Uint8Array> | null =
          null;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            streamController = controller;
          },
        });
        const state: ControlledAskStreamState = {
          advance: () => {},
          postCount: (auditWindow.__auditAskStream?.postCount ?? 0) + 1,
          question: body.question ?? null,
          remaining: events.length,
        };
        const emitNext = () => {
          if (!streamController || cursor >= events.length) return;
          streamController.enqueue(
            encoder.encode(`data: ${JSON.stringify(events[cursor])}\n\n`),
          );
          cursor += 1;
          state.remaining = events.length - cursor;
          if (cursor === events.length) streamController.close();
        };
        state.advance = emitNext;
        auditWindow.__auditAskStream = state;
        emitNext();

        return new Response(stream, {
          status: 200,
          headers: {
            "cache-control": "no-store",
            "content-type": "text/event-stream; charset=utf-8",
            "x-audit-fixture": "controlled-ask-stream",
          },
        });
      };
    },
    { events: DELAYED_ASK_STREAM_EVENTS },
  );
}

async function advanceControlledAskStream(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = (
      window as Window & { __auditAskStream?: ControlledAskStreamState }
    ).__auditAskStream;
    if (!state) throw new Error("Controlled Ask stream was not installed");
    state.advance();
  });
}

async function readControlledAskStream(
  page: Page,
): Promise<Omit<ControlledAskStreamState, "advance"> | null> {
  return page.evaluate(() => {
    const state = (
      window as Window & { __auditAskStream?: ControlledAskStreamState }
    ).__auditAskStream;
    if (!state) return null;
    return {
      postCount: state.postCount,
      question: state.question,
      remaining: state.remaining,
    };
  });
}

async function holdSessionRestore(
  page: Page,
  json: unknown,
): Promise<() => void> {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/ask/session**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await gate;
    await route.fulfill({
      status: 200,
      headers: { "cache-control": "no-store" },
      json,
    });
  });
  return release;
}

test.describe("Ask workspace shell", () => {
  test("server document remains meaningful without JavaScript", async ({
    browser,
    browserName,
  }, testInfo) => {
    const isMobile = testInfo.project.name === "chromium-mobile";
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: isMobile
        ? { width: 390, height: 844 }
        : { width: 1440, height: 900 },
      hasTouch: isMobile,
      isMobile,
    });
    const page = await context.newPage();
    const diagnostics = createBrowserDiagnostics();
    const stopObserving = observeBrowserDiagnostics(page, diagnostics);
    const baseURL = String(testInfo.project.use.baseURL);

    const response = await page.goto(new URL("/ask", baseURL).href);
    expect(response?.status()).toBe(200);
    await expect(page.locator("main#main-content")).toBeVisible();
    await expect(page.locator(".ask-landing-title")).toHaveText(
      /Ask the archive/i,
    );
    await expect(page.getByLabel("Ask a question")).toBeVisible();
    await expect(page.getByLabel("Ask a question")).toBeDisabled();
    await expect(page.locator(".ask-loading-skeleton")).toHaveCount(0);

    if (isMobile) {
      await expect(page.locator(".ask-sidebar")).toBeHidden();
      await expect(page.locator(".ask-mobile-actions")).toBeVisible();
    } else {
      await expect(page.locator(".ask-sidebar")).toBeVisible();
      await expect(page.locator(".ask-mobile-actions")).toBeHidden();
    }

    expectNoUnexpectedNoJsDiagnostics(diagnostics, {
      browserName,
      origin: new URL(response!.url()).origin,
    });
    stopObserving();
    await context.close();
  });

  test("first visit exposes stable landmarks and reduced-motion controls", async ({
    page,
  }) => {
    await page.goto("/ask");
    await waitForSettledUi(page);

    await expect(page.locator(".ask-landing-title")).toBeVisible();
    await expect(page.locator(".ask-transcript")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(page.locator(".ask-composer")).toBeVisible();
    await expect(page.getByLabel("Ask a question")).toBeEnabled();
    await expect(page.locator(".ask-loading-skeleton")).toHaveCount(0);

    const transitionDuration = await page
      .locator(".ask-landing-suggestion")
      .first()
      .evaluate((element) => getComputedStyle(element).transitionDuration);
    expect(transitionDuration).toBe("0s");
  });

  test("an empty deep link submits once, cleans the URL, and stays consumed after refresh", async ({
    page,
  }) => {
    const releaseSession = await holdSessionRestore(page, EMPTY_ASK_SESSION);
    const submittedQuestions: string[] = [];
    page.on("request", (request) => {
      if (
        new URL(request.url()).pathname === "/api/ask" &&
        request.method() === "POST"
      ) {
        const body = request.postDataJSON() as { question?: string };
        if (body.question) submittedQuestions.push(body.question);
      }
    });

    await page.goto("/ask?q=Who%20edited%20the%20paper%3F");
    await expect(page.locator(".ask-landing-title")).toBeVisible();
    await expect(page.getByLabel("Ask a question")).toBeDisabled();
    await page.waitForTimeout(100);
    expect(submittedQuestions).toEqual([]);

    releaseSession();
    await expect(page.getByText(DETERMINISTIC_ASK_ANSWER)).toBeVisible();
    expect(submittedQuestions).toEqual(["Who edited the paper?"]);
    await expect(page).toHaveURL(
      (url) => url.pathname === "/ask" && url.search === "" && url.hash === "",
    );

    await page.reload();
    await waitForSettledUi(page);
    await expect(page.locator(".ask-landing-title")).toBeVisible();
    expect(submittedQuestions).toEqual(["Who edited the paper?"]);
  });

  test("Search to Ask stays below the transition CLS budget", async ({
    page,
  }) => {
    await page.goto("/search");
    await waitForSettledUi(page);
    const before = await readCumulativeLayoutShift(page);

    await page.getByRole("link", { name: /ask the archive/i }).click();
    await expect(page).toHaveURL(/\/ask$/);
    await expect(page.locator(".ask-landing-title")).toBeVisible();
    await waitForSettledUi(page);

    const after = await readCumulativeLayoutShift(page);
    expect(Math.max(0, after - before)).toBeLessThanOrEqual(0.01);
  });
});

test.describe("Ask response states", () => {
  test("shows each delayed research stage before streaming a stable answer", async ({
    page,
  }, testInfo) => {
    await installControlledAskStream(page);
    await page.goto("/ask");
    await waitForSettledUi(page);

    const railSelector =
      testInfo.project.name === "chromium-mobile"
        ? ".ask-mobile-actions"
        : ".ask-sidebar";
    const before = {
      column: await elementBox(page, ".ask-column"),
      composer: await elementBox(page, ".ask-composer"),
      rail: await elementBox(page, railSelector),
    };

    await submitQuestion(page, DELAYED_ASK_QUESTION);
    await expect(page.locator(".ask-thinking-rule")).toContainText(
      "Thinking…",
    );
    await expect
      .poll(() => readControlledAskStream(page))
      .toMatchObject({
        postCount: 1,
        question: DELAYED_ASK_QUESTION,
        remaining: 6,
      });

    await advanceControlledAskStream(page);
    await expect(page.locator(".ask-thinking-rule")).toContainText(
      "Searching archive…",
    );
    await advanceControlledAskStream(page);
    await expect(page.locator(".ask-thinking-rule")).toContainText(
      "Ranking sources…",
    );
    await advanceControlledAskStream(page);
    await expect(page.locator(".ask-thinking-rule")).toContainText(
      "Writing answer…",
    );

    await advanceControlledAskStream(page);
    await expect(page.locator(".ask-thinking-rule")).toContainText(
      "Writing answer…",
    );
    await advanceControlledAskStream(page);
    await expect(page.getByText(DELAYED_ASK_PARTIAL_ANSWER)).toBeVisible();
    await expect(page.locator(".ask-thinking-rule")).toHaveCount(0);

    await advanceControlledAskStream(page);
    await expect(page.getByText(DELAYED_ASK_ANSWER)).toBeVisible();
    await expect(page.getByLabel("Ask a question")).toBeEnabled();
    expect(await readControlledAskStream(page)).toEqual({
      postCount: 1,
      question: DELAYED_ASK_QUESTION,
      remaining: 0,
    });

    const after = {
      column: await elementBox(page, ".ask-column"),
      composer: await elementBox(page, ".ask-composer"),
      rail: await elementBox(page, railSelector),
    };
    expectStableBox(before.column, after.column);
    expectStableBox(before.composer, after.composer);
    expectStableBox(before.rail, after.rail);
  });

  test("renders a recoverable inline API error without collapsing the workspace", async ({
    page,
  }, testInfo) => {
    let postCount = 0;
    await page.route("**/api/ask**", async (route) => {
      const request = route.request();
      if (
        new URL(request.url()).pathname !== "/api/ask" ||
        request.method() !== "POST"
      ) {
        await route.fallback();
        return;
      }
      postCount += 1;
      await route.fulfill({
        status: 200,
        headers: {
          "cache-control": "no-store",
          "content-type": "text/event-stream; charset=utf-8",
          "x-audit-fixture":
            postCount === 1 ? "ask-stream-error" : "ask-stream-recovery",
        },
        body:
          postCount === 1
            ? `data: ${JSON.stringify({
                type: "error",
                kind: "server",
                message: "The deterministic archive fixture is unavailable.",
              })}\n\n`
            : DETERMINISTIC_ASK_STREAM,
      });
    });

    await page.goto("/ask");
    await waitForSettledUi(page);
    const railSelector =
      testInfo.project.name === "chromium-mobile"
        ? ".ask-mobile-actions"
        : ".ask-sidebar";
    const before = {
      column: await elementBox(page, ".ask-column"),
      composer: await elementBox(page, ".ask-composer"),
      rail: await elementBox(page, railSelector),
    };

    await submitQuestion(page, "Trigger the deterministic error");
    const alert = page.locator(".ask-error-inline");
    await expect(alert).toContainText("Notice");
    await expect(alert).toContainText(
      "The deterministic archive fixture is unavailable.",
    );
    await expect(
      alert.getByRole("button", { name: "Retry this question" }),
    ).toBeEnabled();
    await expect(page.getByLabel("Ask a question")).toBeEnabled();
    expect(postCount).toBe(1);

    await alert.getByRole("button", { name: "Retry this question" }).click();
    await expect(page.getByText(DETERMINISTIC_ASK_ANSWER)).toBeVisible();
    await expect(page.getByLabel("Ask a question")).toBeEnabled();
    expect(postCount).toBe(2);

    const after = {
      column: await elementBox(page, ".ask-column"),
      composer: await elementBox(page, ".ask-composer"),
      rail: await elementBox(page, railSelector),
    };
    expectStableBox(before.column, after.column);
    expectStableBox(before.composer, after.composer);
    expectStableBox(before.rail, after.rail);
  });
});

test.describe("expired Ask workspace", () => {
  test("keeps the landing and composer usable beneath the expiry notice", async ({
    page,
  }) => {
    await page.route("**/api/ask/session**", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        headers: {
          "cache-control": "no-store",
          "x-audit-fixture": "expired-ask-session",
        },
        json: EXPIRED_ASK_SESSION,
      });
    });
    await page.goto("/ask");
    await expect(page.getByRole("status")).toContainText(
      "Your last conversation expired. Starting fresh.",
    );
    await expect(page.locator(".ask-landing-title")).toBeVisible();
    await expect(page.getByLabel("Ask a question")).toBeEnabled();
    await expect(page.locator(".ask-transcript")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  });
});

test.describe("returning Ask workspace", () => {
  test.use({ storageSeed: RETURNING_ASK_STORAGE_SEED });

  test("restores content without moving the desktop or mobile shell", async ({
    page,
  }, testInfo) => {
    const releaseSession = await holdSessionRestore(
      page,
      RETURNING_ASK_SESSION,
    );
    const sessionRequest = page.waitForRequest((request) =>
      new URL(request.url()).pathname.startsWith("/api/ask/session"),
    );

    await page.goto("/ask");
    await sessionRequest;
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator(".ask-landing-title")).toBeVisible();

    const isMobile = testInfo.project.name === "chromium-mobile";
    const railSelector = isMobile ? ".ask-mobile-actions" : ".ask-sidebar";
    const before = {
      column: await elementBox(page, ".ask-column"),
      composer: await elementBox(page, ".ask-composer"),
      rail: await elementBox(page, railSelector),
    };

    releaseSession();
    await expect(page.getByText(RETURNING_ASK_ANSWER)).toBeVisible();
    const after = {
      column: await elementBox(page, ".ask-column"),
      composer: await elementBox(page, ".ask-composer"),
      rail: await elementBox(page, railSelector),
    };

    expectStableBox(before.column, after.column);
    expectStableBox(before.composer, after.composer);
    expectStableBox(before.rail, after.rail);
  });

  test("an existing conversation consumes a deep link without submission", async ({
    page,
  }) => {
    let postCount = 0;
    page.on("request", (request) => {
      if (
        new URL(request.url()).pathname === "/api/ask" &&
        request.method() === "POST"
      ) {
        postCount += 1;
      }
    });

    await page.goto("/ask?q=Do%20not%20duplicate%20this");
    await expect(page.getByText(RETURNING_ASK_ANSWER)).toBeVisible();
    await expect(page).toHaveURL(
      (url) => url.pathname === "/ask" && url.search === "" && url.hash === "",
    );
    await page.waitForTimeout(250);
    expect(postCount).toBe(0);
  });

  test("clears the restored thread locally and deletes only its server session", async ({
    page,
  }, testInfo) => {
    const deletedSessionUrls: string[] = [];
    let askPostCount = 0;
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/ask" && request.method() === "POST") {
        askPostCount += 1;
      }
    });
    await page.route("**/api/ask/session**", async (route) => {
      const request = route.request();
      if (request.method() !== "DELETE") {
        await route.fallback();
        return;
      }
      deletedSessionUrls.push(request.url());
      await route.fulfill({
        status: 200,
        headers: { "x-audit-fixture": "deleted-ask-session" },
        json: { deleted: true },
      });
    });

    await page.goto("/ask");
    await expect(page.getByText(RETURNING_ASK_ANSWER)).toBeVisible();
    const clear = visibleConversationAction(
      page,
      testInfo.project.name,
      /clear the current thread/i,
    );
    await expect(clear).toBeEnabled();
    const deleteResponse = page.waitForResponse((response) => {
      const request = response.request();
      return (
        new URL(response.url()).pathname === "/api/ask/session" &&
        request.method() === "DELETE"
      );
    });
    await clear.click();
    await deleteResponse;

    await expect(page.getByRole("status")).toContainText(
      "Conversation cleared — ask a new question below.",
    );
    await expect(page.getByText(RETURNING_ASK_ANSWER)).toHaveCount(0);
    await expect(page.getByLabel("Ask a question")).toBeEnabled();
    await expect.poll(() => deletedSessionUrls.length).toBe(1);
    expect(new URL(deletedSessionUrls[0]).searchParams.get("sessionId")).toBe(
      FIXED_ASK_SESSION_ID,
    );
    expect(askPostCount).toBe(0);

    const storage = await page.evaluate(() => ({
      activeSession: window.localStorage.getItem("owu-ask-session-id"),
      threads: window.localStorage.getItem("owu-ask-threads"),
    }));
    expect(storage.activeSession).toBeTruthy();
    expect(storage.activeSession).not.toBe(FIXED_ASK_SESSION_ID);
    expect(JSON.parse(storage.threads ?? "[]")).toEqual([]);
  });

  test("exports the restored conversation as a deterministic PDF download", async ({
    page,
  }, testInfo) => {
    await page.goto("/ask");
    await expect(page.getByText(RETURNING_ASK_ANSWER)).toBeVisible();
    const exportButton = visibleConversationAction(
      page,
      testInfo.project.name,
      /export the conversation as a pdf/i,
    );
    await expect(exportButton).toBeEnabled();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      exportButton.click(),
    ]);
    expect(download.suggestedFilename()).toBe(
      "ask-the-archive-who-edited-the-paper-in-1960.pdf",
    );
    expect(await download.failure()).toBeNull();
    expect(await download.path()).not.toBeNull();
  });
});

test.describe("archived Ask threads", () => {
  test.use({ storageSeed: THREAD_SWITCH_STORAGE_SEED });

  test("switches between local threads without submitting or refetching", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === "chromium-mobile",
      "The thread rail is a desktop-only control.",
    );
    const askRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/ask" && request.method() === "POST") {
        askRequests.push(request.url());
      }
    });

    await page.goto("/ask");
    await expect(page.getByText(RETURNING_ASK_ANSWER)).toBeVisible();
    await expect(page.locator(".ask-sidebar-section-label")).toContainText(
      "2",
    );

    const secondThread = page.getByRole("button", {
      name: `Open thread: ${SECOND_ASK_QUESTION}`,
    });
    await secondThread.click();
    await expect(page.getByText(SECOND_ASK_ANSWER)).toBeVisible();
    await expect(page.getByText(RETURNING_ASK_ANSWER)).toHaveCount(0);
    await expect(secondThread).toHaveAttribute("aria-current", "true");
    expect(
      await page.evaluate(() =>
        window.localStorage.getItem("owu-ask-session-id"),
      ),
    ).toBe(SECOND_ASK_SESSION_ID);

    const firstThread = page.getByRole("button", {
      name: `Open thread: ${RETURNING_ASK_QUESTION}`,
    });
    await firstThread.click();
    await expect(page.getByText(RETURNING_ASK_ANSWER)).toBeVisible();
    await expect(page.getByText(SECOND_ASK_ANSWER)).toHaveCount(0);
    await expect(firstThread).toHaveAttribute("aria-current", "true");
    expect(askRequests).toEqual([]);
  });
});

test.describe("visual Ask sources", () => {
  test.use({ storageSeed: VISUAL_ASK_STORAGE_SEED });

  test.beforeEach(async ({ page }) => {
    await page.route("**/api/ask/session**", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        headers: {
          "cache-control": "no-store",
          "x-audit-fixture": "visual-ask-session",
        },
        // Empty server history intentionally falls through to the complete
        // local visual turn, including its deterministic follow-up question.
        json: EMPTY_ASK_SESSION,
      });
    });
    await page.route("**/api/editions/1960-01-13", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
      await route.fulfill({
        status: 200,
        headers: {
          "cache-control": "no-store",
          "x-audit-fixture": "visual-source-edition",
        },
        json: VISUAL_ASK_EDITION,
      });
    });
  });

  test("opens a keyboard-complete source reader without moving the Ask shell", async ({
    page,
  }) => {
    let editionRequestCount = 0;
    page.on("request", (request) => {
      if (
        new URL(request.url()).pathname === "/api/editions/1960-01-13" &&
        request.method() === "GET"
      ) {
        editionRequestCount += 1;
      }
    });

    await page.goto("/ask");
    await expect(page.getByText(VISUAL_ASK_ANSWER)).toBeVisible();
    await page
      .getByRole("button", { name: "Sources — 2 articles" })
      .click();
    const sourceTrigger = page.locator(".ask-source-card").first();
    await sourceTrigger.focus();
    await sourceTrigger.click();

    const reader = page.getByRole("dialog", {
      name: VISUAL_ASK_SOURCE_HEADLINE,
    });
    const close = reader.getByRole("button", {
      name: "Close article reader",
    });
    await expect(reader).toBeVisible();
    await expect(close).toBeFocused();
    await expect(reader.getByRole("status")).toHaveText("Loading…");
    await expect(
      reader.getByText("The editors assembled around the newsroom desk."),
    ).toBeVisible();
    expect(editionRequestCount).toBe(1);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe(
      "hidden",
    );

    await page.keyboard.press("Shift+Tab");
    await expect(
      reader.getByRole("link", { name: "Open full edition →" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(reader).toHaveCount(0);
    await expect(sourceTrigger).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  });

  test("navigates the answer and source photo galleries through their lightboxes", async ({
    page,
  }) => {
    await page.goto("/ask");
    await expect(page.getByText(VISUAL_ASK_ANSWER)).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "More pictures — 3" }),
    ).toBeVisible();

    const answerPhoto = page.getByRole("button", {
      name: "Open photo: Reading the archive",
    });
    await answerPhoto.click();
    let lightbox = page.getByRole("dialog", { name: "Photo viewer" });
    await expect(lightbox).toBeVisible();
    await expect(
      lightbox.getByRole("button", { name: "Close photo viewer" }),
    ).toBeFocused();
    await expect(lightbox.getByText("1 / 3")).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(lightbox.getByText("2 / 3")).toBeVisible();
    await expect(lightbox.getByText("The edition front page")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(lightbox).toHaveCount(0);
    await expect(answerPhoto).toBeFocused();

    await page
      .getByRole("button", { name: "Sources — 2 articles" })
      .click();
    const sourceTrigger = page.locator(".ask-source-card").first();
    await sourceTrigger.click();
    const reader = page.getByRole("dialog", {
      name: VISUAL_ASK_SOURCE_HEADLINE,
    });
    await expect(reader).toBeVisible();
    const sourcePhoto = reader.getByRole("button", {
      name: `Expand ${VISUAL_ASK_SOURCE_HEADLINE} — image 1`,
    });
    await sourcePhoto.click();

    lightbox = page.getByRole("dialog", { name: "Photo viewer" });
    await expect(lightbox).toBeVisible();
    await expect(lightbox.getByText("1 / 2")).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(lightbox.getByText("2 / 2")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(lightbox).toHaveCount(0);
    await expect(reader).toBeVisible();
    await expect(sourcePhoto).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(reader).toHaveCount(0);
    await expect(sourceTrigger).toBeFocused();
  });

  test("mobile visual sources meet target, type, contrast, and axe contracts", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-mobile",
      "This is the explicit 390×844 rendered accessibility probe.",
    );

    await page.goto("/ask");
    await expect(page.getByText(VISUAL_ASK_ANSWER)).toBeVisible();

    const mobileActions = page.locator(".ask-mobile-action");
    await expect(mobileActions).toHaveCount(3);
    for (let index = 0; index < 3; index += 1) {
      await expectMinimumTarget(
        mobileActions.nth(index),
        `mobile action ${index + 1}`,
      );
      await expectMinimumFontSize(
        mobileActions.nth(index),
        `mobile action ${index + 1}`,
      );
    }

    const followUp = page.getByRole("button", {
      name: "Which photographs came from the newsroom?",
    });
    await expectMinimumTarget(followUp, "follow-up question");
    await expectMinimumFontSize(
      page.locator(".ask-followups-label"),
      "follow-up label",
    );

    for (const [selector, label] of [
      [".ask-turn-user-label", "question label"],
      [".ask-turn-assistant-label", "answer label"],
      [".ask-photos-panel-label", "photos label"],
      [".ask-photos-tile-caption", "photo caption"],
      [".ask-photos-tile-attr", "photo attribution"],
    ] as const) {
      await expectMinimumFontSize(page.locator(selector).first(), label);
    }

    const sourceToggle = page.getByRole("button", {
      name: "Sources — 2 articles",
    });
    await expectMinimumTarget(sourceToggle, "source disclosure");
    await expectMinimumFontSize(sourceToggle, "source disclosure");
    await sourceToggle.click();

    const sourceCard = page.locator(".ask-source-card").first();
    await expectMinimumTarget(sourceCard, "source card");
    await sourceCard.focus();
    for (const [selector, label] of [
      [".ask-source-card-category", "source category"],
      [".ask-source-card-date", "source date"],
      [".ask-source-card-num", "source number"],
      [".ask-source-card-hint", "source hint"],
      [".ask-source-thumb-count", "source photo badge"],
    ] as const) {
      await expectMinimumFontSize(sourceCard.locator(selector), label);
    }
    await expect(sourceCard.locator(".ask-source-card-date")).toHaveCSS(
      "opacity",
      "1",
    );
    await expect(sourceCard.locator(".ask-source-card-num")).toHaveCSS(
      "opacity",
      "1",
    );
    await expectNoSeriousOrCriticalAxeViolations(page);

    await sourceCard.click();
    const reader = page.getByRole("dialog", {
      name: VISUAL_ASK_SOURCE_HEADLINE,
    });
    await expect(reader).toBeVisible();
    const sourcePhoto = reader.getByRole("button", {
      name: `Expand ${VISUAL_ASK_SOURCE_HEADLINE} — image 1`,
    });
    await expectMinimumTarget(sourcePhoto, "source photo");
    await sourcePhoto.click();

    const lightbox = page.getByRole("dialog", { name: "Photo viewer" });
    await expect(lightbox).toBeVisible();
    await expectMinimumTarget(
      lightbox.getByRole("button", { name: "Close photo viewer" }),
      "lightbox close",
    );
    const caption = lightbox.getByText("Reading the archive");
    await expect(caption).toBeVisible();
    await expectTextContrast(caption, "source-photo lightbox caption");
    await expectNoSeriousOrCriticalAxeViolations(page);
  });
});
