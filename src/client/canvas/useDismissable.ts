/**
 * Open/close state for a menu, closed by a click anywhere else.
 *
 * `pointerdown` on the document rather than a click handler on a backdrop: a backdrop
 * element would sit over the canvas and swallow the first click into it.
 */
import { useEffect, useRef, useState } from "react";

export function useDismissable() {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      // The toggle button lives inside the anchor, so ignoring the anchor is what keeps a
      // click on it from closing here and reopening in the button's own handler.
      if (anchor.current?.contains(event.target as Node) === true) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return { open, setOpen, anchor };
}
