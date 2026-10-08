import { useState } from "react";
// The tab strip is the one widget this page could not hand-roll. `src/skill.ts` names this exact
// case to the model — a hand-written row of tabs looks finished and has no roving focus, no
// Home/End, no `aria-selected`; radix's `Tabs` is the one that ships them. Measured on this page
// before the swap: `document.querySelectorAll("[role]").length === 0`.
// Namespace import on purpose: the package exports `Root`/`List`/`Trigger`/`Content`, not a `Tabs`
// object. `import { Tabs }` compiles, builds and publishes a blank page — React #130 at runtime.
import * as Tabs from "@radix-ui/react-tabs";

const REPO = "https://github.com/MindLab-Research/dsh-generative-ui";
const NPM = "https://www.npmjs.com/package/dsh-generative-ui";
// Not `macaron.im/mindlab/research/…`: that path 301s to the Mind Lab homepage for every user
// agent, so the original link reads as one to nowhere. The paper itself lives at the new path.
const UI4A = "https://www.mindlab.im/updates/ui4a-a-component-native-harness-for-generative-ui";
const INSTALL = "dsh plugin --profile web add dsh-generative-ui";

const page = "mx-auto w-full max-w-5xl px-6";
const section = `${page} border-t border-[#1c1c21] py-20`;
const heading = "text-[34px] font-semibold leading-[1.15] tracking-[-0.02em] md:text-[44px]";
const eyebrow = "font-mono text-xs uppercase tracking-[0.18em] text-[#ff6a3d]";
const body = "text-[15px] leading-relaxed text-[#8f8f9b]";

/** `null` is "there is no such number to show" — the calculator's inputs can be cleared to nothing. */
const money = (value: number | null, digits = 0) => (value === null ? "—" : `¥${value.toFixed(digits)}`);

/**
 * The shell's own stylesheet paints `body` with its light token, so anything outside this page's
 * background — the overscroll gutter, a short viewport — is white. There is no build flag for a
 * theme, and the page is dark by choice, so the two rules that matter are restated here.
 */
const Base = () => <style>{`:root{color-scheme:dark}html,body{background:#0a0a0b}`}</style>;

const Nav = () => (
  <nav className={`${page} flex h-16 items-center justify-between`}>
    <span className="font-mono text-sm text-[#ededf0]">dsh-generative-ui</span>
    <div className="flex items-center gap-5 text-sm text-[#8f8f9b]">
      <a className="transition-colors hover:text-[#ededf0]" href={UI4A}>Research</a>
      <a className="transition-colors hover:text-[#ededf0]" href={NPM}>npm</a>
      <a className="transition-colors hover:text-[#ededf0]" href={REPO}>GitHub</a>
    </div>
  </nav>
);

const Hero = () => (
  <header className={`${page} pt-16 pb-24 md:pt-28`}>
    <p className={eyebrow}>DSH plugin</p>
    <h1 className={`${heading} mt-5 max-w-3xl`}>The agent writes TSX.<br />dsh renders it live.</h1>
    <p className={`${body} mt-7 max-w-2xl`}>
      Generative UI for DeepSeek Harness. The model answers with a live React interface instead of prose — and it streams, the component
      rendering while the model is still typing it.
    </p>
    <Install />
    <div className="mt-8 flex flex-wrap items-center gap-3">
      <a className="rounded-lg bg-[#ededf0] px-4 py-2 text-sm font-medium text-[#0a0a0b] transition-opacity hover:opacity-90" href={REPO}>Get started</a>
      <a className="rounded-lg border border-[#2a2a30] px-4 py-2 text-sm text-[#c9c9d1] transition-colors hover:border-[#3a3a42]" href={UI4A}>Why not a UI schema →</a>
    </div>
  </header>
);

const Install = () => {
  const [feedback, setFeedback] = useState<"idle" | "copied" | "failed">("idle");
  // `navigator.clipboard` is absent on an insecure origin and `writeText` rejects when the document
  // is not focused, so the old `?.writeText(…).then(…)` both threw on a missing API and left the
  // rejection unhandled — while still printing "copied". A reader who sees nothing happen needs to
  // be told to select it by hand, and aria-live is what says so without relying on colour.
  const copy = () => {
    const write = navigator.clipboard?.writeText(INSTALL);
    if (write === undefined) setFeedback("failed");
    else void write.then(() => setFeedback("copied"), () => setFeedback("failed"));
    setTimeout(() => setFeedback("idle"), 1600);
  };
  return (
    <div className="mt-9 flex max-w-xl items-start gap-3 rounded-xl border border-[#24242a] bg-[#121214] px-4 py-3 font-mono text-[12px] md:text-[13px]">
      <span className="text-[#8a8a95]">$</span>
      <code className="flex-1 break-all text-[#d6d6dd]">{INSTALL}</code>
      <button aria-live="polite" className="shrink-0 text-[#9a9aa6] transition-colors hover:text-[#ededf0]" onClick={copy}>
        {feedback === "copied" ? "copied" : feedback === "failed" ? "select it" : "copy"}
      </button>
    </div>
  );
};

