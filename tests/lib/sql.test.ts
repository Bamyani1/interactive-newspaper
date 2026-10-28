import { afterEach, describe, expect, it, vi } from "vitest";
import { neonConfig } from "@neondatabase/serverless";
import {
  createSql,
  describeDatabaseTarget,
  isLocalDatabaseUrl,
  localShimEndpoint,
  routeFetchEndpoint,
} from "@/src/lib/sql";

const PROD_URL =
  "postgresql://u:p@ep-nameless-bar-aexfijli-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require";
const LOCAL_URL = "postgresql://bamyani:local@localhost:5432/transcript";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("routeFetchEndpoint", () => {
  it("sends a Neon host to Neon's own api endpoint", () => {
    expect(routeFetchEndpoint("ep-x-pooler.c-2.us-east-2.aws.neon.tech", 5432)).toBe(
      "https://api.c-2.us-east-2.aws.neon.tech/sql"
    );
  });

  it("sends localhost to the local shim on the default port", () => {
    expect(routeFetchEndpoint("localhost", 5432)).toBe("http://127.0.0.1:7433/sql");
  });

  it("honours NEON_LOCAL_SHIM_PORT for localhost", () => {
    vi.stubEnv("NEON_LOCAL_SHIM_PORT", "7999");
    expect(localShimEndpoint()).toBe("http://127.0.0.1:7999/sql");
    expect(routeFetchEndpoint("localhost", 5432)).toBe("http://127.0.0.1:7999/sql");
  });

  it("sends the eval marker host to NEON_HTTP_SHIM_URL when set", () => {
    vi.stubEnv("NEON_HTTP_SHIM_URL", "http://127.0.0.1:7432/sql");
    expect(routeFetchEndpoint("neon-local-shim", 5432)).toBe("http://127.0.0.1:7432/sql");
  });

  it("never sends a Neon host to a shim, even with shim env set", () => {
    vi.stubEnv("NEON_HTTP_SHIM_URL", "http://127.0.0.1:7432/sql");
    vi.stubEnv("NEON_LOCAL_SHIM_PORT", "7999");
    expect(routeFetchEndpoint("ep-x.c-2.us-east-2.aws.neon.tech", 5432)).toBe(
      "https://api.c-2.us-east-2.aws.neon.tech/sql"
    );
  });
});

describe("createSql", () => {
  it("installs the router so a later query is routed per host", () => {
    createSql(LOCAL_URL);
    const endpoint = neonConfig.fetchEndpoint;
    expect(typeof endpoint).toBe("function");
    if (typeof endpoint !== "function") return;
    expect(endpoint("localhost", 5432)).toBe("http://127.0.0.1:7433/sql");
    expect(endpoint("ep-x.c-2.us-east-2.aws.neon.tech", 5432)).toBe(
      "https://api.c-2.us-east-2.aws.neon.tech/sql"
    );
  });
});

describe("isLocalDatabaseUrl / describeDatabaseTarget", () => {
  it("treats only localhost as local", () => {
    expect(isLocalDatabaseUrl(LOCAL_URL)).toBe(true);
    expect(isLocalDatabaseUrl(PROD_URL)).toBe(false);
    expect(isLocalDatabaseUrl("not a url")).toBe(false);
  });

  it("names the target", () => {
    expect(describeDatabaseTarget(LOCAL_URL)).toBe("local database transcript");
    expect(describeDatabaseTarget(PROD_URL)).toBe("PRODUCTION database ep-nameless-bar-aexfijli");
  });
});
