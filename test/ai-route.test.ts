/**
 * The `$dsh/ai` stream.
 *
 * Once the headers are out nothing can become a status code, so every failure has to arrive
 * inside the body — and a card that gets a clean empty 200 reports "the model said nothing",
 * which is indistinguishable from a real empty answer. The trailer is the only channel left.
 */
import { describe, expect, test } from "bun:test";
import { serveAi } from "../src/index.ts";

const chunks = (...items: unknown[]) => ({
  agentDefaultModel: { currentSelection: () => ({ provider: "p", model: "m" }) },
  llm: { async *stream() { for (const item of items) yield item } },
});

const call = async (opts: { query?: string; body?: string; ctx?: any; live?: Set<string>; method?: string } = {}) => {
  let status = 0, written = "";
  const res = { writeHead(code: number) { status = code; return res }, write(chunk: string) { written += chunk; return true }, end() { return res } };
  const req: any = { method: opts.method ?? "POST", url: `/x?${opts.query ?? "cwd=%2Fw"}`, on() {}, async *[Symbol.asyncIterator]() { if (opts.body !== undefined) yield opts.body } };
  await serveAi((opts.ctx ?? chunks()) as never, () => opts.live ?? new Set(["/w"]), req, res as never);
  return { status, written };
};

const ask = JSON.stringify({ prompt: "hi" });

describe("the fence", () => {
  test("a workspace this session does not own is refused", async () => {
    expect((await call({ body: ask, live: new Set() })).status).toBe(403);
  });

  test("only POST streams", async () => {
    expect((await call({ body: ask, method: "GET" })).status).toBe(405);
  });

  test("an empty or unparseable prompt is refused", async () => {
    expect((await call({ body: JSON.stringify({ prompt: "" }) })).status).toBe(400);
    expect((await call({ body: "not json" })).status).toBe(400);
    expect((await call({ body: JSON.stringify({ system: "only a system prompt" }) })).status).toBe(400);
  });
});

describe("streaming", () => {
  test("text deltas are written through", async () => {
    const { status, written } = await call({ body: ask, ctx: chunks({ type: "text-delta", text: "he" }, { type: "text-delta", text: "llo" }) });
    expect(status).toBe(200);
    expect(written).toBe("hello");
  });

  test("a clean finish adds no trailer", async () => {
    const { written } = await call({ body: ask, ctx: chunks({ type: "text-delta", text: "hi" }, { type: "finish", reason: { kind: "stop" } }) });
    expect(written).toBe("hi");
  });

  // `reason` is an object with a `kind`, not a string. Interpolating it directly writes
  // `[object Object]` — which is how this shipped the first time.
  test("a failure trailer names the reason and the message", async () => {
    const { written } = await call({ body: ask, ctx: chunks({ type: "finish", reason: { kind: "error", failure: { message: "rate limited" } } }) });
    expect(written).toContain("error");
    expect(written).toContain("rate limited");
    expect(written).not.toContain("[object Object]");
  });

  test("a failure with no message still names the kind", async () => {
    const { written } = await call({ body: ask, ctx: chunks({ type: "finish", reason: { kind: "length" } }) });
    expect(written).toContain("length");
    expect(written).not.toContain("undefined");
  });

  // A throw mid-stream cannot become a status code, so it has to arrive as text or the card
  // sees a truncated answer and no reason.
  test("a mid-stream throw is written into the body", async () => {
    const broken = { ...chunks(), llm: { async *stream() { yield { type: "text-delta", text: "par" }; throw new Error("upstream died") } } };
    const { status, written } = await call({ body: ask, ctx: broken });
    expect(status).toBe(200);
    expect(written).toContain("par");
    expect(written).toContain("upstream died");
  });
});
