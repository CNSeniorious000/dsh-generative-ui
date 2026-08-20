/**
 * Wires the canvas column: watch the transcript for canvas writes, mount the panel when
 * there are any, unmount when there are none.
 */
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { CanvasPanel, type Canvas } from "./CanvasPanel.tsx";
import { PANEL_CSS } from "./panel-css.ts";
import { collectCanvases, type ToolCallView } from "./collect.ts";
import { readCanvasFile } from "./read.ts";
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

export function mountCanvasHost({ calls, cwd, sessionId }: CanvasHostOptions): () => void {
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
  // `null` until the first paint, so an empty first paint is still a paint. An empty string
  // would collide with the signature of "no canvases" and skip it.
  let signature: string | null = null;

  const stopWaiting = whenFrameReady((frameElement) => {
    const column = createColumn(frameElement);
    const root = createRoot(column.element);
    disposers.push(() => root.unmount(), column.remove);

    const paint = () => {
      const collected = collectCanvases(calls());
      const workspace = cwd();
      const hidden = dismissed.get(sessionId()) ?? EMPTY;
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

      // Re-render only on a real change: the observer fires on every streamed token.
      const next = canvases.map((c) => `${c.id}:${c.code.length}:${String(c.streaming)}`).join("|");
      if (next === signature) return;
      signature = next;
      if (canvases.length === 0) column.setWidth(0);
      root.render(
        canvases.length === 0
          ? null
          : createElement(CanvasPanel, {
              canvases,
              onWidth: column.setWidth,
              onClose: () => {
                const session = sessionId();
                const hiding = dismissed.get(session) ?? new Set<string>();
                for (const canvas of canvases) hiding.add(canvas.id);
                dismissed.set(session, hiding);
                signature = null;
                scheduleSweep();
              },
            }),
      );
    };

    disposers.push(observeTranscript(paint));
  });

  disposers.push(stopWaiting);
  return () => {
    for (const dispose of disposers.toReversed()) dispose();
  };
}
