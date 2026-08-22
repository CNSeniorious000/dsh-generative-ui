/**
 * Wires the canvas column: watch the transcript for canvas writes, mount the panel when
 * there are any, unmount when there are none.
 */
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { CanvasPanel, type Canvas } from "./CanvasPanel.tsx";
import { CanvasLauncher } from "./CanvasLauncher.tsx";
import { PANEL_CSS } from "./panel-css.ts";
import { collectCanvases, type ToolCallView } from "./collect.ts";
import { listCanvasIds, readCanvasFile } from "./read.ts";
import { createColumn, injectStyles, whenFrameReady } from "./mount.ts";
import { observeTranscript, scheduleSweep } from "../runtime/observe.ts";

export type CanvasHostOptions = {
  /** Every tool call in the current session, oldest first. */
  calls: () => readonly ToolCallView[];
  /** The current session's workspace directory, when it has one. */
  cwd: () => string | undefined;
  /** Identity of the current session; dismissals are remembered against it. */
  sessionId: () => string;
};

const EMPTY: ReadonlySet<string> = new Set();

/**
 * A call whose arguments carry executable code rather than a file operation.
 *
 * Matched on the argument text, not the tool name, for the same reason `collect.ts` classifies
 * by shape: the day the host renames `run_code`, a name list stops matching and canvases
 * silently stop appearing.
 *
 * It must also mention the canvases directory. All 29 opaque canvas writes in the corpus do,
 * even the 27 whose path is built from a variable — and without that clause a session doing
 * ordinary shell work re-lists once per command (measured: median 0, but one session hit 94).
 */
/**
 * What a sweep would paint, as a string. Equal signatures mean nothing to do.
 *
 * The observer fires on every streamed token, so this is what stands between the panel and a
 * React render per token. `code.length` rather than the code: a growing card changes length on
 * every frame, which is exactly when it should repaint, and comparing megabytes of source per
 * token would cost more than the render. The offerable list belongs in it too — closing the
 * last canvas changes nothing about the visible list, and without it the launcher never paints.
 */
export const paintSignature = (canvases: readonly Canvas[], offerable: readonly string[]): string =>
  `${canvases.map((c) => `${c.id}:${c.code.length}:${String(c.streaming)}`).join("|")}#${offerable.join(",")}`;

export const OPAQUE_WRITE = /"(?:code|command)"\s*:[\s\S]*canvases/;

