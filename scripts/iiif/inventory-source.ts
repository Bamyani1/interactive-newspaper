import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_BASE_URL = "https://cdm15963.contentdm.oclc.org";
const DEFAULT_COLLECTION = "p15963coll9";
const SEARCH = "source^wesleyan^all^and";
const FIELDS = "title!date!dmrecord!source!find";
const ISSUE_TITLE = /(?:ohio\s+wesleyan\s+)?transcript/i;
const SUPPLEMENT_TITLE = /\b(?:supplement|special edition|extra edition|commencement|homecoming)\b/i;

interface ContentDmRecord {
  collection?: string;
  pointer?: number | string;
  filetype?: string;
  parentobject?: number | string;
  title?: string;
  date?: string;
  dmrecord?: string;
  source?: string;
  find?: string;
}

interface ClassifiedRecord {
  sourceRecordId: string;
  pointer: number;
  date: string | null;
  title: string;
  source: string;
  filetype: string;
  find: string;
  classification:
    | "issue_candidate"
    | "supplement_candidate"
    | "ambiguous_compound"
    | "standalone_non_issue"
    | "excluded_source"
    | "ambiguous_missing_date";
  reviewFlags: string[];
  activeCorpusDate: boolean;
  manifest?: ManifestInventory;
}

interface ManifestInventory {
  url: string;
  status: "ok" | "failed" | "not_fetched";
  sha256?: string;
  canvasCount?: number;
  canvases?: Array<{
    id: string;
    label: string;
    width: number | null;
    height: number | null;
    imageServiceId: string | null;
  }>;
  failureReason?: string;
}

interface DmQueryResponse {
  pager?: { start?: string | number; maxrecs?: string | number; total?: string | number };
  records?: ContentDmRecord[];
}

function normalizedText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizedSource(value: unknown): string {
  return normalizedText(value).toLowerCase();
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}

export function classifyContentDmRecord(
  record: ContentDmRecord,
  activeDates: Set<string> = new Set(),
  collection = DEFAULT_COLLECTION,
): ClassifiedRecord {
  const pointer = Number(record.pointer ?? record.dmrecord);
  if (!Number.isInteger(pointer) || pointer < 0) {
    throw new Error(`Invalid CONTENTdm pointer: ${record.pointer ?? record.dmrecord}`);
  }
  const dateValue = normalizedText(record.date);
  const date = validDate(dateValue) ? dateValue : null;
  const title = normalizedText(record.title);
  const source = normalizedText(record.source);
  const filetype = normalizedText(record.filetype).toLowerCase();
  const reviewFlags: string[] = [];

  let classification: ClassifiedRecord["classification"];
  if (normalizedSource(source) !== "ohio wesleyan university") {
    classification = "excluded_source";
  } else if (!date) {
    classification = "ambiguous_missing_date";
  } else if (filetype !== "cpd") {
    classification = "standalone_non_issue";
  } else if (SUPPLEMENT_TITLE.test(title)) {
    classification = "supplement_candidate";
  } else if (ISSUE_TITLE.test(title)) {
    classification = "issue_candidate";
  } else {
    classification = "ambiguous_compound";
  }
  if (!title) reviewFlags.push("missing_title");

  return {
    sourceRecordId: `contentdm:${collection}:${pointer}`,
    pointer,
    date,
    title,
    source,
    filetype,
    find: normalizedText(record.find),
    classification,
    reviewFlags,
    activeCorpusDate: Boolean(date && activeDates.has(date)),
  };
}

export function markDateCollisions(records: ClassifiedRecord[]): void {
  const byDate = new Map<string, ClassifiedRecord[]>();
  for (const record of records) {
    if (!record.date || record.classification === "excluded_source") continue;
    const group = byDate.get(record.date) ?? [];
    group.push(record);
    byDate.set(record.date, group);
  }
  for (const group of byDate.values()) {
    if (group.length < 2) continue;
    const normalizedTitles = new Set(
      group.map((record) => normalizedText(record.title).toLowerCase()),
    );
    for (const record of group) {
      record.reviewFlags.push("same_date_collision");
      if (normalizedTitles.size < group.length) {
        record.reviewFlags.push("duplicate_title_collision");
      }
    }
  }
}

