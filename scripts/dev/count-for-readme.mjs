#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * One-shot audit script for README/architecture-doc numbers.
 * Prints authoritative counts from Neon + filesystem so the docs can
 * cite real values instead of stale snapshots.
 *
 * Usage: node scripts/dev/count-for-readme.mjs
 */

import { neon } from "@neondatabase/serverless";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "../../.env.local");
if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf-8").split("\n")) {
        const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*)\s*$/);
        if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
}

const sql = neon(process.env.DATABASE_URL);

async function main() {
    const out = {};

    // Editions
    const edRows = await sql`SELECT COUNT(*)::int AS n, MIN(date) AS min_d, MAX(date) AS max_d FROM editions`;
    out.editions = edRows[0];

    // Articles
    const artRows = await sql`SELECT COUNT(*)::int AS n,
                                     COUNT(embedding)::int AS n_embedded,
                                     COUNT(DISTINCT edition_date)::int AS distinct_editions
                              FROM articles`;
    out.articles = artRows[0];

    // Ads
    const adRows = await sql`SELECT COUNT(*)::int AS n,
                                    COUNT(category)::int AS n_categorized,
                                    COUNT(ad_type)::int AS n_typed
                             FROM ads`;
    out.ads = adRows[0];

    // Weather
    const wxRows = await sql`SELECT COUNT(*)::int AS n,
                                    MIN(date) AS min_d, MAX(date) AS max_d,
                                    COUNT(DISTINCT scope)::int AS scopes
                             FROM weather`;
    out.weather = wxRows[0];

    // Music
    const muRows = await sql`SELECT COUNT(*)::int AS n,
                                    MIN(year)::int AS min_y, MAX(year)::int AS max_y,
                                    COUNT(DISTINCT year)::int AS years,
                                    COUNT(DISTINCT (year, month))::int AS months
                             FROM music`;
    out.music = muRows[0];

    // Ask session turns, ask feedback, spend counter, rate bucket
    try {
        const sessRows = await sql`SELECT COUNT(*)::int AS turns,
                                          COUNT(DISTINCT session_id)::int AS sessions
                                   FROM ask_session_turns`;
        out.ask_session_turns = sessRows[0];
    } catch (e) { out.ask_session_turns = { error: String(e.message).slice(0, 80) }; }

    try {
        const fbRows = await sql`SELECT COUNT(*)::int AS n FROM ask_feedback`;
        out.ask_feedback = fbRows[0];
    } catch (e) { out.ask_feedback = { error: String(e.message).slice(0, 80) }; }

    try {
        const spendRows = await sql`SELECT COUNT(*)::int AS days FROM ai_spend_counter`;
        out.ai_spend_counter = spendRows[0];
    } catch (e) { out.ai_spend_counter = { error: String(e.message).slice(0, 80) }; }

    // Articles per category (for color on scale)
    const catRows = await sql`SELECT category, COUNT(*)::int AS n
                              FROM articles
                              GROUP BY category
                              ORDER BY n DESC`;
    out.articles_by_category = catRows;

    // Filesystem
    const publicEditions = path.resolve(__dirname, "../../public/editions");
    let folderCount = 0, editionJsonCount = 0;
    if (existsSync(publicEditions)) {
        const entries = readdirSync(publicEditions, { withFileTypes: true });
        for (const e of entries) {
            if (!e.isDirectory()) continue;
            folderCount++;
            if (existsSync(path.join(publicEditions, e.name, "edition.json"))) editionJsonCount++;
        }
    }
    out.filesystem = { folderCount, editionJsonCount };

    // Weather file scope
    const wxIndex = path.resolve(__dirname, "../../public/data/weather/ohio/index/delaware-by-date-1950-2000.json");
    if (existsSync(wxIndex)) {
        const wx = JSON.parse(readFileSync(wxIndex, "utf-8"));
        out.weather_file = {
            start_date: wx.start_date,
            end_date: wx.end_date,
            tmax_len: wx.tmax_c?.length,
            tmin_len: wx.tmin_c?.length,
            size_bytes: statSync(wxIndex).size,
        };
    }

    // Music file
    const muFile = path.resolve(__dirname, "../../public/top-10-music/chart-1950-2010.json");
    if (existsSync(muFile)) {
        const mu = JSON.parse(readFileSync(muFile, "utf-8"));
        const months = mu.months || mu;
        out.music_file = {
            months_len: Array.isArray(months) ? months.length : null,
            raw_keys: Object.keys(mu).slice(0, 8),
            size_bytes: statSync(muFile).size,
        };
    }

    console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
    console.error("FAILED:", err);
    process.exit(1);
});
