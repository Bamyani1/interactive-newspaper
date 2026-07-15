import type { Locator } from "@playwright/test";
import { expect, test, type Page } from "../fixtures";
import {
  DEFAULT_STORAGE_SEED,
  RETURNING_ASK_STORAGE_SEED,
} from "../support/deterministic";
import {
  FRAMER_MOTION_REDUCED_MOTION_DEV_WARNING,
  expectNoSeriousOrCriticalAxeViolations,
  expectNoUnexpectedDiagnostics,
  resetBrowserDiagnostics,
  waitForSettledUi,
} from "../support/harness";

interface StabilitySample {
  dateText: string;
  mode: string | null;
}

async function installFirstPaintStabilityRecorder(page: Page) {
  await page.addInitScript(() => {
    const auditWindow = window as Window & {
      __auditFirstPaintStability?: { samples: StabilitySample[] };
    };
    const normalize = (value: string | null | undefined) =>
      (value ?? "").replace(/\s+/g, " ").trim();
    const begin = () => {
      const state = { samples: [] as StabilitySample[] };
      auditWindow.__auditFirstPaintStability = state;
      const record = () => {
        state.samples.push({
          mode: document.documentElement.getAttribute("data-mode"),
          dateText: normalize(
            document.querySelector<HTMLButtonElement>(
              'button[aria-label="Select edition date"]',
            )?.textContent,
          ),
        });
      };
      record();
      new MutationObserver(record).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-mode"],
        characterData: true,
        childList: true,
        subtree: true,
      });
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", begin, { once: true });
    } else {
      begin();
    }
  });
}

async function readStabilitySamples(page: Page): Promise<StabilitySample[]> {
  return page.evaluate(() => {
    const auditWindow = window as Window & {
      __auditFirstPaintStability?: { samples: StabilitySample[] };
    };
    const samples = auditWindow.__auditFirstPaintStability?.samples ?? [];
    const dateText = (
      document.querySelector<HTMLButtonElement>(
        'button[aria-label="Select edition date"]',
      )?.textContent ?? ""
    ).replace(/\s+/g, " ").trim();
    return [
      ...samples,
      {
        mode: document.documentElement.getAttribute("data-mode"),
        dateText,
      },
    ];
  });
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

async function expectPrimaryBodyContrast(page: Page, minimum = 7) {
  const colors = await page.locator("body").evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, foreground: style.color };
  });
  const foreground = relativeLuminance(parseRgb(colors.foreground));
  const background = relativeLuminance(parseRgb(colors.background));
  const ratio =
    (Math.max(foreground, background) + 0.05) /
    (Math.min(foreground, background) + 0.05);
  expect(ratio, `${colors.foreground} on ${colors.background}`).toBeGreaterThanOrEqual(
    minimum,
  );
}

async function expectMinimumTarget(locator: Locator, label: string) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  expect(box, `${label} must have a rendered box`).not.toBeNull();
  expect(box!.width, `${label} width`).toBeGreaterThanOrEqual(43.99);
  expect(box!.height, `${label} height`).toBeGreaterThanOrEqual(43.99);
}

async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  expect(widths.body).toBeLessThanOrEqual(widths.viewport);
}

async function resolveColorToken(page: Page, token: string) {
  return page.evaluate((property) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${property})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);
}

async function expectInstantMotionSurface(locator: Locator, label: string) {
  const state = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { opacity: style.opacity, transform: style.transform };
  });
  expect(state.opacity, `${label} opacity`).toBe("1");
  expect(
    state.transform === "none" ||
      state.transform === "matrix(1, 0, 0, 1, 0, 0)",
    `${label} transform: ${state.transform}`,
  ).toBe(true);
}