export function parseIiifManifest(
  url: string,
  raw: string,
): ManifestInventory {
  const manifest = JSON.parse(raw) as {
    sequences?: Array<{
      canvases?: Array<{
        "@id"?: string;
        id?: string;
        label?: string | { en?: string[] };
        width?: number;
        height?: number;
        images?: Array<{
          resource?: { service?: { "@id"?: string; id?: string } | Array<{ "@id"?: string; id?: string }> };
        }>;
      }>;
    }>;
  };
  const canvases = manifest.sequences?.flatMap((sequence) => sequence.canvases ?? []) ?? [];
  return {
    url,
    status: "ok",
    sha256: sha256Text(raw),
    canvasCount: canvases.length,
    canvases: canvases.map((canvas) => {
      const service = canvas.images?.[0]?.resource?.service;
      const serviceObject = Array.isArray(service) ? service[0] : service;
      const label = typeof canvas.label === "string"
        ? canvas.label
        : canvas.label?.en?.join(" ") ?? "";
      return {
        id: normalizedText(canvas["@id"] ?? canvas.id),
        label: normalizedText(label),
        width: Number.isFinite(canvas.width) ? Number(canvas.width) : null,
        height: Number.isFinite(canvas.height) ? Number(canvas.height) : null,
        imageServiceId: normalizedText(serviceObject?.["@id"] ?? serviceObject?.id) || null,
      };
    }),
  };
}

function dmQueryUrl(params: {
  baseUrl: string;
  collection: string;
  start: number;
  maxRecords: number;
  suppressCompoundPages: boolean;
}): string {
  const query = [
    "dmQuery",
    params.collection,
    SEARCH,
    FIELDS,
    "date!dmrecord",
    String(params.maxRecords),
    String(params.start),
    params.suppressCompoundPages ? "1" : "0",
    "0",
    "0",
    "0",
    "0",
    "json",
  ].join("/");
  const url = new URL("/digital/bl/dmwebservices/index.php", params.baseUrl);
  url.searchParams.set("q", query);
  return url.toString();
}

async function fetchText(url: string, attempts = 3): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchQuery(url: string): Promise<DmQueryResponse> {
  return JSON.parse(await fetchText(url)) as DmQueryResponse;
}

async function fetchParentRecords(baseUrl: string, collection: string) {
  const records: ContentDmRecord[] = [];
  let start = 1;
  let total = 0;
  do {
    const response = await fetchQuery(dmQueryUrl({
      baseUrl,
      collection,
      start,
      maxRecords: 1024,
      suppressCompoundPages: true,
    }));
    const batch = response.records ?? [];
    total = Number(response.pager?.total ?? 0);
    records.push(...batch);
    if (batch.length === 0) break;
    start += batch.length;
  } while (records.length < total);
  return { records, total };
}

async function fetchAllRecordTotal(baseUrl: string, collection: string): Promise<number> {
  const response = await fetchQuery(dmQueryUrl({
    baseUrl,
    collection,
    start: 1,
    maxRecords: 1,
    suppressCompoundPages: false,
  }));
  return Number(response.pager?.total ?? 0);
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), Math.max(1, values.length)) },
    async () => {
      while (true) {
        const index = cursor++;
        if (index >= values.length) return;
        output[index] = await mapper(values[index], index);
      }
    },
  );
  await Promise.all(workers);
  return output;
}

