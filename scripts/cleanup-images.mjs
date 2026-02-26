/**
 * Image Cleanup Script
 *
 * Analyzes image-to-article relevance using multi-signal scoring and removes
 * or reassigns mismatched images. Runs in dry-run mode by default.
 *
 * Usage:
 *   node --experimental-vm-modules scripts/cleanup-images.mjs          # dry-run
 *   node --experimental-vm-modules scripts/cleanup-images.mjs --apply  # write changes
 *   node --experimental-vm-modules scripts/cleanup-images.mjs --date 1960-05-11 --editions-dir public/editions --report-path ocr/runs/1960-05-11/cleanup-report.json
 */

import { access, mkdir, readdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DEFAULT_EDITIONS_DIR = path.join(ROOT, "public", "editions");
const args = process.argv.slice(2);
let applyChanges = false;
let targetDate = "";
let reportPath = "";
let editionsDir = DEFAULT_EDITIONS_DIR;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--apply") {
    applyChanges = true;
    continue;
  }
  if (arg === "--date") {
    targetDate = args[i + 1] || "";
    i += 1;
    continue;
  }
  if (arg === "--report-path") {
    reportPath = args[i + 1] || "";
    i += 1;
    continue;
  }
  if (arg === "--editions-dir") {
    editionsDir = args[i + 1] || "";
    i += 1;
    continue;
  }
  throw new Error(`Unknown option: ${arg}`);
}

if (targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
  throw new Error(`Invalid --date value: ${targetDate}. Expected YYYY-MM-DD.`);
}
if (!editionsDir) {
  throw new Error("Missing editions directory path");
}
if (!path.isAbsolute(editionsDir)) {
  editionsDir = path.resolve(ROOT, editionsDir);
}

// ─── Category classification (reused from ocr-adapter.ts) ────────────

const SPORTS_RE =
  /\b(basketball|football|baseball|soccer|track|tennis|swim|lacrosse|hoopster|cager|gridder|bishop[s ].*(?:slam|win|beat|fall|host)|intramural|sports? brief|v-ball|field hockey|wrestling|golf)\b/i;

const ARTS_RE =
  /\b(album|film|movie|theater|theatre|concert|exhibit|gallery|sculpture|play\b.*(?:about|loyalty|love)|review|rock and roll|VCR|ceramics|photography|dance alloy|artist)\b/i;

const GREEK_RE =
  /\b(fraternity|sorority|greek|pledge|rush|chapter|panhellenic|IFC|house)\b/i;

function classifyText(text) {
  if (SPORTS_RE.test(text)) return "sports";
  if (ARTS_RE.test(text)) return "arts";
  if (GREEK_RE.test(text)) return "greek";
  return "general";
}

// ─── Tokenizer ───────────────────────────────────────────────────────

// Common institutional terms that appear in most articles/captions and
// don't help distinguish relevance between articles in the same paper.
const STOP_WORDS = new Set([
  "the", "and", "for", "was", "are", "were", "has", "have", "had", "but",
  "not", "this", "that", "with", "from", "will", "been", "its", "also",
  "who", "which", "their", "than", "they", "all", "can", "more", "when",
  "ohio", "wesleyan", "owu", "university", "delaware", "campus", "student",
  "students", "college", "transcript", "professor", "faculty", "year",
]);

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

// ─── Proper Name Extraction ──────────────────────────────────────────

