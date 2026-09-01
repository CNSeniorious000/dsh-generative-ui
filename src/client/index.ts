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
import { cancelPendingReport, cardRendered, reportCardError } from "./runtime/report-error.ts";
import { disposeCompiler } from "./runtime/compiler.ts";
import { dropSharedCompiler } from "./runtime/GenUISurface.tsx";
import { disposeRegistry } from "./runtime/registry.ts";
import { registerUi4aHost, releaseBindings, localImports } from "./runtime/bindings.ts";
import { claimInlineFences, isNewestCard } from "./runtime/inline-fence.ts";
import { parseUi4aSegments, type Ui4aSegment } from "./runtime/segments.ts";
import { warmCompiler } from "./runtime/compiler.ts";
import { chatNodes, perNode, type ChatNodeView } from "./session.ts";
import { mountCanvasHost } from "./canvas/index.ts";
import { toolCallsOf, type CallBlock, type ToolCallView } from "./canvas/collect.ts";
import { canvasIdOf } from "../contract.ts";
import { CARD_ERROR_PATH } from "../contract-assets.ts";

export const inject = ["sessions"];

/** Re-exported so `bun run smoke` can build the synthesized blob modules and parse them. */
export { localImports };

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

  /**
   * Identity of the open session, so a dismissed canvas stays dismissed only there.
   * Returns the branded `SessionId` rather than a plain string: `sessions.scope()` needs it.
   */
  const currentSession = () => ctx.sessions.list.getSnapshot().current;
  const sessionId = (): string => currentSession() ?? "";

  // Revoking on teardown is safe: a blob module that was already imported keeps working after
  // its URL is revoked (the module graph holds it), so this only reclaims URLs nothing can
  // reach any more. Without it every HMR round leaks one per registered specifier.
  ctx.effect(() => disposeRegistry, "dsh-generative-ui: blob module URLs");
  // An error report waits a second before it is sent (see `SETTLE_MS`), and an unload inside that
  // second leaves the timer holding a closure over a conversation that is being torn down. There
  // is nothing to flush — a report nobody will read is not worth delivering — so cancelling is
  // the whole disposer, and `cardRendered` already is one.
  ctx.effect(() => () => cancelPendingReport(), "dsh-generative-ui: pending error report");
  // The wasm half of the same problem: ~16MB per instance, one per HMR round, and upstream
  // offers no dispose — dropping the reference is all there is (see `disposeCompiler`).
  ctx.effect(
    () => () => {
      disposeCompiler();
      dropSharedCompiler();
    },
    "dsh-generative-ui: tsx wasm instance",
  );
  // What `$dsh/chat` calls into. A nested fiber, not a static inject: every name in
  // `inject` is a hard dependency, and a profile without `conversation` would otherwise
  // take the whole plugin down rather than just this one capability.
  ctx.inject(["conversation"], (scoped) => {
    scoped.effect(() => {
      // `conversation` is scope-addressed: reading it off the plugin's own context sends
      // into no session and rejects. The scope has to come from `sessions.scope(id)`, and
      // resolved per call rather than once — the reader switches sessions under us.
      //
      // `send` rejects on business failures and the caller is a generated card that cannot
      // handle it, so surface it rather than dropping it: a click that goes nowhere looks
      // exactly like a click that was never wired up.
      const release = registerUi4aHost({
        cwd,
        sessionId,
        send: (text) => {
          const id = currentSession();
          const session = id === undefined ? undefined : scoped.sessions.scope(id);
          if (session === undefined) return void console.error("[dsh-generative-ui] $dsh/chat: no session to send into");
          // The scoped context is minted by the host and carries its own inject set, so our
          // outer declaration does not reach it — reading `conversation` off it directly
          // throws `cannot get property "conversation" without inject`. One more inject on
          // that context is what makes the property readable.
          session.inject(["conversation"], (addressed) => {
            void addressed.conversation.send(text).catch((error: unknown) => console.error("[dsh-generative-ui] $dsh/chat send failed", error));
          });
        },
      });
      return () => {
        release();
        releaseBindings();
      };
    }, "dsh-generative-ui: $dsh host");
  });
  // A card that fails to compile used to be a red panel the reader saw and the model never did.
  // `onError` fires only for a failure that survived settling and retries, so this is the real
  // ones — see `report-error.ts` for why it is once per message and why it waits a beat.
  //
  // A route rather than `conversation.send`: the detail belongs in the model's CONTEXT, which is
  // assembled host-side, and a chat message could never be taken back once the card was fixed.
  // `card-failure.ts` has the rest.
  const sendToModel = (report: { message: string; phase: string } | null) => {
    const id = currentSession();
    if (id === undefined) return;
    void fetch(`${CARD_ERROR_PATH}?session=${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(report ?? {}),
    }).catch((error: unknown) => console.error("[dsh-generative-ui] card error report failed", error));
  };

  // Mounted inside the effect, not beside it: `mountCanvasHost` reaches for MutationObserver
  // straight away, and doing that during registration is exactly what smoke rejects.
  let showCanvas: ((id: string) => void) | null = null;
  ctx.effect(() => {
    const host = mountCanvasHost({ calls, cwd, sessionId, onCardError: (message, phase) => reportCardError(sendToModel, message, phase), onCardRendered: cardRendered });
    showCanvas = host.show;
    return () => {
      showCanvas = null;
      host.dispose();
    };
  }, "dsh-generative-ui: canvas column");

  // The transcript's file links and the "产物" chips call `workspaces.openPath`, which hands
  // the path to the OS — so clicking a canvas the model just wrote opened it in an editor
  // rather than in the panel three inches to the right. Wrapping the method routes canvases
  // to the panel and forwards everything else untouched.
  ctx.inject(["workspaces"], (scoped) => {
    scoped.effect(() => {
      const workspaces = scoped.workspaces as { openPath?: (path: string) => Promise<void> };
      // Wrapping someone else's method is a bet on its shape. Losing that bet here would
      // throw during registration and take the whole plugin down, so a host without it
      // simply keeps its own behaviour.
      if (typeof workspaces.openPath !== "function") return () => {};
      const original = workspaces.openPath.bind(workspaces);
      workspaces.openPath = async (path: string) => {
        const id = canvasIdOf(path);
        // No panel mounted (headless, or torn down): the OS opener is still the right answer.
        if (id === null || showCanvas === null) return original(path);
        showCanvas(id);
      };
      // Restore rather than delete: another plugin may have wrapped it after us, and
      // deleting the own-property would expose theirs — or the prototype's — instead.
      return () => {
        workspaces.openPath = original;
      };
    }, "dsh-generative-ui: canvas links open the panel");
  });
  ctx.effect(
    () =>
      claimInlineFences({
        segments,
        render: ({ code, streaming, mount }) => createElement(GenUISurface, { code, streaming, onError: (error, phase) => reportCardError(sendToModel, error.message, phase, () => isNewestCard(mount)), onRendered: cardRendered }),
      }),
    "dsh-generative-ui: inline fences",
  );
}

/** All assistant prose in one node, concatenated; empty for every other node kind. */
export function textOf(node: ChatNodeView): string {
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
export function callsKeyOf(node: ChatNodeView): string {
  const parts: string[] = [];
  const walk = (block: CallBlock | undefined): void => {
    if (block === undefined) return;
    parts.push(`${(block.call?.argsRaw ?? block.argsRaw)?.length ?? 0}${block.kind === "tool-result" ? "!" : ""}`);
    for (const child of block.subCalls ?? []) walk(child);
  };
  walk((node.data as { root?: CallBlock } | undefined)?.root);
  return parts.join(",");
}
