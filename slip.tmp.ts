// Count `tsx`-fenced blocks that are clearly cards: React component source in a bare ```tsx fence.
import { execSync } from "node:child_process";
const files = execSync(`find ${process.env.HOME}/.dsh/sessions -name session.jsonl.zstd`, { maxBuffer: 1 << 28 }).toString().trim().split("\n");
let ui4a = 0, slipped = 0; const examples: string[] = [];
for (const f of files) {
  let data: string; try { data = execSync(`zstdcat -q ${JSON.stringify(f)}`, { maxBuffer: 1 << 28 }).toString() } catch { continue }
  if (!data.includes("```")) continue;
  for (const line of data.split("\n")) {
    let rec: any; try { rec = JSON.parse(line) } catch { continue }
    if (rec?.type !== "assistant/message") continue;
    for (const t of (rec.data?.message?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text as string)) {
      for (const m of t.matchAll(/(`{3,})(tsx|jsx)\n([\s\S]*?)(?:\n\1|$)/g)) {
        // a card, not a snippet: it exports a default component
        if (!/export\s+default\s+function|export\s+default\s*\(/.test(m[3])) continue;
        slipped++; if (examples.length < 4) examples.push(`${f.split("/").at(-2)}: ${JSON.stringify(m[3].slice(0, 60))}`);
      }
      ui4a += [...t.matchAll(/`{3,}ui4a\/tsx/g)].length;
    }
  }
}
console.log({ ui4aFences: ui4a, bareTsxFencesThatAreCards: slipped });
console.log(examples.join("\n"));
