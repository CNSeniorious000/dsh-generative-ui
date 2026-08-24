/**
 * The canvas column: one mini app per `ui4a/canvases/<id>.ui4a.tsx`, rendered beside the
 * conversation rather than inside it.
 *
 * Composed rather than configured — the panel owns chrome and selection, `GenUISurface`
 * owns rendering, and the caller owns where canvases come from. That is what lets the
 * same surface back both this and the inline cards.
 */
import { useEffect, useRef, useState } from "react";
import { compiler, GenUISurface } from "../runtime/GenUISurface.tsx";
import { canvasPath } from "../../contract.ts";
import { readCanvasChild } from "./read.ts";
import { importsSibling, inlineSubPages } from "./subpages.ts";
import { useDismissable } from "./useDismissable.ts";

export type Canvas = { id: string; code: string; streaming: boolean };

export type CanvasPanelProps = {
  canvases: readonly Canvas[];
  /** Every canvas in the workspace, so the header can reach ones this session never wrote. */
  offerable: readonly string[];
  /** The session's workspace, needed to fetch a canvas's sub-page files. */
  cwd: string | undefined;
  onOpen: (id: string) => void;
  onClose: () => void;
  /** Reports the panel's width so the host frame can reserve matching space. */
  onWidth: (width: number) => void;
  /** A canvas that failed to compile; see `runtime/report-error.ts`. */
  onCardError?: (message: string, phase: string) => void;
  /** A canvas that painted; see `runtime/report-error.ts`. */
  onCardRendered?: () => void;
};

/**
 * Rewrites a canvas's relative sub-page imports into blob URLs before it is compiled.
 *
 * Only for a settled canvas: mid-stream the sibling files are usually not written yet, and a
 * canvas does not stream under the default PTC mode anyway (see CLAUDE.md §3.6). Until the
 * rewrite lands the original source is rendered, which fails exactly as it does today rather
 * than blanking a canvas that was working.
 */
export function useSubPages(cwd: string | undefined, canvas: Canvas | undefined) {
  const [resolved, setResolved] = useState<{ key: string; code: string } | null>(null);
  // Destructured so the effect depends on scalars: the store rebuilds `canvas` on every sweep,
  // and depending on the object would re-run the whole resolve for an unchanged canvas.
  const id = canvas?.id;
  const code = canvas?.code;
  const streaming = canvas?.streaming;

  useEffect(() => {
    if (cwd === undefined || id === undefined || code === undefined) return;
    if (!needsResolve(code, streaming)) return;
    const key = `${id}:${code.length}`;
    let live = true;
    const urls: string[] = [];
    const compile = async (filename: string, source: string) => (await compiler().compile(source, { filename })).code;
    void inlineSubPages(code, canvasPath(id), (specifier, from) => readCanvasChild(cwd, id, specifier, from), compile, urls).then((next) => {
      // Resolved after teardown: nobody will ever render these, so revoke them here — the
      // disposer already ran and cannot see urls the pass appended after it.
      if (!live) return void revokeAll(urls);
      setResolved({ key, code: next });
    });
    return () => {
      live = false;
      // The surface holds the previous code, so its blobs stay reachable until it re-renders;
      // revoking on the next resolve rather than here would leak one set per edit.
      revokeAll(urls);
    };
  }, [cwd, id, code, streaming]);

  if (id === undefined || code === undefined) return "";
  return resolved !== null && resolved.key === `${id}:${code.length}` ? resolved.code : code;
}

/**
 * Revoke every blob URL in a list, exactly once each.
 *
 * Both callers hand it the SAME array — the disposer, and the resolve that lands after it. The
 * array is filled by `inlineSubPages` as it goes, so the two can see different lengths, and a
 * URL revoked twice is harmless while one revoked never is a leak per edit. Emptying the list
 * as it goes makes the pair idempotent regardless of which runs first or what arrived between.
 */
/**
 * Whether this canvas needs the sub-page pass at all. Extracted from the effect because the
 * mutation audit could not constrain it there — flipping `streaming` or dropping the
 * `importsSibling` check survived every test, and both are load-bearing: resolving mid-stream
 * inlines a prefix that the next frame supersedes, and a canvas with no sibling imports would
 * pay a compile per frame to produce the code it already had.
 *
 * The `undefined` checks stay in the effect: a type predicate narrows only one parameter, and
 * moving them here would cost the compiler its knowledge that `cwd` and `id` are strings after.
 */
export const needsResolve = (code: string, streaming: boolean | undefined): boolean => !streaming && importsSibling(code);

export const revokeAll = (urls: string[]): void => {
  while (urls.length > 0) URL.revokeObjectURL(urls.pop()!);
};

/** Cheap gate: only a canvas that actually writes a relative import pays for the pass. */
const MIN_WIDTH = 320;
const MAX_WIDTH = 720;
/** Exported for `test/panel-css.test.ts`: the default must be draggable-to. */
export { MIN_WIDTH as MIN_WIDTH_FOR_TEST, MAX_WIDTH as MAX_WIDTH_FOR_TEST };
/**
 * Must equal the `--dgu-panel-width` fallback in `panel.css`.
 *
 * The CSS default is what the panel is painted at before React's inline style lands; this is
 * what the resize state starts from. Different values mean the panel visibly jumps on its first
 * frame — a `panel-css.test.ts` assertion holds them together, since a stylesheet cannot import
 * a constant.
 */
