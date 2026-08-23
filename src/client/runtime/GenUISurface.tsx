/**
 * One mounted GenUIRenderer. Owns the imperative renderer's lifecycle and nothing
 * else — what to render and where it comes from is the caller's business, which is
 * what lets the same surface back both the inline chat card and the canvas view.
 */
import { useEffect, useRef, useState } from "react";
import { GenUIRenderer } from "partial-react";
import { createBrowserTsxCompiler } from "./compiler.ts";
import { mergeFallbackImports } from "partial-react/import-map";
import { localImports } from "./bindings.ts";

export type GenUISurfaceProps = {
  /** Full source when settled; the growing prefix while streaming. */
  code: string;
  /** True while `code` is still a prefix, so partial frames get normalized before compiling. */
  streaming?: boolean;
  /**
   * Keep React state across recompiles. Right for a growing stream, where each frame is
   * the previous one plus more text. Wrong for a whole-file replacement: the renderer
   * decides reuse from the hook signature, so a rewrite that keeps the same hooks — an
   * edited canvas usually does — is silently dropped rather than rendered.
   */
  preserveState?: boolean;
  /** Real compile diagnostics. Transient streaming frames are filtered out — see TRANSIENT below. */
  onError?: (error: Error, phase: "transform" | "compile" | "render") => void;
  /** Fires whenever a frame actually painted. Use it to clear a previously shown error. */
  onRendered?: () => void;
  className?: string;
};

/**
 * A ref that always holds the latest value, updated after commit rather than during render.
 *
 * Assigning `ref.current` in the render body is a side effect React may discard or replay.
 * Every reader here is a renderer callback that fires well after commit, so a plain effect
 * is early enough.
 */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

/** The compiler owns a single wasm instance; one per document is both enough and what we can afford. */
let sharedCompiler: ReturnType<typeof createBrowserTsxCompiler> | null = null;
/** Paired with `disposeCompiler`: the shared instance must go with the wasm behind it. */
export const dropSharedCompiler = () => {
  sharedCompiler = null;
};

export const compiler = () => {
  if (sharedCompiler === null) {
    sharedCompiler = createBrowserTsxCompiler();
  }
  return sharedCompiler;
};

/**
 * Mid-stream frames legitimately fail: a prefix that has not reached `export default`
 * yet, or a half-written expression. partial-react treats these as transient and keeps
 * the last good frame, so surfacing them would just make the UI flash errors while the
 * model types. Only a failure that survives settling is the caller's business.
 */
/** Exported for `test/transient.test.ts`: this decides whether the reader sees an error. */
export const TRANSIENT = /No default export found|Unexpected (end of|eof)/i;

/**
 * A dependency that failed to arrive, not code that is wrong. esm.sh cold-starts and the
 * network drops, and the symptom is identical to a broken component — a blank surface — so
 * it is worth a few retries before anyone concludes the model wrote something wrong.
 */
/** Exported for `test/transient.test.ts`. */
export const TRANSIENT_LOAD = /failed to fetch|failed to load|networkerror|load failed/i;
const MAX_RETRIES = 3;

/**
 * Whether a reported error is worth another attempt.
 *
 * Extracted because it is the whole of the decision and none of the React: three conditions,
 * each of which sends the reader somewhere different when it is wrong. Exported for
 * `test/retry.test.ts`.
 */
/**
 * Whether a mid-stream error is the stream not being finished yet.
 *
 * Both patterns come from the parse stages — `No default export found` is thrown inside
 * `importCompiledComponent` (compile), and an unexpected EOF is the transform rejecting a
 * prefix. A card whose own render throws a message that happens to match is a real error, so
 * the phase is part of the question rather than the message alone.
 */
export const isUnfinishedFrame = (message: string, phase: string, streaming: boolean) =>
  streaming && phase !== "render" && TRANSIENT.test(message);

export const shouldRetry = (message: string, phase: string, streaming: boolean, attempts: number) =>
  phase === "compile" && !streaming && TRANSIENT_LOAD.test(message) && attempts < MAX_RETRIES;
/**
 * What to do with a frame, given what the surface already holds.
 *
 * `pushCode` APPENDS but a session event carries the whole prefix so far, so the difference
 * between these four answers is the difference between a correct surface and one whose buffer
 * doubles on every frame. Pure, because the decision is, and because a state machine that only
 * runs inside an effect with three refs is one nothing ever checks.
 *
 * - `nothing`   the frame adds no text, or a settled frame re-delivers what is already painted
 * - `replace`   settled: render the whole thing outright
 * - `append`    streaming and the buffer is a prefix of this frame: push only the delta
 * - `restart`   the prefix was rewritten (a re-delivered history page, or an edit)
 */
