// `partial-tsx` / `partial-react` publish raw .ts, so a value import type-checks their
// source too — and skipLibCheck does not apply (it only skips .d.ts). What is left is
// upstream's, not ours: `compiler.ts`'s `typeof Bun` guard with no Bun types, reported in
// MindLab-Research/macaron-genui-demo#1717 (the async-component arm that used to sit beside
// it, #1715, is fixed and closed). Print them, don't fail on them, and delete this script
// once upstream ships the fix.
import { spawnSync } from "node:child_process";

const { stdout } = spawnSync("tsc", ["--noEmit", "--pretty", "false"], { encoding: "utf8", shell: true });
const lines = stdout.split("\n").filter((line) => line.trim() !== "");
// Match the path, not the message: run from a symlinked directory (/tmp -> /private/tmp) tsc
// reports these as `../../private/tmp/.../node_modules/...`, so a prefix test lets them through —
// but a bare `includes` would also swallow a first-party error whose text mentions node_modules.
const isUpstream = (line) => /^[^(]*node_modules\//.test(line);
const ours = lines.filter((line) => !isUpstream(line) && !line.startsWith(" "));
const upstream = lines.filter(isUpstream);

if (upstream.length > 0) console.error(`[upstream, ignored] ${upstream.length} error(s) in partial-react — see macaron-genui-demo#1717`);
for (const line of ours) console.error(line);
process.exit(ours.length > 0 ? 1 : 0);
