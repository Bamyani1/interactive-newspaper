import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();

  const archive = await import('../../src/lib/music-local-archive');
  archive.clearMusicLocalArchiveCacheForTests();
});

describe('/api/music local archive route', () => {
  it('returns monthly top 10 for in-range date', async () => {
    const route = await import('../../src/app/api/music/route');

    const request = new NextRequest('http://localhost/api/music?date=1988-10-12');
    const response = await route.GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.query.month).toBe('1988-10');
    expect(payload.reason).toBeNull();
    expect(payload.record?.source).toBe('BILLBOARD_HOT100_MONTHLY_ARCHIVE');
    expect(Array.isArray(payload.record?.tracks)).toBe(true);
    expect(payload.record?.tracks.length).toBe(10);
    expect(payload.record?.tracks.some((track: { youtubeId: string | null }) => Boolean(track.youtubeId))).toBe(true);
  });

  it('returns explicit out-of-range reason for pre-coverage date', async () => {
    const route = await import('../../src/app/api/music/route');

    const request = new NextRequest('http://localhost/api/music?date=1955-01-15');
    const response = await route.GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.query.month).toBe('1955-01');
    expect(payload.record).toBeNull();
    expect(payload.reason).toBe('OUT_OF_ARCHIVE_RANGE');
  });

  it('returns INVALID_DATE for malformed date', async () => {
    const route = await import('../../src/app/api/music/route');

    const request = new NextRequest('http://localhost/api/music?date=1988-10');
    const response = await route.GET(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.record).toBeNull();
    expect(payload.reason).toBe('INVALID_DATE');
  });
});
