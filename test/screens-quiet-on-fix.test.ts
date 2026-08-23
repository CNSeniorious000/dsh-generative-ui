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
