import { expect, test } from "bun:test";
import { parseUi4aSegments as p } from "../src/client/runtime/segments.ts";
test("standard", () => { const [b]=p("说明\n\n````ui4a/tsx\nexport default function A() {}\n````\n收尾"); expect(b.code).toBe("export default function A() {}\n"); expect(b.complete).toBe(true); });
test("open mid-sentence", () => { const [b]=p("……完整元素周期表。````ui4a/tsx\nexport default function A() {}\n````"); expect(b.complete).toBe(true); });
test("first line glued to lang", () => { const [b]=p("````ui4a/tsx import { useState } from \"react\"\nexport default function A() {}\n````"); expect(b.code.startsWith('import { useState } from "react"\n')).toBe(true); });
test("close glued to last line", () => { const [b]=p("````ui4a/tsx\nexport default function A() {}````"); expect(b.complete).toBe(true); });
test("streaming", () => { const [b]=p("````ui4a/tsx\nexport default function A() {"); expect(b.complete).toBe(false); });
test("longer fence not cut", () => { const [b]=p("`````ui4a/tsx\nconst md = `\\`\\`\\``\n`````"); expect(b.complete).toBe(true); });
test("python untouched", () => { expect(p("```python\nprint(1)\n```")).toHaveLength(0); });
test("two blocks", () => { expect(p("````ui4a/tsx\nA\n````\n中间\n````ui4a/tsx\nB\n````")).toHaveLength(2); });
test("meta on fence line", () => { const [b]=p("````ui4a/tsx title=demo\nexport default function A() {}\n````"); expect(b.code).toBe("export default function A() {}\n"); });

// The one unbalanced fence in a 183-session corpus: the model glued `</parameter></invoke>`
// onto its last line of TSX. Left in, the body fails to compile — the reader loses the whole card.
test("leaked tool-call markup dropped", () => { const [b]=p("好的\n````ui4a/tsx\nexport default () => <div />\n</parameter>\n</invoke>"); expect(b.complete).toBe(false); expect(b.code).toBe("export default () => <div />"); });
test("lookalike inside code survives", () => { const [b]=p("````ui4a/tsx\nconst s = `</parameter>`\n"); expect(b.code).toBe("const s = `</parameter>`\n"); });
// 19 of 405 fence openers in the corpus are the model *describing* the fence rather than opening one;
// 14 put the sentence right after the language. Dropping those costs 0 of 390 real cards.
test("prose about the fence is not a card", () => { expect(p("用 ````ui4a/tsx```` 块，原地渲染成可交互界面\n讲完了。")).toHaveLength(0); });
test("meta after the language still opens a card", () => { const [b]=p("````ui4a/tsx title=demo\nexport default function A() {}\n````"); expect(b.code).toBe("export default function A() {}\n"); });
// 18 of 385 openers in the corpus are closed by a SHORTER run — markdown says that does not close
// the fence, so each was a card that streamed forever. `open=6 close=4` is the common shape.
test("a shorter closing fence still closes", () => { const [b]=p("``````ui4a/tsx\nexport default function A() {}\n````\n收尾"); expect(b.complete).toBe(true); expect(b.code).toBe("export default function A() {}\n"); });
test("an exact closer still wins over an earlier shorter one", () => { const [b]=p("`````ui4a/tsx\nconst md = `\\`\\`\\``\n`````"); expect(b.complete).toBe(true); expect(b.code).toBe("const md = `\\`\\`\\``\n"); });
// Ordering, not just presence: the exact-length closer must be tried FIRST, or a ```js block inside
// the card's own strings ends the card at its first line. This is the entire reason the prompt asks
// for four backticks, and "try short, then exact" passes every other test in this file.
test("a triple-backtick run inside the body does not close a longer fence", () => { const [b]=p("`````ui4a/tsx\nconst help = `\n```js\nfoo()\n```\n`\nexport default function A() {}\n`````"); expect(b.complete).toBe(true); expect(b.code.includes("export default")).toBe(true); });
