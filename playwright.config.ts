import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? "3000");
const localBaseUrl = `http://127.0.0.1:${port}`;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? localBaseUrl;
const productionServer = process.env.PLAYWRIGHT_SERVER_MODE === "production";
const auditPhase = process.env.AUDIT_PHASE ?? "after";
if (auditPhase !== "before" && auditPhase !== "after") {
  throw new Error(`AUDIT_PHASE must be before or after, received: ${auditPhase}`);
}
const harnessEvidenceRoot = `audit-evidence/full/${auditPhase}/harness/test-run/all-projects`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  outputDir: `${harnessEvidenceRoot}/test-results`,
  reporter: [
    ["list"],
    [
      "html",
      {
        open: "never",
        outputFolder: `${harnessEvidenceRoot}/playwright-report`,
      },
    ],
  ],
  use: {
    baseURL,
    colorScheme: "light",
    locale: "en-US",
    timezoneId: "America/New_York",
    contextOptions: {
      reducedMotion: "reduce",
    },
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: productionServer
          ? `npm run build && npm run start -- --hostname 127.0.0.1 --port ${port}`
          : `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
        url: localBaseUrl,
        reuseExistingServer: !process.env.CI && !productionServer,
        timeout: productionServer ? 240_000 : 120_000,
      },
  projects: [
    {
      name: "chromium-desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: "chromium-mobile",
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: "firefox-smoke",
      testMatch: "**/smoke/critical-path.spec.ts",
      use: {
        ...devices["Desktop Firefox"],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: "webkit-smoke",
      testMatch: "**/smoke/critical-path.spec.ts",
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      },
    },
  ],
});