export type Delivery = { do: "nothing" } | { do: "replace"; code: string } | { do: "append"; delta: string } | { do: "restart"; code: string };

export const deliveryFor = (code: string, delivered: string, streaming: boolean): Delivery => {
  if (!streaming) return code === delivered ? { do: "nothing" } : { do: "replace", code };
  if (!code.startsWith(delivered)) return { do: "restart", code };
  const delta = code.slice(delivered.length);
  return delta === "" ? { do: "nothing" } : { do: "append", delta };
};

/**
 * Route a `Delivery` to the renderer. Returns whether anything was delivered, which is what tells
 * the caller to advance its `delivered` marker.
 *
 * Split from the effect so the three calls can be constrained: `render` replaces the buffer,
 * `pushCode` appends to it, and `clear({ preserveVisualState: true })` starts over WITHOUT
 * blanking what is on screen. Getting `render` and `pushCode` the wrong way round doubles the
 * buffer on every streamed frame, and the difference is one word inside an effect.
 */
export const deliver = (renderer: RendererCalls, delivery: Delivery): boolean => {
  if (delivery.do === "nothing") return false;
  if (delivery.do === "replace") renderer.render(delivery.code);
  else if (delivery.do === "append") renderer.pushCode(delivery.delta);
  else {
    // Keep the painted frame so the surface does not blink while it starts over.
    renderer.clear({ preserveVisualState: true });
    renderer.pushCode(delivery.code);
  }
  return true;
};

/** Only what `deliver` touches — the real renderer has far more. */
export type RendererCalls = {
  render: (code: string) => void;
  pushCode: (delta: string) => void;
  clear: (options: { preserveVisualState: boolean }) => void;
};

/** 0.4s / 0.8s / 1.2s covers an esm.sh cold start; past that the package itself is the problem. */
const RETRY_BACKOFF_MS = 400;

/**
 * The same import map with a fresh query on every fetched entry.
 *
 * Only `https://esm.sh/` URLs are touched. Local blob URLs are minted per render and already
 * fresh, and appending a query to a `blob:` URL makes it unresolvable — which would break every
 * card rather than fixing one.
 */
export const bustFetchedImports = (imports: Record<string, string>, attempt: number): Record<string, string> =>
  Object.fromEntries(Object.entries(imports).map(([key, url]) => [key, url.startsWith("https://esm.sh/") ? `${url}${url.includes("?") ? "&" : "?"}ui4a-retry=${attempt}` : url]));

