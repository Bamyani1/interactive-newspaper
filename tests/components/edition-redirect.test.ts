import { beforeEach, describe, expect, it, vi } from "vitest";

const getEditionsList = vi.fn();
const redirect = vi.fn((destination: string) => {
  throw new Error(`redirect:${destination}`);
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.doMock("@/src/lib/editions-server", () => ({ getEditionsList }));
  vi.doMock("next/navigation", () => ({ redirect }));
});

describe("edition route redirect", () => {
  it("redirects to the latest date from the server edition list", async () => {
    getEditionsList.mockResolvedValue([
      { date: "1994-01-19" },
      { date: "2006-04-20" },
      { date: "1960-01-13" },
    ]);
    const { default: EditionRedirect } = await import("../../src/app/edition/page");

    await expect(EditionRedirect()).rejects.toThrow("redirect:/edition/2006-04-20");
    expect(getEditionsList).toHaveBeenCalledOnce();
    expect(redirect).toHaveBeenCalledWith("/edition/2006-04-20");
  });

  it("redirects home when the server edition list is empty", async () => {
    getEditionsList.mockResolvedValue([]);
    const { default: EditionRedirect } = await import("../../src/app/edition/page");

    await expect(EditionRedirect()).rejects.toThrow("redirect:/");
    expect(redirect).toHaveBeenCalledWith("/");
  });
});