/** Three answers to the same question, which is the whole decision the skill teaches. */
const SHAPES = [
  {
    key: "inline",
    title: "Inline",
    line: "A fenced block in the reply",
    body: "Renders in place, between the paragraphs. For a chart, a form, a set of options to click, a calculation the reader wants to change a number in — something that is part of reading the answer.",
    code: "````ui4a/tsx",
  },
  {
    key: "canvas",
    title: "Canvas",
    line: "A file at .dsh/ui4a/canvases/",
    body: "Opens in the panel beside the conversation and stays there across turns. For a tool the user comes back to — a tracker, a browser, an instrument. It is a file they own.",
    code: "canvases/tarot.ui4a.tsx",
  },
  {
    key: "prose",
    title: "Prose",
    line: "Most of the time",
    body: "Closures, CAP theorem, what day it is. An interface the reader has to decode is worse than a sentence, and the default is that prose is enough.",
    code: "—",
  },
];

const Shapes = () => (
  <section className={section}>
    <p className={eyebrow}>Where it shows up</p>
    <h2 className={`${heading} mt-5 max-w-2xl`}>One format, two places, and a default of not using it.</h2>
    <div className="mt-12 grid gap-4 md:grid-cols-3">
      {SHAPES.map((shape) => (
        <div key={shape.key} className="rounded-2xl border border-[#1e1e23] bg-[#101013] p-6">
          <div className="flex items-baseline justify-between">
            <h3 className="text-base font-medium text-[#ededf0]">{shape.title}</h3>
            <code className="font-mono text-[11px] text-[#5c5c66]">{shape.code}</code>
          </div>
          <p className="mt-1 text-[13px] text-[#9a9aa6]">{shape.line}</p>
          <p className="mt-4 text-[14px] leading-relaxed text-[#8f8f9b]">{shape.body}</p>
        </div>
      ))}
    </div>
  </section>
);

/** Three real cards, so the page is a demo rather than a description of one. */
const TABS = [
  ["flags", "rsync flags"],
  ["monthly", "a calculator"],
  ["share", "a chart"],
] as const;

