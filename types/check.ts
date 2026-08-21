/**
 * Asserts the hand-written `$dsh/*` declarations still describe what `bind()` returns.
 *
 * They are hand-written on purpose — a card should see the capability surface, not how it
 * reaches the host — but a surface nobody checks drifts, and the model would find out by
 * getting a false error from `genui check`. This file is type-only: `bun run typecheck`
 * fails if a signature moves without its declaration moving too.
 */
import type { bind } from "../src/client/runtime/bindings.ts";

type Bound = ReturnType<typeof bind>;

/** What the three `.d.ts` files declare, transcribed. Keep in step with them, not with `bind`. */
type Declared = {
  chat: { sendMessage: (text: string) => void };
  ai: { streamText: (options: { prompt: string; system?: string } | string) => AsyncIterable<string> };
  fs: {
    readFile: (path: string) => Promise<string>;
    readdir: (path: string) => Promise<{ name: string; type?: "file" | "directory"; size?: number }[]>;
    readBytes: (path: string) => Promise<Uint8Array<ArrayBuffer>>;
    writeFile: (path: string, content: string) => Promise<void>;
  };
  exec: { bash: (command: string) => Promise<{ stdout: string; stderr: string; exitCode: number | null; truncated: boolean; timedOut: boolean }> };
};

// Both directions: a declaration narrower than the implementation hides capability, and one
// wider promises what the runtime will not do. Either way the model is told something untrue.
const _implementationSatisfiesDeclaration: Declared = null as unknown as Bound;
const _declarationCoversImplementation: Bound = null as unknown as Declared;
void _implementationSatisfiesDeclaration;
void _declarationCoversImplementation;
