import * as React from "react";
import { useEffect, useState } from "react";
import * as JsxRuntime from "react/jsx-runtime";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as Scheduler from "scheduler";
import { GenUIRenderer } from "partial-react";
import { normalizeGeneratedTsx } from "partial-tsx";
// By URL: imported bare, the package inlines its 2.6MB wasm into the page as base64.
import * as tsx from "https://esm.sh/@esm.sh/tsx@1.5.3?target=es2022";
import { usePersistedState } from "../types/standalone/state.js";
import { Stage } from "./live/stage.tsx";
import { ensureImportMap, IMPORT_MAP, installRuntime } from "./live/runtime.ts";
import { FirstPaintRace, StreamedHeadline } from "./ui/motion-pieces.tsx";
import { Fish, Icon } from "./ui/icons.tsx";
import { CSS } from "./ui/styles.ts";

const REPO = "https://github.com/MindLab-Research/dsh-generative-ui";
const NPM = "https://www.npmjs.com/package/dsh-generative-ui";
// Not `macaron.im/mindlab/research/…`: that path 301s to the Mind Lab homepage for every user
// agent, so the original link reads as one to nowhere. The paper itself lives at the new path.
const UI4A = "https://www.mindlab.im/updates/ui4a-a-component-native-harness-for-generative-ui";
const INSTALL = "dsh plugin --profile web add dsh-generative-ui";

const page = "mx-auto w-full max-w-[1240px] px-6";
const h2 = "text-[clamp(30px,4vw,48px)] font-semibold leading-[1.08] tracking-[-0.03em] text-[#f9fafb]";
const lede = "text-[16px] leading-[26px] text-[#adb2b8]";

/**
 * The page's React is the cards' React: everything partial-react compiles imports `react` through
 * the document import map, which points back at the module this bundle already loaded. The map has
 * to be in the HTML before any module script runs, so it is server-rendered. Every package that map
 * shims has to be imported in this file: `genui build` resolves bare specifiers from the entry alone.
 */
installRuntime({ GenUIRenderer, normalize: normalizeGeneratedTsx, tsx }, {
  react: React, "react/jsx-runtime": JsxRuntime, "react-dom": ReactDOM, "react-dom/client": ReactDOMClient, scheduler: Scheduler,
  "$dsh/chat": { sendMessage: (text: string) => dispatchEvent(new CustomEvent("ui4a:send", { detail: text })) },
  "$dsh/state": { usePersistedState },
});

// Rendered only where it can work: in the server render, and in the hydration that has to match it.
// genui dev renders on the client alone, where React warns about the tag and it would never run.
const ssr = typeof document === "undefined" || !!document.querySelector('script[type="importmap"]');
const ImportMap = () => (ssr ? <script type="importmap" dangerouslySetInnerHTML={{ __html: JSON.stringify(IMPORT_MAP) }} /> : null);

/** The stage needs the browser (wasm, rAF, real layout); it mounts after hydration with its box already reserved. */
function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { ensureImportMap(); setMounted(true); }, []);
  return mounted;
}

