/**
 * `inlineSubPages` rewrites a canvas's relative imports into blob URLs before compiling.
 *
 * The property that matters is the one that is invisible in the small case: a cycle must
 * degrade rather than hang. The first implementation registered a pending promise per
 * specifier and resolved a child's own imports during its fetch — which deadlocks, because
 * each side awaits the other's URL. It hung in exactly this test.
 */
import { describe, expect, test } from "bun:test";
import { inlineSubPages } from "../src/client/canvas/subpages.ts";

const run = async (files: Record<string, string>, entry: string) => {
  let minted = 0;
  const original = URL.createObjectURL;
  URL.createObjectURL = () => `blob:test/${(minted += 1)}`;
  try {
    let reads = 0;
    const urls: string[] = [];
    const code = await inlineSubPages(
      entry,
      async (specifier) => {
        reads += 1;
        const source = files[specifier];
        return source === undefined ? null : { source, filename: `${specifier}.ts` };
      },
      async (_filename, source) => source,
      urls,
    );
    return { code, reads, urls };
  } finally {
    URL.createObjectURL = original;
  }
};

describe("inlineSubPages", () => {
  test("rewrites a relative import to a blob url", async () => {
    const { code, urls } = await run({ "./t/a": "export const a=1;" }, 'import {a} from "./t/a"; export default a;');
    expect(urls).toHaveLength(1);
    expect(code).toContain(`"${urls[0]}"`);
    expect(code).not.toContain("./t/a");
  });

  test("follows a child's own imports", async () => {
    const files = { "./t/a": 'import {b} from "./t/b"; export const a=b+1;', "./t/b": "export const b=2;" };
    const { urls, reads } = await run(files, 'import {a} from "./t/a"; export default a;');
    expect(reads).toBe(2);
    expect(urls).toHaveLength(2);
  });

  test("a shared child is fetched and minted once", async () => {
    const files = {
      "./t/a": 'import {c} from "./t/c"; export const a=c;',
      "./t/b": 'import {c} from "./t/c"; export const b=c;',
      "./t/c": "export const c=9;",
    };
    const { urls } = await run(files, 'import {a} from "./t/a"; import {b} from "./t/b"; export default a+b;');
    expect(urls).toHaveLength(3);
  });

  test("a cycle degrades instead of hanging", async () => {
    const files = { "./t/a": 'import {b} from "./t/b"; export const a=1;', "./t/b": 'import {a} from "./t/a"; export const b=2;' };
    const settled = await Promise.race([
      run(files, 'import {a} from "./t/a"; export default a;'),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("hung on a cycle")), 3000)),
    ]);
    // Neither member can be minted, so both keep the specifier they had — the same failure
    // as before this feature existed, rather than a new one.
    expect(settled.urls).toHaveLength(0);
    expect(settled.code).toContain("./t/a");
  });

  test("a missing child keeps its specifier", async () => {
    const { code, urls } = await run({}, 'import {a} from "./t/a"; export default a;');
    expect(urls).toHaveLength(0);
    expect(code).toContain("./t/a");
  });
});
