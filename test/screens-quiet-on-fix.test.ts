import { expect, test } from "bun:test";
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
