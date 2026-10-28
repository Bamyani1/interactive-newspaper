/** @vitest-environment node */
// The local neon-http-shim, started in-process: a localhost DATABASE_URL must
// answer through the same Neon driver production uses. Needs a local Postgres
// on localhost:5432; the live cases skip when there isn't one (CI).
import { connect } from "node:net";
import { userInfo } from "node:os";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createSql } from "@/src/lib/sql";

const PORT = "7499";
const LOCAL_URL = `postgresql://${userInfo().username}:local@localhost:5432/postgres`;
const NEON_URL = "postgresql://u:p@ep-x-pooler.c-2.us-east-2.aws.neon.tech/neondb";

function localPostgresUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "localhost", port: 5432, timeout: 1000 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

const pgUp = await localPostgresUp();

let ensureLocalShim: (url?: string) => Promise<void>;

beforeAll(async () => {
  vi.stubEnv("NEON_LOCAL_SHIM_PORT", PORT);
  ({ ensureLocalShim } = await import("../../scripts/db/lib/local-shim.mjs"));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("ensureLocalShim", () => {
  it("does nothing for a Neon URL", async () => {
    await ensureLocalShim(NEON_URL);
    await expect(fetch(`http://127.0.0.1:${PORT}/sql`)).rejects.toThrow();
  });

  it.skipIf(!pgUp)("serves a localhost URL through the Neon driver", async () => {
    await ensureLocalShim(LOCAL_URL);
    const sql = createSql(LOCAL_URL);
    const rows = await sql.query("SELECT 1::int AS one, now() IS NOT NULL AS ok", []);
    expect(rows).toEqual([{ one: 1, ok: true }]);
  });

  it.skipIf(!pgUp)("reuses a running shim instead of failing on the port", async () => {
    await ensureLocalShim(LOCAL_URL);
    await ensureLocalShim(LOCAL_URL);
    const rows = await createSql(LOCAL_URL).query("SELECT 2::int AS two", []);
    expect(rows).toEqual([{ two: 2 }]);
  });

  it.skipIf(!pgUp)("refuses a connection string for any host but localhost", async () => {
    await ensureLocalShim(LOCAL_URL);
    const res = await fetch(`http://127.0.0.1:${PORT}/sql`, {
      method: "POST",
      headers: { "Neon-Connection-String": NEON_URL, "content-type": "application/json" },
      body: JSON.stringify({ query: "SELECT 1", params: [] }),
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/refuses host/);
  });
});
