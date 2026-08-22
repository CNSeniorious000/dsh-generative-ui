// Were the truncated sessions writing a card when they were killed?
import { execSync } from "node:child_process";
const files = execSync(`find ${process.env.HOME}/.dsh/sessions -name session.jsonl.zstd`, { maxBuffer: 1 << 28 }).toString().trim().split("\n");
let fenceInFlight = 0, total = 0;
for (const f of files) {
  let data: string; try { data = execSync(`zstdcat -q ${JSON.stringify(f)}`, { maxBuffer: 1 << 28 }).toString() } catch { continue }
  let skill = false, replyLen = 0, hasCard = false; let chunkText = "";
  for (const line of data.split("\n")) {
    let rec: any; try { rec = JSON.parse(line) } catch { continue }
    if (rec?.type === "tool/call") { const a = String(rec.data.arguments ?? ""); if (rec.data.name === "skill" && a.includes("generative-ui")) skill = true; if (a.includes(".ui4a.tsx")) hasCard = true }
    if (rec?.type === "assistant/message") for (const t of (rec.data?.message?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text as string)) { replyLen += t.length; if (t.includes("ui4a/tsx")) hasCard = true }
    if (String(rec?.type).endsWith("-chunks") || rec?.type === "assistant/chunk") chunkText += JSON.stringify(rec);
  }
  if (!skill || hasCard || replyLen > 0) continue;
  total++;
  if (chunkText.includes("ui4a/tsx")) fenceInFlight++;
}
console.log({ truncatedSessions: total, wereWritingACardWhenKilled: fenceInFlight });