const Demo = () => {
  const [tab, setTab] = useState<string>("flags");
  return (
    <section className={section}>
      <p className={eyebrow}>Live, not a screenshot</p>
      <h2 className={`${heading} mt-5 max-w-2xl`}>Every card below is ordinary React, running on this page.</h2>
      <p className={`${body} mt-6 max-w-2xl`}>
        No schema, no component allowlist, no DSL. The model writes a component that <code className="font-mono text-[13px] text-[#c9c9d1]">export default</code>s —
        it can import anything on npm — and the runtime compiles it in the browser and mounts it.
      </p>
      <Tabs.Root className="mt-12 overflow-hidden rounded-2xl border border-[#1e1e23] bg-[#101013]" value={tab} onValueChange={setTab}>
        <Tabs.List className="flex gap-1 border-b border-[#1c1c21] p-2">
          {TABS.map(([value, label]) => (
            <Tabs.Trigger
              key={value}
              value={value}
              className={`rounded-lg px-3 py-1.5 font-mono text-[12px] transition-colors ${tab === value ? "bg-[#1e1e24] text-[#ededf0]" : "text-[#9a9aa6] hover:text-[#c9c9d1]"}`}
            >
              {label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <div className="p-6 md:p-8">
          <Tabs.Content value="flags"><FlagTable /></Tabs.Content>
          <Tabs.Content value="monthly"><Monthly /></Tabs.Content>
          <Tabs.Content value="share"><ShareChart /></Tabs.Content>
        </div>
      </Tabs.Root>
    </section>
  );
};

const FLAGS = [
  { flag: "-a", what: "archive — recurse, and keep permissions, times, links", danger: false },
  { flag: "-v", what: "verbose — print each file as it transfers", danger: false },
  { flag: "-z", what: "compress in transit (skip it on a fast LAN)", danger: false },
  { flag: "--delete", what: "delete anything on the server that is not here", danger: true },
];

const FlagTable = () => {
  const [armed, setArmed] = useState(true);
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2 font-mono text-[13px]">
        <span className="text-[#9a9aa6]">$</span>
        <span className="text-[#d6d6dd]">rsync -avz{armed ? " --delete" : ""} ./dist/ deploy@box:/srv/www</span>
      </div>
      <div className="divide-y divide-[#1c1c21] overflow-hidden rounded-xl border border-[#1e1e23]">
        {FLAGS.map((row) => (
          <div key={row.flag} className="flex items-start gap-4 px-4 py-3">
            <code className={`w-20 shrink-0 font-mono text-[13px] ${row.danger && armed ? "text-[#ff6a3d]" : "text-[#c9c9d1]"}`}>{row.flag}</code>
            <span className="text-[14px] text-[#8f8f9b]">{row.what}</span>
          </div>
        ))}
      </div>
      <button
        aria-pressed={armed}
        className={`mt-5 rounded-lg border px-3 py-1.5 text-[13px] transition-colors ${armed ? "border-[#ff6a3d]/40 text-[#ff6a3d]" : "border-[#2a2a30] text-[#8f8f9b] hover:text-[#c9c9d1]"}`}
        onClick={() => setArmed(!armed)}
      >
        {armed ? "--delete is on — here is what it removes" : "turn --delete on"}
      </button>
      <p className="mt-4 text-[13px] text-[#9a9aa6]">
        {armed ? "The trailing slash on ./dist/ decides whether the directory itself is copied. Both of these are controls, not decoration." : "Nothing on the server is removed. The transfer only adds."}
      </p>
    </div>
  );
};

const Monthly = () => {
  const [principal, setPrincipal] = useState(1200000);
  const [rate, setRate] = useState(3.1);
  const [years, setYears] = useState(30);
  const monthlyRate = rate / 100 / 12;
  const months = years * 12;
  const growth = (1 + monthlyRate) ** months;
  // A number input the reader clears reads as 0, not empty (`Number("") === 0`), and both branches
  // then divide by a zero: `growth - 1` at no term, `months` itself at no rate. Nothing to show.
  const payment = months > 0 ? (monthlyRate === 0 ? principal / months : (principal * monthlyRate * growth) / (growth - 1)) : null;
  const total = payment === null ? null : payment * months;
  const interest = total === null ? null : total - principal;
  // `focus:border` alone is a 1.6:1 change against the input's own ground — a focus indicator has
  // to be visible, not merely present.
  const field = "w-full rounded-lg border border-[#24242a] bg-[#16161a] px-3 py-2 font-mono text-[13px] text-[#ededf0] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a3d]";
  const rows: Array<[label: string, value: number, set: (next: number) => void, unit: string]> = [
    ["Principal", principal, setPrincipal, "¥"],
    ["Rate", rate, setRate, "%"],
    ["Years", years, setYears, "yr"],
  ];
  return (
    <div className="grid gap-8 md:grid-cols-2">
      <div className="space-y-4">
        {rows.map(([label, value, set, unit]) => (
          <label key={label} className="block">
            <span className="mb-1.5 block text-[12px] text-[#9a9aa6]">{label}</span>
            <div className="relative">
              <input className={field} type="number" value={value} onChange={(event) => set(Number(event.target.value))} />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 font-mono text-[12px] text-[#8a8a95]">{unit}</span>
            </div>
          </label>
        ))}
      </div>
      <div className="flex flex-col justify-center rounded-xl border border-[#1e1e23] bg-[#14141a] p-6">
        <p className="text-[12px] text-[#9a9aa6]">Monthly payment</p>
        <p className="mt-2 font-mono text-[38px] leading-none tracking-tight text-[#ededf0]">{money(payment, 2)}</p>
        <p className="mt-4 text-[13px] text-[#9a9aa6]">{months > 0 ? `over ${months} payments, equal principal and interest` : "enter a term in years"}</p>
        <div className="mt-6 space-y-2 border-t border-[#24242a] pt-5 text-[13px]">
          <div className="flex justify-between"><span className="text-[#9a9aa6]">Total paid</span><span className="font-mono text-[#c9c9d1]">{money(total)}</span></div>
          <div className="flex justify-between"><span className="text-[#9a9aa6]">Of which interest</span><span className="font-mono text-[#c9c9d1]">{money(interest)}</span></div>
        </div>
      </div>
    </div>
  );
};

const MONTHS = [42, 51, 38, 64, 72, 58, 81, 69, 94, 77, 88, 103];
// The plot depends only on MONTHS, so none of it belongs in the render that a hover re-runs.
const PEAK = Math.max(...MONTHS);
const POINTS = MONTHS.map((value, index) => [index * (640 / (MONTHS.length - 1)), 180 - (value / PEAK) * 150] as const);
const LINE = POINTS.map(([x, y]) => `${x},${y}`).join(" ");

const ShareChart = () => {
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div>
      <div className="mb-5 flex items-baseline justify-between">
        <span className="text-[13px] text-[#9a9aa6]">a chart the model wrote, plotting whatever the question was about</span>
        <span className="font-mono text-[12px] text-[#8a8a95]">{hover === null ? "—" : MONTHS[hover]}</span>
      </div>
      {/* No `preserveAspectRatio="none"`: stretching a 640-wide viewBox to a 900px column turned
          every marker into an 8.5×6 ellipse. The viewBox ratio now holds, so the plot is 281px
          tall in the card rather than 200. */}
      <svg aria-label={`a monthly series from ${Math.min(...MONTHS)} to ${Math.max(...MONTHS)}`} className="h-auto w-full" role="img" viewBox="0 0 640 200">
        <polyline fill="none" points={LINE} stroke="#ff6a3d" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {POINTS.map(([x, y], index) => (
          <circle
            key={index}
            aria-label={`${MONTHS[index]}`}
            className="cursor-pointer"
            cx={x}
            cy={y}
            fill={hover === index ? "#ff6a3d" : "#0a0a0b"}
            r={hover === index ? 5 : 3}
            stroke="#ff6a3d"
            strokeWidth="2"
            tabIndex={0}
            vectorEffect="non-scaling-stroke"
            onBlur={() => setHover(null)}
            onFocus={() => setHover(index)}
            onMouseEnter={() => setHover(index)}
            onMouseLeave={() => setHover(null)}
          >
            {/* The value was reachable by pointer only. A `<title>` gives it to the keyboard, a
                screen reader and a long-press, with no extra axis to draw. */}
            <title>{MONTHS[index]}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
};

/** What a card can reach, in the model's own names. */
const CAPABILITIES = [
  ["$dsh/fs", "read and write files, under the session's own access mode"],
  ["$dsh/exec", "run a command where the host enables it, and check the exit code"],
  ["$dsh/ai", "ask the model, on the app's default model, without seeing a key"],
  ["$dsh/web", "search the web, and get sources back"],
  ["$dsh/chat", "send text into the transcript as the user"],
  ["$dsh/state", "usePersistedState — localStorage behind useState"],
];

const Capabilities = () => (
  <section className={section}>
    <p className={eyebrow}>What a card can reach</p>
    <h2 className={`${heading} mt-5 max-w-2xl`}>It is not stranded in a sandbox.</h2>
    <p className={`${body} mt-6 max-w-2xl`}>
      A card imports the harness through the same capabilities the model has, under the same access mode the user can see and change in the composer.
      Read Only is Read Only for the card too.
    </p>
    <div className="mt-12 grid gap-x-10 gap-y-5 md:grid-cols-2">
      {CAPABILITIES.map(([name, what]) => (
        <div key={name} className="flex items-baseline gap-4 border-t border-[#1c1c21] pt-4">
          <code className="w-24 shrink-0 font-mono text-[13px] text-[#ff6a3d]">{name}</code>
          <span className="text-[14px] text-[#8f8f9b]">{what}</span>
        </div>
      ))}
    </div>
  </section>
);

const STEPS = [
  ["The fence", "The reply carries a four-backtick ui4a/tsx block. Four because generated TSX routinely contains triple backticks."],
  ["The claim", "The client matches the rendered block against the conversation snapshot — never the language tag, which the host truncates and only emits once the fence closes."],
  ["The compile", "partial-tsx + a wasm compiler run in the browser, on the growing text. Half-written JSX is normalized; frames that cannot compile are transient, not errors."],
  ["The mount", "The component renders against the host's own React singleton, so hooks work and the card takes the app's colours, theme and container width."],
];

const HowItWorks = () => (
  <section className={section}>
    <p className={eyebrow}>How the streaming works</p>
    <h2 className={`${heading} mt-5 max-w-2xl`}>The card is compiled from text that is still arriving.</h2>
    <ol className="mt-12 space-y-6">
      {STEPS.map(([title, text], index) => (
        <li key={title} className="flex gap-6 border-t border-[#1c1c21] pt-6">
          <span className="font-mono text-[13px] text-[#8a8a95]">{String(index + 1).padStart(2, "0")}</span>
          <div>
            <h3 className="text-[15px] font-medium text-[#ededf0]">{title}</h3>
            <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-[#8f8f9b]">{text}</p>
          </div>
        </li>
      ))}
    </ol>
  </section>
);

const Footer = () => (
  <footer className={`${page} flex flex-wrap items-center justify-between gap-4 border-t border-[#1c1c21] py-10 text-[13px] text-[#9a9aa6]`}>
    <span>Apache-2.0 · Mind Lab</span>
    <div className="flex gap-5">
      <a className="transition-colors hover:text-[#c9c9d1]" href={REPO}>GitHub</a>
      <a className="transition-colors hover:text-[#c9c9d1]" href={NPM}>npm</a>
      <a className="transition-colors hover:text-[#c9c9d1]" href={UI4A}>UI4A paper</a>
    </div>
  </footer>
);

export default function Site() {
  return (
    <div className="min-h-screen bg-[#0a0a0b] font-sans text-[#ededf0] antialiased">
      <Base />
      <Nav />
      <Hero />
      <Shapes />
      <Demo />
      <Capabilities />
      <HowItWorks />
      <Footer />
    </div>
  );
}
