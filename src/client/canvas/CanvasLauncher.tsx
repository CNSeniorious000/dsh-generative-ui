/**
 * The way back after closing the panel.
 *
 * Closing a canvas hides it without deleting anything, so without an entry point the work
 * is stranded: the file is still on disk and still in the transcript, but nothing on
 * screen reaches it, and the only recovery is to make the model write it again.
 */
export type CanvasLauncherProps = {
  /** How many canvases are currently hidden — shown so the button says what it will restore. */
  count: number;
  onOpen: () => void;
};

export function CanvasLauncher({ count, onOpen }: CanvasLauncherProps) {
  const label = count === 1 ? "重新打开画布" : `重新打开 ${count} 个画布`;
  return (
    <button type="button" className="dgu-launcher" onClick={onOpen} aria-label={label} title={label}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <rect x="1.75" y="2.25" width="10.5" height="9.5" rx="1.75" stroke="currentColor" strokeWidth="1.3" />
        <path d="M8.5 2.5v9" stroke="currentColor" strokeWidth="1.3" />
      </svg>
      {count > 1 && <span className="dgu-launcher-count">{count}</span>}
    </button>
  );
}
