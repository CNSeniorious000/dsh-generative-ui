import { execSync } from "node:child_process";
const files = execSync(`find ${process.env.HOME}/.dsh/sessions -name session.jsonl.zstd`, { maxBuffer: 1 << 28 }).toString().trim().split("\n");
for (const f of files) {
  let data: string; try { data = execSync(`zstdcat -q ${JSON.stringify(f)}`, { maxBuffer: 1 << 28 }).toString() } catch { continue }
  if (!data.includes("点一下卡片我就开工") && !data.includes("往上下滚动可以看到整天")) continue;
  for (const line of data.split("\n")) {
    let rec: any; try { rec = JSON.parse(line) } catch { continue }
    if (rec?.type !== "assistant/message") continue;
    for (const t of (rec.data?.message?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text as string)) {
      const fences = [...t.matchAll(/`{3,}[\w/]*/g)].map((m) => m[0]);
      console.log(f.split("/").at(-2), "fences:", JSON.stringify(fences));
    }
  }
}
