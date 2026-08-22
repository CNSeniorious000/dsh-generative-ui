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
import { inlineSubPages } from "./subpages.ts";
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
};

/**
 * Rewrites a canvas's relative sub-page imports into blob URLs before it is compiled.
 *
 * Only for a settled canvas: mid-stream the sibling files are usually not written yet, and a
 * canvas does not stream under the default PTC mode anyway (see CLAUDE.md §3.6). Until the
 * rewrite lands the original source is rendered, which fails exactly as it does today rather
 * than blanking a canvas that was working.
 */
function useSubPages(cwd: string | undefined, canvas: Canvas | undefined) {
  const [resolved, setResolved] = useState<{ key: string; code: string } | null>(null);
  // Destructured so the effect depends on scalars: the store rebuilds `canvas` on every sweep,
  // and depending on the object would re-run the whole resolve for an unchanged canvas.
  const id = canvas?.id;
  const code = canvas?.code;
  const streaming = canvas?.streaming;

  useEffect(() => {
    if (cwd === undefined || id === undefined || code === undefined || streaming) return;
    if (!RELATIVE_IMPORT.test(code)) return;
    const key = `${id}:${code.length}`;
    let live = true;
    const urls: string[] = [];
    const compile = async (filename: string, source: string) => (await compiler().compile(source, { filename })).code;
    void inlineSubPages(code, canvasPath(id), (specifier, from) => readCanvasChild(cwd, id, specifier, from), compile, urls).then((next) => {
      if (!live) return void urls.forEach((url) => URL.revokeObjectURL(url));
      setResolved({ key, code: next });
    });
    return () => {
      live = false;
      // The surface holds the previous code, so its blobs stay reachable until it re-renders;
      // revoking on the next resolve rather than here would leak one set per edit.
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [cwd, id, code, streaming]);

  if (id === undefined || code === undefined) return "";
  return resolved !== null && resolved.key === `${id}:${code.length}` ? resolved.code : code;
}

/** Cheap gate: only a canvas that actually writes a relative import pays for the pass. */
const RELATIVE_IMPORT = /(\bfrom\s*|\bimport\s*\(\s*)["']\.[^"']*["']/;

const MIN_WIDTH = 320;
const MAX_WIDTH = 720;

/** Drag-to-resize on the panel's left edge, mirroring the host's own invisible hit strip. */
function useResize(initial: number) {
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
        setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - moveEvent.clientX)));
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

export function CanvasPanel({ canvases, offerable, cwd, onOpen, onClose, onWidth }: CanvasPanelProps) {
  const { width, start } = useResize(420);
  useEffect(() => onWidth(width), [width, onWidth]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const { open: picking, setOpen: setPicking, anchor: picker } = useDismissable();
  // Only what is not already a tab: the tabs cover this session, this covers the rest.
  const elsewhere = offerable.filter((id) => !canvases.some((canvas) => canvas.id === id));

  // Follow the newest canvas unless the reader has picked one that still exists. A
  // selection that disappears needs no cleanup: the fallback already covers it, and
  // clearing the state as well would only be a second render saying the same thing.
  const active = canvases.find((canvas) => canvas.id === activeId) ?? canvases[canvases.length - 1];
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
          <GenUISurface key={active.id} code={resolved} streaming={active.streaming} preserveState={false} />
        )}
      </div>
    </div>
  );
}
