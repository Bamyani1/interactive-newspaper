import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ContextSidebar } from "../../src/features/context-panel/components/ContextSidebar";
import { clearMonthlyTrendingMusicCacheForTests } from "../../src/features/music-player/hooks/useMonthlyTrendingMusic";

function setDesktopViewport(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

function successfulFetch(input: RequestInfo | URL) {
  const url = String(input);
  if (url.startsWith("/api/weather")) {
    return Promise.resolve({
      ok: true,
      json: async () => ({
        record: { tmax_c: 21, tmin_c: 9, is_estimated: false },
        reason: null,
      }),
    } as Response);
  }
  if (url === "/top-10-music/chart-1950-2010.json") {
    return Promise.resolve({
      ok: true,
      json: async () => ({ start: "1950-01", end: "2010-12", months: [] }),
    } as Response);
  }
  throw new Error(`Unexpected request: ${url}`);
}

describe("responsive edition context sidebar", () => {
  beforeEach(() => {
    clearMonthlyTrendingMusicCacheForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not mount or fetch hidden context on mobile", () => {
    setDesktopViewport(false);
    const fetchMock = vi.fn(successfulFetch);
    vi.stubGlobal("fetch", fetchMock);

    render(<ContextSidebar currentDate="1989-10-18" />);

    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mounts weather and music context after the desktop query matches", async () => {
    setDesktopViewport(true);
    const fetchMock = vi.fn(successfulFetch);
    vi.stubGlobal("fetch", fetchMock);

    render(<ContextSidebar currentDate="1989-10-18" />);

    expect(await screen.findByRole("complementary")).toHaveAttribute(
      "data-context-sidebar",
    );
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/weather?date=1989-10-18");
      expect(fetchMock).toHaveBeenCalledWith(
        "/top-10-music/chart-1950-2010.json",
      );
    });
  });

  it("distinguishes a weather request failure from an unavailable record", async () => {
    setDesktopViewport(true);
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/weather")) {
        return Promise.reject(new Error("fixture weather failure"));
      }
      if (url === "/top-10-music/chart-1950-2010.json") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ start: "1950-01", end: "2010-12", months: [] }),
        } as Response);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ContextSidebar currentDate="1989-10-19" />);

    expect(
      await screen.findByText("Unable to load weather data right now"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Weather data unavailable")).not.toBeInTheDocument();
  });
});
