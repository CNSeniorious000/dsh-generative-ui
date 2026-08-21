import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const midiToName = (m: number) => `${NOTE_NAMES[m % 12]}${Math.floor(m / 12) - 1}`;
const isBlack = (m: number) => [1, 3, 6, 8, 10].includes(m % 12);

const START = 48; // C3
const KEY_COUNT = 29; // C3 .. E5, two octaves plus

// computer keyboard -> semitone offset from START
const KEY_MAP: Record<string, number> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11,
  k: 12, o: 13, l: 14, p: 15, ";": 16, "'": 17,
};

const QUALITIES: Record<string, number[]> = {
  maj: [0, 4, 7], min: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8],
  maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10], dom7: [0, 4, 7, 10],
  sus4: [0, 5, 7], sus2: [0, 2, 7], add9: [0, 4, 7, 14],
};

type Voice = { osc: OscillatorNode[]; gain: GainNode; stop: (t: number) => void };

export default function PianoCard() {
  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const voicesRef = useRef<Map<number, Voice>>(new Map());
  const heldRef = useRef<Set<number>>(new Set());
  const sustainRef = useRef(false);

  const [down, setDown] = useState<number[]>([]);
  const [sustain, setSustain] = useState(false);
  const [last, setLast] = useState<{ name: string; freq: number } | null>(null);
  const [root, setRoot] = useState(60);
  const [quality, setQuality] = useState("maj");
  const [chordNotes, setChordNotes] = useState<number[]>([]);

  const ensureCtx = useCallback(() => {
    let ctx = ctxRef.current;
    if (!ctx) {
      const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
      ctx = new AC();
      ctxRef.current = ctx;
      const master = ctx.createGain();
      master.gain.value = 0.28;
      master.connect(ctx.destination);
      masterRef.current = master;
    }
    if (ctx.state === "suspended") void ctx.resume(); // only ever called from a gesture handler
    return ctx;
  }, []);

  const noteOn = useCallback((midi: number) => {
    const ctx = ensureCtx();
    const master = masterRef.current!;
    if (voicesRef.current.has(midi)) return;
    const t = ctx.currentTime;
    const f = midiToFreq(midi);
    const gain = ctx.createGain();
    gain.connect(master);
    // ADSR
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.9, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.55, t + 0.12);
    gain.gain.setTargetAtTime(0.34, t + 0.12, 1.4);

    // a few partials so it reads as an instrument rather than a test tone
    const partials: [number, number, OscillatorType][] = [
      [1, 0.6, "sine"], [2, 0.22, "sine"], [3, 0.12, "triangle"], [4, 0.06, "sine"],
    ];
    const osc: OscillatorNode[] = partials.map(([mult, amp, type]) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f * mult, t);
      const g = ctx.createGain();
      g.gain.value = amp / (1 + Math.log2(mult) * 0.4);
      o.connect(g).connect(gain);
      o.start(t);
      return o;
    });

    const stop = (when: number) => {
      gain.gain.cancelScheduledValues(when);
      gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0002), when);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.28);
      osc.forEach((o) => o.stop(when + 0.32));
    };
    voicesRef.current.set(midi, { osc, gain, stop });
    setLast({ name: midiToName(midi), freq: f });
    setDown(() => Array.from(heldRef.current).sort((a, b) => a - b));
  }, [ensureCtx]);

  const noteOff = useCallback((midi: number) => {
    if (sustainRef.current) return;
    const v = voicesRef.current.get(midi);
    if (!v) return;
    voicesRef.current.delete(midi);
    v.stop(ctxRef.current!.currentTime);
  }, []);

  const press = useCallback((midi: number) => {
    if (heldRef.current.has(midi)) return;
    heldRef.current.add(midi);
    setDown(Array.from(heldRef.current).sort((a, b) => a - b));
    noteOn(midi);
  }, [noteOn]);

  const release = useCallback((midi: number) => {
    if (!heldRef.current.has(midi)) return;
    heldRef.current.delete(midi);
    setDown(Array.from(heldRef.current).sort((a, b) => a - b));
    noteOff(midi);
  }, [noteOff]);

  const releaseSustained = useCallback(() => {
    voicesRef.current.forEach((v, midi) => {
      if (heldRef.current.has(midi)) return;
      voicesRef.current.delete(midi);
      v.stop(ctxRef.current!.currentTime);
    });
  }, []);

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === "Space") {
        e.preventDefault();
        ensureCtx();
        sustainRef.current = true;
        setSustain(true);
        return;
      }
      const off = KEY_MAP[e.key.toLowerCase()];
      if (off === undefined) return;
      e.preventDefault();
      press(START + off);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        sustainRef.current = false;
        setSustain(false);
        releaseSustained();
        return;
      }
      const off = KEY_MAP[e.key.toLowerCase()];
      if (off === undefined) return;
      release(START + off);
    };
    const onBlur = () => {
      Array.from(heldRef.current).forEach(release);
      sustainRef.current = false;
      setSustain(false);
      releaseSustained();
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [press, release, releaseSustained, ensureCtx]);

  useEffect(() => () => {
    voicesRef.current.forEach((v) => v.osc.forEach((o) => { try { o.stop(); } catch {} }));
    voicesRef.current.clear();
    void ctxRef.current?.close();
    ctxRef.current = null;
  }, []);

  const chordTimer = useRef<number | null>(null);
  const playChord = useCallback(() => {
    ensureCtx();
    if (chordTimer.current !== null) window.clearTimeout(chordTimer.current);
    const notes = QUALITIES[quality].map((i) => root + i);
    // clear any previous chord voices first
    chordNotes.forEach((m) => { if (!heldRef.current.has(m)) { const v = voicesRef.current.get(m); if (v) { voicesRef.current.delete(m); v.stop(ctxRef.current!.currentTime); } } });
    setChordNotes(notes);
    notes.forEach((m) => noteOn(m));
    setLast({ name: `${NOTE_NAMES[root % 12]} ${quality}`, freq: midiToFreq(root) });
    chordTimer.current = window.setTimeout(() => {
      notes.forEach((m) => {
        if (heldRef.current.has(m) || sustainRef.current) return;
        const v = voicesRef.current.get(m);
        if (v) { voicesRef.current.delete(m); v.stop(ctxRef.current!.currentTime); }
      });
      setChordNotes([]);
      chordTimer.current = null;
    }, 1600);
  }, [ensureCtx, quality, root, chordNotes, noteOn]);

  useEffect(() => () => { if (chordTimer.current !== null) window.clearTimeout(chordTimer.current); }, []);

  const keys = useMemo(() => Array.from({ length: KEY_COUNT }, (_, i) => START + i), []);
  const whites = keys.filter((m) => !isBlack(m));
  const whiteIndex = new Map(whites.map((m, i) => [m, i]));
  const labelFor = (midi: number) => Object.keys(KEY_MAP).find((k) => START + KEY_MAP[k] === midi);

  const activeSet = new Set([...down, ...chordNotes, ...Array.from(voicesRef.current.keys())]);

  const keyProps = (midi: number) => ({
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); press(midi); },
    onPointerUp: () => release(midi),
    onPointerCancel: () => release(midi),
    onPointerLeave: (e: React.PointerEvent) => { if (e.buttons) release(midi); },
  });

  return (
    <div className="pn-root">
      <style>{`
.pn-root{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:14px;border-radius:14px;display:flex;flex-direction:column;gap:12px;font-family:ui-sans-serif,system-ui,sans-serif;container-type:inline-size;user-select:none;-webkit-user-select:none;touch-action:none}
.pn-head{display:flex;flex-direction:column;gap:8px}
.pn-title{font-size:13px;font-weight:600;letter-spacing:.02em}
.pn-readout{display:flex;align-items:baseline;gap:10px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:8px 12px;min-height:44px}
.pn-note{font-size:24px;font-weight:650;font-variant-numeric:tabular-nums;color:var(--dsw-alias-state-business-primary)}
.pn-freq{font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.pn-hint{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.5}
.pn-pedal{margin-left:auto;font-size:11px;padding:3px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.pn-pedal[data-on="true"]{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.pn-board{position:relative;width:100%;height:132px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden}
.pn-white{position:absolute;top:0;bottom:0;background:var(--dsw-alias-bg-layer-2);border-right:1px solid var(--dsw-alias-border-l1);display:flex;align-items:flex-end;justify-content:center;padding-bottom:6px;font-size:9px;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background .06s linear}
.pn-white:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pn-white[data-active="true"]{background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-bg-base)}
.pn-black{position:absolute;top:0;height:58%;background:var(--dsw-alias-label-primary);border-radius:0 0 4px 4px;display:flex;align-items:flex-end;justify-content:center;padding-bottom:4px;font-size:9px;color:var(--dsw-alias-bg-base);cursor:pointer;z-index:2;transition:background .06s linear}
.pn-black[data-active="true"]{background:var(--dsw-alias-state-business-primary)}
.pn-ctrl{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.pn-sel{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 8px;font-size:12px;flex:1 1 90px;min-width:0}
.pn-btn{background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-bg-base);border:none;border-radius:8px;padding:7px 14px;font-size:12px;font-weight:600;cursor:pointer;flex:1 1 100%}
.pn-btn:active{opacity:.82}
.pn-chord{font-size:11px;color:var(--dsw-alias-label-secondary);min-height:16px}
@container (min-width:420px){.pn-board{height:168px}.pn-btn{flex:0 0 auto}.pn-white{font-size:10px}}
@container (min-width:600px){.pn-board{height:196px}.pn-head{flex-direction:row;align-items:center;justify-content:space-between}.pn-readout{flex:1}}
`}</style>

      <div className="pn-head">
        <div className="pn-readout">
          <span className="pn-note">{last ? last.name : "—"}</span>
          <span className="pn-freq">{last ? `${last.freq.toFixed(2)} Hz` : "play a key"}</span>
          <span className="pn-pedal" data-on={sustain}>sustain {sustain ? "on" : "off"}</span>
        </div>
      </div>

      <div className="pn-board">
        {whites.map((m) => {
          const i = whiteIndex.get(m)!;
          return (
            <div key={m} className="pn-white" data-active={activeSet.has(m)} style={{ left: `${(i / whites.length) * 100}%`, width: `${100 / whites.length}%` }} {...keyProps(m)}>
              <span>{labelFor(m) ?? (m % 12 === 0 ? midiToName(m) : "")}</span>
            </div>
          );
        })}
        {keys.filter(isBlack).map((m) => {
          const prevWhite = whiteIndex.get(m - 1)!;
          const w = 100 / whites.length;
          return (
            <div key={m} className="pn-black" data-active={activeSet.has(m)} style={{ left: `${(prevWhite + 1) * w - w * 0.3}%`, width: `${w * 0.6}%` }} {...keyProps(m)}>
              <span>{labelFor(m) ?? ""}</span>
            </div>
          );
        })}
      </div>

      <div className="pn-ctrl">
        <select className="pn-sel" value={root} onChange={(e) => setRoot(Number(e.target.value))} aria-label="chord root">
          {Array.from({ length: 12 }, (_, i) => 60 + i).map((m) => (
            <option key={m} value={m}>{NOTE_NAMES[m % 12]}</option>
          ))}
        </select>
        <select className="pn-sel" value={quality} onChange={(e) => setQuality(e.target.value)} aria-label="chord quality">
          {Object.keys(QUALITIES).map((q) => <option key={q} value={q}>{q}</option>)}
        </select>
        <button className="pn-btn" onClick={playChord}>Play {NOTE_NAMES[root % 12]} {quality}</button>
      </div>

      <div className="pn-chord">
        {chordNotes.length ? chordNotes.map(midiToName).join(" · ") : QUALITIES[quality].map((i) => midiToName(root + i)).join(" · ")}
      </div>

      <div className="pn-hint">Keys <code>a s d f g h j k l</code> for whites, <code>w e t y u o p</code> for accidentals. Hold <code>space</code> for sustain.</div>
    </div>
  );
}
