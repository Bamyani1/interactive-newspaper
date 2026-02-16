import { readFile } from 'fs/promises';
import path from 'path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(process.cwd(), 'public', 'data', 'music', 'us', 'hot100');
const INDEX_PATH = path.join(ROOT, 'index', 'monthly-top10-1958-2000.json');
const CATALOG_PATH = path.join(ROOT, 'index', 'tracks-catalog-1958-2000.json');

describe('1988-10 seeded youtube mapping', () => {
  it('contains non-null youtubeId values for all top-10 tracks', async () => {
    const [indexRaw, catalogRaw] = await Promise.all([
      readFile(INDEX_PATH, 'utf8'),
      readFile(CATALOG_PATH, 'utf8'),
    ]);

    const index = JSON.parse(indexRaw);
    const catalog = JSON.parse(catalogRaw);

    const october1988 = index.find((record: { month: string }) => record.month === '1988-10');
    expect(october1988).toBeTruthy();
    expect(october1988.tracks.length).toBe(10);

    const catalogMap = new Map(catalog.map((track: { track_id: string; youtubeId: string | null }) => [track.track_id, track.youtubeId]));
    const youtubeIds = october1988.tracks.map((track: { track_id: string }) => catalogMap.get(track.track_id));

    expect(youtubeIds.every((value: string | null | undefined) => typeof value === 'string' && value.length > 0)).toBe(true);
  });
});
