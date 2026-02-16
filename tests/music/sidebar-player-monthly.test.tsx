import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarPlayer } from '../../src/features/music-player/components/SidebarPlayer';
import { clearMonthlyTrendingMusicCacheForTests } from '../../src/features/music-player/hooks/useMonthlyTrendingMusic';
import type { MonthlyTrendingApiResponse } from '../../src/types';

function jsonResponse(payload: MonthlyTrendingApiResponse, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  clearMonthlyTrendingMusicCacheForTests();
  vi.restoreAllMocks();
});

describe('SidebarPlayer monthly mode', () => {
  it('shows edition-month top 10 when in range', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      query: { date: '1988-10-12', month: '1988-10' },
      reason: null,
      attempts: ['LOCAL_ARCHIVE:hot100-monthly'],
      record: {
        month: '1988-10',
        source: 'BILLBOARD_HOT100_MONTHLY_ARCHIVE',
        raw: {},
        tracks: Array.from({ length: 10 }, (_, index) => ({
          rank: index + 1,
          track_id: `track-${index + 1}`,
          title: `Song ${index + 1}`,
          artist: `Artist ${index + 1}`,
          youtubeId: index === 0 ? 'dQw4w9WgXcQ' : null,
          points_total: 100 - index,
          best_rank: index + 1,
          weeks_present: 4,
        })),
      },
    }));

    vi.stubGlobal('fetch', fetchMock);

    render(<SidebarPlayer currentDate="1988-10-12" />);

    await screen.findByText('October 1988 Top 10');
    expect(screen.getByText('Billboard Hot 100 (monthly)')).toBeTruthy();
    expect(screen.getAllByText('Song 1').length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/music?date=1988-10-12');
    });
  });

  it('falls back to list mode when no youtube id exists', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      query: { date: '1988-11-01', month: '1988-11' },
      reason: null,
      attempts: ['LOCAL_ARCHIVE:hot100-monthly'],
      record: {
        month: '1988-11',
        source: 'BILLBOARD_HOT100_MONTHLY_ARCHIVE',
        raw: {},
        tracks: [
          {
            rank: 1,
            track_id: 'track-a',
            title: 'No Video Song',
            artist: 'No Video Artist',
            youtubeId: null,
            points_total: 100,
            best_rank: 1,
            weeks_present: 4,
          },
          ...Array.from({ length: 9 }, (_, index) => ({
            rank: index + 2,
            track_id: `track-${index + 2}`,
            title: `Song ${index + 2}`,
            artist: `Artist ${index + 2}`,
            youtubeId: null,
            points_total: 99 - index,
            best_rank: index + 2,
            weeks_present: 4,
          })),
        ],
      },
    }));

    vi.stubGlobal('fetch', fetchMock);

    render(<SidebarPlayer currentDate="1988-11-01" />);

    await screen.findByText('November 1988 Top 10');
    expect(screen.getByText('No verified video for this song')).toBeTruthy();
    expect(screen.getByText('Track list remains available for this month.')).toBeTruthy();
    const searchLink = screen.getByRole('link', { name: 'Open YouTube search' });
    expect(searchLink.getAttribute('href')).toBe(
      'https://www.youtube.com/results?search_query=No%20Video%20Song%20No%20Video%20Artist%20official%20music%20video',
    );
  });

  it('auto-selects the first track with a youtubeId in monthly mode', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      query: { date: '1988-10-18', month: '1988-10' },
      reason: null,
      attempts: ['LOCAL_ARCHIVE:hot100-monthly'],
      record: {
        month: '1988-10',
        source: 'BILLBOARD_HOT100_MONTHLY_ARCHIVE',
        raw: {},
        tracks: [
          {
            rank: 1,
            track_id: 'track-1',
            title: 'No Embed Song',
            artist: 'Artist 1',
            youtubeId: null,
            points_total: 100,
            best_rank: 1,
            weeks_present: 4,
          },
          {
            rank: 2,
            track_id: 'track-2',
            title: 'Embedded Song',
            artist: 'Artist 2',
            youtubeId: 'dQw4w9WgXcQ',
            points_total: 99,
            best_rank: 2,
            weeks_present: 4,
          },
          ...Array.from({ length: 8 }, (_, index) => ({
            rank: index + 3,
            track_id: `track-${index + 3}`,
            title: `Song ${index + 3}`,
            artist: `Artist ${index + 3}`,
            youtubeId: null,
            points_total: 98 - index,
            best_rank: index + 3,
            weeks_present: 4,
          })),
        ],
      },
    }));

    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(<SidebarPlayer currentDate="1988-10-18" />);

    await screen.findByText('October 1988 Top 10');
    await waitFor(() => {
      const iframe = container.querySelector('iframe');
      expect(iframe).toBeTruthy();
      expect(iframe?.getAttribute('src')).toContain('dQw4w9WgXcQ');
    });
  });

  it('shows explicit out-of-range message', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      query: { date: '1955-01-15', month: '1955-01' },
      reason: 'OUT_OF_ARCHIVE_RANGE',
      attempts: ['LOCAL_ARCHIVE:hot100-monthly'],
      record: null,
    }));

    vi.stubGlobal('fetch', fetchMock);

    render(<SidebarPlayer currentDate="1955-01-15" />);

    await screen.findByText('Monthly Top 10');
    expect(
      screen.getByText(
        'No chart data is available for this month. Coverage starts at August 1958 and ends at December 2000.',
      ),
    ).toBeTruthy();
  });
});