async function expectStableFirstPaint(
  page: Page,
  route: string,
  expectedMode: "light" | "dark",
  expectedDate: string,
) {
  await installFirstPaintStabilityRecorder(page);
  const response = await page.goto(route, { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("button", { name: "Select edition date" }),
  ).toBeAttached();
  await waitForSettledUi(page);

  const samples = await readStabilitySamples(page);
  const datedSamples = samples.filter((sample) => sample.dateText.length > 0);
  expect(datedSamples.length).toBeGreaterThan(0);
  expect(new Set(samples.map((sample) => sample.mode))).toEqual(
    new Set([expectedMode]),
  );
  for (const sample of datedSamples) {
    expect(sample.dateText).toContain(expectedDate);
  }
  await expectPrimaryBodyContrast(page);
}

test("general-route first paint keeps saved light mode and latest date stable", async ({
  page,
  diagnostics,
}) => {
  await expectStableFirstPaint(page, "/search", "light", "Apr 20, 2006");
  await expectNoSeriousOrCriticalAxeViolations(page);
  expectNoUnexpectedDiagnostics(diagnostics);
});

test.describe("saved dark first paint", () => {
  test.use({
    storageSeed: {
      ...DEFAULT_STORAGE_SEED,
      localStorage: {
        ...DEFAULT_STORAGE_SEED.localStorage,
        "transcript-mode": "dark",
      },
    },
  });

  test("edition dark state keeps semantic accents and instant disclosures", async ({
    page,
    diagnostics,
    isMobile,
  }) => {
    await expectStableFirstPaint(
      page,
      "/edition/1960-01-13",
      "dark",
      "Jan 13, 1960",
    );

    const accentText = await resolveColorToken(page, "--color-accent-text");
    const accentRule = await resolveColorToken(page, "--color-rule-accent");
    const trigger = page.getByRole("button", { name: "Select edition date" });
    const header = page.locator(".time-controls-header");
    await expect(header).toHaveCSS("border-bottom-color", accentRule);

    await trigger.click();
    const listbox = page.getByRole("listbox", { name: "Available editions" });
    const pickerSurface = listbox.locator("..");
    await expectInstantMotionSurface(pickerSurface, "date picker");
    await expect(trigger).toHaveCSS("color", accentText);
    await expect(
      listbox.getByRole("option", { selected: true }),
    ).toHaveCSS("color", accentText);
    await expectNoSeriousOrCriticalAxeViolations(page);
    await page.keyboard.press("Escape");

    if (isMobile) {
      const activeSection = page.getByRole("button", {
        name: "Top Stories",
        exact: true,
      });
      await expect(activeSection).toHaveCSS("color", accentText);

      const more = page.getByRole("button", { name: "More sections" });
      await more.click();
      const menu = page.getByRole("menu", { name: "More sections" });
      await expectInstantMotionSurface(menu, "mobile More menu");
      await expect(more).toHaveCSS("color", accentText);
      await menu.getByRole("menuitem", { name: "Ads", exact: true }).click();

      await more.click();
      const activeAdItem = page.getByRole("menuitem", {
        name: "Ads",
        exact: true,
      });
      await expect(activeAdItem).toHaveCSS("color", accentText);
      await expectNoSeriousOrCriticalAxeViolations(page);
      await page.keyboard.press("Escape");
    } else {
      const trackToggle = page.locator("#sidebar-track-toggle");
      await expect(trackToggle).toBeVisible();
      if ((await trackToggle.getAttribute("aria-expanded")) === "true") {
        await trackToggle.click();
      }
      await expect(trackToggle).toHaveAttribute("aria-expanded", "false");
      await trackToggle.click();
      const trackList = page.locator("#sidebar-track-list");
      await expect(trackList).toHaveCSS("transition-duration", "0s");
      await expect(trackToggle).toHaveAttribute("aria-expanded", "true");
      const trackListHeight = await trackList.evaluate((element) =>
        element.getBoundingClientRect().height,
      );
      expect(trackListHeight).toBeGreaterThan(0);

      await page
        .locator("button.nav-fleuron-row")
        .filter({
          has: page.locator(".nav-fleuron-name", { hasText: /^Ads$/ }),
        })
        .click();
    }

    const ribbon = page.getByText("Clip & Save", { exact: true }).first();
    await expect(ribbon).toBeVisible();
    await expect(ribbon).toHaveCSS(
      "color",
      await resolveColorToken(page, "--color-text-on-accent"),
    );
    await expect(ribbon).toHaveCSS(
      "background-color",
      await resolveColorToken(page, "--color-accent"),
    );
    await expectNoHorizontalOverflow(page);
    await expectNoSeriousOrCriticalAxeViolations(page);
    expectNoUnexpectedDiagnostics(diagnostics);
  });
});

test("application warnings cannot impersonate the upstream motion warning", async ({
  page,
  diagnostics,
}) => {
  await page.goto("/search");
  await waitForSettledUi(page);
  expectNoUnexpectedDiagnostics(diagnostics);
  resetBrowserDiagnostics(diagnostics);

  const findInjectedWarning = (marker: string) =>
    diagnostics.consoleWarnings.find((warning) => warning.includes(marker));
  const consumeInjectedWarning = (warning: string) => {
    const index = diagnostics.consoleWarnings.indexOf(warning);
    expect(index, `injected warning should still be present: ${warning}`).toBeGreaterThanOrEqual(0);
    diagnostics.consoleWarnings.splice(index, 1);
  };

  for (const message of [
    `application prefix: ${FRAMER_MOTION_REDUCED_MOTION_DEV_WARNING.replace(/^warning: /, "")}`,
    `${FRAMER_MOTION_REDUCED_MOTION_DEV_WARNING.replace(/^warning: /, "")} application suffix`,
  ]) {
    await page.evaluate((warning) => console.warn(warning), message);
    await expect
      .poll(() => findInjectedWarning(message) ?? "")
      .not.toBe("");
    expect(() => expectNoUnexpectedDiagnostics(diagnostics)).toThrow();
    consumeInjectedWarning(findInjectedWarning(message)!);
    expectNoUnexpectedDiagnostics(diagnostics);
  }

  const applicationWarning =
    FRAMER_MOTION_REDUCED_MOTION_DEV_WARNING.replace(/^warning: /, "");
  await page.route("**/audit-application-warning.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `console.warn(${JSON.stringify(applicationWarning)});`,
    }),
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const frame = document.createElement("iframe");
        frame.hidden = true;
        frame.onload = () => resolve();
        frame.onerror = () =>
          reject(new Error("Application warning frame failed"));
        frame.srcdoc =
          '<!doctype html><script src="/audit-application-warning.js"><\/script>';
        document.body.append(frame);
      }),
  );
  await expect
    .poll(() => findInjectedWarning("/audit-application-warning.js") ?? "")
    .not.toBe("");
  expect(() => expectNoUnexpectedDiagnostics(diagnostics)).toThrow();
  consumeInjectedWarning(findInjectedWarning("/audit-application-warning.js")!);

  expectNoUnexpectedDiagnostics(diagnostics);
});

