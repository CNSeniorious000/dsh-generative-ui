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
const compiler = () => {
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
const TRANSIENT = /No default export found|Unexpected (end of|eof)/i;

/**
 * A dependency that failed to arrive, not code that is wrong. esm.sh cold-starts and the
 * network drops, and the symptom is identical to a broken component — a blank surface — so
 * it is worth a few retries before anyone concludes the model wrote something wrong.
 */
const TRANSIENT_LOAD = /failed to fetch|failed to load|networkerror|load failed/i;
const MAX_RETRIES = 3;
/** 0.4s / 0.8s / 1.2s covers an esm.sh cold start; past that the package itself is the problem. */
const RETRY_BACKOFF_MS = 400;

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
  // Re-deliver the current code after a dependency failed to fetch. `clear` is what makes it a
  // real retry: the renderer skips an unchanged compile result, so without it the failed import
  // is never re-attempted and every retry is a no-op. Held through `useLatest` because the
  // attach effect runs once and cannot capture a renderer that did not exist yet.
  const retryRef = useLatest(() => {
    if (renderer === null || code === "") return;
    renderer.clear({ preserveVisualState: true });
    renderer.render(code);
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
          if (streamingRef.current && TRANSIENT.test(error.message)) return;
          // Only retry a settled surface. While streaming, the next frame re-delivers on its own,
          // and a retry there would replace the growing buffer with a stale prefix.
          if (!streamingRef.current && TRANSIENT_LOAD.test(error.message) && retriesRef.current < MAX_RETRIES) {
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
    if (!streaming) {
      // Settled: replace the buffer outright. `deliveredRef` must follow, or a later
      // streaming frame would diff against a prefix this render already superseded.
      if (code === deliveredRef.current) return;
      renderer.render(code);
      deliveredRef.current = code;
      return;
    }
    // `pushCode` APPENDS, but a session event carries the whole prefix so far. Feed it
    // only the delta, or the buffer doubles on every frame.
    const delivered = deliveredRef.current;
    if (code.startsWith(delivered)) {
      const delta = code.slice(delivered.length);
      if (delta === "") return;
      renderer.pushCode(delta);
    } else {
      // The prefix was rewritten (a re-delivered history page, or an edit): start over
      // but keep the painted frame so the surface does not blink.
      renderer.clear({ preserveVisualState: true });
      renderer.pushCode(code);
    }
    deliveredRef.current = code;
    // The refs this reads (`importedRef`, `deliveredRef`, `streamingRef`) are how the effect
    // carries state between frames; listing them would re-run it on values it just wrote.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [renderer, code, streaming]);

  return <div ref={hostRef} className={className} data-genui-root="" />;
}
