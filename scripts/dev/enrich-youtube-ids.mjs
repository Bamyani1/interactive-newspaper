#!/usr/bin/env node

/* eslint-disable no-console */

/**
 * Reads scripts/dev/data/billboard-monthly-raw.json and adds a
 * `youtube_id` to each track using youtubei.js.
 *
 * youtubei.js talks to YouTube's internal InnerTube API (the same one
 * the official mobile/web apps use), so it is dramatically more
 * reliable than HTML-scraping packages like youtube-sr, which return
 * empty results on many queries even with no rate limiting.
 *
 * Concurrency is capped at 5 to stay polite. The script is resumable —
 * tracks with a non-empty youtube_id are skipped, so a crash or a
 * partial run can be picked up by re-running.
 *
 * Usage: node scripts/dev/enrich-youtube-ids.mjs
 */

import { readFile, writeFile } from "fs/promises";
import path from "path";
import pLimit from "p-limit";
import { Innertube } from "youtubei.js";

const DATA_FILE = path.resolve(process.cwd(), "scripts/dev/data/billboard-monthly-raw.json");
const CONCURRENCY = 5;
const PROGRESS_FLUSH = 50;
const REQUEST_TIMEOUT_MS = 15000;

function buildQuery(title, artist) {
  return `${title} ${artist}`;
}

async function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const data = JSON.parse(await readFile(DATA_FILE, "utf8"));

  const tasks = [];
  let alreadyHave = 0;
  for (const month of data.months) {
    for (const track of month.tracks) {
      if (track.youtube_id && track.youtube_id.length > 0) {
        alreadyHave += 1;
        continue;
      }
      tasks.push({ track });
    }
  }

  console.log(`Total tracks: ${alreadyHave + tasks.length}`);
  console.log(`Already have ID: ${alreadyHave}`);
  console.log(`To fetch: ${tasks.length}`);
  if (tasks.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  console.log("Initializing youtubei.js client...");
  const yt = await Innertube.create({ retrieve_player: false });

  const limit = pLimit(CONCURRENCY);
  let completed = 0;
  let succeeded = 0;
  let failed = 0;
  const startTime = Date.now();

  async function flush() {
    await writeFile(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
  }

  await Promise.all(
    tasks.map(({ track }) =>
      limit(async () => {
        const query = buildQuery(track.title, track.artist);
        try {
          const result = await withTimeout(
            yt.search(query, { type: "video" }),
            REQUEST_TIMEOUT_MS,
          );
          const first = result?.results?.[0];
          const id = first && typeof first.id === "string" ? first.id : "";
          if (id) {
            track.youtube_id = id;
            succeeded += 1;
          } else {
            track.youtube_id = "";
            failed += 1;
          }
        } catch (err) {
          track.youtube_id = "";
          failed += 1;
          if (failed <= 5) {
            console.warn(`  miss: ${query} (${err.message})`);
          }
        }
        completed += 1;
        if (completed % PROGRESS_FLUSH === 0) {
          await flush();
          const elapsed = (Date.now() - startTime) / 1000;
          const rate = completed / elapsed;
          const eta = (tasks.length - completed) / rate;
          console.log(
            `  progress: ${completed}/${tasks.length} (${succeeded} ok, ${failed} fail) — ${rate.toFixed(1)}/s, eta ${Math.round(eta)}s`,
          );
        }
      }),
    ),
  );

  await flush();
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s`);
  console.log(`  Succeeded: ${succeeded}`);
  console.log(`  Failed:    ${failed}`);
  console.log(`  Wrote ${DATA_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
