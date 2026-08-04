import { describe, expect, it } from "vitest";

import { AnswerFieldExtractor } from "@/src/lib/answer-stream-extractor";

/** Feed chunks and collect every non-empty delta. */
function run(chunks: string[]): { deltas: string[]; extractor: AnswerFieldExtractor } {
  const extractor = new AnswerFieldExtractor();
  const deltas: string[] = [];
  for (const chunk of chunks) {
    const out = extractor.push(chunk);
    if (out) deltas.push(out);
  }
  return { deltas, extractor };
}

describe("AnswerFieldExtractor", () => {
  it("decodes a complete envelope in one chunk", () => {
    const { deltas, extractor } = run([
      '{"answer":"Hello world.","follow_ups":["Next?"]}',
    ]);
    expect(deltas).toEqual(["Hello world."]);
    expect(extractor.complete).toBe(true);
  });

  it("streams text split across chunks and ignores follow_ups", () => {
    const { deltas } = run([
      '{"answer":"The march ',
      "drew hundreds",
      ' downtown.","follow_ups":["What next?","Who led it?"]}',
    ]);
    expect(deltas.join("")).toBe("The march drew hundreds downtown.");
    expect(deltas.length).toBe(3);
  });

  it("finds the key when it is split across a chunk boundary", () => {
    const { deltas } = run(['{"ans', 'wer": "split key"}']);
    expect(deltas.join("")).toBe("split key");
  });

  it("decodes simple escapes, including one split across chunks", () => {
    const { deltas } = run(['{"answer":"line one\\', 'nline two \\"quoted\\""}']);
    expect(deltas.join("")).toBe('line one\nline two "quoted"');
  });

  it("does not close on an escaped quote", () => {
    const { deltas, extractor } = run(['{"answer":"a \\"b\\" c']);
    expect(deltas.join("")).toBe('a "b" c');
    expect(extractor.complete).toBe(false);
  });

  it("decodes a \\uXXXX escape split across chunks", () => {
    const { deltas } = run(['{"answer":"caf\\u00', 'e9 menu"}']);
    expect(deltas.join("")).toBe("café menu");
  });

  it("holds back a lone high surrogate until its pair arrives", () => {
    const { deltas } = run(['{"answer":"hi \\ud83d', '\\ude00 there"}']);
    expect(deltas.join("")).toBe("hi 😀 there");
    // No emitted delta may end in an unpaired high surrogate.
    for (const delta of deltas) {
      const last = delta.charCodeAt(delta.length - 1);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    }
  });

  it("emits nothing after the answer value closes", () => {
    const extractor = new AnswerFieldExtractor();
    extractor.push('{"answer":"done."');
    expect(extractor.push('}ignored{"answer":"again"}')).toBe("");
  });

  it("emits nothing for plain non-JSON text", () => {
    const { deltas, extractor } = run([
      "A plain legacy answer ",
      "with no envelope.",
    ]);
    expect(deltas).toEqual([]);
    expect(extractor.complete).toBe(false);
  });

  it("tolerates whitespace between key, colon, and value", () => {
    const { deltas } = run(['{\n  "answer" :  "spaced out"\n}']);
    expect(deltas.join("")).toBe("spaced out");
  });
});
