/**
 * Two sections that are pure motion: a headline that streams in the way the cards do, and a race
 * between the same answer written two ways. The race is a function of one clock modulo its period,
 * so its last frame is its first — it loops without a seam and only runs while it is on screen.
 */
import { useRef, useState } from "react";
import { reducedMotion, useFrame, useInView } from "../live/motion.ts";

export function StreamedHeadline({ lines }: { lines: string[] }) {
  const text = lines.join("\n");
  const [n, setN] = useState(0);
  const t = useRef(0);
  useFrame((dt) => {
    if (n >= text.length) return;
    t.current += dt;
    setN(reducedMotion() ? text.length : Math.min(text.length, Math.floor(Math.max(0, t.current - 0.25) * 34)));
  }, n < text.length);
  const starts = lines.map((_, i) => lines.slice(0, i).reduce((a, l) => a + l.length + 1, 0));
  return (
    <h1 aria-label={lines.join(" ")} className="text-[clamp(40px,7vw,84px)] font-semibold leading-[1.02] tracking-[-0.035em] text-[#f9fafb]">
      {lines.map((line, i) => {
        const left = n - starts[i];
        const shown = line.slice(0, Math.max(0, left));
        const typing = left > 0 && left <= line.length;
        return (
          <span key={i} aria-hidden className={`block ${i === 1 ? "text-[#7aaaff]" : ""}`}>
            {/* The full line holds the box so the page below never moves while it types. */}
            <span className="relative block">
              <span className="invisible">{line}</span>
              <span className="absolute inset-0">{shown}{typing && <span className="ui4a-caret ui4a-caret-lg" />}</span>
            </span>
          </span>
        );
      })}
    </h1>
  );
}

const PERIOD = 9;
/** Measured on the 48-case gallery in the UI4A report: tokens to finish the same interface. */
const HTML_TOKENS = 1224;
const UI4A_TOKENS = 672;

const ease = (x: number) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;

function Lane({ label, tokens, firstPaint, at, accent }: { label: string; tokens: number; firstPaint: number; at: number; accent: boolean }) {
  // The writer emits ~200 tokens a second for both lanes; only what each needs before it can paint differs.
  const written = Math.min(tokens, at * 200);
  const painted = written >= firstPaint;
  const grown = tokens === firstPaint ? 1 : ease((written - firstPaint) / (tokens - firstPaint));
  return (
    <div className="grid grid-cols-[120px_1fr] items-center gap-5 max-sm:grid-cols-1 max-sm:gap-2">
      <div>
        <div className={`text-[14px] font-medium ${accent ? "text-[#f9fafb]" : "text-[#adb2b8]"}`}>{label}</div>
        <div className="text-[12px] tabular-nums text-[#81858c]">{Math.round(written)} / {tokens} tokens</div>
      </div>
      <div className="relative h-[92px] overflow-hidden rounded-2xl border border-[#ffffff14] bg-[#1b1b1c]">
        <div className={`absolute inset-y-0 left-0 ${accent ? "bg-[#7aaaff1f]" : "bg-[#ffffff0d]"}`} style={{ width: `${(written / HTML_TOKENS) * 100}%` }} />
        <div className="absolute inset-y-0 border-l border-dashed border-[#ffffff29]" style={{ left: `${(firstPaint / HTML_TOKENS) * 100}%` }} />
        <div className="absolute inset-3 flex items-center gap-3" style={{ opacity: painted ? 1 : 0, transform: `translateY(${painted ? 0 : 6}px)`, transition: "opacity .35s, transform .45s cubic-bezier(.2,.9,.3,1)" }}>
          <div className="h-full rounded-xl bg-[#2c2c2e]" style={{ width: `${30 + grown * 40}%` }}>
            <div className="m-3 h-2 w-1/2 rounded-full bg-[#43454a]" />
            <div className="mx-3 h-[2px] rounded-full bg-[#43454a]"><div className="h-full rounded-full bg-[#7aaaff]" style={{ width: `${20 + grown * 60}%` }} /></div>
            <div className="m-3 h-2 w-1/3 rounded-full bg-[#43454a]" style={{ opacity: grown }} />
          </div>
          <span className="whitespace-nowrap text-[12px] text-[#adb2b8]">{accent ? "usable — still streaming" : "nothing until it parses"}</span>
        </div>
      </div>
    </div>
  );
}

export function FirstPaintRace() {
  const box = useRef<HTMLDivElement>(null);
  const seen = useInView(box);
  const [t, setT] = useState(PERIOD * 0.7);
  useFrame((dt) => { if (seen.get() && !reducedMotion()) setT((x) => (x + dt) % PERIOD); });
  // The loop fades fully out before it wraps and the reset happens while invisible — no frame jumps.
  const at = Math.max(0, Math.min(t - 0.8, PERIOD - 2));
  const fade = Math.min(1, (PERIOD - t) / 0.7, t / 0.5);
  return (
    <div ref={box} className="flex flex-col gap-5" style={{ opacity: fade }}>
      <Lane label="UI4A" tokens={UI4A_TOKENS} firstPaint={110} at={at} accent />
      <Lane label="HTML" tokens={HTML_TOKENS} firstPaint={HTML_TOKENS} at={at} accent={false} />
    </div>
  );
}
