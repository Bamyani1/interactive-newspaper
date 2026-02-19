import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarPlayer } from "../../src/features/music-player/components/SidebarPlayer";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("SidebarPlayer monthly mode", () => {
  it("shows edition-month top 10 when data exists", async () => {
    const yearData = {
      "10": Array.from({ length: 10 }, (_, i) => ({
        rank: i + 1,
        title: `Song ${i + 1}`,
        artist: `Artist ${i + 1}`,
        youtube_id: i === 0 ? "dQw4w9WgXcQ" : "",
      })),
    };

    const fetchMock = vi.fn(async () => jsonResponse(yearData));
    vi.stubGlobal("fetch", fetchMock);

    render(<SidebarPlayer currentDate="1988-10-12" />);

    await screen.findByText("October 1988 Top 10");
    expect(screen.getAllByText("Song 1").length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/top-10-music/1988.json");
    });
  });

  it("falls back to list mode when no youtube id exists", async () => {
    const yearData = {
      "11": Array.from({ length: 10 }, (_, i) => ({
        rank: i + 1,
        title: i === 0 ? "No Video Song" : `Song ${i + 1}`,
        artist: i === 0 ? "No Video Artist" : `Artist ${i + 1}`,
        youtube_id: "",
      })),
    };

    const fetchMock = vi.fn(async () => jsonResponse(yearData));
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
    const yearData = {
      "10": [
        { rank: 1, title: "No Embed Song", artist: "Artist 1", youtube_id: "" },
        { rank: 2, title: "Embedded Song", artist: "Artist 2", youtube_id: "dQw4w9WgXcQ" },
        ...Array.from({ length: 8 }, (_, i) => ({
          rank: i + 3,
          title: `Song ${i + 3}`,
          artist: `Artist ${i + 3}`,
          youtube_id: "",
        })),
      ],
    };

    const fetchMock = vi.fn(async () => jsonResponse(yearData));
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
    const fetchMock = vi.fn(async () => new Response("Not Found", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<SidebarPlayer currentDate="1955-01-15" />);

    await screen.findByText("Monthly Top 10");
    expect(screen.getByText("No chart data was found for this month.")).toBeTruthy();
  });

  it("returns null when no currentDate is provided", () => {
    const { container } = render(<SidebarPlayer />);
    expect(container.innerHTML).toBe("");
  });
});
