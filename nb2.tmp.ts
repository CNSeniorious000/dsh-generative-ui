import { execSync } from "node:child_process";
const files = execSync(`find ${process.env.HOME}/.dsh/sessions -name session.jsonl.zstd`, { maxBuffer: 1 << 28 }).toString().trim().split("\n");
let empty = 0, real = 0;
const kinds = new Map<string, number>();
for (const f of files) {
  let data: string; try { data = execSync(`zstdcat -q ${JSON.stringify(f)}`, { maxBuffer: 1 << 28 }).toString() } catch { continue }
  let skill = false, replyLen = 0, cards = false, canvas = false;
  const types = new Set<string>();
  for (const line of data.split("\n")) {
    let rec: any; try { rec = JSON.parse(line) } catch { continue }
    types.add(rec?.type);
    if (rec?.type === "tool/call") { const a = String(rec.data.arguments ?? ""); if (rec.data.name === "skill" && a.includes("generative-ui")) skill = true; if (a.includes(".ui4a.tsx")) canvas = true }
    if (rec?.type === "assistant/message") for (const t of (rec.data?.message?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text as string)) { replyLen += t.length; if (t.includes("ui4a/tsx")) cards = true }
  }
  if (!skill || cards || canvas) continue;
  if (replyLen === 0) { empty++; for (const t of types) kinds.set(t, (kinds.get(t) ?? 0) + 1) } else real++;
}
console.log({ noReplyAtAll: empty, aRealReplyWithNoCard: real });
console.log("record types present in the empty ones:", [...kinds].sort((a,b)=>b[1]-a[1]).slice(0, 8));
