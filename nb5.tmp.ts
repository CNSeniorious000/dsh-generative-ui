import { execSync } from "node:child_process";
const files = execSync(`find ${process.env.HOME}/.dsh/sessions -name session.jsonl.zstd`, { maxBuffer: 1 << 28 }).toString().trim().split("\n");
for (const f of files) {
  let data: string; try { data = execSync(`zstdcat -q ${JSON.stringify(f)}`, { maxBuffer: 1 << 28 }).toString() } catch { continue }
  let skill = false, replyLen = 0, hasCard = false, ask = "", tail = "";
  for (const line of data.split("\n")) {
    let rec: any; try { rec = JSON.parse(line) } catch { continue }
    if (rec?.type === "tool/call") { const a = String(rec.data.arguments ?? ""); if (rec.data.name === "skill" && a.includes("generative-ui")) skill = true; if (a.includes(".ui4a.tsx")) hasCard = true }
    if (rec?.type === "user/message" && ask === "" && rec?.data?.source?.kind === "user") { const t = (rec.data.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join(" "); if (t && !t.includes("system-reminder")) ask = t.replace(/\s+/g, " ").slice(0, 44) }
    if (rec?.type === "assistant/message") for (const t of (rec.data?.message?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text as string)) { replyLen += t.length; tail = t; if (t.includes("ui4a/tsx")) hasCard = true }
  }
  if (!skill || hasCard || replyLen === 0) continue;
  console.log(`${String(replyLen).padStart(5)}B | ${ask.padEnd(46)} | ${JSON.stringify(tail.slice(-60))}`);
}
