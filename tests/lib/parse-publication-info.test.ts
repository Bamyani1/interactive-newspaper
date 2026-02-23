import { describe, it, expect } from "vitest";
import { parsePublicationInfo } from "../../src/lib/parse-publication-info";

describe("parsePublicationInfo", () => {
  it("parses 1960s format with em-dash", () => {
    const result = parsePublicationInfo(
      "Ohio Wesleyan Transcript, Vol. 93 — No. 13, DELAWARE, OHIO, JANUARY 13, 1960, Price — 15 Cents"
    );
    expect(result).toEqual({ volume: "93", issue: "13" });
  });

  it("parses 1960s format with hyphen", () => {
    const result = parsePublicationInfo("Vol. 95 - No. 7");
    expect(result).toEqual({ volume: "95", issue: "7" });
  });

  it("parses 1970s format with comma", () => {
    const result = parsePublicationInfo("Vol. 103, No. 14");
    expect(result).toEqual({ volume: "103", issue: "14" });
  });

  it("parses 1980s format with space only", () => {
    const result = parsePublicationInfo("Vol. 113 No. 11");
    expect(result).toEqual({ volume: "113", issue: "11" });
  });

  it("parses 1990s format with no spaces", () => {
    const result = parsePublicationInfo("Vol.123 No.15");
    expect(result).toEqual({ volume: "123", issue: "15" });
  });

  it("parses en-dash separator", () => {
    const result = parsePublicationInfo("Vol. 100 – No. 5");
    expect(result).toEqual({ volume: "100", issue: "5" });
  });

  it("returns null for empty string", () => {
    expect(parsePublicationInfo("")).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(parsePublicationInfo(undefined)).toBeNull();
  });

  it("returns null for null", () => {
    expect(parsePublicationInfo(null)).toBeNull();
  });

  it("returns null for string missing Vol", () => {
    expect(parsePublicationInfo("No. 13, some text")).toBeNull();
  });

  it("returns null for string missing No", () => {
    expect(parsePublicationInfo("Vol. 93, some text without issue")).toBeNull();
  });

  it("returns null for completely unrelated string", () => {
    expect(parsePublicationInfo("DELAWARE, OHIO, JANUARY 13, 1960")).toBeNull();
  });
});