function parseArgs(argv: string[]) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    collection: DEFAULT_COLLECTION,
    corpus: "",
    manifestScope: "active" as "active" | "none" | "all",
    concurrency: 4,
    outputDir: path.resolve("evaluation/rag/source-inventory"),
  };
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    const next = argv[index + 1];
    if (value === "--corpus" && next) options.corpus = path.resolve(next), index++;
    else if (value === "--manifest-scope" && next) {
      if (!(["active", "none", "all"] as const).includes(next as never)) {
        throw new Error("--manifest-scope must be active, none, or all");
      }
      options.manifestScope = next as typeof options.manifestScope;
      index++;
    } else if (value === "--concurrency" && next) {
      options.concurrency = Math.max(1, Math.min(8, Number(next)));
      index++;
    } else if (value === "--output-dir" && next) options.outputDir = path.resolve(next), index++;
    else if (value === "--base-url" && next) options.baseUrl = next, index++;
    else if (value === "--collection" && next) options.collection = next, index++;
    else throw new Error(`Unknown or incomplete argument: ${value}`);
  }
  if (options.manifestScope === "active" && !options.corpus) {
    throw new Error("--corpus is required when --manifest-scope=active");
  }
  return options;
}

function writeImmutableArtifact(
  filePath: string,
  contents: string,
  identityHash: string,
): "created" | "reused" {
  mkdirSync(path.dirname(filePath), { recursive: true });
  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, "utf8");
    if (filePath.endsWith(".json")) {
      const parsed = JSON.parse(existing) as { inventorySha256?: string };
      if (parsed.inventorySha256 === identityHash) return "reused";
    } else if (existing === contents) {
      return "reused";
    }
    throw new Error(`Refusing to overwrite immutable source inventory ${filePath}.`);
  }
  const partial = `${filePath}.part`;
  writeFileSync(partial, contents, "utf8");
  renameSync(partial, filePath);
  return "created";
}

