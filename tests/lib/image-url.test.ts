import { describe, it, expect, afterEach } from "vitest";
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

  describe("content-addressed assets (<sha256>.webp)", () => {
    const hash64 = "a".repeat(32) + "0123456789abcdef0123456789abcdef";
    const hashName = `${hash64}.webp`;

    it("routes a bare 64-hex hash to the ocr-assets namespace in prod", () => {
      process.env.IMAGE_BASE_URL = "https://pub-abc123.r2.dev";
      expect(resolveImageUrl("1980-04-17", hashName)).toBe(
        `https://pub-abc123.r2.dev/ocr-assets/${hashName}`
      );
    });

    it("routes an images/-prefixed 64-hex hash to the ocr-assets namespace in prod", () => {
      process.env.IMAGE_BASE_URL = "https://pub-abc123.r2.dev";
      expect(resolveImageUrl("1980-04-17", `images/${hashName}`)).toBe(
        `https://pub-abc123.r2.dev/ocr-assets/${hashName}`
      );
    });

    it("strips a trailing slash from the base URL", () => {
      process.env.IMAGE_BASE_URL = "https://pub-abc123.r2.dev/";
      expect(resolveImageUrl("1980-04-17", hashName)).toBe(
        `https://pub-abc123.r2.dev/ocr-assets/${hashName}`
      );
    });

    it("keeps the dev proxy path without IMAGE_BASE_URL (bare)", () => {
      expect(resolveImageUrl("1980-04-17", hashName)).toBe(
        `/api/editions/1980-04-17/images/${hashName}`
      );
    });

    it("keeps the dev proxy path without IMAGE_BASE_URL (images/ prefix)", () => {
      expect(resolveImageUrl("1980-04-17", `images/${hashName}`)).toBe(
        `/api/editions/1980-04-17/images/${hashName}`
      );
    });

    it("treats a 63-hex name as a legacy filename", () => {
      process.env.IMAGE_BASE_URL = "https://pub-abc123.r2.dev";
      const short = `${hash64.slice(0, 63)}.webp`;
      expect(resolveImageUrl("1980-04-17", short)).toBe(
        `https://pub-abc123.r2.dev/1980-04-17/images/${short}`
      );
    });

    it("treats a 65-hex name as a legacy filename", () => {
      process.env.IMAGE_BASE_URL = "https://pub-abc123.r2.dev";
      const long = `${hash64}f.webp`;
      expect(resolveImageUrl("1980-04-17", long)).toBe(
        `https://pub-abc123.r2.dev/1980-04-17/images/${long}`
      );
    });

    it("treats an uppercase-hex name as a legacy filename", () => {
      process.env.IMAGE_BASE_URL = "https://pub-abc123.r2.dev";
      const upper = `${hash64.slice(0, 63)}F.webp`;
      expect(resolveImageUrl("1980-04-17", upper)).toBe(
        `https://pub-abc123.r2.dev/1980-04-17/images/${upper}`
      );
    });

    it("does not divert a 64-hex hash with a non-webp extension", () => {
      process.env.IMAGE_BASE_URL = "https://pub-abc123.r2.dev";
      expect(resolveImageUrl("1980-04-17", `${hash64}.jpg`)).toBe(
        `https://pub-abc123.r2.dev/1980-04-17/images/${hash64}.webp`
      );
    });
  });
});
