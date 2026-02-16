import { describe, expect, it } from 'vitest';

const scriptModulePromise = import('../../scripts/music/build-us-monthly-hot100-archive.mjs');

describe('build-us-monthly-hot100-archive helpers', () => {
  it('parses CSV rows and computes weekly points', async () => {
    const script = await scriptModulePromise;

    const columns = script.parseCsvLine('1958-08-04,1,"Poor Little Fool","Ricky Nelson",1,1,1');
    expect(columns[0]).toBe('1958-08-04');
    expect(columns[2]).toBe('Poor Little Fool');
    expect(columns[3]).toBe('Ricky Nelson');

    const parsed = script.parseHot100CsvRow({
      chart_week: '1958-08-04',
      current_week: '1',
      title: 'Poor Little Fool',
      performer: 'Ricky Nelson',
    });

    expect(parsed).toEqual({
      chart_week: '1958-08-04',
      month: '1958-08',
      title: 'Poor Little Fool',
      performer: 'Ricky Nelson',
      rank: 1,
      points: 100,
      song_key: 'poor little fool|ricky nelson',
    });

    expect(script.computeWeeklyPoints(1)).toBe(100);
    expect(script.computeWeeklyPoints(100)).toBe(1);
    expect(script.computeWeeklyPoints(101)).toBeNull();
  });

  it('aggregates repeated weekly rows into monthly ranking by total points', async () => {
    const script = await scriptModulePromise;

    const rows = [
      { chart_week: '1988-10-01', current_week: '1', title: 'Song Alpha', performer: 'Artist One' },
      { chart_week: '1988-10-08', current_week: '2', title: 'Song Alpha', performer: 'Artist One' },
      { chart_week: '1988-10-01', current_week: '1', title: 'Song Beta', performer: 'Artist Two' },
      { chart_week: '1988-10-08', current_week: '4', title: 'Song Beta', performer: 'Artist Two' },
    ];

    const aggregates = new Map<string, {
      track_id: string;
      title: string;
      performer: string;
      points_total: number;
      best_rank: number;
      weeks_present: number;
    }>();

    for (const row of rows) {
      const parsed = script.parseHot100CsvRow(row);
      expect(parsed).not.toBeNull();
      if (!parsed) continue;

      const existing = aggregates.get(parsed.song_key) ?? {
        track_id: script.toTrackId(parsed.song_key),
        title: parsed.title,
        performer: parsed.performer,
        points_total: 0,
        best_rank: 999,
        weeks_present: 0,
      };

      existing.points_total += parsed.points;
      existing.best_rank = Math.min(existing.best_rank, parsed.rank);
      existing.weeks_present += 1;
      aggregates.set(parsed.song_key, existing);
    }

    const ranked = script.rankMonthlyTop10([...aggregates.values()], 2);

    expect(ranked[0].title).toBe('Song Alpha');
    expect(ranked[0].points_total).toBe(199); // rank 1 + rank 2 => 100 + 99
    expect(ranked[1].title).toBe('Song Beta');
    expect(ranked[1].points_total).toBe(197); // rank 1 + rank 4 => 100 + 97
  });

  it('applies deterministic tie-break ordering', async () => {
    const script = await scriptModulePromise;

    const tied = [
      {
        track_id: 'a',
        title: 'Zeta Song',
        performer: 'Artist A',
        points_total: 150,
        best_rank: 5,
        weeks_present: 2,
      },
      {
        track_id: 'b',
        title: 'Alpha Song',
        performer: 'Artist A',
        points_total: 150,
        best_rank: 5,
        weeks_present: 2,
      },
      {
        track_id: 'c',
        title: 'Mid Song',
        performer: 'Artist B',
        points_total: 150,
        best_rank: 5,
        weeks_present: 2,
      },
    ];

    const ranked = script.rankMonthlyTop10(tied, 3);

    expect(ranked.map((entry: { title: string }) => entry.title)).toEqual([
      'Alpha Song',
      'Zeta Song',
      'Mid Song',
    ]);
  });
});
