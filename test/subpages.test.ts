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

const ENTRY = ".dsh/ui4a/canvases/c.ui4a.tsx";

const run = async (files: Record<string, string>, entry: string) => {
  let minted = 0;
  const original = URL.createObjectURL;
  URL.createObjectURL = () => `blob:test/${(minted += 1)}`;
  try {
    let reads = 0;
    const urls: string[] = [];
    const code = await inlineSubPages(
      entry,
      ENTRY,
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

  test("the same specifier from two files is two different targets", async () => {
    // The bug this guards: a real split gives every child a sibling import, so `./types`
    // appears in several files at once. Keyed by specifier rather than by resolved path,
    // the first target was served to all of them.
    let minted = 0;
    const original = URL.createObjectURL;
    URL.createObjectURL = () => `blob:test/${(minted += 1)}`;
    try {
      const files: Record<string, string> = {
        [`${ENTRY}|./c/a`]: 'import {t} from "./types"; export const a=t;',
        [`${ENTRY}|./c/lib/b`]: 'import {t} from "./types"; export const b=t;',
        [".dsh/ui4a/canvases/c/a.ts|./types"]: "export const t=1;",
        [".dsh/ui4a/canvases/c/lib/b.ts|./types"]: "export const t=2;",
      };
      const seen: string[] = [];
      const urls: string[] = [];
      const compiled = new Map<string, string>();
      await inlineSubPages(
        'import {a} from "./c/a"; import {b} from "./c/lib/b"; export default a+b;',
        ENTRY,
        async (specifier, from) => {
          const source = files[`${from}|${specifier}`];
          if (source === undefined) return null;
          // Resolve the way the contract does: relative to the importer's directory.
          const dir = from === ENTRY ? ".dsh/ui4a/canvases" : from.split("/").slice(0, -1).join("/");
          const filename = `${dir}/${specifier.replace(/^\.\//, "")}.ts`;
          seen.push(filename);
          return { source, filename };
        },
        async (filename, source) => {
          compiled.set(filename, source);
          return source;
        },
        urls,
      );
      // Four distinct files, not two: the two `./types` are different targets.
      expect(new Set(seen).size).toBe(4);
      expect(urls).toHaveLength(4);
      // And each importer must point at ITS OWN target: the two `./types` are different
      // files, so the two rewritten sources must name different blobs. A specifier-keyed
      // map hands both importers whichever blob was minted first, and these become equal.
      const urlIn = (source: string | undefined) => source?.match(/blob:test\/\d+/)?.[0];
      const aTarget = urlIn(compiled.get(".dsh/ui4a/canvases/c/a.ts"));
      const bTarget = urlIn(compiled.get(".dsh/ui4a/canvases/c/lib/b.ts"));
      expect(aTarget).toBeDefined();
      expect(bTarget).toBeDefined();
      expect(aTarget).not.toBe(bTarget);
    } finally {
      URL.createObjectURL = original;
    }
  });

  test("a missing child keeps its specifier", async () => {
    const { code, urls } = await run({}, 'import {a} from "./t/a"; export default a;');
    expect(urls).toHaveLength(0);
    expect(code).toContain("./t/a");
  });
});

/**
 * Only an import position is rewritten.
 *
 * The rewrite used `replaceAll` on the bare specifier, so `const label = "./board"` beside
 * `import { Board } from "./board"` became a blob URL in the card's own text — the reader sees
 * `blob:null/8f3a…` where a filename belonged. No corpus card writes that today, which is why
 * it survived; the regex that finds the imports already distinguishes the two positions.
 */
test("a specifier that is also a string literal is left alone", async () => {
  const code = `import { Board } from "./board";\nconst label = "./board";\nexport default () => <Board name={label} />;`;
  const out = await inlineSubPages(
    code,
    "entry.tsx",
    async (specifier) => (specifier === "./board" ? { source: "export const Board = () => null;", filename: "board.tsx" } : null),
    async (_filename, source) => source,
    [],
  );
  expect(out).toContain('const label = "./board"');
  expect(out).not.toContain('from "./board"');
});
