/**
 * The way back after closing the panel.
 *
 * Closing a canvas hides it without deleting anything, and a canvas outlives the session
 * that wrote it, so without an entry point the work is stranded: the file is still on
 * disk, but nothing on screen reaches it and the only recovery is making the model write
 * it again.
 */
import { useState } from "react";

export type CanvasLauncherProps = {
  /** Every canvas in the workspace, including ones this session never wrote. */
  ids: readonly string[];
  onOpen: (id: string) => void;
};

export function CanvasLauncher({ ids, onOpen }: CanvasLauncherProps) {
  const [open, setOpen] = useState(false);
  // One canvas needs no menu — the button is the canvas.
  const single = ids.length === 1 ? ids[0] : undefined;
  const label = single === undefined ? `打开画布（${ids.length}）` : `打开画布 ${single}`;

  return (
    <div className="dgu-launcher-dock">
      {open && single === undefined && (
        <ul className="dgu-launcher-menu">
          {ids.map((id) => (
            <li key={id}>
              <button
                type="button"
                className="dgu-launcher-item"
                onClick={() => {
                  setOpen(false);
                  onOpen(id);
                }}
              >
                {id}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="dgu-launcher" aria-label={label} title={label} aria-expanded={single === undefined ? open : undefined} onClick={() => (single === undefined ? setOpen(!open) : onOpen(single))}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <rect x="1.75" y="2.25" width="10.5" height="9.5" rx="1.75" stroke="currentColor" strokeWidth="1.3" />
          <path d="M8.5 2.5v9" stroke="currentColor" strokeWidth="1.3" />
        </svg>
        {ids.length > 1 && <span className="dgu-launcher-count">{ids.length}</span>}
      </button>
    </div>
  );
}
