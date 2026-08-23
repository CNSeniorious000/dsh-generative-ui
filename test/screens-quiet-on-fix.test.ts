import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SCREENS } from "../scripts/screens.ts";

/**
 * `test/cards-negative/` proves each screen fires on the defect. This proves the other half:
 * that it stays quiet on a card doing the same thing RIGHT.
 *
 * That question found three false positives in `NO-FOCUS-RING` — cards replacing the ring with
 * `:focus { border-color }` rather than `:focus-visible`. A screen with no false positives on
 * the corpus is not thereby correct; the corpus may simply never contain the fix, which is
 * likeliest exactly when the screen checks for a good practice nobody follows.
 *
 * Each entry is [fires on this, stays quiet on this]. The right-hand side is the point.
 */
const PAIRS: Record<string, [string, string]> = {
  "JSX-SUBSCRIPT": [`<Icons[kind] size={12} />`, `{(() => { const I = Icons[kind]; return <I size={12} /> })()}`],
  "GLOB-IN-JSX": ["<code>src/**/*.{ts,tsx}</code>", `<code>{"src/**/*.{ts,tsx}"}</code>`],
  "UNQUOTED-CSS-UNIT": ["<span style={{ fontSize: 11px }} />", "<style>{`.chip { font-size: 11px }`}</style>"],
  "TRANSITION-WITHOUT-TRANSFORM": [`<div style={{ transition: "transform .12s ease" }} />`, `<div style={{ transition: "transform .12s ease", transform: "scale(1.02)" }} />`],

  "AND-INTO-ARROW": ["const f = a > 0 && (i: number) => i * 2;", "const f = (i: number) => a > 0 && i * 2;"],
  "REGEX-IN-JSX-TEXT": ["  ^\\w+@\\w+\\.\\w{2,}$", `  const ok = /^\\w+@\\w+\\.\\w{2,}$/.test(v);`],
  "COMMA-IN-STYLE": ["<div style={base, { color: 'red' }} />", "<div style={{ ...base, color: 'red' }} />"],
  "DUPLICATE-STYLE-KEY": ["<div style={{ padding: 4, padding: 8 }} />", "<div style={{ padding: 4, margin: 8 }} />"],
  "MODULE-SCOPE-HOOK": ["const [n, setN] = useState(0);\nexport default function C() { return null }", "export default function C() { const [n, setN] = useState(0); return null }"],
  "DESTRUCTURED-HOOK": ["const [start, setStart] = useRef(0);", "const start = useRef(0);"],
  "SHADOWED-EXPORT": [`import { Legend } from "recharts";\nexport default function Legend() {}`, `import { Legend } from "recharts";\nexport default function Chart() {}`],
  "MISSING-REACT-IMPORT": ["export default function C() { return <Suspense /> }", `import { Suspense } from "react";\nexport default function C() { return <Suspense /> }`],
  "UNGUARDED-LAST-INDEX": [
    `import { bash } from "$dsh/exec";\nconst [rows, setRows] = useState([]);\nconst x = rows[0].name;`,
    `import { bash } from "$dsh/exec";\nconst [rows, setRows] = useState([]);\nconst x = rows.length > 0 ? rows[0].name : "";`,
  ],
  "VIEWPORT-UNITS": [`const s = { width: "100vw" }`, `const s = { width: "100%" }`],
  "HARDCODED-BACKGROUND": [`const s = { background: "#fff" }`, `const s = { background: "var(--dsw-alias-bg-base)" }`],
  "BRAND-PRIMARY-FILL": [`<div style={{ background: "var(--dsw-alias-brand-primary)", color: "#fff" }} />`, `<div style={{ color: "var(--dsw-alias-brand-primary)" }} />`],
  "UNREACHABLE-CONTROL": ["<div onClick={f} />", "<div role='button' tabIndex={0} onClick={f} onKeyDown={g} />"],
  "UNSTOPPABLE-MOTION": [
    "@keyframes slide { from { transform: translateX(40px) } }",
    "@keyframes slide { from { transform: translateX(40px) } }\n@media (prefers-reduced-motion: reduce) { .panel { animation: none } }",
  ],
  "UNLABELLED-CONTROL": [
    `<input type="range" min={0} max={100} value={v} onChange={f} />`,
    `<input type="range" aria-label="音量" min={0} max={100} value={v} onChange={f} />`,
  ],
  "UNGUARDED-NUMBER-INPUT": [
    `<input type="number" onChange={(e) => setN(Number(e.target.value))} />`,
    // Keep the raw string in state and coerce where it is USED, so an empty field stays empty.
    `<input type="number" onChange={(e) => setN(e.target.value === "" ? "" : Number(e.target.value))} />`,
  ],
  "UNGUARDED-ASYNC-HANDLER": [
    `const run = async (t: string) => { for await (const c of streamText({ prompt: t })) setOut(c) }`,
    // The `runId` idiom the corpus already uses: bump a ref, and a stale run returns.
    `const run = async (t: string) => { const id = ++runId.current; for await (const c of streamText({ prompt: t })) { if (id !== runId.current) return; setOut(c) } }`,
  ],
  "NO-FOCUS-RING": [`const s = { outline: "none" }`, `const s = { outline: "none", border: focused ? "1px solid blue" : "none" }`],
};

