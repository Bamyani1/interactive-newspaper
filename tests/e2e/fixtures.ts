import {
  test as base,
  expect,
  type Page,
  type TestInfo,
} from "@playwright/test";
import {
  DEFAULT_API_MOCKS,
  DEFAULT_STORAGE_SEED,
  FIXED_NOW,
} from "./support/deterministic";
import {
  createBrowserDiagnostics,
  expectNoUnexpectedDiagnostics,
  installApiMocks,
  installBrowserStorage,
  installCumulativeLayoutShiftObserver,
  observeBrowserDiagnostics,
  readCumulativeLayoutShift,
  type ApiMock,
  type BrowserDiagnostics,
  type BrowserStorageSeed,
} from "./support/harness";

interface AuditOptions {
  apiMocks: ApiMock[];
  storageSeed: BrowserStorageSeed;
}

interface AuditFixtures {
  diagnostics: BrowserDiagnostics;
}

async function attachJson(
  testInfo: TestInfo,
  name: string,
  value: unknown,
): Promise<void> {
  await testInfo.attach(name, {
    body: Buffer.from(JSON.stringify(value, null, 2)),
    contentType: "application/json",
  });
}

export const test = base.extend<AuditOptions & AuditFixtures>({
  apiMocks: [DEFAULT_API_MOCKS, { option: true }],
  storageSeed: [DEFAULT_STORAGE_SEED, { option: true }],
  diagnostics: [
    async ({ page, apiMocks, storageSeed }, use, testInfo) => {
      const diagnostics = createBrowserDiagnostics();

      await page.clock.setFixedTime(FIXED_NOW);
      await Promise.all([
        installBrowserStorage(page, storageSeed),
        installCumulativeLayoutShiftObserver(page),
        installApiMocks(page, apiMocks),
      ]);
      const stopObserving = observeBrowserDiagnostics(page, diagnostics);

      await use(diagnostics);

      if (!page.isClosed() && page.url() !== "about:blank") {
        diagnostics.cumulativeLayoutShift = await readCumulativeLayoutShift(
          page,
        ).catch(() => 0);
      }
      await attachJson(testInfo, "browser-diagnostics", diagnostics);
      stopObserving();
      expectNoUnexpectedDiagnostics(diagnostics);
    },
    { auto: true },
  ],
});

export { expect };
export type { Page };