export function GenUISurface({ code, streaming = false, preserveState = true, onError, onRendered, className }: GenUISurfaceProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  // State, not a ref: `create` is async, so readiness must be able to trigger the
  // render effect. With a ref, the first pass sees null and nothing ever re-runs it.
  const [renderer, setRenderer] = useState<GenUIRenderer | null>(null);
  // The renderer outlives any one render and calls back into props, so those are read
  // through refs rather than captured — a new handler identity must not re-attach it.
  const onErrorRef = useLatest(onError);
  const onRenderedRef = useLatest(onRendered);
  const streamingRef = useLatest(streaming);
  // Read once at attach: the renderer takes it as a construction option.
  const preserveStateRef = useRef(preserveState);
  /** Retries spent on the current code. Reset by a successful paint and by every new frame. */
  const retriesRef = useRef(0);
  /**
   * Re-deliver the current code after a dependency failed to fetch.
   *
   * `clear` is not enough on its own, though it is necessary — the renderer skips an unchanged
   * compile result. The part that makes this a real retry is **changing the dependency URL**.
   * Measured 2026-08-23: a second `import()` of a URL that already rejected makes **zero**
   * network requests, because the module registry caches the rejection for the page's lifetime.
   * `mergeFallbackImports` maps each bare specifier to a deterministic `https://esm.sh/<pkg>?…`,
   * so re-rendering imports the exact URL that failed and nothing is re-fetched. Every retry
   * before this was a no-op that burned 0.4/0.8/1.2s and reported the same failure.
   */
  const retryRef = useLatest(() => {
    if (renderer === null || code === "") return;
    const attempt = retriesRef.current;
    void mergeFallbackImports(localImports(), code).then((imports) => {
      // Only the fetched esm.sh entries need busting; the local blob URLs are already fresh.
      renderer.setImportMap({ imports: bustFetchedImports(imports, attempt) });
      renderer.clear({ preserveVisualState: true });
      renderer.render(code);
    });
  });

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    let disposed = false;
    let attached: GenUIRenderer | null = null;
    void GenUIRenderer.create(host, {
      compiler: compiler(),
      importmap: { imports: localImports() },
      preserveStateOnUpdate: preserveStateRef.current,
      callbacks: {
        onError: (error, phase) => {
          if (isUnfinishedFrame(error.message, phase, streamingRef.current)) return;
          // Only retry a settled surface. While streaming, the next frame re-delivers on its own,
          // and a retry there would replace the growing buffer with a stale prefix.
          // Compile phase only. A failed dependency import is reported there — `importCompiledComponent`
          // runs inside the compile `catch` (partial-react/src/runtime.ts:338) — and busting the
          // import URLs is the fix for exactly that. The same message reaching us from the RENDER
          // phase is the card's own `fetch` throwing inside its body, where re-importing changes
          // nothing: it costs three retries and 2.4s of blank surface before the reader is told.
          if (shouldRetry(error.message, phase, streamingRef.current, retriesRef.current)) {
            retriesRef.current += 1;
            setTimeout(() => retryRef.current(), RETRY_BACKOFF_MS * retriesRef.current);
            return;
          }
          onErrorRef.current?.(error, phase);
        },
        onRendered: () => {
          retriesRef.current = 0;
          onRenderedRef.current?.();
        },
      },
    }).then((created) => {
      // A fast unmount can land before `create` settles; detaching there would leak the root.
      if (disposed) return void created.detach();
      attached = created;
      setRenderer(created);
    });
    return () => {
      disposed = true;
      // Detach from the local handle, not from a state updater: React skips the updater
      // for an unmounted fiber whenever the queue is not empty, and a renderer that is
      // never detached keeps its React root and its module URL alive for the tab's life.
      attached?.detach();
      attached = null;
      setRenderer(null);
    };
    // Attach exactly once. The refs above are how later prop values reach the renderer
    // without tearing it down, so they deliberately do not belong in these deps.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- see above
  }, []);

  // The set of bare specifiers the current code imports. Recomputing the fallback map costs a
  // network probe per package, so it is keyed on this rather than run per streamed frame.
  const importedRef = useRef("");

  // Last code handed to the renderer. A ref, not state: it only ever feeds the next
  // diff, and re-rendering on it would be a render per streamed frame for nothing.
  const deliveredRef = useRef("");

  useEffect(() => {
    if (renderer === null) return;
    // Anything the model imports beyond the registered react family (recharts, motion, …) has no
    // entry in the import map, and an unresolvable bare specifier fails the whole module import —
    // the surface just stays blank. `mergeFallbackImports` probes esm.sh and fills those in.
    const signature = [...code.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]).join(" ");
    if (signature !== importedRef.current) {
      importedRef.current = signature;
      // A later frame's probe can settle first; without this the map reverts to an older import set.
      void mergeFallbackImports(localImports(), code).then((imports) => {
        if (signature !== importedRef.current) return;
        renderer.setImportMap({ imports });
        // `setImportMap` only stores — it schedules nothing, so whoever delivers next is what
        // makes the new map take effect. While streaming that is the very next frame, and
        // re-delivering here instead would replace the buffer with whatever prefix was current
        // when the probe was fired — truncating the stream mid-flight. Only a settled surface
        // has no next frame, and that is the one that would otherwise stay blank for good.
        if (!streamingRef.current && deliveredRef.current !== "") renderer.render(deliveredRef.current);
      });
    }
    retriesRef.current = 0;
    if (!deliver(renderer, deliveryFor(code, deliveredRef.current, streaming))) return;
    // `deliveredRef` must follow every delivery, or a later streaming frame diffs against a
    // prefix this render already superseded.
    deliveredRef.current = code;
    // The refs this reads (`importedRef`, `deliveredRef`, `streamingRef`) are how the effect
    // carries state between frames; listing them would re-run it on values it just wrote.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [renderer, code, streaming]);

  // A query container, so generated code can size itself against the space it was given.
  // The same card lands in a chat column and in a panel the reader drags between 320 and
  // 720px, and the viewport tells it nothing about either — `100vw` is the whole window in
  // both. Without `container-type` here a `@container` rule is inert rather than wrong
  // (measured: the guarded declaration simply never applies), which is the kind of failure
  // that reads as the model writing something bad.
  return <div ref={hostRef} className={className} data-genui-root="" style={{ containerType: "inline-size" }} />;
}
