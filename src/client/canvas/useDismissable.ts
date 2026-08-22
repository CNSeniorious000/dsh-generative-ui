/**
 * Open/close state for a menu, closed by a click anywhere else.
 *
 * `pointerdown` on the document rather than a click handler on a backdrop: a backdrop
 * element would sit over the canvas and swallow the first click into it.
 */
import { useEffect, useRef, useState } from "react";

/**
 * Closes on a pointerdown anywhere but `anchor`, while `open`. Returns its own disposer.
 *
 * Split out of the hook so the four things that matter are testable without a renderer: that it
 * does not listen while closed, that an outside press closes, that a press inside the anchor
 * does **not**, and that it unsubscribes. A `pointerdown` listener on the document rather than a
 * backdrop element, because a backdrop would sit over the canvas and swallow the first click
 * into it.
 */
export function dismissOnOutsidePointer(open: boolean, anchor: HTMLElement | null, close: () => void): (() => void) | undefined {
  if (!open) return undefined;
  const onPointerDown = (event: Event) => {
    // The toggle button lives inside the anchor, so ignoring the anchor is what keeps a click on
    // it from closing here and reopening in the button's own handler.
    if (anchor?.contains(event.target as Node) === true) return;
    close();
  };
  document.addEventListener("pointerdown", onPointerDown);
  return () => document.removeEventListener("pointerdown", onPointerDown);
}

export function useDismissable() {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);

  useEffect(() => dismissOnOutsidePointer(open, anchor.current, () => setOpen(false)), [open]);

  return { open, setOpen, anchor };
}
