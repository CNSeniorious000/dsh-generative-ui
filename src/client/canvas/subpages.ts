/**
 * Rewrites a canvas's relative imports into blob URLs, before the source is compiled.
 *
 * `src/prompt.ts` tells the model that a canvas's sub-pages live in `<id>/` and are imported
 * with relative paths, and the model does exactly that. But a card is imported as a blob URL,
 * and `blob:` is not a hierarchical scheme — the browser rejects `./tarot/deck` with
 * "Invalid relative url or base scheme isn't hierarchical" before any import map is consulted,
 * so `setImportMap` cannot help. Measured: an import map keyed on the relative specifier fails
 * identically, because resolution against the importer's URL happens first.
 *
 * Replacing the specifier with the child's own blob URL removes the question: an absolute URL
 * has no base to resolve against. Children may import their siblings, which works for the same
 * reason once they too have been rewritten.
 */
/**
 * Matches the specifier of a static import or re-export; the second capture is the specifier.
 *
 * NOT global, and that is load-bearing. It was `/g`, shared by all three call sites, and `.test`
 * on a global regex leaves `lastIndex` past the match it found — so `importsSibling` returning
 * TRUE made the very next `matchAll` on the same string return ZERO. That is the order
 * `CanvasPanel` calls them in: ask whether there are sibling imports, then go resolve them. The
 * panel found none to resolve and the card rendered without its sub-pages.
 *
 * `matchAll` requires `/g`, so it gets its own copy; the shared one stays sticky-free and no
 * caller has to remember to reset anything.
 */
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*)["'](\.[^"']*)["']/;
const SPECIFIER_ALL = new RegExp(SPECIFIER, "g");

/**
 * Whether the card imports a sibling at all — the cheap question `CanvasPanel` asks before
 * paying for a resolve pass. It had its own copy of the regex, identical but for the `g` flag;
 * a widening applied to one and not the other means the panel never calls `inlineSubPages` and
 * the card silently renders without its sub-pages. Sharing one pattern fixed that and introduced
 * the `lastIndex` bug above — hence two derived regexes rather than two literals.
 */
export const importsSibling = (code: string) => SPECIFIER.test(code);

/**
 * @param read fetches one child by its specifier, returning its source and the real filename
 * it was found under — the compiler picks its syntax from the extension, and a specifier is
 * written without one, so passing the specifier makes a `.ts` file fail to parse.
 * @param compile turns one child's TSX into JS. Children go through the same compiler as the
 * card, so a sub-page may be TSX and may itself import a sibling.
 * @param urls collects every blob created, so the caller can revoke them with the surface.
 */
export async function inlineSubPages(code: string, entry: string, read: (specifier: string, from: string) => Promise<{ source: string; filename: string } | null>, compile: (filename: string, source: string) => Promise<string>, urls: string[]): Promise<string> {
  // Keyed by the RESOLVED filename, never by the specifier: `./types` written in two different
  // child files is two different targets, and a specifier-keyed map silently serves the first
  // one to both. Measured on a real split — the model gives every child a sibling import.
  const sources = new Map<string, { source: string; filename: string; specifiers: Map<string, string> }>();
  const missing = new Set<string>();

  const specifiersIn = (source: string) => new Set([...source.matchAll(SPECIFIER_ALL)].map((match) => match[2]));

  // Collected breadth-first, then compiled in one pass. Resolving a child's own imports
  // *during* its fetch deadlocks on a cycle — a imports b imports a, and each awaits the
  // other's URL forever. Measured: it hung. Reading every reachable child first, and only
  // then handing out URLs, has no such wait.
  let frontier: { specifier: string; from: string }[] = [...specifiersIn(code)].map((specifier) => ({ specifier, from: entry }));
  const entryTargets = new Map<string, string>();
  while (frontier.length > 0) {
    const bodies = await Promise.all(frontier.map(async (want) => [want, await read(want.specifier, want.from)] as const));
    const next: { specifier: string; from: string }[] = [];
    for (const [want, found] of bodies) {
      const targets = want.from === entry ? entryTargets : sources.get(want.from)?.specifiers;
      if (found === null) {
        missing.add(want.specifier);
        continue;
      }
      targets?.set(want.specifier, found.filename);
      if (sources.has(found.filename)) continue;
      sources.set(found.filename, { ...found, specifiers: new Map() });
      for (const specifier of specifiersIn(found.source)) next.push({ specifier, from: found.filename });
    }
    frontier = next;
  }

  // A blob's contents are fixed at creation, so a child can only be minted once every sibling
  // it imports already has a URL. Repeat until nothing moves: a cycle never becomes mintable
  // and keeps its original specifiers, failing exactly as it does today rather than hanging.
  const urlFor = new Map<string, string>();
  for (const filename of sources.keys()) urlFor.set(filename, "");

  // Rewrites through `SPECIFIER_ALL`, not `replaceAll`, so only an actual import position moves.
  // A bare `replaceAll("./board")` also rewrites the string in `const label = "./board"` — the
  // card then renders a blob URL as its label, or passes one where a path was meant. No corpus
  // card does this today; the regex that finds the imports already knows the difference, so
  // there is no reason to throw that away when putting them back.
  const rewrite = (source: string, specifiers: Map<string, string>) =>
    source.replace(SPECIFIER_ALL, (whole, lead: string, specifier: string) => {
      const url = urlFor.get(specifiers.get(specifier) ?? "");
      return url === undefined || url === "" ? whole : `${lead}${JSON.stringify(url)}`;
    });

  for (let progress = true; progress;) {
    progress = false;
    const ready = [...sources].filter(([filename, found]) => urlFor.get(filename) === "" && [...found.specifiers.values()].every((dep) => urlFor.get(dep) !== ""));
    const built = await Promise.all(ready.map(async ([filename, found]) => [filename, await compile(filename, rewrite(found.source, found.specifiers))] as const));
    for (const [filename, compiled] of built) {
      const url = URL.createObjectURL(new Blob([compiled], { type: "text/javascript" }));
      urlFor.set(filename, url);
      urls.push(url);
      progress = true;
    }
  }

  return rewrite(code, entryTargets);
}
