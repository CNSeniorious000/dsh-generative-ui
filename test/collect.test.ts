import { expect, test } from "bun:test";
import { collectCanvases, type ToolCallView } from "../src/client/canvas/collect";

const write = (argsRaw: string, settled = false): ToolCallView => ({ name: "write_file", argsRaw, settled });
const codeOf = (raw: string, settled = false) => collectCanvases([write(raw, settled)]).canvases[0]?.code;

const full = JSON.stringify({ path: ".dsh/ui4a/canvases/a.ui4a.tsx", content: "a\tb\nc→d" });

test("a settled write yields the whole file", () => {
  const { canvases } = collectCanvases([write(full, true)]);
  expect(canvases).toHaveLength(1);
  expect(canvases[0]).toMatchObject({ id: "a", code: "a\tb\nc→d", streaming: false });
});

// The property the hand-written walk exists for: arguments arrive a few bytes at a time, so
// every prefix has to be a legal input — including ones that stop inside an escape. A throw
// here is a canvas that vanishes mid-generation; a shrink is one that flickers.
test("every prefix parses, and the code only grows", () => {
  let previous = "";
  for (let n = 1; n <= full.length; n += 1) {
    const code = codeOf(full.slice(0, n)) ?? "";
    expect(code.startsWith(previous)).toBe(true);
    previous = code;
  }
  expect(previous).toBe("a\tb\nc→d");
});

// JSON.stringify emits `→` literally, so the \u path needs an argument written by hand — which
// is what a model's tool call actually looks like when it escapes non-ASCII.
test("a \\u escape cut in half emits nothing rather than a wrong character", () => {
  const head = '{"path":".dsh/ui4a/canvases/a.ui4a.tsx","content":"x\\u2192';
  expect(codeOf(`${head.slice(0, head.length - 2)}`)).toBe("x");
  expect(codeOf(head)).toBe("x→");
});

test("an unsettled write reads as streaming", () => {
  expect(collectCanvases([write(full.slice(0, 55))]).canvases[0]!.streaming).toBe(true);
});