test("every screen has a pair", () => {
  expect(Object.keys(PAIRS).toSorted()).toEqual(Object.keys(SCREENS).toSorted());
});

for (const [name, [dirty, clean]] of Object.entries(PAIRS)) {
  test(`${name} fires on the defect and not on the fix`, () => {
    expect(SCREENS[name](dirty)).toBe(true);
    expect(SCREENS[name](clean)).toBe(false);
  });
}

/**
 * The `>` inside a JSX handler is what a `[^>]*` regex mistakes for the end of the tag, so an
 * attribute written after `onClick={() => …}` is invisible to it. Three screens have had this
 * bug; a freshly generated card that did everything right — `role`, `tabIndex`, `aria-expanded`
 * and a full `onKeyDown` — was reported broken by the last of them.
 *
 * These are the shapes that distinguish a working tag parser from a regex, kept as a set because
 * the next screen to match a tag will need the same three.
 */
const AFTER_AN_ARROW: [string, string, boolean][] = [
  ["UNREACHABLE-CONTROL", `<div onClick={() => go(id)} role="button" tabIndex={0} onKeyDown={k}>x</div>`, false],
  ["UNREACHABLE-CONTROL", `<div onClick={() => go(id)}>x</div>`, true],
  ["UNLABELLED-CONTROL", `<input type="range" onChange={(e) => setV(+e.target.value)} aria-label="音量" />`, false],
  ["UNLABELLED-CONTROL", `<input type="range" onChange={(e) => setV(+e.target.value)} />`, true],
  ["UNGUARDED-NUMBER-INPUT", `<input type="number" onChange={(e) => setN(e.target.value === "" ? "" : Number(e.target.value))} />`, false],
];

for (const [screen, source, shouldFire] of AFTER_AN_ARROW) {
  test(`${screen} reads the whole tag past an arrow handler${shouldFire ? " (and still fires)" : ""}`, () => {
    expect(SCREENS[screen](source)).toBe(shouldFire);
  });
}

/**
 * No screen should match a tag with a regex again. `tagAt` is the shared parser; a `[^>]*` in a
 * pattern that starts at `<` is the bug that produced three false positives, and it reads as
 * perfectly ordinary code every time.
 *
 * The `<button …>…</button>` arm is exempt and named: it matches the whole element including its
 * body, so an attribute after a handler is still inside the matched span.
 */
