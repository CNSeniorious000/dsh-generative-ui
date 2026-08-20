/**
 * Browser half: renders ui4a TSX the model writes, inline in the transcript and in a
 * canvas panel beside it.
 * @module dsh-generative-ui/client
 */
import { createElement } from "react";
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type {} from "@deepseek-ai/dsh-client-ui-layout/client";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import { GenUISurface } from "./runtime/GenUISurface.tsx";
import { claimInlineFences } from "./runtime/inline-fence.ts";
import { parseUi4aSegments, type Ui4aSegment } from "./runtime/segments.ts";
import { warmCompiler } from "./runtime/compiler.ts";
import { chatNodes, perNode, type ChatNodeView } from "./session.ts";
import { mountCanvasHost } from "./canvas/index.ts";
import { toolCallsOf, type CallBlock, type ToolCallView } from "./canvas/collect.ts";

export const inject = ["slots", "sessions"];

/** Assistant text blocks, whose fences are the inline sources. */
type AssistantNodeData = { blocks?: readonly { kind: string; text?: string }[] };

export function apply(ctx: ClientContext): void {
  // Compiling anything pays a ~400 ms wasm init. Doing it now means the first fence the
  // user actually sees does not, and an idle tab is the cheapest possible moment for it.
  void warmCompiler();

  /**
   * Every ui4a fence in the current session's assistant prose, straight from the log.
   *
   * The host's markdown renderer withholds a fence's info string until the closing fence
   * arrives, so the DOM cannot identify a half-written ui4a block. The raw text has the
   * opening fence from its first token, which is what makes inline rendering streamable.
   */
  const segmentsOf = perNode(
    (node) => `${node.anchorSeq}:${textOf(node).length}`,
    (node) => parseUi4aSegments(textOf(node)),
  );
  const segments = (): readonly Ui4aSegment[] => segmentsOf(chatNodes(ctx)).flat();

  /**
   * Every tool call in the current session, in log order — the canvas source.
   *
   * `tool-call` nodes carry a lifecycle `root` (not the assistant's block list), and the
   * root's `call.argsRaw` grows while the call streams, which is what makes a canvas
   * render as it is written.
   */
  const callsOf = perNode(
    (node) => `${node.anchorSeq}:${callsKeyOf(node)}`,
    (node) => (node.kind === "tool-call" ? toolCallsOf(node.data) : []),
  );
  const calls = (): readonly ToolCallView[] => {
    const nodes = chatNodes(ctx);
    // Node iteration order is unspecified; log order decides which write wins.
    return callsOf(nodes)
      .map((calls, index) => ({ calls, seq: nodes[index]?.anchorSeq ?? 0 }))
      .toSorted((a, b) => a.seq - b.seq)
      .flatMap((entry) => entry.calls);
  };

  /** The current session's workspace, which canvas file reads resolve against. */
  const cwd = (): string | undefined => {
    const list = ctx.sessions.list.getSnapshot();
    return list.current === undefined ? undefined : list.byId[list.current]?.cwd;
  };

  /** Identity of the open session, so a dismissed canvas stays dismissed only there. */
  const sessionId = (): string => ctx.sessions.list.getSnapshot().current ?? "";

  ctx.effect(() => mountCanvasHost({ calls, cwd, sessionId }), "dsh-generative-ui: canvas column");
  ctx.effect(() => claimInlineFences({ segments, render: ({ code, streaming }) => createElement(GenUISurface, { code, streaming }) }), "dsh-generative-ui: inline fences");
}

/** All assistant prose in one node, concatenated; empty for every other node kind. */
function textOf(node: ChatNodeView): string {
  const blocks = (node.data as AssistantNodeData | undefined)?.blocks;
  if (blocks === undefined) return "";
  let text = "";
  for (const block of blocks) if (block.kind === "text" && block.text !== undefined) text += block.text;
  return text;
}

/**
 * Cache key for a `tool-call` node: how far its arguments have streamed, plus which calls
 * have settled. Read straight off the node rather than through `toolCallsOf`, so computing
 * the key does not repeat the work the cache exists to avoid.
 *
 * The settled flags are part of the key, not a detail: a call's `argsRaw` is already
 * complete when `tool-result` arrives, so a length-only key would never invalidate and the
 * cached view would claim `streaming` forever — a canvas that never stops pulsing and an
 * `edit` that never marks it stale.
 */
function callsKeyOf(node: ChatNodeView): string {
  const parts: string[] = [];
  const walk = (block: CallBlock | undefined): void => {
    if (block === undefined) return;
    parts.push(`${(block.call?.argsRaw ?? block.argsRaw)?.length ?? 0}${block.kind === "tool-result" ? "!" : ""}`);
    for (const child of block.subCalls ?? []) walk(child);
  };
  walk((node.data as { root?: CallBlock } | undefined)?.root);
  return parts.join(",");
}
