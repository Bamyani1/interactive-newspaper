/** @vitest-environment node */
/**
 * One contract for session ids, shared by /api/ask and /api/ask/session.
 * They disagreed before: /api/ask enforced the character set while the
 * session endpoint accepted any string up to 128 chars, so ids /api/ask
 * would reject could still be used to probe the store.
 */

import { describe, expect, it } from "vitest";
import { isValidSessionId } from "@/src/lib/session-id";
import { newSessionId } from "@/src/lib/conversation-store";

describe("isValidSessionId", () => {
  it("accepts a freshly minted session id", () => {
    expect(isValidSessionId(newSessionId())).toBe(true);
  });

  it("accepts the base64url character set", () => {
    expect(isValidSessionId("AZaz09-_")).toBe(true);
  });

  it("accepts a single character and exactly 128", () => {
    expect(isValidSessionId("a")).toBe(true);
    expect(isValidSessionId("x".repeat(128))).toBe(true);
  });

  it("rejects an empty id", () => {
    expect(isValidSessionId("")).toBe(false);
  });

  it("rejects anything past 128 characters", () => {
    expect(isValidSessionId("x".repeat(129))).toBe(false);
  });

  it("rejects characters outside base64url", () => {
    for (const id of ["has space", "a/b", "a+b", "a.b", "a=b", "a\nb", "sess:1", "🙂"]) {
      expect(isValidSessionId(id), `expected ${JSON.stringify(id)} to be rejected`).toBe(false);
    }
  });

  it("rejects a non-string", () => {
    expect(isValidSessionId(undefined)).toBe(false);
    expect(isValidSessionId(null)).toBe(false);
    expect(isValidSessionId(42)).toBe(false);
    expect(isValidSessionId(["a"])).toBe(false);
  });
});
