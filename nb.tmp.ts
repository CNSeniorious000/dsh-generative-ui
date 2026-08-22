import { execSync } from "node:child_process";
import { parseUi4aSegments } from "./src/client/runtime/segments.ts";
const files = execSync(`find ${process.env.HOME}/.dsh/sessions -name session.jsonl.zstd`, { maxBuffer: 1 << 28 }).toString().trim().split("\n");
let n = 0;
for (const f of files) {
  let data: string; try { data = execSync(`zstdcat -q ${JSON.stringify(f)}`, { maxBuffer: 1 << 28 }).toString() } catch { continue }
  let skill = false, ask = "", canvas = false, cards = 0, endedNormally = false, replyLen = 0;
  for (const line of data.split("\n")) {
    let rec: any; try { rec = JSON.parse(line) } catch { continue }
    if (rec?.type === "tool/call") {
      const a = String(rec.data.arguments ?? "");
      if (rec.data.name === "skill" && a.includes("generative-ui")) skill = true;
      if ((rec.data.name === "write" || rec.data.name === "edit" || rec.data.name === "run_code") && a.includes(".ui4a.tsx")) canvas = true;
    }
    if (rec?.type === "user/message" && ask === "" && rec?.data?.source?.kind === "user") { const t = (rec.data.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join(" "); if (t && !t.includes("system-reminder")) ask = t.replace(/\s+/g, " ").slice(0, 50) }
    if (rec?.type === "turn/end") endedNormally = true;
    if (rec?.type === "assistant/message") for (const t of (rec.data?.message?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text as string)) { replyLen += t.length; for (const seg of parseUi4aSegments(t)) if (/^\s*(import|export|const)\b/.test(seg.code)) cards++ }
  }
  if (!skill || cards > 0 || canvas || !ask) continue;
  n++;
  if (n <= 14) console.log(`ended=${endedNormally} replyBytes=${replyLen} | ${ask}`);
}
console.log("skill loaded, nothing built:", n);
