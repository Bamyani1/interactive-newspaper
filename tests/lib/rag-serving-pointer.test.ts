import { afterEach, describe, expect, it } from "vitest";
import {
  getRagRetrievalConfig,
  setServingPointer,
  type ServingPointer,
} from "@/src/lib/rag-index-config";
import { createServingPointerLoader } from "@/src/lib/rag-serving-pointer";

const VERSIONED = { RAG_RETRIEVAL_MODE: "versioned" } as unknown as NodeJS.ProcessEnv;
const POINTER: ServingPointer = { indexBuildId: "build-1", corpusVersion: "corpus-a" };

function harness(env: NodeJS.ProcessEnv = VERSIONED) {
  let clock = 1_000_000;
  const reads: number[] = [];
  let next: () => Promise<ServingPointer | null> = async () => POINTER;
  const load = createServingPointerLoader({
    env,
    now: () => clock,
    read: () => {
      reads.push(clock);
      return next();
    },
  });
  return {
    load,
    reads,
    tick: (ms: number) => (clock += ms),
    setNext: (fn: () => Promise<ServingPointer | null>) => (next = fn),
  };
}

const served = () => getRagRetrievalConfig(VERSIONED).activeIndexBuildId;

afterEach(() => setServingPointer(null));

describe("loadServingPointer", () => {
  it("never reads the database when the env names a build", async () => {
    const h = harness({
      RAG_RETRIEVAL_MODE: "versioned",
      RAG_ACTIVE_INDEX_BUILD_ID: "build-env",
    } as unknown as NodeJS.ProcessEnv);
    await h.load();
    expect(h.reads).toEqual([]);
  });

  it("reads once, serves the pointer for 30 s, then reads again", async () => {
    const h = harness();
    await h.load();
    expect(served()).toBe("build-1");
    h.tick(29_000);
    await h.load();
    expect(h.reads).toHaveLength(1);
    h.setNext(async () => ({ indexBuildId: "build-2", corpusVersion: "corpus-a" }));
    h.tick(2_000);
    await h.load();
    expect(h.reads).toHaveLength(2);
    expect(served()).toBe("build-2");
  });

  it("shares one read between concurrent requests", async () => {
    const h = harness();
    await Promise.all([h.load(), h.load(), h.load()]);
    expect(h.reads).toHaveLength(1);
  });

  it("keeps the last good pointer when a read fails, and retries after 5 s", async () => {
    const h = harness();
    await h.load();
    h.tick(31_000);
    h.setNext(async () => {
      throw new Error("db timeout");
    });
    await h.load();
    expect(served()).toBe("build-1");
    h.tick(4_000);
    await h.load();
    expect(h.reads).toHaveLength(2);
    h.setNext(async () => ({ indexBuildId: "build-3", corpusVersion: "corpus-a" }));
    h.tick(1_500);
    await h.load();
    expect(h.reads).toHaveLength(3);
    expect(served()).toBe("build-3");
  });

  it("fails closed with no pointer row: versioned config then throws", async () => {
    const h = harness();
    h.setNext(async () => null);
    await h.load();
    expect(() => getRagRetrievalConfig(VERSIONED)).toThrow(/serving pointer/);
  });
});
