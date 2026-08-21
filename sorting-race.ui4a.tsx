import { useEffect, useRef, useState } from "react";
import { Play, Pause, Shuffle } from "lucide-react";

type Op = { c: [number, number] } | { w: number };

function* bubble(a: number[]): Generator<Op> {
  const n = a.length;
  for (let i = 0; i < n - 1; i++) {
    let swapped = false;
    for (let j = 0; j < n - 1 - i; j++) {
      yield { c: [j, j + 1] };
      if (a[j] > a[j + 1]) {
        const t = a[j]; a[j] = a[j + 1]; a[j + 1] = t;
        yield { w: j }; yield { w: j + 1};
        swapped = true;
      }
    }
    if (!swapped) break;
  }
}

function* insertion(a: number[]): Generator<Op> {
  const n = a.length;
  for (let i = 1; i < n; i++) {
    const v = a[i];
    let j = i - 1;
    while (j >= 0) {
      yield { c: [j, i] };
      if (a[j] > v) { a[j + 1] = a[j]; yield { w: j + 1 }; j--; } else break;
    }
    a[j + 1] = v;
    yield { w: j + 1 };
  }
}

function* selection(a: number[]): Generator<Op> {
  const n = a.length;
  for (let i = 0; i < n - 1; i++) {
    let m = i;
    for (let j = i + 1; j < n; j++) {
      yield { c: [m, j] };
      if (a[j] < a[m]) m = j;
    }
    if (m !== i) {
      const t = a[i]; a[i] = a[m]; a[m] = t;
      yield { w: i }; yield { w: m };
    }
  }
}

function* merge(a: number[]): Generator<Op> {
  const n = a.length;
  const tmp = new Array<number>(n);
  for (let width = 1; width < n; width *= 2) {
    for (let lo = 0; lo < n; lo += 2 * width) {
      const mid = Math.min(lo + width, n), hi = Math.min(lo + 2 * width, n);
      if (mid >= hi) continue;
      for (let k = lo; k < hi; k++) tmp[k] = a[k];
      let i = lo, j = mid;
      for (let k = lo; k < hi; k++) {
        if (i < mid && j < hi) {
          yield { c: [i, j] };
          a[k] = tmp[i] <= tmp[j] ? tmp[i++] : tmp[j++];
        } else if (i < mid) a[k] = tmp[i++];
        else a[k] = tmp[j++];
        yield { w: k };
      }
    }
  }
}

function* quick(a: number[], lo = 0, hi = a.length - 1): Generator<Op> {
  if (lo >= hi) return;
  const pivot = a[hi];
  let i = lo;
  for (let j = lo; j < hi; j++) {
    yield { c: [j, hi] };
    if (a[j] < pivot) {
      if (i !== j) {
        const t = a[i]; a[i] = a[j]; a[j] = t;
        yield { w: i }; yield { w: j };
      }
      i++;
    }
  }
  if (i !== hi) {
    const t = a[i]; a[i] = a[hi]; a[hi] = t;
    yield { w: i }; yield { w: hi };
  }
  yield* quick(a, lo, i - 1);
  yield* quick(a, i + 1, hi);
}

function* siftDown(a: number[], start: number, end: number): Generator<Op> {
  let root = start;
  while (2 * root + 1 <= end) {
    const child = 2 * root + 1;
    let swap = root;
    yield { c: [swap, child] };
    if (a[swap] < a[child]) swap = child;
    if (child + 1 <= end) {
      yield { c: [swap, child + 1] };
      if (a[swap] < a[child + 1]) swap = child + 1;
    }
    if (swap === root) return;
    const t = a[root]; a[root] = a[swap]; a[swap] = t;
    yield { w: root }; yield { w: swap };
    root = swap;
  }
}

function* heap(a: number[]): Generator<Op> {
  const n = a.length;
  for (let start = Math.floor(n / 2) - 1; start >= 0; start--) yield* siftDown(a, start, n - 1);
  for (let end = n - 1; end > 0; end--) {
    const t = a[0]; a[0] = a[end]; a[end] = t;
    yield { w: 0 }; yield { w: end };
    yield* siftDown(a, 0, end - 1);
  }
}

const ALGOS: { name: string; fn: (a: number[]) => Generator<Op> }[] = [
  { name: "Bubble", fn: bubble },
  { name: "Insertion", fn: insertion },
  { name: "Selection", fn: selection },
  { name: "Merge", fn: merge },
  { name: "Quick", fn: (a) => quick(a) },
  { name: "Heap", fn: heap },
];

type Order = "random" | "nearly" | "reversed" | "few";

