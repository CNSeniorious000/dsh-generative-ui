// `partial-tsx` / `partial-react` publish raw .ts, so a value import type-checks their
// source too — and skipLibCheck does not apply (it only skips .d.ts). What is left is
// upstream's, not ours: `compiler.ts`'s `typeof Bun` guard with no Bun types, reported in
// MindLab-Research/macaron-genui-demo#1717 (the async-component arm that used to sit beside
// it, #1715, is fixed and closed). Print them, don't fail on them, and delete this script
// once upstream ships the fix.
import { spawnSync } from "node:child_process";

const { stdout } = spawnSync("tsc", ["--noEmit", "--pretty", "false"], { encoding: "utf8", shell: true });
const lines = stdout.split("\n").filter((line) => line.trim() !== "");
const ours = lines.filter((line) => !line.startsWith("node_modules/") && !line.startsWith(" "));
const upstream = lines.filter((line) => line.startsWith("node_modules/"));

if (upstream.length > 0) console.error(`[upstream, ignored] ${upstream.length} error(s) in partial-react/partial-tsx — see macaron-genui-demo#1717`);
for (const line of ours) console.error(line);
process.exit(ours.length > 0 ? 1 : 0);
