import { describe, expect, it } from "vitest";
import {
  classifyContentDmRecord,
  markDateCollisions,
  parseIiifManifest,
} from "../../scripts/iiif/inventory-source";

describe("CONTENTdm source inventory", () => {
  it("classifies an OWU compound Transcript record as an issue candidate", () => {
    expect(
      classifyContentDmRecord({
        pointer: 123,
        filetype: "cpd",
        title: "The Ohio Wesleyan Transcript (Delaware, OH), 1990-02-21",
        date: "1990-02-21",
        source: " Ohio Wesleyan University\n",
      }, new Set(["1990-02-21"])),
    ).toMatchObject({
      sourceRecordId: "contentdm:p15963coll9:123",
      classification: "issue_candidate",
      activeCorpusDate: true,
    });
  });

  it("keeps supplements and non-compound records separate from issues", () => {
    expect(
      classifyContentDmRecord({
        pointer: 1,
        filetype: "cpd",
        title: "Transcript Homecoming Supplement",
        date: "1990-10-01",
        source: "Ohio Wesleyan University",
      }).classification,
    ).toBe("supplement_candidate");
    expect(
      classifyContentDmRecord({
        pointer: 2,
        filetype: "jpg",
        title: "Single page",
        date: "1990-10-01",
        source: "Ohio Wesleyan University",
      }).classification,
    ).toBe("standalone_non_issue");
  });

  it("flags same-date and duplicate-title collisions without choosing a winner", () => {
    const records = [10, 11].map((pointer) =>
      classifyContentDmRecord({
        pointer,
        filetype: "cpd",
        title: "The Transcript",
        date: "1990-02-21",
        source: "Ohio Wesleyan University",
      }),
    );
    markDateCollisions(records);
    expect(records.every((record) => record.reviewFlags.includes("same_date_collision"))).toBe(true);
    expect(records.every((record) => record.reviewFlags.includes("duplicate_title_collision"))).toBe(true);
  });

  it("extracts IIIF v2 canvas lineage without downloading page images", () => {
    const manifest = parseIiifManifest(
      "https://example.test/manifest.json",
      JSON.stringify({
        sequences: [{
          canvases: [{
            "@id": "canvas-1",
            label: "Page 1",
            width: 2000,
            height: 3000,
            images: [{ resource: { service: { "@id": "service-1" } } }],
          }],
        }],
      }),
    );
    expect(manifest).toMatchObject({
      status: "ok",
      canvasCount: 1,
      canvases: [{
        id: "canvas-1",
        width: 2000,
        height: 3000,
        imageServiceId: "service-1",
      }],
    });
  });
});
