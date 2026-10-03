import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backupEditions, restoreEditions } from "../../scripts/db/backup-editions.mjs";

const md5 = (body: string | Buffer) => createHash("md5").update(body).digest("hex");

function memoryClient() {
  const objects = new Map<string, Buffer>();
  return {
    objects,
    async head(key: string) {
      const body = objects.get(key);
      return body ? { etag: md5(body) } : null;
    },
    async put(key: string, body: Buffer) {
      objects.set(key, Buffer.from(body));
    },
    async list(prefix: string) {
      return [...objects.keys()].filter((key) => key.startsWith(prefix));
    },
    async get(key: string) {
      return objects.get(key) ?? null;
    },
  };
}

describe("backup-editions", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "backup-editions-"));
    mkdirSync(path.join(root, "1983-04-21", "images"), { recursive: true });
    writeFileSync(path.join(root, "1983-04-21", "edition.json"), '{"date":"1983-04-21"}');
    writeFileSync(path.join(root, "1983-04-21", "upload-manifest.json"), "{}");
    writeFileSync(path.join(root, "1983-04-21", "images", "a.webp"), "image bytes");
    mkdirSync(path.join(root, "not-a-date"));
    writeFileSync(path.join(root, "not-a-date", "edition.json"), "{}");
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("uploads each dated edition's JSON files and skips images and other folders", async () => {
    const client = memoryClient();
    const result = await backupEditions({ editionsDir: root, client, log: () => {} });

    expect([...client.objects.keys()].sort()).toEqual([
      "edition-backups/1983-04-21/edition.json",
      "edition-backups/1983-04-21/upload-manifest.json",
    ]);
    expect(result).toEqual({ uploaded: 2, unchanged: 0 });
  });

  it("skips files whose stored copy already matches", async () => {
    const client = memoryClient();
    await backupEditions({ editionsDir: root, client, log: () => {} });
    writeFileSync(path.join(root, "1983-04-21", "edition.json"), '{"date":"1983-04-21","v":2}');

    const result = await backupEditions({ editionsDir: root, client, log: () => {} });

    expect(result).toEqual({ uploaded: 1, unchanged: 1 });
  });

  it("uploads nothing on a dry run", async () => {
    const client = memoryClient();
    const result = await backupEditions({ editionsDir: root, client, dryRun: true, log: () => {} });

    expect(client.objects.size).toBe(0);
    expect(result).toEqual({ uploaded: 2, unchanged: 0 });
  });

  it("restores only missing files and never overwrites local ones", async () => {
    const client = memoryClient();
    await backupEditions({ editionsDir: root, client, log: () => {} });
    rmSync(path.join(root, "1983-04-21", "edition.json"));
    writeFileSync(path.join(root, "1983-04-21", "upload-manifest.json"), '{"local":true}');

    const result = await restoreEditions({ editionsDir: root, client, log: () => {} });

    expect(readFileSync(path.join(root, "1983-04-21", "edition.json"), "utf8")).toBe(
      '{"date":"1983-04-21"}'
    );
    expect(readFileSync(path.join(root, "1983-04-21", "upload-manifest.json"), "utf8")).toBe(
      '{"local":true}'
    );
    expect(result).toEqual({ restored: 1, kept: 1 });
  });

  it("refuses stored keys that would write outside the editions folder", async () => {
    const client = memoryClient();
    client.objects.set("edition-backups/../escape.json", Buffer.from("{}"));
    client.objects.set("edition-backups/1983-04-21/../../escape.json", Buffer.from("{}"));

    const result = await restoreEditions({ editionsDir: root, client, log: () => {} });

    expect(result).toEqual({ restored: 0, kept: 0 });
  });
});
