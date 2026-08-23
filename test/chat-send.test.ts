import { expect, test } from "bun:test";
import { apply } from "../src/client/index.ts";
import { bind, releaseBindings } from "../src/client/runtime/bindings.ts";
import { restoreGlobals } from "./globals.ts";

/**
 * `$dsh/chat.sendMessage` drives the next turn, so a card calling it is asking for the
 * conversation to continue. When there is no session to send into, the failure has to be
 * audible: a click that goes nowhere looks exactly like a click that was never wired up.
 *
 * The guard was unconstrained — it lives in a closure inside a `registerUi4aHost` call inside an
 * inject callback.
 */
const applyWithSessions = (current: string | undefined, scope: (id: string) => unknown) => {
  const errors: string[] = [];
  const sent: string[] = [];
  const stub = (): unknown => new Proxy(() => stub(), { get: () => stub(), apply: () => stub() });
  const base: Record<string, unknown> = {
    sessions: { list: { getSnapshot: () => ({ current }) }, scope },
    effect: (run: () => unknown, label?: string) => {
      if (label?.includes("canvas column")) return; // needs a DOM; not the subject
      try { run() } catch { /* only the $dsh host is the subject */ }
    },
    inject: (_want: readonly string[], callback: (scoped: unknown) => void) => callback(scoped),
  };
  const scoped: unknown = new Proxy(base, { get: (t, k) => (k in t ? t[k as string] : stub()) });
  const realError = console.error;
  console.error = (...args: unknown[]) => void errors.push(args.join(" "));
  try { apply(scoped as never) } finally { console.error = realError }
  return { errors, sent };
};

test("with no session open, sending says so rather than failing silently", () => {
  releaseBindings();
  const { errors } = applyWithSessions(undefined, () => undefined);
  const realError = console.error;
  const seen: string[] = [];
  console.error = (...args: unknown[]) => void seen.push(args.join(" "));
  try { bind().chat.sendMessage("hi") } finally { console.error = realError }
  expect(seen.join(" ")).toContain("no session to send into");
  expect(errors).toEqual([]);
  restoreGlobals();
});

test("a session id whose scope has gone is the same case", () => {
  releaseBindings();
  applyWithSessions("s1", () => undefined);
  const realError = console.error;
  const seen: string[] = [];
  console.error = (...args: unknown[]) => void seen.push(args.join(" "));
  try { bind().chat.sendMessage("hi") } finally { console.error = realError }
  expect(seen.join(" ")).toContain("no session to send into");
  restoreGlobals();
});

test("with a session, the text reaches conversation.send", () => {
  releaseBindings();
  const sent: string[] = [];
  applyWithSessions("s1", () => ({
    inject: (_want: readonly string[], callback: (addressed: unknown) => void) =>
      callback({ conversation: { send: (text: string) => { sent.push(text); return Promise.resolve() } } }),
  }));
  bind().chat.sendMessage("你好");
  expect(sent).toEqual(["你好"]);
  restoreGlobals();
});