function summarizeClassifications(records: ClassifiedRecord[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const record of records) {
    counts.set(record.classification, (counts.get(record.classification) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const activeDates = new Set<string>();
  let corpusVersion: string | null = null;
  if (options.corpus) {
    const corpus = JSON.parse(readFileSync(options.corpus, "utf8")) as {
      corpusVersion?: string;
      editions?: Array<{ date?: string }>;
    };
    corpusVersion = corpus.corpusVersion ?? null;
    for (const edition of corpus.editions ?? []) {
      if (edition.date) activeDates.add(edition.date);
    }
  }

  console.error("Fetching parent/root CONTENTdm records...");
  const [{ records: rawRecords, total: parentTotal }, allRecordTotal] = await Promise.all([
    fetchParentRecords(options.baseUrl, options.collection),
    fetchAllRecordTotal(options.baseUrl, options.collection),
  ]);
  const records = rawRecords.map((record) =>
    classifyContentDmRecord(record, activeDates, options.collection),
  );
  markDateCollisions(records);

  const manifestTargets = options.manifestScope === "none"
    ? []
    : records.filter((record) =>
        options.manifestScope === "all" || record.activeCorpusDate,
      );
  console.error(`Fetching ${manifestTargets.length} IIIF manifests (metadata only)...`);
  await mapWithConcurrency(
    manifestTargets,
    options.concurrency,
    async (record, index) => {
      const url = `${options.baseUrl}/iiif/info/${options.collection}/${record.pointer}/manifest.json`;
      try {
        record.manifest = parseIiifManifest(url, await fetchText(url));
      } catch (error) {
        record.manifest = {
          url,
          status: "failed",
          failureReason: error instanceof Error ? error.message : String(error),
        };
      }
      if ((index + 1) % 25 === 0 || index + 1 === manifestTargets.length) {
        console.error(`  manifests ${index + 1}/${manifestTargets.length}`);
      }
      return record;
    },
  );
  for (const record of records) {
    if (!record.manifest) {
      record.manifest = {
        url: `${options.baseUrl}/iiif/info/${options.collection}/${record.pointer}/manifest.json`,
        status: "not_fetched",
      };
    }
  }

  records.sort((left, right) =>
    (left.date ?? "").localeCompare(right.date ?? "") || left.pointer - right.pointer,
  );
  const dateGroups = new Map<string, ClassifiedRecord[]>();
  for (const record of records) {
    if (!record.date || record.classification === "excluded_source") continue;
    const group = dateGroups.get(record.date) ?? [];
    group.push(record);
    dateGroups.set(record.date, group);
  }
  const collisionDates = [...dateGroups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([date, group]) => ({
      date,
      sourceRecordIds: group.map((record) => record.sourceRecordId),
      titles: group.map((record) => record.title),
      activeCorpusDate: activeDates.has(date),
    }));
  const activeUnmatchedDates = [...activeDates]
    .filter((date) => (dateGroups.get(date) ?? []).length === 0)
    .sort();
  const activeCollisionDates = collisionDates
    .filter((collision) => collision.activeCorpusDate)
    .map((collision) => collision.date);
  const manifestSuccesses = manifestTargets.filter(
    (record) => record.manifest?.status === "ok",
  ).length;
  const immutableContent = {
    source: {
      baseUrl: options.baseUrl,
      collection: options.collection,
      search: SEARCH,
      fields: FIELDS,
      suppressCompoundPagesForRoots: true,
    },
    corpusVersion,
    apiTotals: {
      matchingParentOrRootRecords: parentTotal,
      matchingRecordsIncludingCompoundPages: allRecordTotal,
      impliedCompoundChildRecords: Math.max(0, allRecordTotal - parentTotal),
    },
    counts: {
      exactOhioWesleyanRecords: records.filter(
        (record) => record.classification !== "excluded_source",
      ).length,
      classifications: summarizeClassifications(records),
      uniqueDatedGroups: dateGroups.size,
      collisionDates: collisionDates.length,
      activeCorpusDates: activeDates.size,
      activeUnmatchedDates: activeUnmatchedDates.length,
      activeCollisionDates: activeCollisionDates.length,
      manifestsRequested: manifestTargets.length,
      manifestsSucceeded: manifestSuccesses,
      manifestsFailed: manifestTargets.length - manifestSuccesses,
    },
    activeUnmatchedDates,
    activeCollisionDates,
    collisions: collisionDates,
    records,
  };
  const inventorySha256 = sha256Text(stableStringify(immutableContent));
  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    inventorySha256,
    ...immutableContent,
  };
  const baseName = `contentdm-${options.collection}-${inventorySha256.slice(0, 16)}`;
  const jsonPath = path.join(options.outputDir, `${baseName}.json`);
  const markdownPath = path.join(options.outputDir, `${baseName}.md`);
  const jsonDisposition = writeImmutableArtifact(
    jsonPath,
    `${JSON.stringify(payload, null, 2)}\n`,
    inventorySha256,
  );
  const markdownDisposition = writeImmutableArtifact(
    markdownPath,
    [
      "# CONTENTdm Source Inventory",
      "",
      `- Inventory hash: \`${inventorySha256}\``,
      `- Corpus version: \`${corpusVersion ?? "none"}\``,
      `- Matching parent/root records: ${parentTotal}`,
      `- Matching records including compound pages: ${allRecordTotal}`,
      `- Exact Ohio Wesleyan records: ${payload.counts.exactOhioWesleyanRecords}`,
      `- Unique dated groups: ${payload.counts.uniqueDatedGroups}`,
      `- Same-date collision groups: ${payload.counts.collisionDates}`,
      `- Active corpus dates mapped: ${activeDates.size - activeUnmatchedDates.length}`,
      `- Active corpus dates unmatched: ${activeUnmatchedDates.length}`,
      `- Active corpus dates with collisions: ${activeCollisionDates.length}`,
      `- IIIF manifests: ${manifestSuccesses}/${manifestTargets.length} succeeded`,
      "",
      "## Classifications",
      "",
      ...Object.entries(payload.counts.classifications).map(
        ([classification, count]) => `- ${classification}: ${count}`,
      ),
      "",
      "Records with date collisions remain review candidates; this inventory does not silently choose one pointer.",
      "",
    ].join("\n"),
    inventorySha256,
  );
  console.log(
    JSON.stringify(
      {
        jsonPath,
        markdownPath,
        disposition: {
          json: jsonDisposition,
          markdown: markdownDisposition,
        },
        inventorySha256,
        apiTotals: payload.apiTotals,
        counts: payload.counts,
      },
      null,
      2,
    ),
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
