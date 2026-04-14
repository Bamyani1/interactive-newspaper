import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarPlayer } from "../../src/features/music-player/components/SidebarPlayer";
import { clearMonthlyTrendingMusicCacheForTests } from "../../src/features/music-player/hooks/useMonthlyTrendingMusic";

const ARCHIVE_URL = "/top-10-music/chart-1950-2010.json";
const START_YEAR = 1950;
const END_YEAR = 2010;
const TOTAL_MONTHS = (END_YEAR - START_YEAR + 1) * 12;

type TrackTuple = [string, string, string];
type RawTrack = { title: string; artist: string; youtube_id: string };

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function monthIndex(year: number, month: number): number {
  return (year - START_YEAR) * 12 + (month - 1);
}

function packedArchiveWithMonth(year: number, month: number, tracks: RawTrack[]): unknown {
  const months: Array<TrackTuple[] | null> = new Array(TOTAL_MONTHS).fill(null);
  months[monthIndex(year, month)] = tracks.map(
    (t): TrackTuple => [t.title, t.artist, t.youtube_id],
  );
  return { start: `${START_YEAR}-01`, end: `${END_YEAR}-12`, months };
}

beforeEach(() => {
  vi.restoreAllMocks();
  clearMonthlyTrendingMusicCacheForTests();
});

describe("SidebarPlayer monthly mode", () => {
  it("shows edition-month top 10 when data exists", async () => {
    const tracks: RawTrack[] = Array.from({ length: 10 }, (_, i) => ({
      title: `Song ${i + 1}`,
      artist: `Artist ${i + 1}`,
      youtube_id: i === 0 ? "dQw4w9WgXcQ" : "",
    }));

    const fetchMock = vi.fn(async () => jsonResponse(packedArchiveWithMonth(1988, 10, tracks)));
    vi.stubGlobal("fetch", fetchMock);

    render(<SidebarPlayer currentDate="1988-10-12" />);

    await screen.findByText("October 1988 Top 10");
    expect(screen.getAllByText("Song 1").length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(ARCHIVE_URL);
    });
  });

  it("falls back to list mode when no youtube id exists", async () => {
    const tracks: RawTrack[] = Array.from({ length: 10 }, (_, i) => ({
      title: i === 0 ? "No Video Song" : `Song ${i + 1}`,
      artist: i === 0 ? "No Video Artist" : `Artist ${i + 1}`,
      youtube_id: "",
    }));

    const fetchMock = vi.fn(async () => jsonResponse(packedArchiveWithMonth(1989, 11, tracks)));
    vi.stubGlobal("fetch", fetchMock);

    render(<SidebarPlayer currentDate="1989-11-01" />);

    await screen.findByText("November 1989 Top 10");
    expect(screen.getByText("No verified video for this song")).toBeTruthy();
    expect(screen.getByText("Track list remains available for this month.")).toBeTruthy();
    const searchLink = screen.getByRole("link", { name: "Open YouTube search" });
    expect(searchLink.getAttribute("href")).toBe(
      "https://www.youtube.com/results?search_query=No%20Video%20Song%20No%20Video%20Artist%20official%20music%20video"
    );
  });

  it("auto-selects the first track with a youtubeId in monthly mode", async () => {
    const tracks: RawTrack[] = [
      { title: "No Embed Song", artist: "Artist 1", youtube_id: "" },
      { title: "Embedded Song", artist: "Artist 2", youtube_id: "dQw4w9WgXcQ" },
      ...Array.from({ length: 8 }, (_, i) => ({
        title: `Song ${i + 3}`,
        artist: `Artist ${i + 3}`,
        youtube_id: "",
      })),
    ];

    const fetchMock = vi.fn(async () => jsonResponse(packedArchiveWithMonth(1990, 10, tracks)));
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<SidebarPlayer currentDate="1990-10-18" />);

    await screen.findByText("October 1990 Top 10");

    const playButton = await screen.findByRole("button", {
      name: /Play Embedded Song by Artist 2/i,
    });
    fireEvent.click(playButton);

    await waitFor(() => {
      const iframe = container.querySelector("iframe");
      expect(iframe).toBeTruthy();
      expect(iframe?.getAttribute("src")).toContain("dQw4w9WgXcQ");
    });
  });

  it("shows NO_DATA message for out-of-range dates", async () => {
    // Mock a valid archive — the year (1949) is outside the archive's
    // 1950-2010 range, so the hook should still surface NO_DATA.
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        start: `${START_YEAR}-01`,
        end: `${END_YEAR}-12`,
        months: new Array(TOTAL_MONTHS).fill(null),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<SidebarPlayer currentDate="1949-12-15" />);

    await screen.findByText("Monthly Top 10");
    expect(screen.getByText("No chart data was found for this month.")).toBeTruthy();
  });

  it("returns null when no currentDate is provided", () => {
    const { container } = render(<SidebarPlayer />);
    expect(container.innerHTML).toBe("");
  });
});
