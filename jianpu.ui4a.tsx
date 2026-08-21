import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Square, Music2 } from "lucide-react";

type Item =
  | { kind: "bar"; x: number; w: number }
  | { kind: "note"; x: number; w: number; degree: number; octave: number; accidental: number; beats: number; startBeat: number; label: string; index: number };

const SEMITONES = [0, 2, 4, 5, 7, 9, 11]; // 1..7
const KEYS = [
  { name: "1=C", root: 60 }, { name: "1=D", root: 62 }, { name: "1=E", root: 64 },
  { name: "1=F", root: 65 }, { name: "1=G", root: 67 }, { name: "1=A", root: 69 }, { name: "1=bB", root: 70 },
];
const PX_PER_BEAT = 56, MIN_W = 26, GAP = 6, BAR_W = 10;
const STORE = "dsh.jianpu.v1";

const DEFAULT_TEXT = "1 2 3 5 | 6 - 5 - | 3_ 5_ 6_ 5_ 3 2 | 1 - - -";

function parse(text: string) {
  const raw = text.replace(/\|/g, " | ").split(/\s+/).filter(Boolean);
  const notes: { degree: number; octave: number; accidental: number; beats: number; label: string }[] = [];
  const seq: ({ bar: true } | { bar: false; ref: number })[] = [];
  for (const tok of raw) {
    if (tok === "|") { seq.push({ bar: true }); continue; }
    if (/^-+$/.test(tok)) { if (notes.length) notes[notes.length - 1].beats += tok.length; continue; }
    const re = /([#b]?)([0-7])([',^v]*)(_*)(\.*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(tok))) {
      if (!m[0]) break;
      const [, acc, digit, oct, unders, dots] = m;
      let octave = 0;
      for (const c of oct) octave += c === "'" || c === "^" ? 1 : -1;
      let beats = 1 / Math.pow(2, unders.length);
      for (let i = 0; i < dots.length; i++) beats *= 1.5;
      notes.push({
        degree: Number(digit),
        octave,
        accidental: acc === "#" ? 1 : acc === "b" ? -1 : 0,
        beats,
        label: (acc || "") + digit,
      });
      seq.push({ bar: false, ref: notes.length - 1 });
    }
  }
  const items: Item[] = [];
  let x = 0, beat = 0, ni = 0;
  for (const s of seq) {
    if (s.bar) { items.push({ kind: "bar", x, w: BAR_W }); x += BAR_W + GAP; continue; }
    const n = notes[s.ref];
    const w = Math.max(MIN_W, n.beats * PX_PER_BEAT);
    items.push({ kind: "note", x, w, startBeat: beat, index: ni++, ...n });
    x += w + GAP;
    beat += n.beats;
  }
  return { items, totalWidth: Math.max(0, x - GAP), totalBeats: beat };
}

function midiOf(n: { degree: number; octave: number; accidental: number }, root: number) {
  return root + SEMITONES[n.degree - 1] + n.accidental + 12 * n.octave;
}

export default function JianpuPlayerCard() {
  const [text, setText] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORE) || "{}").text ?? DEFAULT_TEXT; } catch { return DEFAULT_TEXT; }
  });
  const [keyIdx, setKeyIdx] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORE) || "{}").keyIdx ?? 0; } catch { return 0; }
  });
  const [bpm, setBpm] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORE) || "{}").bpm ?? 96; } catch { return 96; }
  });
  const [playing, setPlaying] = useState(false);
  const [cursor, setCursor] = useState<number | null>(null);
  const [active, setActive] = useState(-1);

  const { items, totalWidth, totalBeats } = useMemo(() => parse(text), [text]);

  useEffect(() => { localStorage.setItem(STORE, JSON.stringify({ text, keyIdx, bpm })); }, [text, keyIdx, bpm]);

  const ctxRef = useRef<AudioContext | null>(null);
  const sourcesRef = useRef<{ osc: OscillatorNode; gain: GainNode }[]>([]);
  const rafRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    const ctx = ctxRef.current;
    for (const { osc, gain } of sourcesRef.current) {
      try { if (ctx) gain.gain.cancelScheduledValues(ctx.currentTime); osc.stop(); osc.disconnect(); gain.disconnect(); } catch { /* already stopped */ }
    }
    sourcesRef.current = [];
    setPlaying(false); setCursor(null); setActive(-1);
  }, []);

  const start = useCallback(() => {
    const notes = items.filter((i): i is Extract<Item, { kind: "note" }> => i.kind === "note");
    if (!notes.length) return;
    // AudioContext is only ever constructed from inside a user gesture handler
    const ctx = ctxRef.current || (ctxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)());
    if (ctx.state === "suspended") ctx.resume();
    const spb = 60 / bpm;
    const t0 = ctx.currentTime + 0.12;
    const root = KEYS[keyIdx].root;
    for (const n of notes) {
      if (n.degree === 0) continue;
      const at = t0 + n.startBeat * spb;
      const dur = Math.max(0.08, n.beats * spb * 0.92);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = 440 * Math.pow(2, (midiOf(n, root) - 69) / 12);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.22, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at); osc.stop(at + dur + 0.05);
      sourcesRef.current.push({ osc, gain });
    }
    setPlaying(true);
    const tick = () => {
      const el = ctxRef.current;
      if (!el) return;
      const beats = (el.currentTime - t0) / spb;
      if (beats >= totalBeats) { stop(); return; }
      const b = Math.max(0, beats);
      let cur = notes[0], idx = 0;
      for (let i = 0; i < notes.length; i++) if (notes[i].startBeat <= b) { cur = notes[i]; idx = i; }
      const x = cur.x + Math.min(1, (b - cur.startBeat) / cur.beats) * cur.w;
      setCursor(x); setActive(idx);
      const sc = scrollRef.current;
      if (sc && (x < sc.scrollLeft + 40 || x > sc.scrollLeft + sc.clientWidth - 40)) sc.scrollLeft = x - sc.clientWidth / 2;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [items, bpm, keyIdx, totalBeats, stop]);

  const toggle = useCallback(() => { if (playing) stop(); else start(); }, [playing, start, stop]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
      if (e.code === "Space") { e.preventDefault(); toggle(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current);
    for (const { osc } of sourcesRef.current) { try { osc.stop(); } catch { /* noop */ } }
    ctxRef.current?.close();
  }, []);

  useEffect(() => { if (playing) stop(); /* notation edits invalidate the schedule */ }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="jp-root">
      <style>{`
.jp-root { background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); padding: 14px; border-radius: 14px; font: 400 14px/1.5 ui-sans-serif, system-ui, sans-serif; display: flex; flex-direction: column; gap: 12px; }
.jp-head { display: flex; align-items: center; gap: 8px; font-weight: 600; }
.jp-head .jp-sub { font-weight: 400; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.jp-panel { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; padding: 10px; }
.jp-ta { width: 100%; box-sizing: border-box; min-height: 76px; resize: vertical; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; padding: 8px 10px; font: 400 15px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace; outline: none; }
.jp-ta:focus { border-color: var(--dsw-alias-state-business-primary); }
.jp-controls { display: flex; flex-direction: column; gap: 10px; }
@container (min-width: 520px) { .jp-controls { flex-direction: row; align-items: center; justify-content: space-between; } }
.jp-keys { display: flex; flex-wrap: wrap; gap: 6px; }
.jp-key { cursor: pointer; border-radius: 999px; padding: 5px 10px; font: 500 12px/1 ui-monospace, monospace; background: transparent; color: var(--dsw-alias-label-secondary); border: 1px solid var(--dsw-alias-border-l2); }
.jp-key:hover { background: var(--dsw-alias-interactive-bg-hover); }
.jp-key[data-on="1"] { background: var(--dsw-alias-state-business-primary); border-color: var(--dsw-alias-state-business-primary); color: var(--dsw-alias-bg-base); }
.jp-right { display: flex; align-items: center; gap: 10px; }
.jp-play { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; border: 1px solid var(--dsw-alias-state-business-primary); background: var(--dsw-alias-state-business-primary); color: var(--dsw-alias-bg-base); border-radius: 999px; padding: 7px 14px; font: 600 13px/1 inherit; }
.jp-play[data-on="1"] { background: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); }
.jp-bpm { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.jp-bpm input { accent-color: var(--dsw-alias-state-business-primary); width: 90px; }
.jp-scroll { overflow-x: auto; overflow-y: hidden; padding: 6px 2px 2px; }
.jp-stage { position: relative; height: 76px; }
.jp-note { position: absolute; top: 0; height: 62px; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--dsw-alias-label-primary); font: 500 18px/1 ui-monospace, monospace; }
.jp-note[data-rest="1"] { color: var(--dsw-alias-label-secondary); }
.jp-note[data-on="1"] { background: var(--dsw-alias-state-business-primary); border-color: var(--dsw-alias-state-business-primary); color: var(--dsw-alias-bg-base); }
.jp-dots { font-size: 9px; height: 10px; letter-spacing: 2px; }
.jp-hz { font-size: 9px; color: var(--dsw-alias-label-secondary); height: 11px; }
.jp-note[data-on="1"] .jp-hz { color: var(--dsw-alias-bg-base); }
.jp-bar { position: absolute; top: 4px; height: 54px; display: flex; align-items: center; justify-content: center; }
.jp-bar span { display: block; width: 2px; height: 100%; background: var(--dsw-alias-border-l2); }
.jp-cursor { position: absolute; top: -2px; width: 2px; height: 68px; background: var(--dsw-alias-state-success-primary); border-radius: 2px; }
.jp-legend { font-size: 11px; color: var(--dsw-alias-label-secondary); display: flex; flex-wrap: wrap; gap: 4px 12px; }
.jp-legend code { font-family: ui-monospace, monospace; color: var(--dsw-alias-label-primary); }
.jp-empty { color: var(--dsw-alias-label-secondary); font-size: 12px; padding: 22px 4px; }
`}</style>

      <div className="jp-head">
        <Music2 size={16} /> 简谱播放器
        <span className="jp-sub">空格播放 · {KEYS[keyIdx].name}</span>
      </div>

      <div className="jp-panel">
        <textarea className="jp-ta" value={text} spellCheck={false} onChange={(e) => setText(e.target.value)} placeholder="1 2 3 5 | 6 - 5 -" />
        <div className="jp-legend" style={{ marginTop: 8 }}>
          <span><code>-</code> 延长一拍</span>
          <span><code>_</code> 时值减半</span>
          <span><code>.</code> 附点</span>
          <span><code>'</code> 高八度</span>
          <span><code>,</code> 低八度</span>
          <span><code>0</code> 休止</span>
          <span><code>#5 b3</code> 变化音</span>
          <span><code>|</code> 小节线</span>
        </div>
      </div>

      <div className="jp-controls">
        <div className="jp-keys">
          {KEYS.map((k, i) => (
            <button key={k.name} className="jp-key" data-on={i === keyIdx ? "1" : "0"} onClick={() => { if (playing) stop(); setKeyIdx(i); }}>{k.name}</button>
          ))}
        </div>
        <div className="jp-right">
          <label className="jp-bpm">
            {bpm}
            <input type="range" min={40} max={200} value={bpm} onChange={(e) => { if (playing) stop(); setBpm(Number(e.target.value)); }} />
          </label>
          <button className="jp-play" data-on={playing ? "1" : "0"} onClick={toggle}>
            {playing ? <Square size={13} /> : <Play size={13} />}{playing ? "停止" : "播放"}
          </button>
        </div>
      </div>

      <div className="jp-panel">
        {items.length === 0 ? (
          <div className="jp-empty">还没有音符 —— 在上面贴一段简谱试试。</div>
        ) : (
          <div className="jp-scroll" ref={scrollRef}>
            <div className="jp-stage" style={{ width: totalWidth + 4 }}>
              {items.map((it, i) =>
                it.kind === "bar" ? (
                  <div key={i} className="jp-bar" style={{ left: it.x, width: it.w }}><span /></div>
                ) : (
                  <div key={i} className="jp-note" data-on={it.index === active ? "1" : "0"} data-rest={it.degree === 0 ? "1" : "0"} style={{ left: it.x, width: it.w }}>
                    <div className="jp-dots">{it.octave > 0 ? "•".repeat(it.octave) : ""}</div>
                    <div>{it.degree === 0 ? "0" : it.label}</div>
                    <div className="jp-dots">{it.octave < 0 ? "•".repeat(-it.octave) : ""}</div>
                    <div className="jp-hz">{it.degree === 0 ? "" : Math.round(440 * Math.pow(2, (midiOf(it, KEYS[keyIdx].root) - 69) / 12)) + "Hz"}</div>
                  </div>
                )
              )}
              {cursor !== null && <div className="jp-cursor" style={{ left: cursor }} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