test("no screen matches a tag with [^>]*", () => {
  const source = readFileSync(`${import.meta.dir}/../scripts/screens.ts`, "utf8")
    .replaceAll(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");   // the comments explain the bug; they are not it
  const offenders = [...source.matchAll(/<\\?[a-zA-Z][\w\\]*\\?b?\[\^>\]\*/g)]
    .map((m) => m[0])
    .filter((hit) => !hit.startsWith("<button"));
  expect(offenders).toEqual([]);
});

/**
 * `NO-FOCUS-RING` is the sole detector on 50 of 378 corpus cards — more than every other screen
 * combined — so a false positive in it mis-diagnoses more cards than a wrong answer anywhere
 * else. It has been retightened once already, for cards replacing the ring with `:focus`
 * rather than `:focus-visible`.
 *
 * Measured on the corpus: 72 of 73 flagged cards do not contain the string "focus" anywhere at
 * all, and the 73rd's only mention is `onFocus={(e) => e.target.select()}` — selecting text, not
 * indicating focus. Zero false positives in 73.
 */
const FOCUS_RING_CASES: [string, string, boolean][] = [
  ["a bare outline:none is the defect", `<button style={{ outline: "none" }}>x</button>`, true],
  [":focus-visible in a style block", "<style>{`button:focus-visible { outline: 2px solid red }`}</style><button style={{ outline: \"none\" }} />", false],
  ["a focused flag driving borderColor", `const [focused] = useState(false);\n<input style={{ outline: "none", borderColor: focused ? "blue" : "grey" }} />`, false],
  ["a focused flag driving boxShadow", `const [focused] = useState(false);\n<input style={{ outline: "none", boxShadow: focused ? "0 0 0 2px blue" : "none" }} />`, false],
  ["outlineOffset counts as a ring", `<button style={{ outline: "none", outlineOffset: 2 }} />`, false],
  ["no outline:none, nothing to say", `<button style={{ border: "1px solid" }} />`, false],
  [":focus, not :focus-visible, still a replacement", "<style>{`button:focus { border-color: blue }`}</style><button style={{ outline: \"none\" }} />", false],
];

for (const [name, source, fires] of FOCUS_RING_CASES) {
  test(`NO-FOCUS-RING: ${name}`, () => {
    expect(SCREENS["NO-FOCUS-RING"](source)).toBe(fires);
  });
}

/**
 * `UNLABELLED-CONTROL`, the second-largest carrier (28 sole diagnoses). Two shapes from the
 * corpus that look like false positives and are not:
 *
 * - a visible `<span>` above the slider. Sighted users see a label; a screen reader announces
 *   "slider, 20" with no name, because a `<span>` is not a `<label>` and carries no `htmlFor`.
 *   This is the majority shape and exactly the defect only a checker finds.
 * - a card that labels ONE control correctly and flags on a different, unlabelled one. The
 *   presence of `<label htmlFor>` somewhere in the file says nothing about the slider.
 */
const LABEL_CASES: [string, string, boolean][] = [
  ["a span above a slider is not a label", `<div><span>每天背新词</span></div>\n<input type="range" min={5} max={60} value={n} onChange={f} />`, true],
  ["aria-label names it", `<input type="range" aria-label="每天背新词" min={5} max={60} value={n} onChange={f} />`, false],
  ["a real label beside it", `<label htmlFor="d">每天</label>\n<input type="range" id="d" min={5} max={60} value={n} onChange={f} />`, false],
  ["one labelled control does not vouch for another", `<label htmlFor="c">摄氏</label><input id="c" type="number" value={v} onChange={f} />\n<input type="range" min={-40} max={200} value={v} onChange={f} />`, true],
  ["a text input is not this screen's business", `<input type="text" value={v} onChange={f} />`, false],
  ["an unlabelled select announces its value", `<select value={n} onChange={f}><option>每天</option></select>`, true],
];

for (const [name, source, fires] of LABEL_CASES) {
  test(`UNLABELLED-CONTROL: ${name}`, () => {
    expect(SCREENS["UNLABELLED-CONTROL"](source)).toBe(fires);
  });
}

/**
 * The shape that made the lookback wrong in both directions. A `<label>` CLOSED before the
 * control associates with nothing — no `htmlFor`, not wrapping — so it reads as a label and
 * announces as nothing. Two corpus cards do exactly this; the old check cleared them.
 */
test("UNLABELLED-CONTROL: a closed label beside the control names nothing", () => {
  expect(SCREENS["UNLABELLED-CONTROL"](`<label><span>贷款金额</span></label>\n<input type="range" min="10" max="1000" value={v} onChange={f} />`)).toBe(true);
});

test("UNLABELLED-CONTROL: a label WRAPPING the control does name it", () => {
  expect(SCREENS["UNLABELLED-CONTROL"](`<label>年利率\n<input type="range" min={1} max={8} value={v} onChange={f} />\n</label>`)).toBe(false);
});

/**
 * The other lookback of the same kind (`UNGUARDED-NUMBER-INPUT`, 500 characters). Audited after
 * the `<label>` one turned out to be wrong: the failure mode is misattribution — deciding a call
 * belongs to the wrong control because it is merely the nearest.
 *
 * Both interleavings are covered. `lastIndexOf` is correct here specifically because the call
 * sits inside its own element's handler, so "nearest preceding input" IS the owning one.
 */
const NUMBER_CASES: [string, string, boolean][] = [
  ["the defect", `<input type="number" value={n} onChange={(e) => setN(Number(e.target.value))} />`, true],
  ["guarded with isNaN", `<input type="number" value={n} onChange={(e) => { const v = Number(e.target.value); if (!isNaN(v)) setN(v) }} />`, false],
  ["guarded against empty", `<input type="number" value={n} onChange={(e) => setN(e.target.value === "" ? 0 : Number(e.target.value))} />`, false],
  ["a slider cannot produce either input", `<input type="range" value={n} onChange={(e) => setN(Number(e.target.value))} />`, false],
  ["a slider between the number field and the call", `<input type="number" value={a} onChange={h1} />\n<input type="range" value={b} onChange={(e) => setB(Number(e.target.value))} />`, false],
  ["a number field after a slider", `<input type="range" value={b} onChange={h2} />\n<input type="number" value={a} onChange={(e) => setA(Number(e.target.value))} />`, true],
];

for (const [name, source, fires] of NUMBER_CASES) {
  test(`UNGUARDED-NUMBER-INPUT: ${name}`, () => {
    expect(SCREENS["UNGUARDED-NUMBER-INPUT"](source)).toBe(fires);
  });
}

/**
 * `UNGUARDED-ASYNC-HANDLER`. Scoped by brace depth rather than proximity, so it has none of the
 * misattribution problem — but its guard pattern had a hole: `latest` and `stale` matched a bare
 * identifier, so naming a variable `latest` cleared the handler. Both matched 0 of 378 corpus
 * cards and are gone; the last case is what they used to break.
 */
const ASYNC_CASES: [string, string, boolean][] = [
  ["the defect", `const run = async () => { const r = await bash("ls"); setOut(r.stdout) }`, true],
  ["guarded by a runId ref", `const run = async () => { const id = ++runId.current; const r = await bash("ls"); if (id !== runId.current) return; setOut(r.stdout) }`, false],
  ["guarded by an abort signal", `const run = async () => { const c = new AbortController(); const r = await bash("ls"); if (c.signal.aborted) return; setOut(r.stdout) }`, false],
  ["nothing awaited", `const run = async () => { setOut("x") }`, false],
  ["no setState after the await", `const run = async () => { const r = await bash("ls"); console.log(r) }`, false],
  ["a variable merely named latest is not a guard", `const run = async () => { const latest = 1; const r = await bash("ls"); setOut(r.stdout + latest) }`, true],
];

for (const [name, source, fires] of ASYNC_CASES) {
  test(`UNGUARDED-ASYNC-HANDLER: ${name}`, () => {
    expect(SCREENS["UNGUARDED-ASYNC-HANDLER"](source)).toBe(fires);
  });
}

/**
 * Alternations that clear a screen but have never matched a corpus card. Auditing these is what
 * removed `latest`/`stale` from `UNGUARDED-ASYNC-HANDLER` — but "never matched" is not by itself
 * the fault. The four below are unmatched and CORRECT, because each is a real alternate spelling
 * of the fix; `latest` was a word that merely appeared near one.
 *
 * The test is the question to ask of the next one: does a card written this way actually do the
 * right thing? If yes, an unused alternation is coverage waiting to be used. If no, it excuses.
 */
const UNUSED_BUT_REAL: [string, string, string][] = [
  ["UNLABELLED-CONTROL", "aria-labelledby", `<span id="lab">音量</span><input type="range" aria-labelledby="lab" value={v} onChange={f} />`],
  ["UNREACHABLE-CONTROL", "onKeyUp", `<div onClick={go} onKeyUp={go} tabIndex={0}>x</div>`],
  ["UNREACHABLE-CONTROL", "onKeyPress", `<div onClick={go} onKeyPress={go} tabIndex={0}>x</div>`],
  ["NO-FOCUS-RING", "a focus box-shadow", "<style>{`button:focus { box-shadow: 0 0 0 2px blue }`}</style><button style={{ outline: \"none\" }} />"],
];

for (const [screen, spelling, source] of UNUSED_BUT_REAL) {
  test(`${screen}: ${spelling} is a real fix, not an excuse`, () => {
    expect(SCREENS[screen](source)).toBe(false);
  });
}

/**
 * A transform applied IMPERATIVELY is still a transform. One corpus card sets it from
 * `onMouseDown`, and it is real motion — the first version of `TRANSITION-WITHOUT-TRANSFORM`
 * flagged it because the property never appears in a style object.
 */
test("TRANSITION-WITHOUT-TRANSFORM: an imperative transform counts", () => {
  expect(SCREENS["TRANSITION-WITHOUT-TRANSFORM"](`<button style={{ transition: "transform .12s ease" }} onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.95)")}>x</button>`)).toBe(false);
});
