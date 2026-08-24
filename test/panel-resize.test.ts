import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { useResize } from "../src/client/canvas/CanvasPanel.tsx";
import { restoreGlobals } from "./globals.ts";

/**
 * Drag-to-resize coalesces to one width update per frame, because `pointermove` fires far faster
 * than the panel can lay out, and cancels a pending frame on release so a width computed from a
 * stale pointer never lands after the drag ended.
 *
 * Both guards were unconstrained — they live inside an event handler inside a hook. Reached here
 * by rendering the hook and then driving the listeners it registered, which is what a drag is.
 */
const drive = () => {
  const listeners = new Map<string, (event: unknown) => void>();
  const frames: (() => void)[] = [];
  let cancelled = 0;
  Object.assign(globalThis, {
    window: {
      innerWidth: 1200,
      addEventListener: (type: string, fn: (event: unknown) => void) => void listeners.set(type, fn),
      removeEventListener: (type: string) => void listeners.delete(type),
    },
    document: { querySelector: () => null },
    requestAnimationFrame: (fn: () => void) => {
      frames.push(fn);
      return frames.length;
    },
    cancelAnimationFrame: () => {
      cancelled += 1;
    },
  });

  // The hook's API leaves the render through a child that stores it, rather than through an
  // assignment in the component body — which is a side effect during render, and lint says so.
  // A child receiving it as a prop is doing the storing on ITS render, which is the same shape a
  // ref callback has and the rule allows.
  const captured: { current?: { width: number; start: (e: unknown) => void } } = {};
  const Sink = ({ api }: { api: { width: number; start: (e: unknown) => void } }) => {
    captured.current = api;
    return null;
  };
  const Probe = () => createElement(Sink, { api: useResize(420) });
  renderToString(createElement(Probe));
  const target = { setPointerCapture: () => {}, setAttribute: () => {}, removeAttribute: () => {} };
  captured.current!.start({ currentTarget: target, pointerId: 1 });
  return { listeners, frames, cancelled: () => cancelled };
};

test("many pointermoves schedule one frame, not one each", () => {
  const { listeners, frames } = drive();
  for (let i = 0; i < 20; i += 1) listeners.get("pointermove")!({ clientX: 800 - i });
  expect(frames.length).toBe(1);
  restoreGlobals();
});

test("after the frame runs, the next move schedules another", () => {
  const { listeners, frames } = drive();
  listeners.get("pointermove")!({ clientX: 800 });
  frames[0]!(); // the browser paints
  listeners.get("pointermove")!({ clientX: 700 });
  expect(frames.length).toBe(2);
  restoreGlobals();
});

test("releasing cancels a frame that has not run", () => {
  const { listeners, cancelled } = drive();
  listeners.get("pointermove")!({ clientX: 800 });
  listeners.get("pointerup")!({});
  expect(cancelled()).toBe(1);
  restoreGlobals();
});

test("releasing with nothing pending cancels nothing", () => {
  const { listeners, cancelled } = drive();
  listeners.get("pointerup")!({});
  expect(cancelled()).toBe(0);
  restoreGlobals();
});

test("the drag unregisters both listeners on release", () => {
  const { listeners } = drive();
  listeners.get("pointerup")!({});
  expect([...listeners.keys()]).toEqual([]);
  restoreGlobals();
});