export function mountCanvasHost({ calls, cwd, sessionId }: CanvasHostOptions): { dispose: () => void; show: (id: string) => void } {
  /**
   * Canvas bodies re-read from disk, for the ones a patch left stale.
   *
   * Keyed by canvas id and versioned by how many mutating calls it has seen, so a further
   * edit invalidates the entry while repeated sweeps over the same state reuse it. Without
   * the version the choice is between never refetching and refetching every frame.
   */
  const fromFile = new Map<string, { version: number; code?: string }>();
  const disposers: (() => void)[] = [injectStyles(PANEL_CSS)];
  /**
   * Canvases the reader dismissed, per session.
   *
   * Closing hides what is on screen without opting out of the feature — a canvas written
   * afterwards still opens. Keyed by session because ids are only unique within one: a
   * dismissal must not follow the reader into another conversation, and returning to a
   * session should find it as they left it.
   */
  const dismissed = new Map<string, Set<string>>();
  /**
   * Canvases the reader opened from the launcher that this session never wrote.
   *
   * A canvas outlives its session, so the launcher offers everything in the workspace —
   * but those have no tool call to reconstruct them from, and their bodies come off disk.
   * Keyed by session for the same reason `dismissed` is.
   */
  const opened = new Map<string, Set<string>>();
  /** Bodies of the launcher-opened canvases. Read once: nothing in this session changes them. */
  const openedCode = new Map<string, string>();
  /** Every canvas on disk, for the launcher. Refreshed per workspace, not per sweep. */
  let workspaceIds: readonly string[] = [];
  let listedFor: string | undefined;
  /** Settled opaque calls at the time of the last listing — see the sweep for why. */
  let listedAfter = -1;
  // `null` until the first paint, so an empty first paint is still a paint. An empty string
  // would collide with the signature of "no canvases" and skip it.
  let signature: string | null = null;

  /**
   * Show a canvas the reader picked, whether or not this session wrote it.
   *
   * Defined out here rather than inside the sweep because callers outside the panel reach
   * it too — the transcript's file links, which would otherwise hand a `.ui4a.tsx` to the
   * OS file opener.
   */
  const show = (id: string): void => {
    const session = sessionId();
    dismissed.get(session)?.delete(id);
    const showing = opened.get(session) ?? new Set<string>();
    showing.add(id);
    opened.set(session, showing);
    signature = null;
    scheduleSweep();
  };

  const stopWaiting = whenFrameReady((frameElement) => {
    const column = createColumn(frameElement);
    const root = createRoot(column.element);
    disposers.push(() => root.unmount(), column.remove);

    const paint = () => {
      const allCalls = calls();
      const collected = collectCanvases(allCalls);
      const workspace = cwd();
      const session = sessionId();
      const hidden = dismissed.get(session) ?? EMPTY;
      // The workspace listing backs the launcher. Fetched once per workspace rather than per
      // sweep — the sweep runs per streamed token, and a directory listing is not free.
      // A call that ran arbitrary code may have written a canvas without any argument saying
      // so: 29 canvas writes in the corpus go through `run_code`, and in 27 of them the path is
      // built from a variable, so nothing in the arguments names the id. `collect.ts` cannot
      // classify what the arguments do not contain — but the workspace listing already knows,
      // it just never refreshed. Counting settled opaque calls re-lists once each time one
      // finishes, which is a directory read per code execution and nothing per streamed token.
      let opaque = 0;
      for (const call of allCalls) if (call.settled && OPAQUE_WRITE.test(call.argsRaw)) opaque += 1;
      if (workspace !== undefined && (workspace !== listedFor || opaque !== listedAfter)) {
        listedFor = workspace;
        listedAfter = opaque;
        void listCanvasIds(workspace).then((ids) => {
          workspaceIds = ids;
          signature = null;
          scheduleSweep();
        });
      }
      const canvases: Canvas[] = collected.canvases
        .filter((canvas) => !hidden.has(canvas.id))
        .map((canvas) => {
          const version = collected.stale.get(canvas.id);
          // Not patched: the write's own arguments are the canvas, streaming included.
          if (version === undefined) return canvas;
          // One entry per canvas covers both states: `code` absent means a read is in
          // flight, present means it settled. Two collections would only be two things to
          // keep in sync.
          const cached = fromFile.get(canvas.id);
          if (cached?.version === version) return cached.code === undefined ? canvas : { ...canvas, code: cached.code };
          if (workspace !== undefined) {
            fromFile.set(canvas.id, { version });
            void readCanvasFile(workspace, canvas.id).then((code) => {
              // A miss keeps the entry (with no body) rather than dropping it: deleting it
              // makes the very next sweep — one per streamed token — fire the same failing
              // read again, forever. The version already invalidates it when a real change
              // lands, which is the only thing that could make the answer differ.
              if (code === null) return;
              fromFile.set(canvas.id, { version, code });
              // The body changed underneath the signature, so force the next sweep to paint.
              signature = null;
              scheduleSweep();
            });
          }
          // Until it arrives, the previous body still beats an empty panel.
          return cached?.code === undefined ? canvas : { ...canvas, code: cached.code };
        });

      // Canvases the reader picked out of the launcher. Their code is not in any tool call,
      // so it comes off disk once and then stays — nothing this session does can change it.
      for (const id of opened.get(session) ?? EMPTY) {
        if (hidden.has(id) || canvases.some((canvas) => canvas.id === id)) continue;
        const code = openedCode.get(id);
        if (code !== undefined) canvases.push({ id, code, streaming: false });
        else if (workspace !== undefined) {
          openedCode.set(id, "");
          void readCanvasFile(workspace, id).then((body) => {
            if (body === null) return;
            openedCode.set(id, body);
            signature = null;
            scheduleSweep();
          });
        }
      }

      // What the launcher can offer: everything on disk, plus anything written this session
      // whose file has not landed yet. Sorted so the button does not reshuffle between sweeps.
      const offerable = [...new Set([...workspaceIds, ...collected.canvases.map((canvas) => canvas.id)])].toSorted();

      const next = paintSignature(canvases, offerable);
      if (next === signature) return;
      signature = next;
      if (canvases.length === 0) column.setWidth(0);

      const repaint = () => {
        signature = null;
        scheduleSweep();
      };

      root.render(
        canvases.length > 0
          ? createElement(CanvasPanel, {
              canvases,
              offerable,
              cwd: cwd(),
              onOpen: show,
              onWidth: column.setWidth,
              onClose: () => {
                const hiding = dismissed.get(session) ?? new Set<string>();
                for (const canvas of canvases) hiding.add(canvas.id);
                dismissed.set(session, hiding);
                // Anything opened from the launcher is closed for good rather than left to
                // reappear on the next sweep: `dismissed` covers the ones with a tool call
                // behind them, and this covers the ones without.
                opened.delete(session);
                repaint();
              },
            })
          : offerable.length > 0
            ? createElement(CanvasLauncher, {
                ids: offerable,
                onOpen: show,
              })
            : null,
      );
    };

    disposers.push(observeTranscript(paint));
  });

  disposers.push(stopWaiting);
  return {
    dispose: () => {
      for (const dispose of disposers.toReversed()) dispose();
    },
    show,
  };
}