export const DEFAULT_WIDTH = 420;

/**
 * The panel's width for a pointer at `clientX`, clamped to what is usable.
 *
 * Extracted from the drag handler because it is the whole of the arithmetic and none of the
 * DOM: a swapped bound or a flipped subtraction gives a panel that snaps shut or eats the
 * conversation, and the drag itself cannot be exercised without a browser.
 */
/**
 * Which canvas the panel shows, and which ids the "other canvases" menu offers.
 *
 * Both are pure functions of the props and both decide what the reader is looking at, so they
 * are here rather than inline: the fallback is what covers a selected canvas disappearing
 * mid-stream (no cleanup needed — clearing the state as well would be a second render saying
 * the same thing), and `offerable` minus the tabs is what keeps the menu from listing what is
 * already on screen.
 */
export const activeCanvas = (canvases: readonly Canvas[], activeId: string | null) => canvases.find((canvas) => canvas.id === activeId) ?? canvases[canvases.length - 1];

export const otherCanvases = (canvases: readonly Canvas[], offerable: readonly string[]) => offerable.filter((id) => !canvases.some((canvas) => canvas.id === id));

export const widthForPointer = (clientX: number, viewportWidth: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, viewportWidth - clientX));

/** Drag-to-resize on the panel's left edge, mirroring the host's own invisible hit strip. */
export function useResize(initial: number) {
  const [width, setWidth] = useState(initial);
  const frame = useRef(0);
  const start = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.setAttribute("data-dragging", "");
    const move = (moveEvent: PointerEvent) => {
      // One update per frame: pointermove fires far faster than the panel can lay out.
      if (frame.current !== 0) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        setWidth(widthForPointer(moveEvent.clientX, window.innerWidth));
      });
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      document.querySelector("[data-dragging]")?.removeAttribute("data-dragging");
      if (frame.current !== 0) cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };
  return { width, start };
}

export function CanvasPanel({ canvases, offerable, cwd, onOpen, onClose, onWidth, onCardError, onCardRendered }: CanvasPanelProps) {
  const { width, start } = useResize(DEFAULT_WIDTH);
  useEffect(() => onWidth(width), [width, onWidth]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const { open: picking, setOpen: setPicking, anchor: picker } = useDismissable();
  // Only what is not already a tab: the tabs cover this session, this covers the rest.
  const elsewhere = otherCanvases(canvases, offerable);

  // Follow the newest canvas unless the reader has picked one that still exists. A
  // selection that disappears needs no cleanup: the fallback already covers it, and
  // clearing the state as well would only be a second render saying the same thing.
  const active = activeCanvas(canvases, activeId);
  const resolved = useSubPages(cwd, active);

  return (
    <div className="dgu-panel" style={{ "--dgu-panel-width": `${width}px` } as React.CSSProperties}>
      <div className="dgu-resize" onPointerDown={start} style={{ left: 0 }} />
      <div className="dgu-header">
        <span className="dgu-title">{active?.id ?? "Canvas"}</span>
        <span className="dgu-spacer" />
        {elsewhere.length > 0 && (
          <div className="dgu-picker" ref={picker}>
            <button type="button" className="dgu-icon-button" onClick={() => setPicking(!picking)} aria-expanded={picking} aria-label={`其他画布（${elsewhere.length}）`} title={`其他画布（${elsewhere.length}）`}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M3 5.5l4 3.5 4-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {picking && (
              <ul className="dgu-launcher-menu dgu-picker-menu">
                {elsewhere.map((id) => (
                  <li key={id}>
                    <button
                      type="button"
                      className="dgu-launcher-item"
                      onClick={() => {
                        setPicking(false);
                        setActiveId(id);
                        onOpen(id);
                      }}
                    >
                      {id}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <button type="button" className="dgu-icon-button" onClick={onClose} aria-label="关闭画布" title="关闭画布">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {canvases.length > 1 && (
        <div className="dgu-tabs" role="tablist">
          {canvases.map((canvas) => (
            <button key={canvas.id} type="button" role="tab" className="dgu-tab" aria-selected={canvas.id === active?.id} onClick={() => setActiveId(canvas.id)}>
              {canvas.id}
            </button>
          ))}
        </div>
      )}
      <div className="dgu-body">
        {active === undefined ? (
          <div className="dgu-empty">写入 ui4a/canvases/&lt;id&gt;.ui4a.tsx 后，画布会出现在这里</div>
        ) : (
          // A canvas arrives as whole files, so recompiles replace rather than extend —
          // preserving state would make an edited canvas silently keep the old render.
          <GenUISurface key={active.id} code={resolved} streaming={active.streaming} preserveState={false} onError={(error, phase) => onCardError?.(error.message, phase)} onRendered={onCardRendered} />
        )}
      </div>
    </div>
  );
}
