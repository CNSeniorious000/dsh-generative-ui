/**
 * Mounts the canvas column into the host's AppFrame.
 *
 * There is no additive slot for a whole column: `details` is a single-occupant slot the
 * conversation already owns, and taking it would remove the tool-details seat declared
 * inside it. A portal into the frame's own flex row adds a column without contending for
 * anything — the same shape dsh-better-sidebar uses for its right sidebar.
 */
const FRAME = ".pI_x6G_frame, [class*='_frame']";
const PLUGIN_ID = "dsh-generative-ui";

/**
 * Injects the panel stylesheet.
 *
 * The `data-plugin` attribute is required, not decorative: the client module loader
 * claims every `style:not([data-plugin])` for whichever plugin is currently
 * materializing, so an unmarked sheet gets adopted by a stranger and torn out with them.
 */
export function injectStyles(css: string): () => void {
  const style = document.createElement("style");
  style.setAttribute("data-plugin", PLUGIN_ID);
  style.setAttribute("data-plugin-css", `${PLUGIN_ID}/panel`);
  style.textContent = css;
  document.head.append(style);
  return () => style.remove();
}

/**
 * Resolves the frame element, waiting for it when the shell has not painted yet.
 * @param onFound - called once with the container; not called if disposed first.
 */
export function whenFrameReady(onFound: (frame: HTMLElement) => void): () => void {
  const found = document.querySelector<HTMLElement>(FRAME);
  if (found !== null) {
    onFound(found);
    return () => {};
  }
  const observer = new MutationObserver(() => {
    const frame = document.querySelector<HTMLElement>(FRAME);
    if (frame === null) return;
    observer.disconnect();
    window.clearTimeout(timer);
    onFound(frame);
  });
  observer.observe(document.body, { subtree: true, childList: true });
  // The selector tracks a hashed class name, so a host rebuild can invalidate it. Without
  // this the failure is a canvas panel that silently never appears; one warning turns a
  // mystery into a starting point.
  const timer = window.setTimeout(() => {
    observer.disconnect();
    console.warn(`[dsh-generative-ui] no AppFrame matched ${FRAME} — canvases cannot mount. The host's layout markup likely changed.`);
  }, 15_000);
  return () => {
    observer.disconnect();
    window.clearTimeout(timer);
  };
}

/**
 * Creates the panel's host element and makes room for it.
 *
 * The frame's own columns are sized to fill the viewport exactly, so an extra flex child
 * is laid out past the right edge no matter where it is inserted — present in the DOM,
 * correctly sized, and entirely off screen (that is what the first attempt did). Instead
 * the panel is fixed to the right edge and the frame is given matching right padding, so
 * the conversation reflows into the remaining width and nothing overlaps.
 *
 * @param frame - the host's AppFrame element.
 * @param width - the panel's current width in pixels.
 */
export function createColumn(frame: HTMLElement): {
  element: HTMLElement;
  setWidth: (width: number) => void;
  remove: () => void;
} {
  const element = document.createElement("div");
  element.setAttribute("data-dgu-canvas-column", "");
  document.body.append(element);
  const previousPadding = frame.style.paddingRight;
  const setWidth = (width: number) => {
    frame.style.paddingRight = width === 0 ? previousPadding : `${width}px`;
  };
  return {
    element,
    setWidth,
    remove: () => {
      frame.style.paddingRight = previousPadding;
      element.remove();
    },
  };
}