function Install() {
  const [copied, setCopied] = useState(false);
  const copy = () => void navigator.clipboard?.writeText(INSTALL).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); });
  return (
    <div className="flex max-w-full items-center gap-3 rounded-2xl border border-[#ffffff1f] bg-[#1b1b1c] py-2 pl-4 pr-2 font-mono text-[13px]">
      <span className="text-[#81858c]">$</span>
      <code className="min-w-0 flex-1 truncate text-[#cfd3d6]">{INSTALL}</code>
      <button type="button" onClick={copy} aria-live="polite" className="shrink-0 rounded-xl bg-[#2c2c2e] px-3 py-1.5 font-sans text-[12px] text-[#cfd3d6] transition-[background-color,transform] duration-200 hover:bg-[#353638] active:scale-[.96]">
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

const Nav = () => (
  <nav className={`${page} flex h-16 items-center justify-between`}>
    <span className="flex items-center gap-2.5 text-[14px] font-medium text-[#f9fafb]"><Fish className="h-[15px] w-[20px]" /> dsh-generative-ui</span>
    <div className="flex items-center gap-6 text-[14px] text-[#adb2b8]">
      <a className="transition-colors hover:text-[#f9fafb]" href={UI4A}>Research</a>
      <a className="transition-colors hover:text-[#f9fafb]" href={NPM}>npm</a>
      <a className="transition-colors hover:text-[#f9fafb]" href={REPO}>GitHub</a>
    </div>
  </nav>
);

function Hero({ live }: { live: boolean }) {
  return (
    <header className={`${page} pb-14 pt-16 md:pt-24`}>
      <div className="grid items-end gap-10 lg:grid-cols-[1.2fr_1fr]">
        <StreamedHeadline lines={["The answer", "is an interface."]} />
        <div className="flex flex-col gap-6 lg:pb-3">
          <p className={lede}>
            A plugin for DeepSeek Harness. The model writes a React component into its reply and dsh web runs it as the tokens arrive — sliders you can drag
            before the card is finished, 3D, games, any package on npm.
          </p>
          <Install />
        </div>
      </div>
      <div className="mt-14">
        {/* The stage box is reserved before the runtime loads, so the page below never shifts. */}
        {live ? <Stage /> : <div className="h-[640px] rounded-2xl border border-[#ffffff1f] bg-[#151517] max-lg:h-[600px]" />}
      </div>
    </header>
  );
}

const POINTS = [
  { icon: "send", title: "Streams, and is usable while it does", text: "partial-react compiles the half-written file on every frame and keeps the last good one on screen. A control is live the moment its line arrives." },
  { icon: "workspace", title: "State survives the rest of the stream", text: "Hooks keep their values across recompiles, so what the reader dragged mid-stream is still there when the model finishes the file." },
  { icon: "plugin", title: "Any npm package, no install", text: "Bare imports resolve through esm.sh against the host's own React — React Aria, react-three-fiber, KaTeX, NumberFlow, confetti." },
  { icon: "context", title: "Wired to the harness", text: "$dsh/chat starts the next turn, $dsh/state persists, $dsh/fs and $dsh/exec run under the session's own access mode." },
] as const;

const Points = () => (
  <section className={`${page} grid gap-x-10 gap-y-10 py-20 md:grid-cols-2 lg:grid-cols-4`}>
    {POINTS.map((p) => (
      <div key={p.title} className="flex flex-col gap-3">
        <Icon name={p.icon} className="size-5 text-[#7aaaff]" />
        <h3 className="text-[16px] font-medium text-[#f9fafb]">{p.title}</h3>
        <p className="text-[14px] leading-[22px] text-[#adb2b8]">{p.text}</p>
      </div>
    ))}
  </section>
);

const Race = () => (
  <section className={`${page} grid gap-12 border-t border-[#ffffff14] py-24 lg:grid-cols-[1fr_1.4fr]`}>
    <div className="flex flex-col gap-5">
      <h2 className={h2}>Half the tokens. On screen from the first tenth.</h2>
      <p className={lede}>
        A component is shorter than the page that would draw it — about 45% fewer output tokens across the 48-case gallery in the UI4A report — and it can render
        long before it is complete. HTML has nothing to show until it parses.
      </p>
      <a href={UI4A} className="text-[14px] text-[#7aaaff] transition-colors hover:text-[#a5c4ff]">Read the UI4A report →</a>
    </div>
    <FirstPaintRace />
  </section>
);

const NATIVE = [
  ["Your theme", "Cards read dsh's own tokens, so dark mode and accent follow the app."],
  ["Inline or canvas", "A reply-sized card sits in the transcript; anything worth keeping opens in the canvas panel beside it."],
  ["No new tools", "The model writes files with dsh's own Write and Edit. Canvases live under .dsh/ui4a/ in the workspace."],
  ["Errors go back to the model", "A card that fails after streaming reports itself, once, and the model fixes it in the next turn."],
];

const Native = () => (
  <section className={`${page} grid gap-12 border-t border-[#ffffff14] py-24 lg:grid-cols-[1fr_1.4fr]`}>
    <div className="flex flex-col gap-5">
      <h2 className={h2}>A dsh plugin, not a widget in an iframe.</h2>
      <p className={lede}>One install. The cards render in the host's React tree, under the host's styles and the session's permissions.</p>
      <Install />
    </div>
    <dl className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
      {NATIVE.map(([title, text]) => (
        <div key={title} className="border-t border-[#ffffff14] pt-5">
          <dt className="text-[15px] font-medium text-[#f9fafb]">{title}</dt>
          <dd className="mt-2 text-[14px] leading-[22px] text-[#adb2b8]">{text}</dd>
        </div>
      ))}
    </dl>
  </section>
);

const Footer = () => (
  <footer className={`${page} flex flex-wrap items-center justify-between gap-4 border-t border-[#ffffff14] py-10 text-[13px] text-[#81858c]`}>
    <span>Apache-2.0 · Mind Lab</span>
    <div className="flex gap-5">
      <a className="transition-colors hover:text-[#cfd3d6]" href={REPO}>GitHub</a>
      <a className="transition-colors hover:text-[#cfd3d6]" href={NPM}>npm</a>
      <a className="transition-colors hover:text-[#cfd3d6]" href={UI4A}>UI4A report</a>
    </div>
  </footer>
);

export default function Site() {
  const live = useMounted();
  return (
    <div className="min-h-screen bg-[#0e0e10] text-[#f9fafb] antialiased">
      <ImportMap />
      <style>{CSS}</style>
      <Nav />
      <Hero live={live} />
      <Points />
      <Race />
      <Native />
      <Footer />
    </div>
  );
}
