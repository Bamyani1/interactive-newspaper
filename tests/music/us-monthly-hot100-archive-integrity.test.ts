import { readFile } from 'fs/promises';
import path from 'path';
import { describe, expect, it } from 'vitest';

const INDEX_PATH = path.join(
  process.cwd(),
  'public',
  'data',
  'music',
  'us',
  'hot100',
  'index',
  'monthly-top10-1958-2000.json',
);

function listMonthsInclusive(startMonth: string, endMonth: string): string[] {
  const [startYear, startMonthNum] = startMonth.split('-').map(Number);
  const [endYear, endMonthNum] = endMonth.split('-').map(Number);

  const output: string[] = [];
  let year = startYear;
  let month = startMonthNum;

  while (year < endYear || (year === endYear && month <= endMonthNum)) {
    output.push(`${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}`);
    month += 1;
    if (month === 13) {
      year += 1;
      month = 1;
    }
  }

  return output;
}

describe('US monthly Hot 100 archive integrity', () => {
  it('covers every month from 1958-08 through 2000-12', async () => {
    const raw = await readFile(INDEX_PATH, 'utf8');
    const index = JSON.parse(raw) as Array<{ month: string }>;

    const expectedMonths = listMonthsInclusive('1958-08', '2000-12');
    expect(index).toHaveLength(expectedMonths.length);
    expect(index[0]?.month).toBe('1958-08');
    expect(index[index.length - 1]?.month).toBe('2000-12');
    expect(index.map((record) => record.month)).toEqual(expectedMonths);
  });

  it('contains exactly 10 ranked tracks per month', async () => {
    const raw = await readFile(INDEX_PATH, 'utf8');
    const index = JSON.parse(raw) as Array<{
      month: string;
      tracks: Array<{ rank: number; track_id: string }>;
    }>;

    for (const monthRecord of index) {
      expect(monthRecord.tracks).toHaveLength(10);

      const ranks = monthRecord.tracks.map((track) => track.rank).sort((a, b) => a - b);
      expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

      const trackIds = new Set(monthRecord.tracks.map((track) => track.track_id));
      expect(trackIds.size).toBe(10);
    }
  });

  it('contains known in-range month for edition date 1988-10', async () => {
    const raw = await readFile(INDEX_PATH, 'utf8');
    const index = JSON.parse(raw) as Array<{
      month: string;
      source: string;
      tracks: unknown[];
    }>;

    const october1988 = index.find((record) => record.month === '1988-10');

    expect(october1988).toBeTruthy();
    expect(october1988?.source).toBe('BILLBOARD_HOT100_MONTHLY_ARCHIVE');
    expect(october1988?.tracks.length).toBe(10);
  });
});
