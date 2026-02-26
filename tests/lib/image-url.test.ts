import { describe, it, expect, afterEach, vi } from "vitest";
import { resolveImageUrl } from "../../src/lib/image-url";

describe("resolveImageUrl", () => {
  afterEach(() => {
    delete process.env.IMAGE_BASE_URL;
  });

  describe("without IMAGE_BASE_URL (local dev)", () => {
    it("returns API proxy path for a bare filename", () => {
      expect(resolveImageUrl("1980-04-17", "0001_Page 1_img1.jpg")).toBe(
        "/api/editions/1980-04-17/images/0001_Page%201_img1.jpg"
      );
    });

    it("strips images/ prefix before building path", () => {
      expect(resolveImageUrl("1980-04-17", "images/0001_Page 1_img1.jpg")).toBe(
        "/api/editions/1980-04-17/images/0001_Page%201_img1.jpg"
      );
    });

    it("preserves original extension (no webp conversion)", () => {
      expect(resolveImageUrl("1980-04-17", "photo.png")).toBe(
        "/api/editions/1980-04-17/images/photo.png"
      );
    });
  });

  describe("with IMAGE_BASE_URL (production)", () => {
    it("returns R2 URL with .webp extension for .jpg", () => {
      process.env.IMAGE_BASE_URL = "https://pub-abc123.r2.dev";
      expect(resolveImageUrl("1980-04-17", "0001_Page 1_img1.jpg")).toBe(
        "https://pub-abc123.r2.dev/1980-04-17/images/0001_Page 1_img1.webp"
      );
    });

    it("converts .jpeg to .webp", () => {
      process.env.IMAGE_BASE_URL = "https://pub-abc123.r2.dev";
      expect(resolveImageUrl("1980-04-17", "photo.jpeg")).toBe(
        "https://pub-abc123.r2.dev/1980-04-17/images/photo.webp"
      );
    });

    it("converts .png to .webp", () => {
      process.env.IMAGE_BASE_URL = "https://pub-abc123.r2.dev";
      expect(resolveImageUrl("1980-04-17", "photo.png")).toBe(
        "https://pub-abc123.r2.dev/1980-04-17/images/photo.webp"
      );
    });

    it("converts .tif to .webp", () => {
      process.env.IMAGE_BASE_URL = "https://pub-abc123.r2.dev";
      expect(resolveImageUrl("1980-04-17", "scan.tif")).toBe(
        "https://pub-abc123.r2.dev/1980-04-17/images/scan.webp"
      );
    });

    it("converts .tiff to .webp", () => {
      process.env.IMAGE_BASE_URL = "https://pub-abc123.r2.dev";
      expect(resolveImageUrl("1980-04-17", "scan.tiff")).toBe(
        "https://pub-abc123.r2.dev/1980-04-17/images/scan.webp"
      );
    });

    it("strips images/ prefix", () => {
      process.env.IMAGE_BASE_URL = "https://pub-abc123.r2.dev";
      expect(resolveImageUrl("1980-04-17", "images/photo.jpg")).toBe(
        "https://pub-abc123.r2.dev/1980-04-17/images/photo.webp"
      );
    });

    it("strips trailing slash from base URL", () => {
      process.env.IMAGE_BASE_URL = "https://pub-abc123.r2.dev/";
      expect(resolveImageUrl("1980-04-17", "photo.jpg")).toBe(
        "https://pub-abc123.r2.dev/1980-04-17/images/photo.webp"
      );
    });

    it("leaves non-image extensions unchanged", () => {
      process.env.IMAGE_BASE_URL = "https://pub-abc123.r2.dev";
      expect(resolveImageUrl("1980-04-17", "data.json")).toBe(
        "https://pub-abc123.r2.dev/1980-04-17/images/data.json"
      );
    });
  });
});