function extractProperNames(text) {
  const names = [];
  // Match sequences of capitalized words (2+ words = likely a name)
  const matches = text.match(/(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/g) || [];
  for (const m of matches) {
    names.push(m.toLowerCase());
  }
  // Also match single capitalized words that aren't common sentence starters
  const commonWords = new Set([
    "the", "this", "that", "these", "those", "here", "there", "where",
    "when", "what", "which", "who", "how", "its", "also", "but", "and",
    "for", "not", "with", "from", "they", "their", "been", "have", "has",
    "was", "were", "are", "will", "can", "may", "all", "one", "two",
    "new", "old", "last", "first", "next", "each", "both", "many", "some",
    "our", "her", "his", "any", "back", "after", "before", "over", "under",
  ]);
  const singleCaps = text.match(/\b[A-Z][a-z]{2,}\b/g) || [];
  for (const w of singleCaps) {
    if (!commonWords.has(w.toLowerCase())) {
      names.push(w.toLowerCase());
    }
  }
  return [...new Set(names)];
}

// ─── Relevance Scoring ──────────────────────────────────────────────

function scoreRelevance(caption, articleHeadline, articleBody, articleCategory) {
  if (!caption || caption.trim().length < 15) return 1.0; // too short to judge

  const captionTokens = tokenize(caption);
  if (captionTokens.length === 0) return 1.0;

  const articleText = `${articleHeadline} ${articleBody}`;
  const articleTokens = new Set(tokenize(articleText));

  // Signal 1: Token overlap (weight 0.35)
  const overlap = captionTokens.filter((t) => articleTokens.has(t)).length;
  const tokenScore = overlap / captionTokens.length;

  // Signal 2: Proper name matching (weight 0.40)
  const captionNames = extractProperNames(caption);
  let nameScore = 0;
  if (captionNames.length > 0) {
    const articleTextLower = articleText.toLowerCase();
    const matched = captionNames.filter((name) =>
      articleTextLower.includes(name)
    ).length;
    nameScore = matched / captionNames.length;
  } else {
    nameScore = 0.5; // neutral when no names to check
  }

  // Signal 3: Category match (weight 0.25)
  const captionCategory = classifyText(caption);
  const catScore = captionCategory === "general" ? 0.5 :
    captionCategory === articleCategory ? 1.0 : 0.0;

  return tokenScore * 0.35 + nameScore * 0.4 + catScore * 0.25;
}

// ─── Photo-only detection ───────────────────────────────────────────

function isPhotoOnly(article) {
  if (!article.headline || article.headline.trim().length === 0) return true;

  const body = (article.body || "").replace(/\s+/g, " ").trim();
  if (body.length === 0) return true;

  // If body is essentially the same as a caption
  const captions = (article.images || []).map((img) => img.caption || "");
  for (const cap of captions) {
    const capNorm = cap.replace(/\s+/g, " ").trim().toLowerCase();
    const bodyNorm = body.toLowerCase();
    if (
      bodyNorm.length < 500 &&
      (capNorm.includes(bodyNorm) || bodyNorm.includes(capNorm))
    ) {
      return true;
    }
  }

  return false;
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n📰 Image Cleanup Script (${applyChanges ? "APPLY" : "DRY-RUN"} mode)\n`);

  const entries = await readdir(editionsDir, { withFileTypes: true });
  const discoveredEditionDirs = entries
    .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
    .map((e) => e.name)
    .sort();
  const editionDirs = targetDate
    ? discoveredEditionDirs.filter((d) => d === targetDate)
    : discoveredEditionDirs;

  if (targetDate && editionDirs.length === 0) {
    throw new Error(`Edition not found for --date ${targetDate}`);
  }

  if (targetDate) {
    console.log(`Scoped to edition date: ${targetDate}\n`);
  }

  let totalRemoved = 0;
  let totalReassigned = 0;
  let totalEmptyCleaned = 0;
  let totalEditionsModified = 0;
  const editionReports = [];

  for (const date of editionDirs) {
    const filePath = path.join(editionsDir, date, "edition.json");
    let raw;
    try {
      raw = await readFile(filePath, "utf-8");
    } catch {
      continue;
    }

    const edition = JSON.parse(raw);
    if (!Array.isArray(edition.articles)) continue;

    let editionModified = false;
    const changes = [];
    let editionRemoved = 0;
    let editionReassigned = 0;
    let editionEmptyCleaned = 0;

    for (let i = 0; i < edition.articles.length; i++) {
      const article = edition.articles[i];
      const imageFiles = article.image_files || [];
      const images = article.images || [];

      // Clean empty strings from image_files
      const emptyCount = imageFiles.filter((f) => f === "").length;
      if (emptyCount > 0) {
        article.image_files = imageFiles.filter((f) => f !== "");
        // Rebuild images array to match
        const newImages = [];
        let imgIdx = 0;
        for (let fi = 0; fi < imageFiles.length; fi++) {
          if (imageFiles[fi] !== "") {
            newImages.push(images[fi] || { caption: "", position: "" });
            imgIdx++;
          }
        }
        article.images = newImages;
        totalEmptyCleaned += emptyCount;
        editionEmptyCleaned += emptyCount;
        editionModified = true;
        changes.push(
          `  [${i}] "${article.headline?.slice(0, 50)}": removed ${emptyCount} empty image_files entries`
        );
      }

      // Skip photo-only articles
      if (isPhotoOnly(article)) continue;

      // Skip articles without images
      if (!article.image_files || article.image_files.length === 0) continue;

      const articleCategory = classifyText(
        `${article.headline || ""} ${(article.body || "").slice(0, 300)}`
      );

      // Score each image
      for (let imgI = article.image_files.length - 1; imgI >= 0; imgI--) {
        const caption = article.images?.[imgI]?.caption || "";

        if (caption.trim().length < 15) continue; // can't evaluate

        const score = scoreRelevance(
          caption,
          article.headline || "",
          article.body || "",
          articleCategory
        );

        if (score < 0.15) {
          // Try to find a better article on the same page
          const currentPage = article.source_pages?.[0];
          let reassigned = false;

          if (currentPage) {
            let bestAlt = null;
            let bestAltScore = 0;

            for (let j = 0; j < edition.articles.length; j++) {
              if (j === i) continue;
              const alt = edition.articles[j];
              if (!alt.source_pages?.includes(currentPage)) continue;
              if (isPhotoOnly(alt)) continue;

              const altCategory = classifyText(
                `${alt.headline || ""} ${(alt.body || "").slice(0, 300)}`
              );
              const altScore = scoreRelevance(
                caption,
                alt.headline || "",
                alt.body || "",
                altCategory
              );

              if (altScore >= 0.3 && altScore - score >= 0.15 && altScore > bestAltScore) {
                bestAlt = j;
                bestAltScore = altScore;
              }
            }

            if (bestAlt !== null) {
              // Reassign image to better-matching article
              const imgFile = article.image_files[imgI];
              const imgData = article.images?.[imgI] || { caption: "", position: "" };

              // Remove from current
              article.image_files.splice(imgI, 1);
              if (article.images) article.images.splice(imgI, 1);

              // Add to target
              const target = edition.articles[bestAlt];
              if (!target.image_files) target.image_files = [];
              if (!target.images) target.images = [];
              target.image_files.push(imgFile);
              target.images.push(imgData);

              totalReassigned++;
              editionReassigned++;
              reassigned = true;
              editionModified = true;
              changes.push(
                `  [${i}→${bestAlt}] REASSIGN "${caption.slice(0, 60)}..." ` +
                  `(score ${score.toFixed(2)} → ${bestAltScore.toFixed(2)}) ` +
                  `from "${article.headline?.slice(0, 40)}" to "${target.headline?.slice(0, 40)}"`
              );
              continue;
            }
          }

          if (!reassigned) {
            // Remove image entirely
            article.image_files.splice(imgI, 1);
            if (article.images) article.images.splice(imgI, 1);

            totalRemoved++;
            editionRemoved++;
            editionModified = true;
            changes.push(
              `  [${i}] REMOVE "${caption.slice(0, 60)}..." ` +
                `(score ${score.toFixed(2)}) from "${article.headline?.slice(0, 40)}"`
            );
          }
        } else if (score < 0.3) {
          changes.push(
            `  [${i}] UNCERTAIN "${caption.slice(0, 60)}..." ` +
              `(score ${score.toFixed(2)}) in "${article.headline?.slice(0, 40)}" — keeping`
          );
        }
      }

      // Trim images array to match image_files length
      if (article.images && article.image_files) {
        if (article.images.length > article.image_files.length) {
          article.images = article.images.slice(0, article.image_files.length);
          editionModified = true;
        }
      }
    }

    // ── Ad image validation ──────────────────────────────────────────
    const adSources = [edition.ads, edition.enriched_ads].filter(Array.isArray);
    for (const adList of adSources) {
      for (let i = 0; i < adList.length; i++) {
        const ad = adList[i];
        const adImages = ad.image_files || [];

        // Remove empty strings
        const adEmptyCount = adImages.filter((f) => f === "").length;
        if (adEmptyCount > 0) {
          ad.image_files = adImages.filter((f) => f !== "");
          totalEmptyCleaned += adEmptyCount;
          editionEmptyCleaned += adEmptyCount;
          editionModified = true;
          changes.push(
            `  [ad ${i}] "${ad.business_name?.slice(0, 50)}": removed ${adEmptyCount} empty image_files entries`
          );
        }

        // Validate referenced image files exist on disk
        if (ad.image_files && ad.image_files.length > 0) {
          const imagesDir = path.join(editionsDir, date, "images");
          const validFiles = [];
          for (const f of ad.image_files) {
            const filename = f.replace(/^images\//, "");
            const fullPath = path.join(imagesDir, filename);
            try {
              await access(fullPath);
              validFiles.push(f);
            } catch {
              totalRemoved++;
              editionRemoved++;
              editionModified = true;
              changes.push(
                `  [ad ${i}] REMOVE missing file "${f}" from "${ad.business_name?.slice(0, 40)}"`
              );
            }
          }
          if (validFiles.length !== ad.image_files.length) {
            ad.image_files = validFiles;
          }
        }
      }
    }

    // Sync enriched_ads image_files with ads image_files
    if (edition.ads && edition.enriched_ads) {
      for (let i = 0; i < Math.min(edition.ads.length, edition.enriched_ads.length); i++) {
        const adImgs = edition.ads[i].image_files || [];
        const enrichedImgs = edition.enriched_ads[i].image_files || [];
        if (JSON.stringify(adImgs) !== JSON.stringify(enrichedImgs)) {
          edition.enriched_ads[i].image_files = [...adImgs];
          editionModified = true;
        }
      }
    }

    if (changes.length > 0) {
      console.log(`📅 ${date}:`);
      for (const c of changes) console.log(c);
      console.log();
    }

    if (editionModified) {
      totalEditionsModified++;
      if (applyChanges) {
        await writeFile(filePath, JSON.stringify(edition, null, 2) + "\n", "utf-8");
        console.log(`  ✅ Written: ${filePath}\n`);
      }
    }

    editionReports.push({
      date,
      modified: editionModified,
      changes,
      metrics: {
        images_removed: editionRemoved,
        images_reassigned: editionReassigned,
        empty_entries_cleaned: editionEmptyCleaned,
      },
      edition_json_path: filePath,
    });
  }

  console.log("─".repeat(60));
  console.log(`Summary:`);
  console.log(`  Editions scanned: ${editionDirs.length}`);
  console.log(`  Editions modified: ${totalEditionsModified}`);
  console.log(`  Images removed: ${totalRemoved}`);
  console.log(`  Images reassigned: ${totalReassigned}`);
  console.log(`  Empty entries cleaned: ${totalEmptyCleaned}`);

  if (!applyChanges && totalEditionsModified > 0) {
    console.log(`\n⚠️  Dry-run mode — no files changed. Run with --apply to write.\n`);
  }

  if (reportPath) {
    const report = {
      mode: applyChanges ? "apply" : "dry-run",
      date_scope: targetDate || null,
      started_at: new Date().toISOString(),
      editions_scanned: editionDirs.length,
      summary: {
        editions_modified: totalEditionsModified,
        images_removed: totalRemoved,
        images_reassigned: totalReassigned,
        empty_entries_cleaned: totalEmptyCleaned,
      },
      editions: editionReports,
    };

    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf-8");

    const mdPath = reportPath.endsWith(".json")
      ? reportPath.replace(/\.json$/i, ".md")
      : `${reportPath}.md`;
    const mdLines = [
      "# Cleanup Report",
      "",
      `- Mode: ${report.mode}`,
      `- Date scope: ${report.date_scope ?? "all editions"}`,
      `- Editions scanned: ${report.editions_scanned}`,
      `- Editions modified: ${report.summary.editions_modified}`,
      `- Images removed: ${report.summary.images_removed}`,
      `- Images reassigned: ${report.summary.images_reassigned}`,
      `- Empty entries cleaned: ${report.summary.empty_entries_cleaned}`,
      "",
    ];
    for (const ed of editionReports) {
      mdLines.push(`## ${ed.date}`);
      mdLines.push(`- Modified: ${ed.modified ? "yes" : "no"}`);
      mdLines.push(`- Images removed: ${ed.metrics.images_removed}`);
      mdLines.push(`- Images reassigned: ${ed.metrics.images_reassigned}`);
      mdLines.push(`- Empty entries cleaned: ${ed.metrics.empty_entries_cleaned}`);
      mdLines.push(`- Edition JSON: ${ed.edition_json_path}`);
      if (ed.changes.length) {
        mdLines.push("- Changes:");
        for (const c of ed.changes) {
          mdLines.push(`  - ${c.trim()}`);
        }
      }
      mdLines.push("");
    }
    await writeFile(mdPath, mdLines.join("\n").trimEnd() + "\n", "utf-8");
    console.log(`Cleanup report written: ${reportPath}`);
    console.log(`Cleanup report markdown: ${mdPath}`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
