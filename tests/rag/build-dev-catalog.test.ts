/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { verifiedFactGroups } from "../../scripts/rag/build-dev-catalog.mjs";

describe("verifiedFactGroups", () => {
  const source = "A smokebomb exploded in Thompson  Hall Friday evening.\nShawkey said";

  it("keeps phrases found in the source, ignoring case and spacing", () => {
    expect(verifiedFactGroups([["thompson hall", "Stuyvesant"], ["Shawkey"]], source)).toEqual([
      ["thompson hall"],
      ["Shawkey"],
    ]);
  });

  it("drops a group none of whose phrases appear", () => {
    expect(verifiedFactGroups([["Gray Chapel"], ["Friday"]], source)).toEqual([["Friday"]]);
  });
});
