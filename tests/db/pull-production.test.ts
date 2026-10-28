/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { assertLocalTarget, directHostUrl, pullPlan } from "../../scripts/db/pull-production.mjs";

const PROD =
  "postgresql://u:p@ep-nameless-bar-aexfijli-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require";
const LOCAL = "postgresql://bamyani:local@localhost:5432/transcript";

describe("directHostUrl", () => {
  it("drops -pooler so pg_dump talks to the compute directly", () => {
    expect(directHostUrl(PROD)).toBe(
      "postgresql://u:p@ep-nameless-bar-aexfijli.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require"
    );
  });

  it("leaves a direct URL alone", () => {
    const direct = PROD.replace("-pooler", "");
    expect(directHostUrl(direct)).toBe(direct);
  });
});

describe("assertLocalTarget", () => {
  it("accepts localhost", () => {
    expect(() => assertLocalTarget(LOCAL)).not.toThrow();
  });

  it("refuses a production URL, so a pull can never drop production's schema", () => {
    expect(() => assertLocalTarget(PROD)).toThrow(/local/);
  });

  it("refuses a missing URL", () => {
    expect(() => assertLocalTarget(undefined)).toThrow(/local/);
  });
});

describe("pullPlan", () => {
  it("dumps public plus pgvector from the direct host and restores in one transaction", () => {
    const plan = pullPlan({ prodUrl: PROD, localUrl: LOCAL });
    expect(plan.dumpArgs).toEqual([
      "--format=plain",
      "--no-owner",
      "--no-acl",
      "--schema=public",
      "--extension=vector",
      directHostUrl(PROD),
    ]);
    expect(plan.psqlArgs).toEqual([
      LOCAL,
      "--single-transaction",
      "-v",
      "ON_ERROR_STOP=1",
      "--quiet",
      "--output=/dev/null",
    ]);
    // The dump itself recreates the schema and the vector extension.
    expect(plan.resetSql).toBe(
      "SET client_min_messages = warning;\nDROP SCHEMA IF EXISTS public CASCADE;\n"
    );
  });
});
