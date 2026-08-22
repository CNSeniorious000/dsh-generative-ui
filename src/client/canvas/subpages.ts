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
/** Matches the specifier of a static import or re-export; the capture is the specifier itself. */
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*)["'](\.[^"']*)["']/g;

/**
 * @param read fetches one child by its specifier, returning its source and the real filename
 * it was found under — the compiler picks its syntax from the extension, and a specifier is
 * written without one, so passing the specifier makes a `.ts` file fail to parse.
 * @param compile turns one child's TSX into JS. Children go through the same compiler as the
 * card, so a sub-page may be TSX and may itself import a sibling.
 * @param urls collects every blob created, so the caller can revoke them with the surface.
 */
export async function inlineSubPages(
  code: string,
  read: (specifier: string) => Promise<{ source: string; filename: string } | null>,
  compile: (filename: string, source: string) => Promise<string>,
  urls: string[],
): Promise<string> {
  // Collected breadth-first, then compiled in one pass. Resolving a child's own imports
  // *during* its fetch deadlocks on a cycle — a imports b imports a, and each awaits the
  // other's URL forever. Measured: it hung. Reading every reachable child first, and only
  // then handing out URLs, has no such wait.
  const sources = new Map<string, { source: string; filename: string }>();
  const missing = new Set<string>();

  const specifiersIn = (source: string) => new Set([...source.matchAll(SPECIFIER)].map((match) => match[2]));

  let frontier = [...specifiersIn(code)];
  while (frontier.length > 0) {
    const wanted = frontier.filter((specifier) => !sources.has(specifier) && !missing.has(specifier));
    const bodies = await Promise.all(wanted.map(async (specifier) => [specifier, await read(specifier)] as const));
    frontier = [];
    for (const [specifier, found] of bodies) {
      if (found === null) {
        missing.add(specifier);
        continue;
      }
      sources.set(specifier, found);
      frontier.push(...specifiersIn(found.source));
    }
  }

  // A blob's contents are fixed at creation, so a child can only be minted once every sibling
  // it imports already has a URL. Repeat until nothing moves: a cycle never becomes mintable
  // and keeps its original specifiers, failing exactly as it does today rather than hanging.
  const urlFor = new Map<string, string>();
  for (const specifier of sources.keys()) urlFor.set(specifier, "");

  const rewrite = (source: string) => {
    let out = source;
    for (const [specifier, url] of urlFor) {
      if (url === "") continue;
      out = out.replaceAll(`"${specifier}"`, JSON.stringify(url)).replaceAll(`'${specifier}'`, JSON.stringify(url));
    }
    return out;
  };

  // Children whose imports are all already minted can be minted next; repeat until nothing
  // moves. A cycle never becomes mintable, and its members keep their original specifiers —
  // failing exactly as they do today rather than hanging.
  for (let progress = true; progress; ) {
    progress = false;
    // One round at a time: every child whose siblings are already minted, compiled together.
    const ready = [...sources].filter(([specifier, found]) =>
      urlFor.get(specifier) === "" && [...specifiersIn(found.source)].filter((dep) => sources.has(dep)).every((dep) => urlFor.get(dep) !== ""));
    const built = await Promise.all(ready.map(async ([specifier, found]) => [specifier, await compile(found.filename, rewrite(found.source))] as const));
    for (const [specifier, compiled] of built) {
      const url = URL.createObjectURL(new Blob([compiled], { type: "text/javascript" }));
      urlFor.set(specifier, url);
      urls.push(url);
      progress = true;
    }
  }

  return rewrite(code);
}