function makeArray(n: number, order: Order): number[] {
  const a = Array.from({ length: n }, (_, i) => i + 1);
  if (order === "reversed") return a.reverse();
  if (order === "nearly") {
    const swaps = Math.max(1, Math.round(n / 12));
    for (let k = 0; k < swaps; k++) {
      const i = Math.floor(Math.random() * n), j = Math.min(n - 1, i + 1 + Math.floor(Math.random() * 3));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  if (order === "few") {
    const buckets = 5;
    const b = a.map(() => Math.ceil(((Math.floor(Math.random() * buckets) + 1) / buckets) * n));
    return b;
  }
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

type Lane = { name: string; a: number[]; gen: Generator<Op>; comps: number; writes: number; done: boolean; c: [number, number]; w: number };

function buildLanes(base: number[]): Lane[] {
  return ALGOS.map((al) => {
    const a = base.slice();
    return { name: al.name, a, gen: al.fn(a), comps: 0, writes: 0, done: false, c: [-1, -1] as [number, number], w: -1 };
  });
}

const CSS = `
.sr-root { container-type: inline-size; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); padding: 12px; border-radius: 12px; font: 13px/1.4 ui-sans-serif, system-ui, sans-serif; }
.sr-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }
.sr-ctl { display: flex; align-items: center; gap: 6px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 4px 8px; }
.sr-ctl label { color: var(--dsw-alias-label-secondary); font-size: 11px; letter-spacing: .02em; }
.sr-ctl select, .sr-ctl input[type=range] { background: transparent; color: var(--dsw-alias-label-primary); border: none; outline: none; font: inherit; }
.sr-ctl select { cursor: pointer; }
.sr-ctl input[type=range] { width: 84px; accent-color: var(--dsw-alias-state-business-primary); cursor: pointer; }
.sr-btn { display: inline-flex; align-items: center; gap: 6px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-primary); border-radius: 8px; padding: 5px 10px; cursor: pointer; font: inherit; }
.sr-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
.sr-grid { display: grid; grid-template-columns: 1fr; gap: 8px; }
.sr-lane { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 8px 10px 6px; }
.sr-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.sr-name { font-weight: 600; }
.sr-stats { color: var(--dsw-alias-label-secondary); font-size: 11px; font-variant-numeric: tabular-nums; }
.sr-done { color: var(--dsw-alias-state-success-primary); font-size: 11px; font-weight: 600; }
.sr-canvas { display: block; width: 100%; height: 72px; }
.sr-legend { margin-top: 10px; display: flex; gap: 14px; flex-wrap: wrap; color: var(--dsw-alias-label-secondary); font-size: 11px; }
.sr-dot { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 5px; vertical-align: middle; }
@container (min-width: 560px) { .sr-grid { grid-template-columns: 1fr 1fr; } .sr-canvas { height: 88px; } }
@container (min-width: 900px) { .sr-grid { grid-template-columns: 1fr 1fr 1fr; } }
`;

export default function SortingRace() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const lanesRef = useRef<Lane[]>(buildLanes(makeArray(48, "random")));
  const doneAtRef = useRef<number>(0);

  const [size, setSize] = useState(48);
  const [speed, setSpeed] = useState(6);
  const [order, setOrder] = useState<Order>("random");
  const [running, setRunning] = useState(true);
  const [, force] = useState(0);

  const cfg = useRef({ speed, running });
  cfg.current = { speed, running };

  // rebuild whenever the shape of the race changes
  useEffect(() => {
    lanesRef.current = buildLanes(makeArray(size, order));
    doneAtRef.current = 0;
    force((v) => v + 1);
  }, [size, order]);

  useEffect(() => {
    const id = window.setInterval(() => force((v) => v + 1), 120);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let raf = 0;
    const root = rootRef.current;
    if (!root) return;

    const cs = getComputedStyle(root);
    const tok = (n: string, fallback: string) => cs.getPropertyValue(n).trim() || fallback;
    const colors = {
      bar: tok("--dsw-alias-label-secondary", cs.color),
      track: tok("--dsw-alias-bg-layer-2", tok("--dsw-alias-bg-layer-1", "transparent")),
      cmp: tok("--dsw-alias-state-business-primary", cs.color),
      wr: tok("--dsw-alias-state-error-primary", cs.color),
      ok: tok("--dsw-alias-state-success-primary", cs.color),
    };

    const draw = () => {
      const lanes = lanesRef.current;
      for (let li = 0; li < lanes.length; li++) {
        const cv = canvasRefs.current[li];
        if (!cv) continue;
        const dpr = window.devicePixelRatio || 1;
        const w = cv.clientWidth, h = cv.clientHeight;
        if (!w || !h) continue;
        if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
          cv.width = Math.round(w * dpr);
          cv.height = Math.round(h * dpr);
        }
        const ctx = cv.getContext("2d");
        if (!ctx) continue;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const L = lanes[li];
        const n = L.a.length;
        const max = n;
        const bw = w / n;
        for (let i = 0; i < n; i++) {
          const bh = Math.max(2, (L.a[i] / max) * (h - 2));
          ctx.fillStyle = L.done ? colors.ok : i === L.w ? colors.wr : i === L.c[0] || i === L.c[1] ? colors.cmp : colors.bar;
          ctx.globalAlpha = L.done ? 0.85 : i === L.w || i === L.c[0] || i === L.c[1] ? 1 : 0.55;
          ctx.fillRect(i * bw, h - bh, Math.max(1, bw - (bw > 3 ? 1 : 0)), bh);
        }
        ctx.globalAlpha = 1;
      }
    };

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const lanes = lanesRef.current;
      if (cfg.current.running) {
        const budget = Math.max(1, Math.round(Math.pow(cfg.current.speed, 1.9)));
        let allDone = true;
        for (const L of lanes) {
          if (L.done) continue;
          allDone = false;
          for (let s = 0; s < budget; s++) {
            const r = L.gen.next();
            if (r.done) { L.done = true; L.c = [-1, -1]; L.w = -1; break; }
            const v = r.value;
            if ("c" in v) { L.comps++; L.c = v.c; L.w = -1; }
            else { L.writes++; L.w = v.w; L.c = [-1, -1]; }
          }
        }
        if (allDone) {
          const now = performance.now();
          if (!doneAtRef.current) doneAtRef.current = now;
          else if (now - doneAtRef.current > 1100) {
            lanesRef.current = buildLanes(makeArray(size, order));
            doneAtRef.current = 0;
          }
        }
      }
      draw();
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size, order]);

  const lanes = lanesRef.current;

  const reshuffle = () => {
    lanesRef.current = buildLanes(makeArray(size, order));
    doneAtRef.current = 0;
    force((v) => v + 1);
  };

  return (
    <div className="sr-root" ref={rootRef}>
      <style>{CSS}</style>
      <div className="sr-bar">
        <button className="sr-btn" onClick={() => setRunning((r) => !r)}>
          {running ? <Pause size={13} /> : <Play size={13} />}
          {running ? "Pause" : "Play"}
        </button>
        <button className="sr-btn" onClick={reshuffle}><Shuffle size={13} />Reshuffle</button>
        <div className="sr-ctl">
          <label htmlFor="sr-order">order</label>
          <select id="sr-order" value={order} onChange={(e) => setOrder(e.target.value as Order)}>
            <option value="random">random</option>
            <option value="nearly">nearly sorted</option>
            <option value="reversed">reversed</option>
            <option value="few">few unique</option>
          </select>
        </div>
        <div className="sr-ctl">
          <label htmlFor="sr-size">n {size}</label>
          <input id="sr-size" type="range" min={12} max={140} step={4} value={size} onChange={(e) => setSize(Number(e.target.value))} />
        </div>
        <div className="sr-ctl">
          <label htmlFor="sr-speed">speed {speed}</label>
          <input id="sr-speed" type="range" min={1} max={12} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
        </div>
      </div>

      <div className="sr-grid">
        {lanes.map((L, i) => (
          <div className="sr-lane" key={L.name}>
            <div className="sr-head">
              <span className="sr-name">{L.name}</span>
              {L.done ? <span className="sr-done">done</span> : <span className="sr-stats">{L.comps.toLocaleString()} cmp · {L.writes.toLocaleString()} wr</span>}
            </div>
            <canvas className="sr-canvas" ref={(el) => { canvasRefs.current[i] = el; }} />
            {L.done && <div className="sr-stats">{L.comps.toLocaleString()} cmp · {L.writes.toLocaleString()} wr</div>}
          </div>
        ))}
      </div>

      <div className="sr-legend">
        <span><i className="sr-dot" style={{ background: "var(--dsw-alias-state-business-primary)" }} />compared</span>
        <span><i className="sr-dot" style={{ background: "var(--dsw-alias-state-error-primary)" }} />written</span>
        <span><i className="sr-dot" style={{ background: "var(--dsw-alias-state-success-primary)" }} />sorted</span>
        <span>same array, same step budget every frame</span>
      </div>
    </div>
  );
}
