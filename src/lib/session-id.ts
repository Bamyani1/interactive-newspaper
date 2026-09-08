/**
 * The session-id contract, in one place.
 *
 * `newSessionId()` mints 32 CSPRNG bytes as base64url, so the accepted shape
 * is the base64url alphabet up to 128 characters. /api/ask and
 * /api/ask/session used to disagree — the former enforced this, the latter
 * accepted any string up to 128 chars — which let ids /api/ask would refuse
 * still reach the conversation store.
 */

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function isValidSessionId(value: unknown): boolean {
  return typeof value === "string" && SESSION_ID_PATTERN.test(value);
}
