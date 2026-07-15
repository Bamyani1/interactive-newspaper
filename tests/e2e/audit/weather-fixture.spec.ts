import { test, expect } from "../fixtures";
import { waitForSettledUi } from "../support/harness";

const DETERMINISTIC_WEATHER_REASON = "No deterministic audit weather record.";

// The desktop context sidebar fetches `/api/weather?date=…`, and the real route
// rate-limits (10/60s), so the exhaustive edition sweep would 429 without the
// default fixture in `DEFAULT_API_MOCKS`. This proves the sweep only ever sees
// the deterministic body — never the live route (which returns a different
// shape and can 429).
test("desktop edition weather is served by the deterministic fixture, never the live route", async ({
  page,
}) => {
  // Force a desktop viewport (≥1024px) so the context sidebar mounts and the
  // weather request fires regardless of the active project.
  await page.setViewportSize({ width: 1280, height: 900 });

  const weatherChecks: Promise<{ status: number; reason: unknown }>[] = [];
  page.on("response", (response) => {
    if (!response.url().includes("/api/weather")) return;
    weatherChecks.push(
      (async () => {
        let reason: unknown = "<non-json>";
        try {
          reason = ((await response.json()) as { reason?: unknown }).reason;
        } catch {
          reason = "<non-json>";
        }
        return { status: response.status(), reason };
      })(),
    );
  });

  await page.goto("/edition/2006-04-20");
  await waitForSettledUi(page);
  await expect.poll(() => weatherChecks.length).toBeGreaterThan(0);

  const results = await Promise.all(weatherChecks);
  for (const result of results) {
    expect(result.status).toBe(200);
    expect(result.reason).toBe(DETERMINISTIC_WEATHER_REASON);
  }
});
