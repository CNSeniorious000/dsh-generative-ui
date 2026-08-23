import { useEffect, useRef, useState } from "react"
import { Play, Pause } from "lucide-react"

function makeNoiseBuffer(ctx: AudioContext) {
  const len = Math.floor(ctx.sampleRate * 0.05)
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len)
  return buffer
}

function playClick(ctx: AudioContext, time: number, accent: boolean, noise: AudioBuffer) {
  const out = ctx.createGain()
  out.connect(ctx.destination)

  // 短促噪声瞬态，模拟木鱼的「哒」
  const n = ctx.createBufferSource()
  n.buffer = noise
  const ng = ctx.createGain()
  ng.gain.setValueAtTime(accent ? 1.0 : 0.55, time)
  ng.gain.exponentialRampToValueAtTime(0.001, time + 0.03)
  n.connect(ng)
  ng.connect(out)
  n.start(time)
  n.stop(time + 0.04)

  // 高频「叮」音头，重拍更高更亮
  const o = ctx.createOscillator()
  o.type = "triangle"
  o.frequency.value = accent ? 2000 : 1400
  const og = ctx.createGain()
  og.gain.setValueAtTime(accent ? 0.65 : 0.38, time)
  og.gain.exponentialRampToValueAtTime(0.001, time + 0.06)
  o.connect(og)
  og.connect(out)
  o.start(time)
  o.stop(time + 0.07)
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export default function Metronome() {
  const [bpm, setBpm] = useState(120)
  const [beatsPerBar, setBeatsPerBar] = useState(4)
  const [currentBeat, setCurrentBeat] = useState(0)
  const [running, setRunning] = useState(false)
  // A metronome is the case `prefers-reduced-motion` exists for: something that pulses forever.
  // There is no `<style>` block here to hang a media query on, so the preference is read once
  // and the transitions fall out of it — the beat still lands, it just stops moving.
  const [still] = useState(() => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true)
  const [draft, setDraft] = useState<string | null>(null)
  // The BPM field is borderless by design, so the browser's ring has to go — and something has
  // to come back, or tabbing into the card's main control shows nothing. Inline rather than a
  // `:focus-visible` rule because this card has no `<style>` block.
  const [focused, setFocused] = useState(false)

  const ctxRef = useRef<AudioContext | null>(null)
  const noiseRef = useRef<AudioBuffer | null>(null)
  const timerRef = useRef<number | null>(null)
  const visualTimeoutsRef = useRef<number[]>([])
  const nextNoteTimeRef = useRef(0)
  const beatRef = useRef(0)
  const bpmRef = useRef(bpm)
  const beatsRef = useRef(beatsPerBar)
  const tapTimesRef = useRef<number[]>([])

  useEffect(() => { bpmRef.current = bpm }, [bpm])
  useEffect(() => { beatsRef.current = beatsPerBar }, [beatsPerBar])

  // 调度循环：用 AudioContext 时钟做前瞻调度，避免 setTimeout 累积漂移
  useEffect(() => {
    if (!running) return
    const ctx = ctxRef.current!
    nextNoteTimeRef.current = ctx.currentTime + 0.05
    beatRef.current = 0
    setCurrentBeat(0)

    const id = window.setInterval(() => {
      const c = ctxRef.current
      if (!c) return
      const secondsPerBeat = 60 / bpmRef.current
      while (nextNoteTimeRef.current < c.currentTime + 0.12) {
        const beat = beatRef.current
        playClick(c, nextNoteTimeRef.current, beat === 0, noiseRef.current!)
        const delayMs = Math.max(0, (nextNoteTimeRef.current - c.currentTime) * 1000)
        const to = window.setTimeout(() => setCurrentBeat(beat), delayMs)
        visualTimeoutsRef.current.push(to)
        nextNoteTimeRef.current += secondsPerBeat
        beatRef.current = (beat + 1) % beatsRef.current
      }
    }, 25)
    timerRef.current = id

    return () => {
      window.clearInterval(id)
      visualTimeoutsRef.current.forEach(clearTimeout)
      visualTimeoutsRef.current = []
    }
  }, [running])

  // 卸载时清理
  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
      visualTimeoutsRef.current.forEach(clearTimeout)
      if (ctxRef.current) ctxRef.current.close()
    }
  }, [])

  function ensureContext() {
    if (!ctxRef.current) {
      const AC = window.AudioContext || (window as any).webkitAudioContext
      ctxRef.current = new AC()
      noiseRef.current = makeNoiseBuffer(ctxRef.current)
    }
    return ctxRef.current
  }

  function toggle() {
    if (running) {
      setRunning(false)
      setCurrentBeat(0)
      beatRef.current = 0
    } else {
      const ctx = ensureContext()
      if (ctx.state === "suspended") ctx.resume()
      setRunning(true)
    }
  }

  function changeBeats(n: number) {
    setBeatsPerBar(n)
    setCurrentBeat(0)
    beatRef.current = 0
  }

  function tap() {
    const now = performance.now()
    const times = tapTimesRef.current
    if (times.length && now - times[times.length - 1] > 2000) times.length = 0
    times.push(now)
    if (times.length > 6) times.shift()
    if (times.length >= 2) {
      const intervals: number[] = []
      for (let i = 1; i < times.length; i++) intervals.push(times[i] - times[i - 1])
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length
      setBpm(clamp(Math.round(60000 / avg), 30, 280))
      setDraft(null)
    }
  }

  const shownBpm = draft ?? String(bpm)

  return (
    <div style={{ padding: 20, borderRadius: 14, border: "1px solid var(--dsw-alias-border-l1)", background: "var(--dsw-alias-bg-layer-1)", maxWidth: 360 }}>
      {/* 拍点指示 */}
      <div style={{ display: "flex", gap: 10, justifyContent: "center", alignItems: "center", minHeight: 30 }}>
        {Array.from({ length: beatsPerBar }).map((_, i) => {
          const accent = i === 0
          const active = i === currentBeat && running
          const size = accent ? 16 : 12
          return (
            <span
              key={i}
              style={{
                width: size,
                height: size,
                borderRadius: "50%",
                background: active ? "var(--dsw-alias-state-business-primary)" : "transparent",
                border: `1.5px solid ${accent || active ? "var(--dsw-alias-state-business-primary)" : "var(--dsw-alias-border-l2)"}`,
                transform: active && !still ? "scale(1.25)" : "scale(1)",
                transition: still ? "none" : "transform 90ms ease, background 90ms ease",
              }}
            />
          )
        })}
      </div>

      {/* BPM 读数 */}
      <div style={{ textAlign: "center", margin: "14px 0 6px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 6 }}>
          <input
            type="number"
            value={shownBpm}
            min={30}
            max={280}
            onFocus={(e) => e.target.select()}
            onChange={(e) => {
              const raw = e.target.value
              setDraft(raw)
              const v = parseInt(raw, 10)
              if (!isNaN(v)) setBpm(clamp(v, 30, 280))
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => { setFocused(false); setDraft(null) }}
            style={{
              width: 92,
              fontSize: 52,
              fontWeight: 700,
              textAlign: "center",
              color: "var(--dsw-alias-label-primary)",
              background: "transparent",
              border: "none",
              outline: "none",
              borderRadius: 8,
              boxShadow: focused ? "0 0 0 2px var(--dsw-alias-state-business-primary)" : "none",
              fontVariantNumeric: "tabular-nums",
            }}
          />
          <span style={{ fontSize: 13, color: "var(--dsw-alias-label-secondary)", letterSpacing: 2 }}>BPM</span>
        </div>
      </div>

      {/* 速度滑杆 */}
      <input
        type="range"
        min={30}
        max={280}
        step={1}
        value={bpm}
        onChange={(e) => { setBpm(+e.target.value); setDraft(null) }}
        style={{ width: "100%", accentColor: "var(--dsw-alias-state-business-primary)", margin: "8px 0 14px" }}
      />

      {/* 拍号 + 定速 */}
      <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6 }}>
          {[2, 3, 4, 5, 6, 7].map((n) => (
            <button
              key={n}
              onClick={() => changeBeats(n)}
              style={{
                minWidth: 34,
                height: 30,
                borderRadius: 8,
                border: `1px solid ${n === beatsPerBar ? "var(--dsw-alias-state-business-primary)" : "var(--dsw-alias-border-l1)"}`,
                background: n === beatsPerBar ? "var(--dsw-alias-state-business-primary)" : "transparent",
                color: n === beatsPerBar ? "var(--dsw-alias-bg-base)" : "var(--dsw-alias-label-secondary)",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {n}<span style={{ opacity: 0.6, fontSize: 10 }}>/4</span>
            </button>
          ))}
        </div>
        <button
          onClick={tap}
          style={{
            height: 30,
            padding: "0 12px",
            borderRadius: 8,
            border: "1px solid var(--dsw-alias-border-l1)",
            background: "transparent",
            color: "var(--dsw-alias-label-secondary)",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          轻拍定速
        </button>
      </div>

      {/* 播放按钮 */}
      <button
        onClick={toggle}
        aria-label={running ? "停止" : "开始"}
        style={{
          margin: "18px auto 4px",
          width: 64,
          height: 64,
          borderRadius: "50%",
          border: "none",
          cursor: "pointer",
          background: "var(--dsw-alias-state-business-primary)",
          color: "var(--dsw-alias-bg-base)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: running ? "0 0 0 8px color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent)" : "none",
          transition: still ? "none" : "box-shadow 150ms ease",
        }}
      >
        {running ? <Pause size={26} /> : <Play size={26} style={{ marginLeft: 3 }} />}
      </button>
    </div>
  )
}