test("landing picker removes its entry animation for reduced motion", async ({
  page,
  diagnostics,
}) => {
  await page.goto("/");
  await waitForSettledUi(page);
  const trigger = page.getByRole("button", {
    name: /Selected edition:.*Activate to change/i,
  });
  await expectMinimumTarget(trigger, "edition-picker trigger");
  await trigger.click();
  const picker = page.locator(".ep-container--open");
  await expect(picker).toBeVisible();
  await expect(picker).toHaveCSS("animation-name", "none");
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousOrCriticalAxeViolations(page);
  expectNoUnexpectedDiagnostics(diagnostics);
});

test("gold edition keeps mobile targets, metadata, and approved nav radii", async ({
  page,
  diagnostics,
  isMobile,
}) => {
  await page.goto("/edition/1960-01-13");
  await waitForSettledUi(page);

  await expectMinimumTarget(
    page.getByRole("link", { name: "Return to landing page" }),
    "return-to-landing link",
  );
  await expectMinimumTarget(
    page.getByRole("button", { name: "Toggle color theme" }),
    "theme-mode toggle",
  );
  await expectMinimumTarget(
    page.getByRole("button", { name: "See Next Edition" }),
    "next-edition button",
  );

  const volume = page.getByText("Vol. 93 · No. 13");
  await expect(volume).toBeVisible();
  await expect(volume).toHaveCSS("opacity", "1");

  if (isMobile) {
    const mobileNav = page.locator("nav").filter({
      has: page.getByRole("button", { name: "More sections" }),
    });
    const searchLink = mobileNav.getByRole("link", {
      name: "Search the archive",
    });
    await expect(searchLink).toHaveCSS("border-radius", "2px");
    await expectMinimumTarget(searchLink, "mobile Search navigation");
    const more = mobileNav.getByRole("button", { name: "More sections" });
    await expect(more).toHaveCSS("border-radius", "2px");
    await more.click();
    await expect(
      mobileNav.getByRole("menu", { name: "More sections" }),
    ).toHaveCSS("border-radius", "2px");
  }

  await expectNoHorizontalOverflow(page);
  await expectNoSeriousOrCriticalAxeViolations(page);
  expectNoUnexpectedDiagnostics(diagnostics);
});

const markdownThreads = JSON.parse(
  RETURNING_ASK_STORAGE_SEED.localStorage!["owu-ask-threads"],
) as Array<{ turns: Array<{ answer: string }> }>;
markdownThreads[0].turns[0].answer = [
  "A restored answer with a real fenced code block:",
  "",
  "```ts",
  'const edition = "1960-01-13";',
  "```",
].join("\n");

test.describe("keyboard-reachable code regions", () => {
  test.use({
    storageSeed: {
      ...RETURNING_ASK_STORAGE_SEED,
      localStorage: {
        ...RETURNING_ASK_STORAGE_SEED.localStorage,
        "owu-ask-threads": JSON.stringify(markdownThreads),
      },
    },
  });

  test("primitive and real Ask Markdown code regions are keyboard reachable", async ({
    page,
    diagnostics,
  }) => {
    const response = await page.goto("/dev/primitives");
    expect(response?.status()).toBe(200);
    await waitForSettledUi(page);

    const primitiveCodeRegion = page.locator("pre").first();
    await expect(primitiveCodeRegion).toHaveAttribute("tabindex", "0");
    await primitiveCodeRegion.focus();
    await expect(primitiveCodeRegion).toBeFocused();

    await page.goto("/ask");
    await waitForSettledUi(page);
    const markdownCodeRegion = page.locator(".ask-turn-answer pre").first();
    await expect(markdownCodeRegion).toContainText(
      'const edition = "1960-01-13";',
    );
    await expect(markdownCodeRegion).toHaveAttribute("tabindex", "0");
    await markdownCodeRegion.focus();
    await expect(markdownCodeRegion).toBeFocused();

    await expectNoHorizontalOverflow(page);
    await expectNoSeriousOrCriticalAxeViolations(page);
    expectNoUnexpectedDiagnostics(diagnostics);
  });
});
