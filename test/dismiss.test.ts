/**
 * Closing a menu by pressing somewhere else.
 *
 * `pointerdown` on the document rather than a click handler on a backdrop: a backdrop element
 * would sit over the canvas and swallow the first click into it. That choice makes the anchor
 * exception load-bearing — the toggle button is *inside* the anchor, so without it a press on
 * the button closes here and immediately reopens in the button's own handler, and the menu
 * never opens.
 */
import { restoreGlobals } from "./globals.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { dismissOnOutsidePointer } from "../src/client/canvas/useDismissable.ts";

let listeners: ((event: any) => void)[] = [];

// Restore after EACH test: the stub below is narrower than other files' (a `document` with
// no `querySelectorAll`), and bun shares one global per RUN. Leaving it installed breaks the
// next file, which looks like a bug there. `./globals.ts` holds the pre-stub originals.
afterEach(restoreGlobals);

beforeEach(() => {
  listeners = [];
  (globalThis as any).document = {
    addEventListener: (type: string, fn: (event: any) => void) => {
      if (type === "pointerdown") listeners.push(fn);
    },
    removeEventListener: (type: string, fn: (event: any) => void) => {
      listeners = listeners.filter((l) => l !== fn);
    },
  };
});

const press = (target: unknown) => {
  for (const listener of listeners.slice()) listener({ target });
};
/** An anchor that contains exactly the nodes given to it. */
const anchorOf = (...children: unknown[]) => ({ contains: (node: unknown) => children.includes(node) }) as unknown as HTMLElement;

describe("dismissOnOutsidePointer", () => {
  test("a closed menu listens for nothing", () => {
    expect(dismissOnOutsidePointer(false, anchorOf(), () => {})).toBeUndefined();
    expect(listeners).toHaveLength(0);
  });

  test("a press outside closes it", () => {
    let closed = 0;
    dismissOnOutsidePointer(true, anchorOf(), () => {
      closed += 1;
    });
    press({ id: "somewhere else" });
    expect(closed).toBe(1);
  });

  // The whole reason the anchor is passed in: the toggle lives inside it.
  test("a press on the toggle inside the anchor does not", () => {
    const toggle = { id: "toggle" };
    let closed = 0;
    dismissOnOutsidePointer(true, anchorOf(toggle), () => {
      closed += 1;
    });
    press(toggle);
    expect(closed).toBe(0);
  });

  test("a menu with no anchor yet still closes on any press", () => {
    let closed = 0;
    dismissOnOutsidePointer(true, null, () => {
      closed += 1;
    });
    press({ id: "anything" });
    expect(closed).toBe(1);
  });

  test("the disposer unsubscribes", () => {
    let closed = 0;
    const dispose = dismissOnOutsidePointer(true, anchorOf(), () => {
      closed += 1;
    });
    dispose?.();
    expect(listeners).toHaveLength(0);
    press({ id: "after dispose" });
    expect(closed).toBe(0);
  });
});
