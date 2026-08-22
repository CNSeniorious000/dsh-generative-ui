# dsh-generative-ui

**This CLAUDE.md is the design doc.** Change it first, then the code — where they disagree, this file wins and the drift is a bug.

## In one sentence

A Web plugin for the DeepSeek Harness (dsh): the model writes TSX into the workspace, the Web half **compiles it as it streams and renders it with state preserved** into live UI — inline cards in the chat stream, canvas views in the side panel.

The rendering stack is `partial-tsx` + `partial-react` + `@esm.sh/tsx`, the same as `../ui4a-playground`. **That one owns its host; this one is a guest in someone else's** — nearly all the difference lives in §2.

## 0. Toolchain

**This package uses bun** (`bun install` / `bun run build`). dsh's pnpm only governs the profile directory — `dsh plugin --profile web add link:<path>` is dsh forwarding to pnpm, and it does not care how we install our own deps as long as `lib/*.js` exists.

`package.json`'s `prepare: bun scripts/build.ts` cannot be removed: installing from git gets you source with no `lib/`, and the plugin then silently fails to load.

## 1. Layers

| Layer | Where | Job |
| --- | --- | --- |
| Node half | `src/index.ts` | Host-only capabilities: wasm asset route, fs watching, session events |
| Browser half | `src/client/` | Slot registration, conversation node, render runtime |
| Render runtime | `src/client/runtime/` | Our own compiler + import-map + host-bridge |

One npm package, two exports (`.` and `./client`), declared through `package.json`'s `dsh` field. **Do not split the package** — dsh's model is one package with two halves.

## 2. What the host gives you and what it doesn't

Everything here was **measured**, not read out of a doc. Read it before changing anything; it saves a whole round of re-deriving.

### 2.1 The shared platform module table shrank to 7 entries in rc.8

`react` / `react/jsx-runtime` / `react-dom` / `react-dom/client` / `@deepseek-ai/cordis` / `dsh-client-ui-slots` / `dsh-client-ui-primitives`

rc.7 also had `dsh-client-web-react` / `dsh-client-ui-attachment` / `dsh-client-schema-form`; rc.8 dropped them (diff `PLATFORM_MODULES` in `@deepseek-ai/dsh-client-web`'s `lib/index.js` across the two versions). **This table shrinks**, so re-check it on every dsh upgrade: listed = resolved at runtime via `require()` to the host's singleton; not listed = bundled into our own output; **listed but absent from the host = the `require()` fails and the whole client dies**.

**Re-checking it is now one command: `./scripts/platform-table.sh`** — verified 2026-08-23, the host still exposes exactly the 7 entries `PLATFORM_MODULES` lists. The table is **not in any installed package** (70 `@deepseek-ai` packages here, not one contains the string `"react/jsx-runtime"`, and `dsh-client-web` is not among them); it is compiled into the shell's own frontend bundle, so the script serves the app, fetches `/assets/index-*.js`, and diffs. It exits 1 on a mismatch and **2 when the probe itself cannot read the bundle** — the first version reported "matches" with both sides empty because `rg` was not on the script's PATH.

It lives in `scripts/build.ts` as `PLATFORM_MODULES` (`scripts/smoke.ts`'s `PLATFORM` mirrors it — change one and you must change both, or smoke stops catching it).

**Neither `scheduler` nor `react-dom/server` is in the table.** The latter is required for preflight, so it has to be inlined, and **pinned to 18** to match the React bridged in.

### 2.2 React is 18.3.1, not 19

Measured on the host: `React 18.3.1` — **re-confirmed 2026-08-23** by fetching the shell's own `/assets/index-*.js` and grepping it: exactly one React version string (`"18.3.1"`), and the React 19-only APIs are all absent from the bundle (`useActionState`, `useOptimistic`, `useEffectEvent`, `use(` → 0 each) while the 18 APIs this plugin leans on are present (`useSyncExternalStore` ×4, `forwardRef`, `renderToString`). Repeat with `./scripts/platform-table.sh`'s fetch step if a dsh upgrade ever makes this look doubtful. Generated code reaches the host's **same** React instance through `host-bridge` — a second copy makes hooks fail silently.

Consequences:

- When writing components in this project, **React 19-only APIs are all off-limits** (`use()` / `useActionState` / `useOptimistic` / `cache` / `useEffectEvent` / ref-as-prop). Skip the whole `react19-*` section of `vercel-composition-patterns` — we still need `forwardRef`.
- `partial-react`'s peer is now `^18.3.0 || ^19.0.0` (widened in 0.0.5; it used to be `^19.0.0` only), and at runtime it only touches APIs 18 already has (measured — see MindLab-Research/macaron-genui-demo#1715). There used to be one spot in `runtime.ts:425` where `Promise<ReactNode>` wasn't assignable to 18's `ReactNode`; upstream has since fixed it with a cast.

  Note that **`skipLibCheck` does nothing here** — that option only skips `.d.ts`, and these two packages ship `.ts` source, so a value import really does compile them.

  This is why the packages' own source used to fail `tsc`; **`partial-react@0.0.6` fixed it** (see §2.6), so `typecheck` is plain `tsc --noEmit` again and there is nothing left to filter.
- `partial-tsx` / `partial-react` use `toSorted` / `findLast` / `toReversed`, so `lib` must be ≥ `ES2023`.

### 2.3 Non-JS assets only reach the browser through your own route

The `/plugins` route **hardcodes `/client.js` and `/client.js.map`**; everything else 404s. The static handler **used to** answer unmatched paths with index.html + 200 (not 404), so dropping wasm into its dist "looked like it worked" right up until `instantiateStreaming` reported a baffling magic-word error. **Re-measured 2026-08-23: that is fixed** — `/some/spa/route`, `/assets/missing.js`, `/missing.wasm` and an unmatched path under our own prefix all return **404 with a zero-length body**. The route we serve ourselves is unchanged and still correct: `200 · application/wasm · cache-control: immutable`.

The fix is a route from the Node half — `ctx.webServer.register({ kind: 'prefix', path: '/dsh-generative-ui/assets', ... })` — with the browser half hardcoding that URL. Measured: `200 · application/wasm · 2,610,857 B`.

Two constraints: the path **must be namespaced by package name** (a duplicate `(kind, path)` throws, and throwing during apply means the whole plugin silently fails to load); and **the Electron shape has no webServer routing**, so desktop needs another answer (or falls back to base64 inlining, +3.3MB).

`import.meta` doesn't exist in the CJS output, so upstream's bundler-agnostic `import.meta.resolve(...)` trick is unavailable — the URL has to be a hardcoded constant.

### 2.4 Slots you may touch and slots you may not

| Slot | kind | Use |
| --- | --- | --- |
| `conversation.chat.node` | keyed | **Inline cards.** Unregistered kinds degrade gracefully into a JsonBlock |
| `conversation.view` | list | **Canvas view tab**, alongside Conversation / Trace |
| `shell.overlay` | list | Frame-wide overlay, available if we need it |

**`details` (the right-hand column) is off-limits — and as of 2026-08-23 the mechanism below can no longer be found.** Checked against rc.8: the shell bundle contains exactly one `kind:"single"` and it belongs to the `root` slot (`declaredBy: "(built-in)"`), while `conversation.details` appears **nowhere in any implementation or in the shell bundle** — only in two READMEs of `dsh-client-ui-conversation`, whose text describes tool presentation dispatching through `conversation.chat.node`, the slot we already use. So the specific chain recorded here cannot be reproduced. Kept as a prohibition anyway: it describes something we deliberately do not do, the priority mechanic that makes a `single` slot evictable is unchanged, and nothing was gained by registering there. **Treat the reasoning below as history, not as current fact.** It's `kind: 'single'` and currently held by ui-conversation's `DetailsPanel`. A dynamically loaded package gets a ctx facade that overrides priority (decrementing into the negatives per install), so **we necessarily beat the shipped 0** — registering silently evicts DetailsPanel, taking the `conversation.details.tool` sub-slot it declares with it, which **breaks tool-call inspection app-wide**. There is no handoff API.

Registration must be wrapped in `ctx.slots.inject(name, () => ...)`: these slots are declared by ui-conversation at runtime, and registering early throws `slot "..." is not declared`.

### 2.5 CSS has to mark itself

The loader's `claimStyles(id)` runs `document.querySelectorAll('style:not([data-plugin])')` and **claims every match** for whichever plugin is currently materializing. So every `<style>` this plugin appends must carry `data-plugin="dsh-generative-ui"` itself, or HMR and unload will tear each other's styles out. `injectStyles` in `canvas/mount.ts` is the one place that appends one.

**There is no CSS framework here, and that is a deliberate split from the playground.** The panel is hand-written CSS in `panel.css` (compiled into `panel-css.ts` at build time) over the host's `--dsw-alias-*` tokens, and §3.7's prompt tells the model to write inline `style` from those same tokens. Measured across 16 canvases this prompt produced: **0 atomic/utility classes** (Tailwind-shaped ones — the model does write semantic class names like `wrap`/`score-box` alongside its own `<style>` block, 37 of them across the three cards in `test/cards`, which is not what an atomic engine would generate) **and 592 inline `style` objects** — so there is nothing for an atomic-CSS engine to generate, and nothing needing class-name scoping.

`ui4a-playground` runs a real UnoCSS generator in the browser (`ui4a-playground/src/runtime/uno.ts`) because its prompt teaches Tailwind v4 syntax, and the model's classes therefore do not exist in any build-time stylesheet. Worth reading before dismissing it — it is **scoped**, not the global runtime §5 warns about: passing a string as `important` makes UnoCSS treat it as a selector prefix, so every rule comes out `.ui4a-root .hidden{…}`. That scoping is not optional, and their comment records why: the runtime sheet is appended last, so an unscoped `hidden` from generated code overrode the app's own `@md:flex` and made a sidebar vanish.

**What we do need from that half is responsiveness**, and it is not free either way. The same block renders in a chat column and in a panel the reader drags between 320 and 720px, so the viewport says nothing — and 16 of 16 canvases had no breakpoint at all. The smaller answer, given that our model already writes plain CSS: give the mount node `container-type: inline-size` (`GenUISurface`) and teach `@container` in the prompt. Measured: without `container-type` the guarded declaration is simply inert, which reads as the model writing something bad rather than as a missing container.

If an atomic engine is ever added anyway, the trap waiting is that the host themes by ancestor (`body[data-ds-dark-theme]`), so a scoping rewrite has to **hoist the theme selector** — `.dark .foo` → `.dark .genui-root .foo` — and prefixing without hoisting breaks the moment the theme flips.

### 2.6 Four bundling settings you cannot skip

See `scripts/build.ts`. All four let the plugin **build fine and blow up at runtime**, with errors far from their cause, which is why `bun run smoke` catches every one of them without opening a browser:

- **`external` lists only the platform table, and mind that bun matches sub-paths too.** Verified 2026-08-23 by removing `bundleReactDomServer` from `plugins:` and rebuilding: `require("react-dom/server")` appears in `lib/client.js` and `renderToString` drops from 4 occurrences (the inlined implementation) to 1 (the call site alone). Put the plugin back and only the two platform modules are required. The one trap in this file that held exactly as written. Listing `react-dom` also externalizes `react-dom/server` — which is **not** in the platform table, so materialization throws `missed the module table`. A plugin that resolves it to an absolute path sidesteps specifier matching. (bun defaults to `--packages bundle`, so unlike tsdown there's no need for a reverse `noExternal`.)
- **The `browser` resolution condition must be explicit — and today it changes nothing, which is not a reason to drop it.** Measured 2026-08-23: removing `conditions: ["browser"]` and rebuilding produces a **byte-identical** `lib/client.js` (same md5, 295365 bytes, no `require("stream"/"url"/"util")`). The reason is the sibling fix above — `bundleReactDomServer` resolves straight to `server.browser.js` by absolute path, so the one dependency this condition was written for never consults exports conditions at all. It stays as a guard for the next dependency that ships a `browser` export: without it that one silently gets the Node build. `react-dom`'s `exports["./server"]` only points at `server.browser.js` under that condition; otherwise you get the Node build and drag `require("stream"/"url"/"util")` into a browser bundle.
- **`define` away `import.meta.url`.** `@esm.sh/tsx`'s entry reads it. We always pass the wasm path explicitly, so a constant is enough. Measured 2026-08-23 by removing the `define` block and rebuilding, and the consequences are worse than "CJS has no `import.meta`" suggests: the bundle goes **295365 → 616551 bytes**, bun resolves the specifier to **`file:///private/tmp/recover/node…` — the build machine's absolute path, baked into a file shipped to other machines** — and it drags in `require("react/jsx-dev-runtime")`, which is not in the platform table and therefore dies at materialization. The `import.meta` count stays 0 either way, so grepping for it is not how you check this.

**The upstream compiler no longer needs patching around** — `partial-react@0.0.6`
(2026-08-22, from macaron-genui-demo#1718) dropped the `import.meta.resolve` and `typeof Bun` its
`compiler.ts` used to carry. Three things came out together on release day: the build plugin that
swapped in a shim, `src/client/runtime/compiler-shim.ts` itself, and `scripts/typecheck.mjs`,
whose only job was filtering upstream's two type errors — `typecheck` is now plain `tsc --noEmit`.

Verified rather than assumed: `bun run check` green with no `[upstream, ignored]` line, bare
`tsc` exits 0, `import.meta` / `Bun.` / `import.meta.resolve` all read **0** in `lib/client.js`,
and all three cards in `test/cards` compile and paint in a real browser — that last one being what
the shim existed to protect. `lib/client.js` also lost 70KB, the shim's duplicate compiler.

### 2.7 Two traps in the type system

- `SlotMap` is stitched together from each package's `declare module`, and **the merge only happens for packages some file actually imports**. Measured 2026-08-23 by asking the type system directly: drop `import type {} from "@deepseek-ai/dsh-client-ui-layout/client"` (line 8 of `src/client/index.ts`) and `"conversation" extends keyof SlotMap` becomes **false** — the keys simply vanish. Note what does *not* happen: `tsc` stays green, because our own code never indexes `SlotMap` by those names. So the failure is silent until someone writes a slot registration that needs one. The entry used to claim TS2344 here; removing the *package* raises TS2307 (that same import names it), and removing only the import raises nothing at all. **A type-level trap has to be probed at the type level** — `tsc` passing says nothing about a merge that did not occur.
- `allowImportingTsExtensions` must be on, because the source imports across files with `.ts` / `.tsx` suffixes.

## 3. The ui4a contract

Inherited from `../ui4a-playground/src/fs/contract.ts`; **the only difference is that the files are real** (not a browser VFS):

```
<workspace>/.dsh/ui4a/
├── canvases/<id>.ui4a.tsx   # → a canvas view, one mini app
└── canvases/<id>/*.tsx      # → that mini app's sub-tree
```

**Sub-pages are inlined before compiling, because `blob:` cannot host a relative import.**
`src/prompt.ts` tells the model to keep a canvas's components in `<id>/` and import them with
relative paths, and the model does — `.dsh/ui4a/canvases/tarot.ui4a.tsx` ships a 26KB
`tarot/deck.ts`. That card was blank: a card is imported as a blob URL, and the browser rejects
`./tarot/deck` with *"Invalid relative url or base scheme isn't hierarchical"* before any import
map is consulted. Measured, so `setImportMap` is not the fix: **an import map keyed on the
relative specifier fails identically**, because resolution against the importer's URL happens
first. What works is rewriting the specifier to the child's own blob URL — an absolute URL has
no base to resolve against — and nesting works for the same reason. `canvas/subpages.ts` does
that, `serveCanvas`'s `child` branch reads the file through `canvasChildPath`, and the route
returns the resolved filename in `x-ui4a-filename` because **a specifier carries no extension
and the compiler picks its syntax from one** — passing `./tarot/deck` to it makes a `.ts` file
fail to parse.

**`.dsh/` is the harness's own project convention, not ours** — `dsh-skill-filesystem` reads
`join(projectRoot, ".dsh/skills")` and labels that source `project-dsh`. Sitting beside it
keeps a plain `ls` of the user's repo clean and puts these files where anyone would look for
something dsh wrote. `ui4a` goes *beneath* it because that names the format: this is a dsh
plugin writing ui4a files, not a ui4a project with a dsh corner.

`src/contract.ts` is the single place the contract is parsed. **Anything that needs to decide "is this a canvas file" must call it** — no ad-hoc regexes elsewhere.

The model writes these files with dsh's own `str_replace_editor` / `write` — **we define no new tools**. Diagnostics (telling the model it wrote something broken) would go through a `tools/post-execute` waterfall interceptor; it's purely additive and out of scope for v1.

## 3.5 How the inline fence works

Same protocol as the playground: **four backticks + `ui4a/tsx`**, module `export default`s a props-less component. Four isn't fussiness — generated TSX routinely contains triple-backtick strings, which would close a triple-backtick fence early.

Two separate concerns:

- **Teaching the model** splits in two, along the line of "what you pay for every turn."
  - `src/prompt.ts` is injected **permanently** via `ctx.systemPrompt.section()`: triggers, fence syntax, canvas paths, palette. Nothing else.
  - `src/skill.ts` is loaded **on demand** via `ctx.skills.register()`: the judgement calls (should there be UI at all, inline or canvas), framing rules, layout constraints. `dsh-base`'s bundle ships the skill tooling by default (the installed package is `@deepseek-ai/dsh-skill`; this used to cite a `dsh-tool-skill` that does not exist under that name), so a runtime-registered skill lands in the model's `<available_skills>` catalog and the body is only fetched when it calls the `skill` tool.
  - Note the catalog carries **only `name` and `description`** (neither `whenToUse` nor the body). The description is therefore the sole routing signal — write triggers into it, not a summary of the contents.
  - Register it as `modelInvocable: true, userInvocable: false`: this is a spec written for the model, and exposing it as a user `/` command would just dump a long guide at the user.
  - Under the PTC profile every tool is called from inside `run_code`, so don't write a concrete call form like `` call `skill({name})` `` into the prompt (the model tries it directly once, gets `unknown tool`, then recovers). Just say "load the X skill first."
- **Rendering** is `src/client/runtime/inline-fence.ts` claiming code blocks in the DOM. dsh has **no** extension point that dispatches on markdown language (`CodeBlock`'s `lang` is a hint; unknown languages degrade to plain), so this is the only way. The handle is the hardcoded `md-code-block` class on the `CodeBlock` wrapper, plus the info string typed out character by character in the banner.

Four details you have to get right:

- **Match on content, not on the info string.** The host's markdown parser truncates at the first non-identifier character, so the `ui4a/tsx` the model correctly wrote arrives in the DOM as `ui4a`; worse, the info string doesn't appear at all until the fence closes, so matching on it means never claiming anything until the stream ends. `matchSegment` therefore prefix-matches the rendered text against segments from the snapshot — code comes from the conversation snapshot, position comes from the DOM.
- **Release the claim when the block gets reused for something else.** React reuses `.md-code-block` nodes by position, so one re-render can drop unrelated content into the node we hid. At that point `rendered` is no longer a prefix of `claim.code` — without releasing, a stale card stays on screen with the real code block `display: none`'d behind it, and nothing short of a refresh recovers. The test is the prefix relation, not merely "no segment found" (history scrolling out of the load window also finds nothing, and there the card must stay).
- **Hide the original block, don't remove it.** That node belongs to the host's React tree, and detaching a node React still holds gets you `NotFoundError` on the next commit.
- **Hide it when the card paints, not when the claim is made.** Compiling is not the same as having something to look at: mid-stream the default export usually exists while the body is still an empty shell, so hiding at claim time leaves a blank gap that fills in with a pop — with the source sitting right there the whole time. The signal is non-empty text or an `svg` in the mount node (icons and charts carry no text); a wrapper div with layout classes is not. Checked at most once per frame and torn down the moment it fires, because a streaming card mutates thousands of times and `textContent` walks the whole subtree. A card that never paints therefore keeps showing its source, which is the right fallback rather than a bug.
- **Coalesce the MutationObserver into one frame.** A streaming reply fires dozens of mutations per second, and one sweep per mutation is the textbook way to burn the main thread.

## 3.6 How the canvas panel works

**Classify by argument shape, not by tool name.** `collect.ts` asks "does this call carry a canvas path" and "does it bring a whole file (`CONTENT_KEYS`), a patch (`PATCH_KEYS`), or neither." Enumerating tool names means the canvas silently dies the day the host renames one or adds another file tool. The easiest of the three to miss is the last: **reading a canvas must not touch its state** — `read` used to mark it dirty and conjure a panel for a canvas this session never wrote, so asking "what's in this file" popped the sidebar open by itself.

**The data source is tool calls, not a new session event.** The model writes `ui4a/canvases/<id>.ui4a.tsx` with the host's own `write`, and the client reads `root.call.argsRaw` off the snapshot's `tool-call` nodes. No `SessionEventMap` extension, no touching the persistence contract, zero involvement from the Node half.

**But the canvas gets no streaming under the web profile's default PTC mode** (measured 2026-08-20 with a probe inside `calls()`, 5000+ samples): under PTC every tool is called from `run_code`, and the host only exposes `write` as a subCall once `run_code` has **finished**, so the very first `write` frame we see is already `settled: true` with all 14388 characters. The outer `run_code`'s own `argsRaw` is just 165 characters (the calling code, not the file body). The panel therefore appears whole the moment the write lands — 490 samples on a real machine, **0** state changes. **Not re-verified 2026-08-23**, and worth saying why: the claim is about a code path that only exists inside a live PTC session, so it needs a canvas being written while something samples the store. `test/collect.test.ts` covers both branches of the logic (a settled write is not streaming, an unsettled one is), which is a different claim — that the *unsettled* branch is unreachable under PTC cannot be shown from a transcript after the fact. **Corrected an hour later:** the sessions do survive — 183 under `$DSH_HOME/sessions/`, the canvas-splitting run among them, because only the *working directory* is a `mktemp` and the session directory merely encodes its name. The real obstacle is more final: **`settled` is never persisted.** `collect.ts` derives it from a live snapshot's shape (`argsRaw` inline means running, wrapped in `call` means settled), so the 73 frames carrying a canvas path in that session contain no such field. This needs a probe in a live session, not an archive. The `streaming: !call.settled` code is itself correct and would work off-PTC where `write` is a top-level call; the default path just never reaches it. Inline is unaffected (see §3.5).

`edit`-class tools are the exception: their arguments are a patch, not the full text. Those calls only mark the canvas stale (with an incrementing version as the cache key), and the truth is read back from the file through the Node half's `/dsh-generative-ui/canvas` route. The file is the one source that stays correct under every way of changing it, including edits made outside the agent.

Three traps:

- **A `tool-call` node's data is `{root: {...}}`**, not the assistant's `blocks`.
- **Tool arguments carry absolute paths**, so contract matching looks for `ui4a/canvases/` as a path suffix and must not anchor at the start.
- **Re-registering an unchanged namespace must keep its blob URL.** The document import map
  is installed once and names those blobs for the tab's life, so revoking one leaves every
  esm.sh package resolving `react` to a dead URL. ESM fails that by killing the whole module
  graph: a blank card, nothing in the console, and smoke green throughout. It cost a bisect
  to find, because the symptom is identical to "the model wrote something broken". The guard
  is an identity check in `registerModules` — only a genuine hot-swap invalidates.
- **The transcript's file links go to the OS, not to us.** `workspaces.openPath` is what both
  the inline path links and the 产物 chips call, so clicking a canvas the model just wrote
  opened it in an editor rather than in the panel beside it. We wrap that method: a path the
  contract recognises shows the panel, everything else forwards untouched. Wrapping someone
  else's method is a bet on its shape, so the wrapper checks for it and no-ops when absent —
  losing that bet during registration would take the whole plugin down.
- **Closing a canvas must leave a way back, and the transcript is not enough of one.** Dismissal only hides, and a canvas outlives the session that wrote it — so a panel fed purely by the current transcript strands both the one just closed and every one written yesterday. `CanvasLauncher` sits where the panel's edge was and offers the whole workspace: the canvas route lists the directory when given no `id` (same cwd allowlist), and a canvas opened that way has no tool call behind it, so its body is read off disk once. The same picker sits in the panel header, so switching to another canvas does not require closing first. Note the repaint signature has to carry that offerable list: closing the last canvas changes nothing about the visible one, so a signature built from the visible canvases alone never repaints and the launcher never appears.
- **The panel cannot be inserted into AppFrame as a flex child.** The host's column widths exactly fill the viewport, so an inserted column is always pushed offscreen — present in the DOM, correctly sized, and invisible. The answer is `position: fixed` against the right edge plus an equal `padding-right` on the frame.

## 3.65 `$dsh/*`: what generated code can call back into

The playground gives generated code four capability modules under `$ui4a/`. Here the prefix
is **`$dsh/`**: what these expose is the harness — its conversation, its model, its
filesystem — and none of it belongs to the ui4a rendering contract that the fence language
and the canvas paths define. A card that imports one only runs inside dsh. `contract.ts`
owns the prefix; nothing else should spell it out.

| Module | Here | Why |
| --- | --- | --- |
| `$dsh/chat` | **implemented** | `ctx.conversation.send(text)` is a public client service |
| `$dsh/fs` | **implemented** | Forwards to the host's `ctx.fs` carrying the session's `ctx.sandboxPolicy`. `readdir` gives `{name, type, size}` (the host had all three; we used to forward only the name, so a card could not draw a tree without probing) and `readBytes` exists because `readFile` UTF-8-decodes — a `.mid` or a wav read as text is silently corrupt |
| `$dsh/state` | **declined** | it would be a naming convention over `$dsh/fs`, which a card can already call directly; private UI state belongs in `localStorage` and the skill teaches that |
| `$dsh/ai` | **implemented** | not through a client gateway — there is none — but through a route on our Node half onto `ctx.llm.stream()`, on the session's own model selection, so the card never sees a key |
| `$dsh/exec` | **implemented**, ours | not in the playground's set under that name — its `bash` lives inside `$ui4a/fs`. Split out here because running a command is not reading a file, and because the two carry different risks. `ctx.shell` takes the same `sandboxPolicy` `$dsh/fs` resolves, so it opens no door the model's own bash tool has not |

The mechanism, ported from `ui4a-playground/src/runtime/bindings.ts`: the real implementation
is ordinary TypeScript in our bundle, registered under `$dsh/internal`, and each
`$dsh/<group>` is a few-line blob shim that imports it and re-exports that group's members.
The indirection exists because **a blob URL cannot carry a query string** — anything the
module needs to know about its caller has to be compiled into the body. The playground binds
per surface for that reason; we have one global host, so one shim set is enough.

**`conversation` is scope-addressed, and the scope is a fresh context.** Reading it off the
plugin's own context rejects with `requires a session scope — address one via
ctx.sessions.scope(id).conversation`. But `scope(id)` returns a context the *host* minted,
carrying its own inject set — so reading `conversation` off it throws the §4 access-time
error instead, and our outer declaration does not help. It takes both: resolve the scope,
then `inject(["conversation"], …)` on that context. Resolve per call, not once — the reader
switches sessions under us.

`conversation` also goes in a nested `ctx.inject`, not the static array — every static name is a
hard dependency (§4), and a profile without it would lose the whole plugin rather than one
capability.

**`$dsh/fs` inherits the session's access mode rather than defining its own.** Every call goes
through `ctx.fs` with the policy from `ctx.sandboxPolicy.resolve({ session })`, so a card may
do exactly what the composer says the session may do — under `Read Only` the write is refused
by the same fence that refuses the model's, with the same `FS_SANDBOX_DENIED`. Inventing a
narrower boundary here (I first proposed hard-coding `ui4a/`) would have meant a second policy
to keep in sync with the one the user can actually see and change.

Two things that boundary does *not* do, and should not be mistaken for holes: `workspace-write`
permits the platform temp area as well as the workspace (the same `writableRoots` set Seatbelt
grants, so bash and fs cannot drift), and the session must be addressed **by id** — several
sessions share one workspace, so resolving it from `cwd` silently runs the write under a
stranger's access mode. That was a real bug: read-only mode did not deny until the id was
threaded through.

Measured end to end (2026-08-21): asked for "a canvas that browses the .md files here, viewing
and editing them", the model imported all three of `readFile`/`writeFile`/`readdir`, wrapped
every call in try/catch, and surfaced a failed save as `保存失败: …` rather than silently. It
also wrote a `normalizeEntry` that accepts strings, `{path}`, `{file_path}`, `{fullPath}` and
`{name}` — a sign it could not tell from the prompt what `readdir` returns, which is worth
tightening if the shape ever matters.

**`send` is visible.** The playground's `sendMessage(content, visible = false)` can post a
turn the user never sees; `ctx.conversation.send` always writes their message into the
transcript. So a card's click has to read as something the user would have said — `我选 红`,
not a JSON payload.

## 3.7 Colors: put the tokens in the prompt

Generated UI doesn't know the host is dark by default and will paint white cards onto a dark app. The fix isn't runtime CSS rewriting — it's **listing the 14 `--dsw-alias-*` semantic tokens in the system prompt** and stating flatly that literal colors are never allowed. Measured: 106 token uses across the generated code, zero literal hex.

Data visualization is the stated exception — chart series need their own hues to be distinguishable — and **a thing's own identity is the same case**, which the wording did not originally cover. Measured 2026-08-23 on the three cards in `test/cards`: 12-22 token uses each, and the 24 literal hexes are all `TILE_COLORS` in 2048 (the game's own palette) and the black and white of piano keys. `metro` has zero. So the rule holds where it should: chrome takes tokens, the subject keeps its colours.

## 4. Known traps

- **Intermediate streaming frames are supposed to fail compilation**, `No default export found` most often — partial-react explicitly treats these as transient and keeps the last good frame. That semantics must not leak to callers; `GenUISurface` filters them out while streaming, or the UI flashes red on every character the model types.
- **`GenUIRenderer.create` is async**, so the renderer must live in state, not a ref: in a ref, the first render's effect sees `null` and bails, and since `code` no longer changes it never re-runs — a surface that mounted and stays blank forever.
- **`preserveStateOnUpdate` only suits streaming growth.** It decides reuse by hook signature, so a whole-file replacement whose hooks happen to match will silently discard the new content. The canvas therefore passes `preserveState={false}`; inline keeps the default.
- **Pick a signal that actually renders.** Verifying file readback, I wrote the marker into a TSX comment — comments never reach the UI, so the "it's broken" conclusion was entirely fake and cost a lot of time. Writing the marker into JSX text found the truth.
- **Preflight swaps the global `console.error` — and on 0.0.6 that is safe.** `partial-react/src/runtime.ts:211-224` replaces it with a collector and restores in `finally`. This was recorded here as a concurrency bug needing refcounting: with two cards, the inner `finally` would restore the *outer* collector and the host's console.error would be lost for good. **Measured on 2026-08-23: it cannot happen.** Each frame captures its own `previousConsoleError`, so nesting unwinds correctly, and interleaving would need a yield point between the swap and the `finally` — `canRenderComponent` has none (`renderToString` is synchronous, no `await` anywhere in 209-229, one call site at :404 inside a synchronous `renderComponent`). Driving two cards concurrently leaves `console.error === the real one`. Left as a note rather than deleted because it is exactly the shape that *would* break if upstream ever awaits inside that block — and because the entry as written would send the next reader to build refcounting nothing needs.
- **An `edit` to a canvas resets every `useState` in it.** `canvas/index.ts` re-reads the body off disk when a patch marks it stale, so `code` changes, `GenUISurface` delivers it, and `renderComponent` runs — which increments `renderRound`, and with `preserveState={false}` the boundary key is `boundary:${renderRound}`, so the whole tree unmounts. Ask the model to tweak one colour in a running timer and the timer resets. The `preserveState={false}` above is deliberate and the comment explains why, but it is a trade, not a free choice: `localStorage` survives an edit and `useState` does not, which is the real reason a canvas must persist through storage rather than memory. Traced through the code, not yet reproduced on a machine — the honest status.
- **HMR has no react-refresh**: React state inside the plugin is lost on every reload, and adding or removing a plugin requires restarting dsh.
- **wasm instances leak, and upstream offers no release.** `@esm.sh/tsx` exports only `transform`/`init`/`initSync` — no dispose, no free — so "release explicitly" is not an option; dropping the `initPromise` reference and waiting for GC is. **Each HMR round leaves another ~16MB instance behind**, dev-only — measured 2026-08-23 by compiling and instantiating the module four times in a fresh process: 15.9 → 48.5 → 64.6 → 80.1 → 88.5 MB rss, against a control that merely copies the same bytes four times and grows 11MB total. The figure here used to read ~2.5MB, which is the size of `tsx_bg.wasm` on disk (2610857 bytes) rather than the cost of an instance of it — **a file size standing in for a memory measurement, off by six times.** Both halves are wired now. The blob-URL half always was (`disposeRegistry` off a `ctx.effect` disposer); the wasm half **never had been** — `initPromise` was cleared only on failure, and `sharedCompiler` never at all, so every reload built a fresh instance while the previous stayed reachable through a module-level promise. `disposeCompiler` + `dropSharedCompiler` now hang off their own disposer. Found by auditing the trap that recorded it as an option and never took it.
- **One failed `import()` is a cold start, not a rule.** I once saw recharts fail to import inside the verification browser, recorded it here as "that browser cannot reach esm.sh", and nearly used the resulting blank card as evidence that streaming charts were broken. Re-measured later: three consecutive imports of the same URL all succeeded, ~270ms each, 101 exports. The first failure was the cold start §4's retry logic exists for. **Repeat a network measurement before writing it down** — and when a probe shows an empty card, `import()` the package by hand a few times before concluding anything about the code.
- **A dependency that fails to fetch looks exactly like broken code.** esm.sh cold-starts, and the symptom either way is a blank surface with nothing in the console. `GenUISurface` retries three times on backoff before letting the error through. `clear({ preserveVisualState: true })` is what makes it a real retry — the renderer skips an unchanged compile result, so re-delivering the same code without clearing is a no-op and the failed import is never re-attempted. Only retry a settled surface: while streaming, the next frame re-delivers anyway, and retrying there would replace the growing buffer with a stale prefix.
- **Bare specifiers need a fallback import map.** `registryImports()` only has the five React entries, so the moment the model writes `import { BarChart } from "recharts"` resolution fails — and ESM fails by killing the whole module import, so the surface goes **completely blank with no error at all** (onError doesn't fire either). `GenUISurface` calls `mergeFallbackImports` (`partial-react/import-map`) with the code's import set to probe esm.sh and fill the gaps. It costs ~36ms per run, so dedupe by specifier signature rather than recomputing per frame.
- **Every entry in `inject` is a hard dependency.** cordis's `Inject` type has no required/optional distinction (`registry.d.ts:13`) — one missing service and the entire fiber stays inactive, with not a single line of `apply()` running. That's why `webServer` and `skills` are nested fibers via `ctx.inject([...], cb)`: `dsh --profile headless` has no `webServer`, and listing it statically would leave the plugin unable to even teach the model there — which is precisely the profile batch evals run on. Only services that make the plugin pointless when absent (`systemPrompt`) belong in the static array.
- **publint's `client.js` warning cannot be fixed.** It wants the CJS `lib/client.js` renamed to `.cjs` (because `"type": "module"` makes it parse as ESM). But the host builds that URL as a hardcoded `/plugins/<id>/client.js`, so changing the extension means the plugin never loads. **Re-checked 2026-08-23: the package this used to name (`dsh-client-modules`) is not in the dependency tree at all, and `/plugins/` appears in no `@deepseek-ai` package here** — the name has moved or was read elsewhere. The conclusion still holds on its own evidence: `bunx publint` still emits exactly this one warning, and §2.3 records the hardcoded route independently. Cite the behaviour, not a package you cannot point at. That's a requirement of the host shape, not an oversight of ours.
- **cordis enforces `inject` at access time, not declaration time.** Reading an undeclared service (`ctx.sessions`) doesn't fail at apply; it throws `cannot get property "sessions" without inject` **inside the request handler**, which `dsh-host-webserver` turns into a **400 with no body and nothing in the logs**. It looks exactly like an unregistered route and is actually a missing dependency. Bypassing the type system (`as unknown as`) to dodge a client-side type conflict does not dodge this runtime check — the service still has to be declared, just inside a `ctx.inject([...])` scope.
- **`/dsh-generative-ui/canvas` must validate `cwd`.** The route answers **any** page the user has open (a plain GET skips preflight), so without validation it is a whole-disk file-existence oracle — `?cwd=/tmp/leak-probe` was measured returning file contents. The allowlist comes from each session's `header.cwd` in `ctx.sessions.list()`; the client only ever sends the current session's cwd, so nothing legitimate is caught by it.
- **A settings panel is impossible — right conclusion, wrong reason.** Measured 2026-08-23 in a real `dsh web`: `ctx.inject(["settings"], …)` **never fires its callback**, so the client ctx carries no `settings` service at all and there is nothing to be refused by. Every claim in the old wording was wrong: `settings-not-exposed` appears nowhere in the tree (`dsh-host-apiproxy` has `settings-rejected` and `settings-conflict`), and its `settingsNs` allowlist belongs to the **model provider directory**, not to plugin settings. Built-in plugins (`dsh-client-locale`, `dsh-client-ui-conversation`) do call `settings.register`, so the service exists somewhere — just not on the context a third-party client plugin is given. Configuration goes through `cordis.patch.yml`.
- **dsh is a developer preview** (devDependencies sat at `0.1.0-rc.8` when this was written; package.json is the source of truth) and openly warns about breaking changes. On every version bump, re-verify the platform table, slot names, and event signatures — rc.7→rc.8 already changed `ChatNodeSeat`'s props (`loadImage` → `renderMessageImages`), we just didn't use them.

## 4.5 Empirical basis for the prompt (2026-08-20, 40 prompts)

Ran 40 prompts through `dsh --profile headless "<prompt>"` (20 inline, 20 canvas), reading `tool/call` and
`reasoning-chunks` out of `~/.dsh/sessions/<cwd-key>/session-*/session.jsonl.zstd` to look at the **process**, not
just the artifact. headless is the right channel for this kind of batch: one process per prompt, cwd-isolated
sessions, concurrency via `xargs -P` (`jobs -r` doesn't report in a non-interactive shell — don't use it as a gate).

The result was an almost perfect correlation:

| 20 inline prompts | count | produced UI |
|---|---|---|
| loaded the skill | 10 | **9** |
| did not load the skill | 10 | **0** |

(When counting fences, accept three backticks or more — that's how `segments.ts` parses. Counting only four misses
the ones where the model wrote 3/5/6/8.)

Of the 20 canvas prompts: **20/20 loaded the skill**, 19 wrote a correct `ui4a/canvases/<id>.ui4a.tsx` with
`height:100%`, and the remaining one ("a chat UI demo") judged it inline — its reasoning quoted the skill verbatim
("would the user want this again in ten turns?"), and it judged right.

**Not one of the prompts that skipped the skill produced any UI.** Among the misses were a mortgage calculator, a
unit converter, BMI, and a three-way comparison — all of which should have been interactive. Their reasoning never
raised the idea of UI at all; this wasn't a considered rejection. So the problem was **the trigger signal in the
resident layer**, not the skill's contents: however well the skill is written, a skill the model never reads may as
well not exist. On that basis the resident prompt gained the rule that a question doesn't have to say "build me one"
to want an interface, enumerated by request shape (numbers the user might change, multi-way comparison, procedures),
naming weak phrasings like "算一下… / 看看… / 对比一下…" explicitly.

Three other empirical corrections:

- **Half the canvases had no persistence** (8/19 used localStorage in the first round), so a refresh lost everything.
  A canvas is by definition "somewhere the user comes back to," which makes this fatal. The skill now requires
  `localStorage`. Note: **do not write `usePersistedState`** — that's the playground's `$dsh/state`, which this
  plugin never implemented, and making the model import something nonexistent fails compilation outright, which is
  far worse than losing state. `rg` for any API you promise in a prompt before you promise it.
- **The model hand-rolls implementations to avoid library traps** (dropping recharts for hand-built SVG, dropping a
  markdown renderer for a bare textarea). The original "never hold back because it isn't available" missed the point —
  its worry wasn't availability but the library being painful. Added a line naming the common libraries.
- **Chinese canvas ids were silently rejected.** `背单词.ui4a.tsx` didn't match `/^[\w-]+$/` (JS's `\w` excludes CJK),
  so the sidebar never opened while the model said "done." 1 of the 40 hit it. The regex exists to prevent directory
  escape, not to enforce ASCII; it's now the exclusion-based `/^[^/\\.\s]+$/`.

### Verified on the failing subset first (11 prompts, 2 of them controls)

Re-ran the first round's failures verbatim. All flipped, and both controls held rather than being pushed too far:

| | before | after |
|---|---|---|
| `帮我算房贷…` | no UI, did arithmetic in bash | **UI**, bash gone |
| `帮我看看 BMI 正常范围` | no UI (plain text) | **UI** (and without loading the skill — the resident rule works on its own) |
| `算一下 128GB…换算` | no UI | **UI** |
| `帮我可视化…电动车` | UI, but read an unrelated package.json first | **UI**, redundant read gone |
| `帮我写个正则…边写边测` | wrote ` ```tsx `, lost entirely | **correct ui4a fence** |
| `帮我做个背单词的应用` | 1013 hand-written lines | **452 lines**, using `motion/react` + `lucide-react` |
| canvas persistence | 8/19 | **10/11**, `useState` reserved for transient UI state |
| control `什么是闭包？` | no UI | **still no UI** ✓ |
| control `今天星期几` | no UI | **still no UI** ✓ |

`v-bmi`'s reasoning quoted the newly added line word for word ("anything with a number the user might want to change
is a candidate for a block") and then reversed its original "simple factual question, just answer it" call — direct
evidence the intervention worked.

### Ordering: the skill goes before you *explore*, not before you build

For an **underspecified** request like `帮我比较三款云服务器的性价比`, the first version had the model run 10 searches
and 2 bash calls before loading the skill — while the skill's answer for exactly this kind of request is "ask back
with an interface." That "Do it before you explore" line was buried inside the "asking back" subsection, so by the
time it was read the searching was done. After the ordering rule moved up into the resident layer (heading changed
from "Before you build one" to "Load the skill **before you explore**"):

- `帮我比较三款云服务器` — tool calls **13 → 4**, and the skill went from last to first
- `帮我做个网站` — the very first action is the skill, zero exploration, straight to an options card asking back
- `做个工具给我用` — 0/1 produced UI before; after adding "the vaguest requests need it most, not least",
  **3/3 loaded the skill first and produced a clarifying card**
- `把这些数据可视化一下` — still explores the workspace first. That one **is correct**: it has to know what data
  exists. Not redundant.

Verified on a real machine: a Chinese canvas (`ui4a/canvases/单位换算.ui4a.tsx`) opened the sidebar correctly, the
panel filled, the app worked, and the reply even explained that state goes to `localStorage` (key
`canvas:单位换算`) — both the regex widening and the persistence rule confirmed in the browser.

Backtick counts observed were 3/5/6/8 — **not one prompt wrote exactly four** — but `segments.ts` accepts three or
more and matches the close to the open, so everything rendered fine. That tolerance was the right call. What was
actually lost was the one that wrote the language as `tsx` (right intent, slipped hand).

### Full re-run after the changes (the same 40)

After validating on the failing subset, re-ran the **complete 40** unchanged. These are the comparable numbers:

| | round 1 | re-run |
|---|---|---|
| inline produced UI | 9/20 | **13/20** |
| inline loaded skill | 10/20 | **13/20** |
| inline total tool calls | 34 | **29** |
| canvas loaded skill | 20/20 | 20/20 |
| canvas used persistence | 8/19 | **17/19** |
| canvas third-party imports | 27 | **42** |
| canvas mean line count | 603 | 586 |

Canvas tool calls went 49 → 59, but **17 of the increase sit in a single prompt** ("team weekly report page", 12 edits
+ 4 reads re-checking whether a JSX member expression was legal); the other 19 barely moved. One outlier, unrelated
to the changes.

**More UI, fewer steps** — four more prompts produced UI while tool calls went *down* by five, so it wasn't bought
with extra work. `帮我比较三款云服务器` alone went from 13 tool calls to 4.

Case by case, the ones that still produce no UI are all judged correctly: memory-model comparison → table, CAP
theorem → explanation, closures → explanation, JSON formatting → just give the result, what day is it → one line.
`做个番茄工作法的计时器` moved from inline to canvas, which is also right (something the user comes back to).

**One stable failure mode remains**: writing the fence language as `tsx` instead of `ui4a/tsx`. Both rounds hit it
1/20 (round 1 on "regex, test as you write", the re-run on "each step of quicksort"), about 5%. The chain of intent
is entirely correct — the reasoning says "build an inline ui4a/tsx block" out loud — the hand simply slips back to
the familiar language name at the last moment, and the whole interface is lost, leaving a source listing. A rule
naming it specifically now lives in the resident layer, right after the four-backticks line, as close to the moment
of writing as possible. Re-ran each of the two prompts that failed 3 times: **6/6 correct**.

It came back on 2026-08-21 on `帮我搭个东西记录点什么`, at 1/5, 1/5 and 1/6 across three passes —
~17% for that one prompt against ~5% overall. My first reading was "the vaguer the request,
the likelier the slip", and **one control killed it**: `帮我搞个东西看看数据`, no less vague, went
6/6 clean. So it is not a property of vagueness; it is a property of that prompt, and the
mechanism behind it is still unknown. Recorded rather than acted on — a rule aimed at a
pattern this thin would be aimed at nothing.

The general lesson is the one from §4.5's counting traps: with a ~5% base rate, five samples
of one prompt cannot tell a real cluster from noise. Run the control before believing the
explanation.

Two measurement traps worth recording, both of which had me draw a wrong conclusion: fences must be counted at three
backticks or more (counting four misses 3/5/6/8), and canvas artifacts must be counted by `find`ing the whole runs
directory (my original `runs/*/ui4a/canvases/*.tsx` glob missed files and turned "8/19 used persistence" into "0/10,
all useState"). Confirm your baseline numbers are real before changing a prompt.

### Render-layer measurements: 32/33 compile, the one failure is JSX subscripting (2026-08-20)

Put all 33 artifacts from the re-run (19 canvas + 14 inline) through the same `@esm.sh/tsx` the plugin uses:

- **32/33 compile.** The failure is `<STATUS_META[r.status].icon />` — JSX allows member expressions `<a.b />` but
  **not subscripts `<a[k] />`**. The model even talked itself through "member expressions are allowed" in its
  reasoning; subscripts don't count.
- The rest ran in a real dsh web: a dashboard using recharts + lucide-react + motion/react together rendered fine,
  1064px tall, 12 svgs.

**But real-machine screenshots caught two color bugs caused by the prompt**, invisible to static compilation:

1. **`--dsw-alias-brand-primary` is not an accent, it's a foreground color.** Measured, it equals `label-primary` in
   both themes (near-white in dark, near-black in light). My palette table called it "the one accent", the model
   complied — filling icon tiles with it and drawing the icons in white — and produced white-on-white squares. The
   real accent is `--dsw-alias-state-business-primary` (DeepSeek blue `rgb(103,158,254)` / `rgb(65,118,230)`). Table
   fixed and a counter-example added.
2. **In light theme `bg-base`/`layer-1`/`layer-2` are all pure white**, so hierarchy can only come from borders. And
   the skill's "a border or a background, never both" made the model drop the border once it picked a background —
   three identical white layers, no hierarchy at all. That rule now reads "a background only counts if it actually
   differs from what's under it", and the resident layer calls out the theme behavior.

Re-shot in both themes afterwards: the four blue icon tiles read clearly in light and dark, and cards separate by
border in light.

Same lesson as before: **every variable name you put in a prompt, and its semantics, has to be measured.** Nothing
fails to compile, nothing errors at render, and the model still ships something a user sees is broken at a glance.

### Streaming and mid-flight frames smoke (2026-08-20)

**Mid-frame stress test**: sliced all 33 real artifacts into growing prefixes ~40 characters apart and ran every
frame through `normalizeGeneratedTsx` + `transform` (GenUISurface's partial path): **11092 frames, and hard errors
appeared only in the file that already failed to compile** — zero errors across the other 32. Zero transient errors,
too, and not because they were filtered: `normalizeGeneratedTsx` genuinely completes half-written attributes,
unclosed JSX, and missing braces (verified with a separate probe).

**Inline really does stream**: sampled every 250ms on a real machine — first frame at 28.5s, settled at 46s, spanning
17.5 seconds with **47** state changes (h 0→28→58→78→419→…→1339, nodes 0→4→…→390). A 60ms sampling run saw 23
changes with **zero error frames and zero blank frames**. Node counts dip mid-flight (196→174, 390→375), which is
`preserveState` re-rendering with state kept, not content being lost.

**The canvas does not stream under the default PTC mode** — see the measurements in §3.6.

**Multiple cards on one page** (three inline blocks in one reply) don't conflict, but this round caught a new fatal
error:

- **The default export must not share a name with an import.** `import { Pie } from "recharts"` next to
  `export default function Pie()` — the compiler **drops `Pie` from the import list entirely** (shadowed by the local
  declaration), so `<Pie>` points at the component itself and recurses infinitely into React error #185 "Maximum
  update depth exceeded". **Nothing fails at compile time**; the symptom is a white card with height and zero
  children. A rule now lives in the resident layer and the re-run passed (the pie chart went from `h=84/n=0` to
  `h=329/n=83/svg=5`).

One detection technique worth keeping: **judge a broken card by "has height, zero children", not by matching error
text in innerText** — #185's error text wasn't in the container, and text matching missed it entirely.

But read `innerText` as well, because zero children has **two** causes that need opposite responses
(2026-08-21, both hit within an hour):

| `innerText` | Meaning | Whose bug |
| --- | --- | --- |
| empty | The module graph died — a bad import, a revoked blob URL. ESM kills the whole import silently. | ours |
| `ERROR: …` | partial-react's error boundary caught a throw during render and painted the message. | the generated code's |

The boundary renders a bare text node, so the child count is 0 either way. Counting alone reported
a generated component's `item.difficulty.includes(…)` on a half-streamed object as an infrastructure
failure, and I went looking in the wrong half of the system.

### `$dsh/chat` in the model's hands (2026-08-21, 5 prompts + 5 repeats)

Ran five underspecified requests through headless to see whether the model uses `sendMessage`
the way the prompt describes, rather than whether the API works:

- **5/5 imported `$dsh/chat` and wired every option to it.** No prompting for it beyond the
  one line in the resident layer and the example in the skill.
- **5/5 sent human-readable text** — `sendMessage(id)` where `id` is `单位换算器` / `个人主页` /
  `习惯打卡`. None sent a JSON payload, which matters because `ctx.conversation.send` always
  writes the message into the transcript: a click has to read as something the user would say.
- Unprompted, they also got the answered state right: `disabled` after choosing, the chosen
  card highlighted, and a free-text field for answers not on the list.

`$dsh/ai` measured the same way: asked for "a recipe tool — I type ingredients, it lists
dishes", the model reached for `streamText` + `partial-json` and parsed the buffer as it grew,
without loading the skill. The first attempt then died mid-generation on
`dish.difficulty.includes(…)` — `partial-json` hands out objects whose fields have not arrived
yet, and one method call on a missing one throws inside render. After the skill gained a rule
saying every streamed field is optional until the end, the re-run guarded all of them
(`?? []`, `?? "…"`, `&&`) and ran clean: 47 → 141 nodes as items landed one at a time.

### `@genui/cli` as the model's own checker (2026-08-21)

The skill tells the model to run `@genui/cli check` over a canvas before leaving it. Three
things about that recommendation were measured rather than assumed:

- **It catches what matters here.** `check` (which includes TypeScript diagnostics) flags both
  of §4's expensive failures: the JSX subscript `<a[k] />`, and an import shadowed by the
  default export — the React #185 recursion that builds clean and renders a blank card.
  `lint` alone catches only the first.
- **`npx`, not `bunx`.** The package is not on npm, so the URL is pkg.pr.new's long form
  (`pkg.pr.new/${owner}/${repo}/${package}@${commit-or-branch}`; the compact form needs an npm
  release). bun rejects that with `unrecognised dependency format` — a scoped name inside the
  URL — while npx runs it. This is the one place in this repo where npx is the right answer.
- **`@main`, not a SHA.** The branch tag resolves to the latest published commit, so the
  instruction does not rot. pkg.pr.new publishes on every push to that repo.

`@genui/cli` lives in `MindLab-Research/macaron-genui-demo` as a private workspace package; if
it is ever released to npm, shorten the URL and drop the npx caveat.

**`-i` is mandatory once a card imports `$dsh/*`.** Without it `check` reports
`Cannot find module '$dsh/chat'` on every such line — a false error the model will go and
"fix". `types/importmap.json` plus the three `.d.ts` beside it exist for that flag, and
`src/index.ts` resolves their absolute path at load time (`../types/` relative to
`import.meta.url`), because the plugin lives wherever the profile installed it and the model
runs the checker from the workspace. `skillBody` takes that path and omits the flag when it
cannot be resolved.

**That map is for `check` only.** Its targets are `.d.ts`, so `build` and `dev` fail on it with
`Missing export` — verified. Not a gap: `$dsh/*` forwards to dsh's own services, so a standalone
HTML export or a Vite preview has no harness to reach, and there is no JS that would make them
work there. `types/README.md` says so beside the file.

Two things measured while wiring this up, both worth knowing before trusting the flag:

- **The `.d.ts` are not actually loaded.** `-i` suppresses TS2307 and nothing more:
  `sendMessage(42)` against a `.d.ts` declaring `(text: string)` still passes. The control
  proves TS itself is running — a plain `const s: string = useState(0)[0]` is caught. Reported
  with a minimal repro on MindLab-Research/macaron-genui-demo#1427, which already tracks this
  class of gap. So today the flag buys silence, not signal; real errors like the shadowed
  import are still caught because those need no facade types.
- **`bun genui check -i` and the published CLI disagree.** This repo's host config is
  `check: async (code, _imports, codeDir) => …` — the underscore discards the import map — so
  locally the flag does nothing at all, and I nearly concluded from that it was useless
  everywhere. Verify CLI behaviour against the published build, not the checkout.

### Getting the model to reach for a capability (2026-08-22, 20 prompts + follow-ups)

The negative judgements were already right — 5/5 avoided `$dsh/ai` where the data is fixed,
4/4 kept a canvas's private state in `localStorage`, 2/2 asked back through `$dsh/chat`. The
positive ones were the problem: **0/5 used `$dsh/ai` where it was wanted, 0/2 used `$dsh/fs`
for read-then-display.** The model knew the APIs (another run called `readdir`/`readFile`
correctly) and chose to hardcode instead.

Two rewrites moved nothing. What did was reading the session log rather than guessing:

> "the content (Tokyo attractions) is fixed knowledge I already have. I don't need
> `streamText` for Tokyo landmarks — that's fixed data."

**The model reads "fixed" as "known to me"** — which for Tokyo is true, so every framing about
variable content or unseen inputs argued past it. The test that works is **enumerability**:
three-day Tokyo itineraries is not a set of five, and writing five samples the space while
presenting it as the whole. Quoting that reasoning back with a closed/open table took the
failing prompts to 2/3, the third correctly staying local (two-digit addition is one formula —
`Math.random` beats a model call).

Same shape for `$dsh/fs`: the model read files with its own tools and pasted the findings in
as literals. "Reading it yourself is not the card reading it — that card is a photograph" took
that to 2/2.

A third gap sat above both: **`给我五个猫名` produced no UI at all.** The trigger list in the
resident layer was all numbers, comparisons and steps, and a naming request is none of those.
"Asking for a few of something is asking for more of them" fixed it.

One case stayed prose after all of it — a dinner recipe — and the log shows a deliberate
weighing, not a miss. That is a judgement call worth leaving to the model.

Method note: the first pass concluded the skill had not loaded, from grepping `out.txt`.
Headless's final reply is far too terse to show internal calls; the session log said it had
loaded every time. **Check `~/.dsh/sessions/<cwd-key>/session-*/session.jsonl.zstd`**, whose
`reasoning-chunks` carry a `texts` array — and where the model tells you exactly why it did
what it did, which beats a third rewrite guessing at it.

### A negative result: the "knob" reframing did not transfer (2026-08-22)

The playground added a rule telling the model to ask **which input the user is most likely
to change** rather than whether the task is hard enough to deserve an interface, and reported
its conversion prompts flipping from tables to live fields. Tried here as a replacement for
our existing trigger rule, on four prompts with a knob and two controls without.

**It did not reproduce: 1/4.** Only the mortgage prompt flipped, and the session logs say why
each of the others did not:

| prompt | reasoning | what happened |
| --- | --- | --- |
| mortgage | 4664 chars, quoted the new rule verbatim | **built the widget** |
| 1000 USD → CNY | 2773 chars: "the input (amount) is likely to change. **But more fundamentally, I need current data**" | three searches about rate staleness, never returned to the question of shape |
| 5kg → lb | **172 chars**: "simple conversion... factual calculation. No need for tools." | the rule was never reached at all |
| React vs Vue | — | prose, correctly |

So the rule lands only when the reply already has room for it. A second pass added "this one
is simple is not a reason to skip it" and "decide the shape before you go get the data",
aimed at exactly those two failures. The unit conversion's reasoning grew 172 → 709 chars,
quoted the new line, **and overruled it**: "this is a trivial single conversion. I think a
simple prose answer is fine here." The currency one grew to 4519 chars with no mention of
shape at all — the lookup had taken the whole turn.

Reverted. Two rounds, no movement on the cases it targeted, and the one case that did engage
came back with a considered judgement rather than a miss. **A prompt rule that the model
reads, quotes, and then argues with is not a wording problem** — that is the shape §4.5
already records as worth leaving alone, and pushing harder would just be overriding it. Worth
knowing too that a fix measured in another harness does not transfer for free: same model
family, different tool surface, and the same sentence lands differently.

### An expression the user is holding is a fourth trigger shape (2026-08-22)

`这个 cron 到底几点跑？*/17 3-5 * * 2` produced no UI, and the session log shows why: 2003
characters of reasoning that never once considered an interface. **"This is a simple factual
question — no tools needed, no skill needed."** The same sentence that killed `5 公斤等于多少磅`
earlier the same day.

But the answer it wrote was *already a table* — twelve firing times, laid out in markdown. The
trigger list in the resident layer had three shapes (a number to change, a multi-way
comparison, steps to step through) and an opaque expression is none of them, even though it is
the case where a live table pays best: the way to be sure a cron line does what you think is to
change a field and watch what moves.

Added a fourth shape, with the tell stated explicitly (**your answer is already a table**) and
the excuse named (`simple is what makes it cheap to build, not what makes it unwanted`).
Measured: **3/3 flipped** — `cron`, `glob` and `chmod` all produced a fence — and both controls
(`HTTP 418`, `尾递归优化`) correctly stayed prose. Worth contrasting with the `knob` reframing
tried earlier the same day, which went 1/4 and was reverted: this one names a request *shape*
the model can match on sight, where that one asked it to re-judge something it had already
judged.

### The `$dsh/exec` sandbox, measured (2026-08-22)

Switched the composer to `Read Only` and ran the same two commands through the route:

| command | exit | what came back |
| --- | --- | --- |
| `echo hello` | 0 | `hello` — reads are untouched |
| `touch ./probe.txt` | **1** | `touch: Operation not permitted` on stderr, **HTTP 200**, and no file on disk |

The denial arrives as a *result*, not an exception — same shape as `$dsh/fs`'s
`FS_SANDBOX_DENIED`, and the reason a card can say "this session is read-only" instead of
going blank. Under `workspace-write` a write to the platform temp area succeeds, which §3.65
already records as intended: that is the same `writableRoots` set Seatbelt grants the model's
own bash, and a narrower fence here would be a second policy to keep in sync.

Note the route requires a resolvable session id — an absent or unknown one is a 400 before any
command is composed, so there is no unattributed execution path.

### The second turn, measured at last (2026-08-22)

Every number in this section had answered "did a card appear". A critique pass pointed out that
nothing measured what happens *next*, and that the revision loop is where the documented
remount-resets-state trap lives. Two runs, both cheap:

**A revision is an edit, not a rewrite.** Asked for a pomodoro canvas (338 lines, using
localStorage), then `这个不对，休息应该是 10 分钟不是 5 分钟`. The diff is **one line**:
`BREAK_MS = 5 * 60 * 1000` → `10 * 60 * 1000`, same 338 lines. The reply even says the panel
needs a refresh. So the feared shape — a whole-file rewrite discarding the reader's state on
every tweak — is not what the model does; `str_replace` is.

**A vague follow-up resolves, and the width rule survives it.** Third turn on the same canvas:
`把它改成横着的，字太小了看不清` — a pronoun with no referent in the sentence, a layout verb, and
a complaint. The model resolved 它 to the canvas in the panel and, crucially, did not simply
turn the layout sideways: it added `@container (min-width: 640px)` so the horizontal
arrangement applies when there is room and falls back to a column when there is not, then
listed the type-size changes it made (56→64px, 14→18px). 125-line diff, and the container-query
rule held under a request that never mentioned width.

**Two resident rules can fight, and "fine as text" wins.** `帮我算下这个月还剩多少钱能花，
工资 12000，房租 3500，还了 2000 花呗` produced correct prose and no card, on a request whose
three numbers are exactly the "a number the user might want to change" shape. The reasoning
trace is 4010 characters of the model arguing with itself **six times**, quoting the trigger
rule, nearly building the card (*"Given the strong guidance in the system prompt … I'll provide
a lightweight interactive card"*), and finally settling it with a different rule of ours:

> "Not for text that is already fine as text. A simple subtraction is fine as text."

Not a rule that failed to land — two that collide, decided by the one that reads as permission
to stop. Left alone deliberately: tightening either one damages what the other covers, and the
model's own tie-breaker (*"用户语气是随口问的"*) is a reasonable read of the request.

### Failure-shaped requests: scale is the trigger, not failure (2026-08-22)

A round-7 angle proposed cards for the states people are actually in when they ask for help —
a stack trace, a failing build, a flaky test. Built a repo with a deliberately broken file and
asked `build 挂了，我该先看哪个错`.

**Three errors: no card, and rightly so.** The reply ran the build, then made the observation
that matters — the three are *independent*, not a cascade — ranked them (`TS2304` name-not-found
above the two type mismatches, because a missing name means a piece of code is absent rather
than mislabelled), and added a rule worth keeping: *"报错一大堆时通常先看第一个，因为它最可能是
根因；但这次三个是平级的，所以看最重的那个"*. Nothing there wanted an interface.

Re-ran at **forty-eight** errors, the scale the intent actually named. Still no card, and the
reply explains why better than the intent did:

> "先看第一条，但更要紧的是先**归类**——这 48 条不是 48 个问题。"

Two codes, twenty-four each, and it said so in a four-row table, noted that the two classes do
not cascade into one another, and then inferred *"这文件看起来是被截断/删了一半"* — which is
exactly how the fixture was built. Forty-eight lines of output, two actual problems.

So the angle's premise is wrong about real failures: a big error count is usually a small
number of classes repeated, and once deduplicated there is nothing to triage.

Then built the case that was supposed to earn the card — a monorepo build failing **seven
different ways across four packages** (missing workspace module, unresolved import, a postcss
plugin, an absent env var, an OOM, a test timeout). Still prose, and still right: it picked
`@org/shared-types` because it is the only *shared internal* dependency, which makes it a build
graph problem rather than a file problem, and the one whose fix can clear others.

**Triage assumes a flat list of peers. Real build failures have a topology**, and finding the
upstream root is reasoning, not sorting — the thing the model is better at than any interface
would be. Two scales, two kinds of heterogeneity, no card either time. The angle is refuted,
and the reason is worth more than the angle was.

### Is the card's arithmetic right? (2026-08-22)

The critique named this the biggest unexamined risk: *"generative UI raises the credibility of
output without raising its accuracy."* Three prompts with independently computable answers:

| prompt | truth | card said | card's formula |
| --- | --- | --- | --- |
| 30y ¥1M at 4.2%, monthly payment | 4890.17 | **4890.17** | `P*r*(1+r)^n/((1+r)^n-1)`, with an `r === 0` branch |
| 5 公斤 3 两 in pounds | 11.35 | **11.35** | prose; also flagged that a HK/TW 两 is 37.5g, giving 11.30 |

A third, `这个 cron 一年跑多少次？0 3 * * 1`, was better than correct: it answered **"52 or 53,
depending on how many Mondays that year has"** (2025 has 52, 2024 has 53) and built a card with
a **year selector that counts them**, using `Date.UTC` to dodge the timezone trap. The right
answer to "how many times a year" was not a number, and the card is what let it say so.

All three exact, and the arithmetic lives in the card rather than in a number the model wrote
down. Three samples is not a guarantee, but the specific fear — a plausible card quietly wrong
— did not reproduce on the shapes most likely to show it.

### Counting fences does not count canvases (2026-08-22)

Every headless eval in this file counts ` ``` ` fences in the reply. That misses a canvas
entirely: a canvas is a *file*, and the reply about it is prose. I read `fence=0` on
`这个目录下都有啥文件，我想快速看看每个文件里写了什么` and concluded the browse rule had failed —
twice. It had not. The run produced a **522-line canvas file browser**: a collapsible tree from
`readdir`, `readFile` only on click, a `Map` cache that also caches failures, and a single-column
fallback under 560px. Exactly the shape the rule describes.

**An eval must count both**: fences in `out.txt` *and* files under
`.dsh/ui4a/canvases/`. Counting one and calling it "produced UI" understates the model on
precisely the requests most likely to deserve a canvas — the ones about a whole set of things.

### Regression after a day of prompt changes (2026-08-22)

Three trigger rules were added in one day (expression, browse, exec). Re-ran the six prompts
§4.5 names as its fixed points:

| control (must stay prose) | | positive (must produce UI) | |
| --- | --- | --- | --- |
| `什么是闭包？` | ✓ prose | `帮我算下房贷` | ✓ fence |
| `今天星期几` | ✓ prose | `帮我看看 BMI 正常范围` | ✓ fence |
| `HTTP 状态码 418` | ✓ prose | `给我五个猫名` | ✓ fence |

**6/6.** The new rules did not widen the boundary, and adding three did not dilute the ones
already there enough to lose a positive. Worth re-running whenever the resident layer grows —
it is six headless runs and it is the only thing that catches a rule eating its neighbours.

### What the resident layer costs (2026-08-22)

The always-on prompt is **3254 tokens across 8 bold rules**; the on-demand skill is 6183. Three
of those rules were added in one day, which is the moment to say the obvious: every rule added
to the resident layer dilutes the attention the others get, and it is paid on every turn of
every session, including the ones that will never produce UI.

The bar for a resident rule, given what §4.5 measures: it must be recognisable from the request
alone (see the pattern below), it must cover a *shape* of request rather than a topic, and it
must have flipped something measurable. Everything else belongs in the skill, where it is paid
for only when the model has already decided UI is on the table.

### Gathering data eats the turn (three observations, 2026-08-22)

The same failure shape showed up three times, on unrelated prompts, and it is not a wording
problem in any rule:

| prompt | what happened |
| --- | --- |
| `1000 美元换成人民币是多少` | 2773 chars of reasoning. Named the trigger rule — *"the input (amount) is likely to change"* — then **"But more fundamentally, I need current data"**, ran three searches about rate staleness, never returned to the question of shape. |
| `CORS 报错到底谁拒绝了我` | Asked itself *"Should I build a UI?"*, noted it *"does have a kind of flow/decision structure"*, then judged prose sufficient. A considered call. |
| `这个目录下都有啥文件，我想快速看看每个文件里写了什么` | Read all 26 files with its own tools, then: *"a compact per-file one-liner is best"*. Once the reading was done, a card was redundant work on an answer it already had. **Fixed by the browse rule** — see the counting note below for why it looked like it had not been. |

The middle one is a legitimate judgement. The other two share a mechanism: **the decision about
what shape the answer takes is made once, early, and a data-gathering detour overwrites it.**
By the time the model has the data it is finishing, not deciding.

A rule that fires *after* the detour cannot help, which is why the `knob` rewrite went 1/4 —
it asked the model to re-judge something it had stopped judging. What did work (the expression
rule, 3/3) matches on the *shape of the request*, before any tool runs. **Trigger rules must be
recognisable from the prompt alone.** Anything that needs the answer in hand to evaluate will
lose to whatever the model went to fetch.

### Streaming charts, finally measured (2026-08-22)

Two research passes disagreed about whether a recharts chart restarts its animation on every
streamed frame. Sampled a real inline card at 100ms while the model wrote it:

```
13101ms  rc=0  h=0        card mounted, empty
13501ms  rc=0  h=33       skeleton growing
14200ms  rc=0  h=363      layout settled
14301ms  rc=15 h=363      chart elements appearing
15902ms  rc=75 h=363      chart complete, height never moved
17221ms  rc=0  h=0        one remount, 80ms
17301ms  rc=75 h=363      back
```

**Seventeen distinct states, sixteen of them monotonic growth.** The chart is built up
incrementally inside a stable layout box; the single collapse is the settled recompile at the
end and lasts 80ms. No per-frame animation restart, no flicker — the reading that said
otherwise reasoned correctly from the code and missed that `renderComponent` runs far less
often than a frame arrives.

Three recharts cards in that session, all rendered: 72, 82 and 89 recharts elements with axes
and values. Which also settles the earlier claim that the probe browser could not load it.

### The destructive-command rule, tested head-on (2026-08-22)

Asked, in a throwaway repo with an untracked file: `帮我做个卡片，把这个仓库里没跟踪的文件清理一下`
— a direct request to build a card that deletes.

The card lists the untracked files with one `git ls-files --others --exclude-standard`, and
routes every delete through `sendMessage`. **Zero destructive commands, and the file survived.**
The model stated the reason itself, unprompted: *"点「清理」不会在卡片里直接 rm，而是把要删的
文件名通过 sendMessage 发回给我，由我在对话里执行删除——全程可见、可追溯。"*

That is the consent argument in the model's own words, on the same day the rule was written.

### `$dsh/exec` in the model's hands, first run (2026-08-22)

Asked for a git-log card in a throwaway repo, the model wrote exactly the intended shape
without being pointed at it: `import { bash } from "$dsh/exec"`, one command for the list, a
second on click for `git show`, and **`if (res.exitCode !== 0)` rather than a try/catch** — the
one thing the prompt insists on, because a non-zero exit resolves. A capability added that
morning was in correct use the same day, from the prompt text alone.

## 4.9 Dependencies and releasing

**`^0.0.5` lets nothing through.** semver's caret on 0.0.x matches that exact version; to accept later patches you
need `~`. `partial-react`/`partial-tsx` used to be pinned exactly, which was equivalent to `^` and only served to
make renovate open a PR per patch.

**A high peerDependencies lower bound just cuts users off.** `^0.1.0-rc.7` was measured to already cover rc.8 through
the 0.1.x release (prerelease range behavior is easy to remember backwards — one `semver.satisfies` check is faster
than guessing). Bumping to `^0.1.0-rc.8` would only exclude hosts still on rc.7 — renovate leaves peerDeps alone by
default, and it's right to.

**Renovate groups packages by config, not by closing PRs manually.** One `groupName` plus
`matchPackageNames: ["/^@deepseek-ai//"]` in `.github/renovate.json` reopens 8 dsh packages as a single PR. Validate
with `bunx -p renovate renovate-config-validator` (`bunx --bun` crashes on the re2 native module; drop `--bun` and it
runs on node).

**pkg-pr-new must not be run through bunx in CI.** Its docs explicitly forbid `npx`/`bunx`/`dlx` — install it as a
dependency and run it from the lockfile (`bun run pkg-pr-new`).

**Add npm badges only once the package is actually published.** shields' `npm/v` and `npm/l` both read the registry
and render `package not found` when it doesn't exist — two red crosses at the top of the README are worse than none.

**A thin test fake reads as a broken plugin.** smoke's `ctx.inject` used to hand its callback
the bare context rather than the proxied one, so a nested scope saw `undefined` for the very
services it had just declared — reported as "effect failed", which is indistinguishable from
a real defect until you read the fake. If smoke accuses the plugin of something the browser
does not, suspect the stand-in first.

**Widening dependencies is only safe if CI can actually verify.** smoke used to call the module factory without
running `apply()`, so it let every "plugin fails to load" class of problem through (hit once: a lint change hung the
main thread and smoke stayed green). It now runs `apply()` and asserts both the effect count and the elapsed time.
All three failure modes were verified catchable: `apply` throwing, an effect throwing, and synchronous blocking
(blocking can't be guarded with `setTimeout` — on a single thread the callback queues behind the block and never
fires — so measure elapsed time instead).

## 5. Reference implementations

Check which one you're copying from first — these repos solve different problems:

| For | Copy from |
| --- | --- |
| React singleton bridge, import-map, own compiler, path contract | `../ui4a-playground/src/{runtime,fs}/` |
| wasm warmup, esm.sh fallback that avoids a second React | `../genui-canvas/src/{genui-runtime,components/genui}/` |
| CSS scoping + theme ancestor hoisting | `Ori-Replication/obsidian-ui4a-renderer`'s `src/styling.ts` |
| dsh plugin skeleton, how to split the two configs (it uses tsdown, we use `Bun.build` — see §0) | `liuup/dsh-latex-tools` |
| How to organize a large client plugin | `omdsh-dev/DSH-better-sidebar` |

**A ported file keeps drifting after you port it.** `segments.ts` and `compiler.ts` both came from the playground
and both later grew fixes there that we did not have — the fence tolerances the model actually needs, and normalizing
the final frame. Neither showed up as a bug report here, because both failure modes look like the model wrote
something bad. When re-reading that repo, diff the files we ported rather than skimming its commit subjects, and run
its test cases against our copy: three of its nine fence cases failed here, and one of my own re-typed assertions
used `?.` and turned a failure into a pass.

**Don't copy** `../macaron-claude-code/web`'s zero-isolation approach (global UnoCSS runtime + global reset) — while
vendoring, it stubbed `useGenUIStyleScope` into a no-op, which pollutes the shell of any host that has its own design
system.

### "I don't know what they want" is why the form exists (2026-08-22)

`帮我把 .env 弄明白，有几个值我要改` in a fixture with 3 set keys and 3 missing ones.
First run: `fence=0`, no canvas — a correct table of current values, a table of missing ones,
a warning about the uncommitted secret, ending on **"你要改哪几个、分别改成什么值？"**.

Two mechanisms, found in the reasoning trace, not guessed:

1. The `**Nothing destructive, ever**` bullet, written for `$dsh/exec`, generalized:
   *"I can't write to the file from a card without sendMessage for destructive ops.
   Actually editing .env is a file write. Hmm."*
2. Under it, the plain reflex: *"I don't know what new values they want. So I should first
   explain, then ask."* — which is exactly backwards. **Not knowing the value is the argument
   for a field, not against one.** The model also decided *"I don't think I need a skill here"*,
   so the whole skill layer never loaded; the resident layer had to carry it alone.

Fixed in both layers: the skill now says a write leaves a diff and a read-only session refuses
it, so a card **should** write with a preview and a confirm; the resident layer got a trigger
keyed on the sentence — "when they tell you they want to change something without saying what to,
the missing value is the card", with the same *decide before you read* clause the browse rule needed.

Re-run: `fence=1`, 213 lines — every key from both files in one form, `existed:false` badged
未设置, a `/key|secret|token|password|dsn/i` mask with an eye toggle, blank values skipped,
`writeFile` behind one 保存 button, and a `<details>` preview of the exact text about to land
with the secret still masked. The preview was not asked for by name; it followed from
*change visible before it lands*.

Same pattern as every other trigger that worked: **recognisable from the request alone.**
"我要改" is in the sentence. Nothing had to be read first.

### A plan talks itself out of being a plan (2026-08-22)

Non-dev intents, first sweep: `我妈生日送啥` 1, `这周末去哪玩` 1, `对比几个手机` 1 — but
`我想学吉他，从哪开始` 0 and `想开始跑步怎么循序渐进` 0. Both prose answers **contain a
week-by-week table**; the running one is a full 10-week Couch-to-5K.

The traces show the same self-talk twice, and n3's is the honest one — it saw the rule and
argued past it:

> *"The guidance says 'Anything with steps to step through' is a UI block. A running progression
> plan is steps. But honestly, a clean prose answer with a clear week-by-week table might be
> better and simpler."* … *"building a UI would be over-engineering a simple 'how do I start'
> question."*

m3: *"it's a text answer that's fine as text."* So the abstract rule was present, recognised,
and **overruled by a plausibility check** — which is the failure mode, not a missing rule.

The counter has to name why a plan is different from the prose around it: it is followed over
weeks, checked off, and bent to the person following it. Added to the resident layer with the
give-away stated as **the second person over time** and the specific rationalisation quoted back
("这在文字里就够了" is true of the explanation and false of the plan; they arrive together).

Re-run 3/3. Two of them chose a **canvas**, unprompted — right call for something spanning weeks —
and the running plan persisted its checkboxes to `localStorage` with no instruction to.
Prose fixtures still 4/4.

The generalisation: **an abstract rule the model can weigh loses to "this seems like overkill".
A rule that names the artefact and what happens to it after the reply does not.**

### Non-dev intents, measured (2026-08-22)

The research corpus was written by dev-shaped agents, so this checks the other half.

| prompt | shape |
| --- | --- |
| `我妈生日快到了，帮我想想送啥` | fence |
| `这周末去哪玩比较好` | fence |
| `帮我对比下这几个手机 iPhone 17 小米 16 Pixel 11` | fence |
| `教教我五线谱怎么看` | fence (12.6kb — the slowest single reply measured, first attempt read as a timeout) |
| `我想学吉他，从哪开始` | prose → **canvas** after the plan rule |
| `想开始跑步，怎么循序渐进` | prose → **canvas** after the plan rule |
| `帮我定个每天背单词的计划` | fence both before and after |

7/7 produce UI now. Two notes worth keeping: a long generation is not a failure — n4 was
re-run and returned normally, matching §4's cold-start lesson; and **the two that failed were
both plans**, which is what isolated the rule rather than a scattering of unrelated misses.

### A canvas edit does remount — reproduced, and the symptom is partial (2026-08-22)

The open item said "a canvas `edit` resets every `useState`, traced through the code, not yet
reproduced". Now reproduced in a real browser, and the observation is sharper than the note.

Setup: asked dsh web for a counter canvas, clicked `+1` three times, typed `typed-by-hand` into
its input. State: `3` / `typed-by-hand`. Then asked the model to change one button's label —
a one-character diff, verified with `diff`.

After: **`3` survived, the input was empty.**

That looks like selective state loss and is not. The model had given `count` a lazy initializer
reading `localStorage` and an effect writing it back; `draft` was plain `useState`. The tree
remounted and took both — `count` merely restored itself. `CanvasPanel.tsx:124` passes
`preserveState={false}` on purpose (a canvas arrives as a whole file, so preserving state would
make an edit look like it did nothing), so this is the design working, not a bug.

Two things worth having learned:

1. **The failure was invisible because the model had already worked around half of it.** A
   symptom partly masked by good behaviour reads as a *different, smaller* bug. Both states had
   to be checked to see it at all.
2. `skill.ts` warned about persistence in terms of **reload**. The trigger that actually fires is
   **the next edit** — far more frequent, and caused by us rather than the user. Reworded there:
   change one word in a label and the user's half-typed row goes with it.

Method note: my first attempt edited the file with `sed` and nothing re-rendered. The version
key in `collect.ts` counts *mutating tool calls*, not mtime — editing behind the agent's back is
not the edit path. Drive the real one.

### Unit conversion, and the single sample that nearly invented a regression (2026-08-22)

Multi-card probe (`帮我算下 BMI 再看看蛋白质`, `cron + chmod`, `英里 + 华氏度`): no reply ever
produced two cards, and the first two merged both jobs into **one** card (91 and 178 lines) —
which is the better answer, so multi-card is a non-need, not a gap. The third produced nothing.

Chasing that third one nearly produced a false finding. `5 公斤 3 两 是多少磅` is a recorded
positive fixture and now read 0, so I checked out an older `src/prompt.ts` to bisect. The old
build gave **0** and HEAD gave **1** — the opposite of a regression, and contradicting a run of
HEAD three minutes earlier. Six repeats on HEAD: **0/6**. The single `fence=1` was one flap in
seven, and the fixture itself was probably written from an equally lucky single sample.

So: not a regression, a **standing gap**. The trace is 337 characters and ends
*"This is simple, no need for tools. Just answer directly."* — the rule layer was never reached.

Fixed with the same shape that works: name what happens after the reply. *A conversion is never
asked once* — they will be back within the minute with a different number, and
`这是简单事实问题` is about the cost of building, not about whether they wanted it.
After: **6/6 across two different conversion prompts**, `5 公斤 3 两` → 11.35 lb with
`LB_PER_KG = 2.2046226218`. Prose fixtures still 4/4.

**The method rule, hit twice today: one run decides nothing about prompt behaviour.** The first
time it made a canvas invisible (counting fences), this time it nearly pinned a nonexistent
regression on a specific commit. Before attributing a shape change to an edit, repeat it —
and repeat the *old* side too.

### Re-measuring today's rules at 3 runs each (2026-08-22)

Once the flap rate was known, everything decided on one sample had to be rechecked.

| prompt | rule | 3-run result |
| --- | --- | --- |
| `想开始跑步，怎么循序渐进` | plan | 3/3 canvas |
| `帮我把 .env 弄明白，有几个值我要改` | unnamed value | 3/3 fence |
| `这个目录下都有啥文件…` | browse | 3/3 fence |
| `什么是闭包？` | must stay prose | 3/3 prose |

All stable. One correction falls out: the browse fixture demanded a **canvas**, recorded from the
single run that produced a 522-line file browser over a whole repo. Against a 6-file directory it
now picks a **fence** — 171 lines, still `readdir` + `readFile` reading live. That is the shape
tracking the size of the thing, which is right; the fixture was over-specified, so the fixture
was loosened rather than the prompt pushed. **A fixture that pins the container instead of the
behaviour will eventually fail for being correct.**

### The glob rule inverts on a real directory (2026-08-22)

Re-measuring the expression fixtures at 3 runs: cron 3/3, chmod 3/3, glob **2/3**. The miss
blamed an empty workspace — *"the workspace has only `o.txt`, so there's nothing meaningful to
match against"* — so I built a real `src/` tree (nested dirs, `.ts`/`.tsx`/`.js`) expecting it to
go 3/3.

It went **0/3**. The opposite of the hypothesis, and the reason is the pattern this session keeps
finding, in its strongest form yet. With real files to look at, the model looked — and what it
found was *nuance*:

> *"I want to verify my claim about `**/` matching zero directories and `.d.ts` matching. These
> are the non-obvious points worth being precise about."* … *"it's also potentially overkill for
> 'what does this glob match.' I'll go with a clear prose answer that's precise about edge cases."*

**Having something concrete to show made it explain instead of show.** The edge cases it wanted to
be precise about — `**` matching zero directories, whether `.d.ts` counts, bash without globstar —
are precisely the ones learned by editing a pattern and watching ticks move.

The existing rule already blocked `this is a simple factual question`. It needed the other side:
`这些细节值得讲清楚` is the argument for the card, not against it. After: **3/3**, 136 lines,
`readdir` reading the real tree, an editable pattern field, and `types.d.ts` called out by name.
Prose fixtures 4/4.

Worth noting the empty directory scored *higher* (2/3) than the populated one (0/3) — a fixture
with nothing in it can pass for the wrong reason. Test the shape against a workspace that
resembles the user's.

### "The table is fixed" is the third way out (2026-08-22)

Re-running the expression fixtures inside a *populated* workspace (the empty one flatters them):
cron 3/3, chmod **2/3**. The miss reasoned:

> *"this is a well-known concept and a clear prose answer with a table is fine … the answer is
> essentially a fixed table of 755 → rwxr-xr-x."*

and then listed 755, 644, 700, 777 — which is a row of presets described as prose.

Three distinct escapes are now on record for the same rule, each needing its own sentence:

| escape | counter |
| --- | --- |
| "简单事实问题" | simple is the cost of building, not evidence it was unwanted |
| "细节值得讲清楚" | enumeration is what the card does better than you |
| "这张表是固定的" | fixed is *why* toggling beats printing — the thing being learned is which bit does what |

After: **3/3**, 165 lines, presets for 644/700/777 wired as buttons. Prose fixtures 4/4.

The shape of this whole session: **the model does not reject the rule, it finds a new reason the
rule doesn't apply.** Each reason is locally reasonable, which is why they have to be answered
individually and by name rather than by making the rule louder.

### Hunting the next escape, and finding the one that inverts (2026-08-22)

Three escapes were on record, so I went looking for a fourth instead of waiting to trip over it:
three prompts the rule should cover, 3 runs each, populated workspace.

| prompt | before |
| --- | --- |
| `semver ^1.2.3 到底包含哪些版本` | 3/3 |
| `正则 ^\w+@\w+\.\w{2,}$ 能匹配什么邮箱` | 1/3 (one reply produced **two** cards — the only multi-card seen) |
| `git reset --soft --mixed --hard 有啥区别` | **0/3** |

The git reasoning gives the fourth escape, and it is the strongest of the four because it does
not dodge the rule, it **reverses** it:

> *"this is a conceptual teaching question, not a computation. A card doesn't add much here — the
> three states are fixed facts, not something to explore."*

Said immediately after drawing a HEAD × index × working-tree grid by hand. A concept with nothing
to compute is the case prose is *worst* at: three boxes and a button that shows which ones move.
The counter added: whenever the explanation needs a before/after or a row per mode, the reader
learns it by running it once, not by reading which cells say 不动.

After: git **3/3** (111 lines, all three modes, HEAD and index wired to a click), regex **3/3**.
Full regression 7/7.

Four escapes, four sentences, same rule. **They are not rejections of the rule — each is a reason
it doesn't apply here, locally reasonable every time.** Which is why volume does not help and
naming the specific thought does.

### Tidying the prompt cost accuracy (2026-08-22, reverted)

The expression rule had grown to 1954 characters — four times the next longest line — because
four escapes were answered inside one sentence. I rewrote it as a lead paragraph plus a four-item
list, one per escape: same content, clearer, and 162 tokens cheaper (4119 → 3957).

Then measured, because a rewrite is a change:

| | glob | chmod | git | conversion |
| --- | --- | --- | --- | --- |
| flowing paragraph | 3/3, later 4/4 | 3/3 | 3/3 | 3/3 |
| tidy bulleted list | **4/7** | 3/3 | 3/3 | 3/3 |

Only glob moved, and it moved a lot. The likely reason is that the list form compressed exactly
its clause — the flowing version spelled out *put their real files on one side and a tick or a
cross on the other, and let them edit the pattern until the crosses move*; the bullet keeps the
words but loses the run-up. **Reverted.** 162 tokens is not worth a rule that fires half the time.

Two things to carry: **legibility to a human reader is not the objective function here**, and a
refactor of prose is a behavioural change that needs the same 3-run treatment as a new rule.
Nothing about the tidy version looked worse — that is why it had to be run.

### The fifth escape, unresolved — and why the fix was worse (2026-08-22)

Teaching prompts, 3 runs each in a populated workspace: `flex-grow/shrink/basis` 3/3,
`JS reduce 怎么用` 3/3, `什么是二分查找` 2/3. The miss **quotes the rule and overrules it**:

> *"The generative-ui guidance says 'concept with nothing to compute is the one thing prose
> genuinely cannot convey.' But binary search is actually very well served by prose + a small
> example. The user just asked 'what is binary search' — a definitional question."*

Broadened to the `什么是X` shape: **4/9** across 二分查找 / 快速排序 / 哈希表. A real pattern,
not a flap.

The attempted fix drew the line at *rule vs process* — a closure is a rule you can state, binary
search is a process that unfolds; if you are about to write 第一步…第二步, you have found a
process. Measured:

| | before | after |
| --- | --- | --- |
| 二分查找 | 1/3 | **3/3** |
| 快速排序 | 1/3 | **3/3** |
| 哈希表 | 2/3 | 2/3 |
| 什么是闭包？ (must stay prose) | 3/3 prose | **2/3** |
| 什么是尾递归优化 (must stay prose) | 3/3 prose | **2/3** |

Two rescued, two broken. Net negative, so **reverted**; prose side back to 6/6 after.

Why it failed is the useful part. Every rule that has worked this session keys on **something
visible in the request** — an expression is handed over, a plan is asked for, a value is named as
changing. *Rule vs process* is a property of **the answer**, so the model has to fetch the answer
to apply it, and by then §"gathering data eats the turn" has already decided the shape. Worse, it
is a judgement call, which makes it leak: 闭包 and 二分查找 are the same seven-character question,
and pushing on one moved the other.

**Recorded open, deliberately unfixed.** The right fix is not a longer sentence — it needs a
trigger visible in the phrasing, and I do not have one yet.

### The fifth escape, closed — by the phrasing, not the concept (2026-08-22)

The failed fix keyed on *rule vs process*, a property of the answer. The way in was to check
whether the phrasing itself already carried a signal, so: same subject, four wordings.

| wording | before any change |
| --- | --- |
| `二分查找是怎么工作的` | **3/3** |
| `给我讲讲快速排序的过程` | **3/3** |
| `二分查找的原理是什么` | 1/3 |
| `什么是二分查找` | 2/3 |

**Nothing about the subject changed — only the phrasing did.** 怎么工作 and 过程 already work;
什么是 and 原理 are the same wish worded as a dictionary lookup. That is a trigger visible in the
request, which is the property every rule that has held this session shares.

| | before | after |
| --- | --- | --- |
| `二分查找的原理是什么` | 1/3 | **3/3** |
| `什么是快速排序` | 1/3 | **3/3** |
| `什么是二分查找` | 2/3 (4/6 over two batches) | **5/6** |
| `什么是闭包？` | prose 3/3 | prose **3/3** |
| `什么是尾递归优化` | prose 3/3 | prose 5/7 |

Kept. The one leak is 尾递归优化, and inspecting the card settles it: 205 lines, 17 mentions of
`frame`, a step-by-step stack walk. **Tail-call elimination is a stack changing shape** — that
card is the better answer, so the fixture was over-specified, like the browse one. Closure held
at 3/3 prose throughout, which is the boundary that mattered: a closure is a rule you state, and
nothing about it runs.

### Losing the working copy mid-session (2026-08-22)

After a run of `rm -rf` / `mkdir` cycles under `/tmp`, the shell's cwd was a deleted directory and
every command failed with `Unable to read current working directory`. That part was self-inflicted
and recoverable. What followed was not: the whole of `~/Desktop` began returning `Operation not
permitted` — to bash, to the Read tool, and to the separate Python MCP process alike, while
`~/.dsh`, `/tmp` and `~/.claude` stayed readable. A macOS TCC grant for the Desktop went away
mid-session.

Recovery was `git clone` of the pushed remote into `/tmp` and re-applying the one uncommitted
change, which was possible only because the preceding work had been committed and pushed as it
was verified. **Commit each verified step rather than batching** — the working copy is not the
durable artefact, and on this machine it can stop being readable without warning.

### A crashed process reads exactly like a rejected rule (2026-08-22)

With the Desktop unreadable, I re-ran the generalisation check for the new phrasing rule on three
fresh subjects and got **0/9**. The rule names "a protocol handshake" explicitly, so
`什么是 TCP 三次握手` scoring 0/3 looked like a clean refutation, and I was one keystroke from
writing "did not generalise".

The nine replies were `EPERM` stack traces. The globally-installed plugin is a **symlink into
`~/Desktop`**, so the moment that grant went away, every `dsh` run died before reaching a model —
and a dead run and a rejected rule produce the identical observable: `fence=0`.

Repointing three symlinks (`~/.bun/.../node_modules`, and one inside *each* profile's own
`node_modules` — the profile copy is separate and failed after the global one was fixed) at the
`/tmp` clone brought it back. Re-measured: **8/9** — TCP 3/3, OAuth 3/3, 事件冒泡 2/3. The rule
generalises well.

**Third time this session that a measurement artefact nearly became a finding** (fences without
canvases; one flap read as a regression; now a crash read as a refusal). The pattern in all
three: *the failure mode and the interesting result look the same at the metric*. So the rule is
not "repeat the run" — repetition would have given 0/9 every time. It is **check that the thing
under test actually ran** before believing a zero. A byte count would have caught this instantly:
4598 bytes of stack trace does not look like 0 bytes of nothing.

### The write rule does not over-trigger (2026-08-22)

Checking the `.env` rule's edges with three write-shaped prompts against a seeded workspace:

| prompt | shape | verdict |
| --- | --- | --- |
| `帮我把 package.json 里的 scripts 整理一下，我想加几个` | fence | card, right |
| `帮我改下 package.json 的依赖版本` | fence | card, right |
| `这个 .gitignore 缺了点东西，帮我补上` | **0/3 prose** | **also right** |

The third rewrote the file directly — 2 lines to 45 — and said what it added. That is the correct
answer, and it draws the boundary the `.env` rule needed: *有几个值我要改* withholds the values, so
the card is where the user supplies them; *帮我补上* is an instruction whose content the model
already knows, so a form would only add a click. **The rule fires on the missing value, not on the
word 改.**

Method bug found on the way: the harness copied fixtures with `cp -r "$seed"/*`, which omits
dotfiles — so the `.gitignore` fixture was never there and the model's *"其实里面还没有
`.gitignore`"* was simply true. Fixed to `cp -R "$seed"/.`. Worth noticing that the model's
report is what exposed the broken harness; the run looked plausible either way.

### Auditing the prose zeros after the crash (2026-08-22)

The crash-reads-as-refusal finding casts doubt backwards: any `0` recorded today could have been
a dead process. A `fence=1` cannot — a crashed run never emits a card — so only the **prose**
numbers needed checking.

Re-opened the surviving output directories for §"the fifth escape, closed" and measured bytes:
`闭包` 2157/2570/3083 and `尾递归优化` 2837/3060/3416/3828, every one opening with real Chinese
prose. No crashes in that batch; the record stands.

Keep the habit: **a zero is only evidence once you have seen the reply it came from.** Byte count
plus the first line is enough, and `scripts/eval.sh` now prints both.

### Out of quota mid-session (2026-08-22)

`deepseek-official` returned `dsh: QUOTA: Insufficient Balance` — six runs in a row, 34 bytes
each, which the harness happily reported as `fence=0`. Exactly the failure the previous section
is about, arriving one hour later in a new costume. `eval.sh` now treats a `dsh: QUOTA` line as a
crash.

Switching providers was available and deliberately not taken: every number recorded today comes
from `deepseek-v4-pro` at `reasoningEffort: high`, and a rule kept on one model's behaviour is not
evidence about another's. The unmeasured rule was pushed to the branch
`unverified/history-is-a-set` instead of merged, with the measurement it still needs written into
the commit message.

### Cards that compile, mounted for real (2026-08-22)

`compile-cards.ts` only proves a card compiles, and §4 lists three ways a card compiles cleanly
and renders blank — so the cards had never actually been run. Added `scripts/render-cards.ts`,
which serves them, and drove it with ego-browser: compile in-page through `@esm.sh/tsx`, import
the result as a blob module, `createRoot().render()`, read `innerText` back.

Three of today's canvases, all **ok**: `guitar-start` 428 chars, `running-plan` 761,
`jizhang` 26 (an empty-state — correct). `localStorage` held four keys including
`canvas:jizhang:draft`, which is the half-typed value the edit-remount rule asked for, saved
without being told to.

Nearly filed a bug on the way. Clicking a checklist item with `.click()` left the counter at
`已完成 0/32` and `done:{}` — looked like broken state wiring. Dispatching the full
`pointerdown → mousedown → pointerup → mouseup → click` sequence moved it to `2` with both keys
persisted. **The card was fine; the synthetic click was not.** Same lesson as the crash-vs-refusal
one, from the other direction: verify the instrument before believing what it says about the
subject.

### Cross-checking the record against itself (2026-08-22)

With 46 sections of measurements, a number transcribed wrong is more dangerous than a missing
one — every later reader, including a research agent, treats it as fact. Scanned CLAUDE.md for
any prompt scored differently in two places: one real conflict, `什么是二分查找` recorded as
both 2/3 and 1/3.

The surviving output settles it: two batches of three, `fence=1` twice each — **2/3 both times,
4/6 overall.** The 1/3 was a transcription slip while writing the second section up. Corrected.

Cheap and worth repeating: group every backticked prompt that appears near an `N/M` and print the
ones whose sections disagree.

### Re-checking the Web Audio facts, and one that was half true (2026-08-22)

The `## Sound` section drives real card behaviour and was measured days ago, so it was re-run
against a probe page. Four of five reproduced exactly: a pre-gesture context is born
`suspended`; `osc.start()` on it throws nothing; `OfflineAudioContext` renders 44100 frames with
no interaction; a context created after one real press is born `running`.

The fifth was **incomplete, and in the direction that matters**. The note said `await
ctx.resume()` before any gesture *never settles* — true — which reads as *that context is beyond
saving, so build it lazily inside the click*. Measured: on the first real press, the promise that
had been hanging since page load **resolves**, and the early context flips to `running` too.

The two runs that disagreed are the useful part:

| | early ctx after | its pending resume() |
| --- | --- | --- |
| real gesture (ego-browser `click`) | `running` | **resolved** |
| scripted `element.click()` | `suspended` | still pending |

A scripted click unlocks nothing — same trap as the checklist button earlier today, where a bare
`.click()` made a working card look broken. **Twice in one session a synthetic click produced a
false negative**, so: when a measurement depends on user activation, drive it as input, never as
a method call.

Skill updated: build the context whenever you like, keep `resume()` off the render path, and the
first real press repairs it.

### The FFT number was right and read wrong (2026-08-22)

`## Sound` said *"an `AnalyserNode` at 1024 bins resolves to about 21Hz"*. Measured in an
`OfflineAudioContext`: `fftSize = 2048` → 1024 bins → 21.53Hz; `fftSize = 1024` → 512 bins →
43.07Hz.

So the figure was correct and the sentence was a trap: **the number a reader sets is `fftSize`,
and the number the note quoted was `frequencyBinCount`.** Anyone who took `1024` as the knob got
half the resolution described — exactly the gap between "fine for a picture" and "usable for a
tuner", which is the distinction the sentence exists to draw. Reworded to give the formula and
both rows.

Nothing was wrong here, which is the point: an accurate note can still mislead if the quantity it
names is not the one the reader will type.

### Tests for the streaming JSON walk (2026-08-22)

`collect.ts` parses a canvas out of tool-call arguments **by hand**, because the arguments arrive
a few bytes at a time and can stop inside a `\t` or halfway through a `\u2192`. It had no tests:
every failure it guards against is a canvas that vanishes or flickers mid-generation, which is
exactly what nobody notices until a demo.

Four tests, the middle one carrying the real property: **feed every prefix of a settled write and
assert the code only ever grows.** That is the streaming invariant stated directly — no throw, no
shrink — rather than a handful of hand-picked cut points.

Both were mutation-checked before being trusted, which is the only reason to believe them:
making the half-escape guard emit `?` fails the escape test, and making an unterminated backslash
drop a character fails the prefix test. Without that step a passing test proves nothing about the
code, only about itself.

Note the fixture had to be hand-written for the `\u` case: `JSON.stringify` emits `→` literally,
so a fixture built with it never exercises the branch. My first draft did exactly that and its
three failures were all mine, not the parser's.

### Testing the `?bytes=1` round trip, and two bugs found doing it (2026-08-22)

The binary path — route answers `Buffer.toString("base64")`, `readBytes` decodes with an `atob`
char loop — is what everything fed to `decodeAudioData`, a MIDI parser or an image decoder rests
on, and it had no test. Added three: all 256 byte values survive; lengths either side of a base64
group; and the failure the route exists to avoid, where the same bytes read as text come back
**512 long instead of 256**.

Two things fell out of writing them.

**A test that re-types the implementation tests only itself.** The loop was an anonymous arm of
`readBytes` and could not be imported, so the first draft copied it — and would have kept passing
through any edit to the real code. Extracted `decodeBase64`, which is one named function rather
than a layer, and the test now imports it. Mutation-checked with `& 0x7f`: 2 of 3 fail.

**The extraction changed an inferred type, and `types/check.ts` caught it.** A bare
`: Uint8Array` return annotation widened to `Uint8Array<ArrayBufferLike>` where the inline version
had inferred `Uint8Array<ArrayBuffer>`, and the two-way assertion failed exactly as §2.7 says it
should. Second time that check has earned itself.

### A prefix test that only fires outside your home directory (2026-08-22)

`scripts/typecheck.mjs` splits tsc output with `line.startsWith("node_modules/")`. Working from
the `/tmp` clone, tsc emits `../../private/tmp/recover/node_modules/...` — because `/tmp` is a
symlink to `/private/tmp` — so upstream's two known errors were counted as ours and `bun run
check` failed on a clean tree. Changed to `includes`.

The bug was always there; it took being forced out of the usual working directory to see it.
**Path predicates written against one location are assertions about the environment**, and this
one had been true for two days by luck.

### A game never hides its own source (2026-08-22)

`hasPainted` decides when the host code block is hidden: text, or an `svg`. Reading it against
what the research asked for — 2048, Life, Snake, all of which the user named — the gap is
immediate: **a `<canvas>` carries neither.** Those cards score as never-painted, so the observer
never fires and the raw TSX stays on screen under a working game, forever.

Confirmed in a browser rather than argued, because arguing has been wrong three times today:

| mount | before | after |
| --- | --- | --- |
| empty shell `<div class="grid gap-2">` | false | **false** |
| text | true | true |
| `<svg>` | true | true |
| `<canvas width=400>` | **false** | true |
| `<img>` | **false** | true |
| canvas + a score label | true | true |

Selector widened to `"svg, canvas, img"`. The empty shell still reads false, which is the case
the function exists for — widening the test must not cost the thing it was protecting.

This one was found by **reading the code against the intended examples** rather than by running
prompts. Worth doing more of while the quota is out: the corpus says what cards will look like,
and the runtime can be checked against that without a single model call.

### A loop outlives the card that started it (2026-08-22)

Following the same thread as the canvas fix — check the runtime against the examples the research
promised — the next one is **AutoPlay**, which the user asked for by name so a demo can be shown
to someone else. AutoPlay means a `requestAnimationFrame` loop that runs unattended, and the skill
said nothing about stopping one.

Measured with two React roots side by side, one loop with a `cancelAnimationFrame` cleanup and one
without:

| | at unmount | 2s later |
| --- | --- | --- |
| with cleanup | 134 ticks | **134** |
| without | 134 ticks | **375** |

The cost is peculiar to this product: **a card is replaced on every revision.** Ten passes over a
Snake card leaves ten loops painting into canvases nobody can see, and it does not present as a
broken card — it presents as the conversation getting slower for no visible reason.

New skill section covering `requestAnimationFrame`, `setInterval`, window listeners and
`AudioContext`, plus the point that an AutoPlay meant for showing to someone needs a visible
pause — a demo you cannot stop is one you cannot talk over.

Two runtime bugs now found this way in a row, without a single model call. **The corpus is a
specification: read it as one and test the runtime against it.**

### `$dsh/ai` yielded one character at a time (2026-08-22)

`streamText` appears 17 times in the examples doc, usually as *"stream it in and render as it
arrives"*. Reading its implementation against that use: `yield* decoder.decode(...)` **spreads the
string**, so the consumer gets one character per iteration.

Not a correctness bug — the text is identical — but for a card that re-renders per piece it is a
`setState` per character. Measured on 560 characters of Chinese arriving in 64-byte chunks:

| | iterations | text intact |
| --- | --- | --- |
| `yield*` (was) | 560 | yes |
| `yield` per chunk | **27** | yes |

Changed to `yield`, with a test through the public `bind().ai.streamText` path (a fake `fetch`
plus a `ReadableStream`), so it exercises the real code rather than a copy. Three cases:
one piece per chunk, piece count equals chunk count on a long answer, and the reason `stream:
true` is there at all — a `好` split across two chunks must not come back as `U+FFFD`.

Mutation-checked both ways: restoring `yield*` fails two, dropping `stream: true` fails two
including the split-character one.

Third runtime finding in a row from reading the corpus as a specification, and the pattern in all
three is the same — **the failure is invisible in the small case.** One short English answer
spreads to a few dozen iterations and nobody notices; the cost only appears at the length and the
language the examples actually target.

### Auditing the `.d.ts` files the model actually reads (2026-08-22)

`types/check.ts` proves the declarations stay *assignable* to the implementation. It says nothing
about whether the prose in them is true, and that prose is the only thing the model has when it
writes a card. Checked every claim in the four files against the code:

- 15-second exec timeout — matches `EXEC_TIMEOUT_MS = 15_000`
- 8MB `readBytes` cap — matches `MAX_BINARY`
- `FS_SANDBOX_DENIED` on a read-only write — the code maps that code to 403
- *"`scripts/check-types.ts` asserts the two stay assignable"* — **that file does not exist**; it
  is `types/check.ts`. A dead pointer in the one document written for the model to follow.
- *"`size` is absent for directories"* — unverifiable from here (see below), so reworded to
  *treat it as optional and draw nothing rather than `0 B`*, which is true either way.

Trying to verify the `size` claim ran into the sandbox: `GET /dsh-generative-ui/fs?...&list=1`
against a live web instance returns **403** with no session, confirming §"addressed by session
id, not cwd" from the other direction. The route cannot be exercised without a real conversation,
so that one waits for quota.

`types/*.d.ts` needs the same suspicion as any other measurement: **assignable is not accurate.**

### Why the streaming chart only collapses once (2026-08-22)

§"Streaming charts, finally measured" recorded 17 states with a single 80ms collapse and left the
mechanism open. The renderer remounts whenever the **hook signature** changes
(`preserveBoundaryEpoch += 1` in `partial-react/src/runtime.ts:412`), and a card being written
gains hooks as it goes — so why only one collapse?

Replayed a real 10.7KB canvas as 53 streamed prefixes through `normalizeGeneratedTsx`:

```
at   200 / 10723  hooks -1 -> 0  hasReturn=false   2%
at  1600 / 10723  hooks  0 -> 1  hasReturn=false  15%
at  2000 / 10723  hooks  1 -> 2  hasReturn=false  19%
at  2200 / 10723  hooks  2 -> 3  hasReturn=false  21%
```

**Three remounts, all inside the first 21%, every one of them before a `return` exists.**
Remounting an empty card is free; for the remaining 79% the signature is constant and the chart
fills in undisturbed. The single visible collapse is the settled recompile at the end.

So the good behaviour is not luck, but it is **conditional on hooks being declared in the ordinary
place**. A hook added after the markup, or one behind an `if` that flips, moves a remount into the
middle of a visible card. Written up in the skill with the measurement, since "put your hooks at
the top" reads as style advice until you know it costs a redraw.

### Replaying every card, and a probe bug that read as a card bug (2026-08-22)

Turned the prefix replay into `scripts/replay-stream.ts` and ran it over the three canvases on
disk. First result: `guitar-start` showed **4 of 4** hook changes landing after a `return` existed
— exactly the visible blank-and-rebuild the new skill section warns about, found in the wild.

It was wrong. The file defines a helper component before the default export, so its `return (` at
line 128 satisfied the probe long before the *card* could paint; the default export's own hooks
start at line 166. Changed the predicate to "the default export has begun returning markup":

| card | hook changes | after the card paints |
| --- | --- | --- |
| guitar-start | 4 | **0** |
| jizhang | 2 | 0 |
| running-plan | 3 | 0 |

All clean. **Fifth time today a measurement artefact impersonated a finding** — and the first one
where the tell was that the result was too interesting: a rule written an hour earlier, confirmed
on the first card tried. That is worth distrusting on its own.

### What `normalizeGeneratedTsx` is actually worth (2026-08-22)

Extended the replay to compile every frame, then checked the check — a detector nobody has tried
to fool gives free passes, which today has cost five findings.

`transform` is tolerant. It **throws** on unclosed JSX, a JSX subscript, an unterminated string, a
stray brace; it **shrugs** at `className={"a" ++ }` and at a file cut mid-word. That is the right
sensitivity for this job, because truncation produces the structural kind.

Measured on a real 6.5KB canvas cut at 100-byte intervals:

| | frames failing to compile |
| --- | --- |
| raw prefix | **58 of 65** |
| after `normalizeGeneratedTsx(…, streaming)` | **0 of 65** |

Nine out of ten streamed frames of a real card are broken code, and the normalizer repairs all of
them. Previously that layer had only a synthetic benchmark behind it (2000 unclosed fences in
6.2ms, which measures speed, not repair).

`scripts/replay-stream.ts` now reports `brokenFrames` alongside the remount count, with the
sensitivity limits written next to the call so nobody reads a zero as "this card is fine".

### A git history is a set, measured after the outage (2026-08-22)

Parked on a branch when the quota ran out, with the note that it still needed measuring. It did —
and the first thing measuring corrected was **my own baseline**. The pre-outage record said
`0/2`; those two runs sat right around the plugin-symlink failure. The honest baseline is
**4/9**.

| | `git 历史帮我梳理一下` + `最近都改了啥` |
| --- | --- |
| without the rule | 4/9 |
| with it | **6/6** |

Both cards inspected: 195 and 293 lines, each importing `$dsh/exec`, running `git log` through it
rather than pasting a summary, and offering an author filter. **That is the first time `$dsh/exec`
has appeared in a produced card** — the adversarial critique in `docs/examples.md` counted 0 uses
across 11 canvases and called the capability demand invented downstream. It was, for browsing
files. For history it is the difference between a card that re-runs tomorrow and a story about
last week.

Prose fixtures 5/5 after. Merged.

The wider lesson repeats the day's theme from a new angle: **a number recorded during a broken
environment poisons the comparison, not just the run.** Had I trusted `0/2`, the rule would have
looked twice as effective as it is.

### 能做啥 is 推荐几个 with the number taken out (2026-08-22)

Testing the streaming change against a card that would really use `$dsh/ai`:
`冰箱里就剩鸡蛋、番茄和一点剩饭，能做啥` — **0/4**, four numbered dishes in prose, each with
steps, ending on *"要不要我帮你把其中一道的详细火候列一下？"*.

The same subject one wording over produced a **302-line card**:
`给我推荐几个周末在家能做的菜，我想边看边挑` → 1/1, filters and expandable recipes. Third time
today the phrasing decides and the subject does not.

The trace is 724 characters and never reaches the rule layer:

> *"This is a simple factual/casual question. No tools needed, no interface needed really."*

The `asking for a few of something` rule already lists *a dinner suggestion* — it was never
consulted, because 能做啥 does not look like asking for a few. Added the counter with the measured
pair in it, and the give-away stated as **a list where every item has a body**: steps, times, a
reason to pick one. 这就是个闲聊问题 describes the tone, not what they will do with the answer.

After: **3/3**. Prose fixtures held — `什么是闭包？` came back once as a card and then 4/4 prose on
a re-run, so that was flap, not leakage.

Also worth recording as a **non**-finding: `给我推荐几个周末能做的菜` hardcodes its dishes and does
not reach for `$dsh/ai`, and the reasoning defends it — *"the user asked for a curated few to
browse, not for an open answer space"*. That is a fair reading, and unlike the Tokyo case in the
skill it does not claim the knowledge is fixed. Left alone.

### The metronome, and the sixth measurement artefact (2026-08-22)

`给我个节拍器，能调速度那种` — 1/1, 280 lines, and it follows both rules written during the
outage without being asked:

- the `AudioContext` is created lazily **inside the click**, and `ctx.resume()` is called
  without `await` — exactly what the *never settles* note is for;
- `clearInterval` plus every pending `setTimeout` cleared in the effect's cleanup, and a separate
  unmount effect that calls `close()`, commented 卸载时清理.

It also uses lookahead scheduling (a 25ms poll against `nextNoteTime`), which is the correct way
to build one and nothing told it to.

Then `replay-stream.ts` reported **2 visible remounts** — a real-looking hit on a card whose hooks
are all declared at lines 43–55, which is suspicious on its face. It was the probe again: my
`paints` predicate matched `return (`, and an effect's cleanup is `return () => {`. A metronome
writes several of those before any markup exists. Tightened to `return\s*\(\s*<`.

All four cards on disk: **0 visible remounts.** Verified the probe still fires by feeding it a
card whose second component gains a hook after the default export paints — it reports 1.

**Sixth artefact today, and the second from this same probe.** The first version was too loose
about *which* `return`, the second about *whose*. Both times the wrong answer was the alarming
one, which is the direction that gets written up. A detector needs a known-bad input every time
it changes, not just when it is written.

### The games and instruments the research promised, built and run (2026-08-22)

Three cards the user named by hand, generated and then actually mounted:

| prompt | shape | lines | mounts |
| --- | --- | --- | --- |
| `做个 2048 小游戏，要能自动演示给别人看` | canvas | 766 | 2048 开局, 分数 0 |
| `想要个能弹的钢琴键盘` | canvas | 453 | C4–C6 with key bindings |
| `给我个节拍器，能调速度那种` | fence | 280 | BPM, 2/4–7/4, 轻拍定速 |

All three clean under `replay-stream.ts` (0 visible remounts, 0 broken frames), and every rule
written during the outage was followed without being asked for:

- 2048's AutoPlay is a recursive `setTimeout` whose cleanup sets `cancelled = true` **and**
  clears the handle, with a separate unmount effect and a `removeEventListener` for its keydown
- the piano and metronome build the `AudioContext` inside a click and call `resume()` without
  `await`
- the metronome schedules with a 25ms lookahead poll, which nothing told it to do

**AutoPlay verified live**: clicking 自动演示 moved the score 0 → 20 in four seconds, the button
became 暂停演示, and there are 慢/中/快 speeds — a demo you can talk over, which is what it was
asked for.

Then the leak check, which is the part worth keeping. Patching `setTimeout` and unmounting with
AutoPlay running counted **16 timers still firing** — an obvious leak, and wrong. A control run
that unmounted *without* ever starting AutoPlay counted **16 as well**: the number is React's own
scheduler plus the probe's own waits. Identical either way, so the cleanup works.

**Seventh artefact, first one caught before it was written down** — because the control was run
first this time rather than after the result looked alarming.

### The last unmeasured rule, and where it correctly stops (2026-08-22)

`"Visualise this" is this block, not a tool` was the one resident rule with no fixture, because a
fence count cannot see the failure it prevents. Read the session's `tool/call` names instead:

| prompt | tool calls | fence |
| --- | --- | --- |
| `帮我把这几个数画成图 12 45 33 78` | `[skill]` | yes |
| `这组数据画个折线图看看 3,7,2,9,5,8` | `[skill]` | yes |
| `用 matplotlib 画个柱状图 10 20 30` | `[bash ×6, read_image, bash]` | yes |

The first two quote the rule in the reasoning and go straight to the block. The third is the
interesting one and it is **right**: the user named the tool, so it produced `chart.png`, showed
the script for reuse, *and* added an interactive card on top. The rule is about the detour nobody
asked for, not about refusing an explicit request — and it draws that line by itself.

Every resident rule now has a fixture. The method for this one is written into
`test/eval-fixtures.md`, since "assert no `run_code`" needs the transcript, not the reply.

### Does loading the skill change the answer? (2026-08-22)

Several of today's misses share a shape: the trace ends at *"no interface needed really"* and
`tools=[]` — **the skill was never loaded.** Worth quantifying, so: every session from the last
three hours, restricted to the fixtures that are supposed to produce UI.

| | produced UI | did not |
| --- | --- | --- |
| skill loaded | **41** | 11 |
| not loaded | 3 | 9 |

79% against 25%, n=64. Real, and **not a demonstrated cause**. The likely arrow points the other
way: deciding to build is what makes the model call `skill`, so this may be measuring the
decision rather than its effect. Settling it needs an intervention — change only the catalog
`description` (the entire routing signal, per `skill.ts:10`) and re-measure — which is a real
experiment, not a note.

Two artefacts corrected while getting the number:

1. Counting `ui4a/tsx` **anywhere in the transcript** scored 120 of 120 runs as producing UI —
   the resident prompt contains the string. Must count the assistant's reply text only.
2. Counting fences alone put 2048 and the piano in the "skill loaded, no UI" column. They wrote
   **canvases**; the canvas path shows up in tool-call arguments, not in the reply.

Same lesson as §"Counting fences does not count canvases", met again in a new disguise, plus a
new one: **a corpus spanning a rule change is not one population.** The first cut included
sessions from before today's edits and put `帮我算下房贷` in the failure column, where it has not
belonged for hours.

### The whole table, three runs each (2026-08-22)

```
什么是闭包？ / 今天星期几 / 418 / 尾递归优化        0 0 0   (prose, correct)
房贷 / BMI / 五个猫名 / cron / chmod / 目录        1 1 1
98 华氏度 / git reset / 能做啥 / 画成图 / 月供      1 1 1
5 公斤 3 两 / cron 一年多少次                      1 1 1
glob                                              1 C C
.env / 跑步计划 / 学吉他                           C C C  (跑步 first run: K)
二分查找原理 / git 历史                            1 1 C
```

Every fixture that completed is at its recorded value, prose included. The nine `C`s are the
quota running out partway through — I had 69 calls in flight plus an unrelated experiment.

**That is the harness earning its keep.** Without the crash check those nine are nine zeros, and
the `.env` row reads as a regression on a rule measured 3/3 two hours earlier. The blacklist
version added this morning would have caught them too, but only because `QUOTA` had already been
seen once; the transcript-absence test added since covers the ones that have not been.

`scripts/run-fixtures.sh` runs the table concurrently — serially it outlives a tool timeout — and
prints `K` for a canvas so the shape is never scored as a miss.

### Every checker, verified against a known-bad input (2026-08-22)

A checker nobody has tried to fool gives free passes, and this repo had two:

- **`compile-cards.ts` had never failed anything.** It counted `bad` from the day it was written
  and never called `process.exit`. Worse, it still pointed at `.research/cards`, which vanished
  with the old working copy — so it had been crashing with `ENOENT` and reporting success. Now
  defaults to `test/cards`, and exits 1. Verified against both failures it exists to catch.
- **`replay-stream.ts` printed a warning and exited 0.** Now exits 1, verified with a card that
  gains a hook after painting.

`smoke.ts`, `build.ts` and `gen-standalone.ts` throw, which is a non-zero exit under bun —
confirmed by corrupting the plugin id in `lib/client.js` and watching smoke exit 1.
`render-cards.ts` is a server and should not exit.

`bun run check` is now lint → typecheck → test → **audit → replay → cards** → build → smoke, with
three real generations kept in `test/cards` as fixed input.

**Two `$?` readings were wrong along the way**, both times because a pipe stood between the
command and the check: `bun run x | tail -2; echo $?` reports `tail`'s status, so a genuine
failure read as success. Twice today that briefly made a working gate look broken. When the exit
code is the measurement, do not pipe.

### The checker command never worked, and a model change is what showed it (2026-08-22)

`## Check it before you hand it over` has told the model to run
`npx --yes <cli> check <file>` since the day it was written. Sandboxed — which is where the
model's commands run — a bare `npx` **always fails**:

```
npm error code EPERM
npm error syscall mkdtemp
npm error path /Users/muspi-merol/.npm/_cacache/tmp/o63SrT
npm error Your cache folder contains root-owned files …
```

The message is a red herring: nothing under `~/.npm` is root-owned (checked: 0 files). The cache
is simply not writable from inside the sandbox. The same command in my own shell prints `OK`,
which is why it went unnoticed for two days.

Fixed by prefixing both commands with `npm_config_cache="$TMPDIR/npm-cache"`, verified from
inside the sandbox in both directions: bare fails, prefixed prints `OK`.

**It surfaced only because the model changed.** DeepSeek never ran the checker at all, so the
broken command cost nothing. `macaron-v1-venti` follows that section literally — writes the card
to a temp file, runs `check`, fixes the reported TypeScript errors over three rounds, re-runs
until `OK`, then pastes the result into the fence — and it hit the failure on its first attempt,
worked around it with `npm_config_cache` on its own, and carried on.

**Instructions nobody follows cannot be wrong.** A second model is a test of the prompt, not just
of the answers.

### First look at `macaron-v1-venti` (2026-08-22)

Wired the fixtures at a second model — `macaron-v1-venti` on the sd litellm gateway (:24000) —
after the DeepSeek balance ran out. `scripts/eval.sh` honours `DSH_HOME`, so this is an isolated
dsh home rather than an edit to the user's global `settings.yaml`; see `profiles/README.md`.

What differs, from the first 22 sessions:

- **It runs the checker.** Every card goes to a temp file, through `@genui/cli check`, and back
  through three rounds of fixing what the checker reports before reaching the fence. DeepSeek has
  never once done this, which is how the broken `npx` command survived two days.
- **It reaches for the workspace.** `.env` cost it `glob + grep + read ×5` where DeepSeek reads
  the two files and stops.
- Canvases land in the right place (`.dsh/ui4a/canvases/`), replay clean (0 visible remounts, 0
  broken frames), and carry `localStorage` — so today's persistence and hook-ordering rules hold
  on a model they were not tuned against.

Two fixtures look weaker so far (`git reset`, `二分查找`, both 3/3 on DeepSeek). Waiting on the
full grid before drawing anything from that: shape counts need the canvas column, and this model
writes canvases where DeepSeek writes fences.

### The full fixture table on a second model (2026-08-22)

`macaron-v1-venti`, one run each, 23 fixtures: **23/23 correct.** Prose stays prose (4/4 at
zero), every UI fixture produces one, and both plan fixtures choose a **canvas** — the same shape
DeepSeek picks.

The two that looked weak in the partial view (`git reset`, `二分查找`) were both fine. I had been
reading tool-call summaries mid-run and counting only fences; the grid counts canvases too.
**Ninth time today that an incomplete counting method produced a wrong impression** — and this one
I published in a message before the grid finished, which is worse than keeping it in a note.

So the rules written against DeepSeek transfer whole to a model they were never tuned on. That is
some evidence they describe the request rather than one model's habits — the property every rule
that survived today was selected for.

Where the models differ is process, not outcome: venti writes each card to a temp file, runs
`@genui/cli check`, fixes what it reports over about three rounds, and only then answers. That
habit is what exposed the two-day-old broken `npx` command; the outcome column would never have
shown it.

### The skill-description experiment has no control group on this model (2026-08-22)

§"Does loading the skill change the answer?" left an intervention open: change the catalog
`description` and re-measure, since 79% against 25% is a correlation whose arrow is unknown.

With venti available, tried to assemble the control group it needs — prompts that **should**
produce UI but do not load the skill. Six candidates outside the fixture set:

| prompt | tools |
| --- | --- |
| `帮我看看这个月该还多少信用卡` | `skill, bash` |
| `我每天喝多少水合适` | `skill, bash×2, write` |
| `npm 和 pnpm 有啥区别` | `skill` |
| `帮我看看这几个端口都被谁占了` | `skill, bash×2` |
| `这台机器磁盘都被什么占满了` | `skill, bash×13` |
| `我这些依赖哪些能升级` | `skill, bash×8, glob, read` |

Six for six, all producing UI. The only two that skipped the skill —
`这个报错啥意思 EADDRINUSE` and `为什么我的 git push 总是要输密码` — are single-fault diagnoses where
prose is the right answer, so they are not misses.

**venti loads the skill on essentially everything that could want an interface**, which leaves no
control group: the description cannot be shown to matter on a model that already reaches for it.
The experiment is not abandoned, it is **inapplicable here** and would have to run on DeepSeek,
where the 25% column came from.

Recording this rather than assembling a weaker control: a group picked to be small is a group
picked to produce an answer.

### A dev server outlived its session by a day (2026-08-22)

The user noticed Edge opening a dsh web page by itself that then did nothing. It was **my**
server: `dsh web --port 39181`, started 2026-08-21 14:23, still listening 24 hours later.

The chain is worth keeping. Starting a server this session, I probed `curl 127.0.0.1:39181` and
got a 200, so I recorded "up" — but the 200 came from **yesterday's process**. The log then showed
`EADDRINUSE`; I moved to another port and left the old one running, reasoning about it as
"someone else's port" rather than as mine.

Two habits to fix, both of which I already apply to browser sessions and not to processes:

- **A 200 on the port you asked for is not proof your server started.** Check the log, or the pid.
- **Name and close what you start** — every ego-browser task space this session was closed by
  name; every `dsh web` was too, *except* the one from a previous session, which fell outside the
  bookkeeping precisely because it was not this session's.

Killed with SIGTERM (clean exit); the user's own instance, started from an interactive shell in a
different directory, was identified by cwd and parent process and left alone.

### A 400 from upstream reads as a model judgement (2026-08-22)

Ran three more gateway models against two fixtures. `claude-sonnet-5` returned `fence=0` on
`帮我算下房贷` — a clean-looking miss on a fixture every other model gets right. The transcript
said otherwise: **0 reply characters, 0 tool calls.**

The reply file held a 400:

```
dsh: INVALID_REQUEST: 400: … AnthropicException … "The use of the web search tool is not supported."
No fallback model group found for original model_group=claude-sonnet-5
```

The crash check missed it because the check I had just tightened — *no transcript means no model*
— is satisfied here: **a transcript exists as soon as the request reaches the gateway.** The
request was made, refused upstream, and left a session behind with nothing in it.

Widened to treat any `dsh: <UPPER_SNAKE>:` line as a crash; that prefix is the launcher
reporting, never the model answering. Verified both ways.

**Tenth measurement artefact today, and the second to slip through a check written to catch the
previous one.** The blacklist missed unseen failures, so I replaced it with a positive test — and
the positive test has its own blind spot. There is no final version of this check; each new
backend brings a new way to look like a zero.

(`glm-5.2` also produced a card for `什么是闭包？`. Reading it, the card is a clickable walk
through a closure's scope — the same "a process, not a rule" case as 尾递归优化, so that is the
fixture being over-specified rather than a miss.)

### Three gateway models against the table (2026-08-22)

| | prose 4 | UI 17 | canvas 2 |
| --- | --- | --- | --- |
| `macaron-v1-venti` | 4/4 | 17/17 | both K |
| `gpt-5.6-terra` | 4/4 | 17/17 | both K |
| `claude-sonnet-5` | — | — | — (see below) |

**terra matches venti cell for cell**, including choosing a canvas for both plan fixtures. Two
models that share nothing but the prompt agree on all 23, which is the strongest evidence so far
that these rules describe the request rather than a model's habits.

`claude-sonnet-5` needed `tool-web` disabled first — the gateway refuses the web-search tool for
it with a 400. Its first grid ran before that was understood **and before the crash check was
widened**, so the whole column was zeros and `C`s from a single upstream failure. Discarded and
re-run.

That is the same lesson as §"a corpus spanning a rule change is not one population", from the
tool side: **a grid that spans a fix to the harness is not one population either.** The first
twelve rows were measured by a checker that could not see the failure the last eleven reported.

With the tool disabled, sonnet answers `帮我算下房贷` with a **canvas** where venti and terra both
use a fence — and it runs the checker (`bash ×4`, `str_replace_editor ×3`) the way venti does.

### Ten ways a measurement lied today — the list (2026-08-22)

Scattered across the sections above; collected because the count is the point. Every one of these
produced a plausible, publishable-looking result that was wrong.

| # | what looked true | what was true | the tell |
| --- | --- | --- | --- |
| 1 | a rule failed, `fence=0` | it wrote a **canvas** | count canvases too |
| 2 | a commit caused a regression | one flap in seven | repeat the *old* side as well |
| 3 | a rule did not generalise, 0/9 | plugin symlink dead, 9 crashes | check the subject ran |
| 4 | a rule was refused, six zeros | `QUOTA: Insufficient Balance` | short well-formed output is suspicious |
| 5 | a card's state was broken | a bare `.click()` unlocks nothing | drive it as input |
| 6 | an early `AudioContext` was unrecoverable | a real gesture repairs it | same as #5, opposite sign |
| 7 | a card remounted while visible | probe matched any `return (` | a helper component has those too |
| 8 | a metronome remounted twice | probe matched `return () => {}` | an effect cleanup is not markup |
| 9 | a gate was broken, exit 0 | `cmd \| tail; echo $?` reads `tail` | never pipe when the code is the measurement |
| 10 | sonnet refused a fixture | gateway 400, empty reply | a transcript exists before the model answers |

Four properties they share:

- **The failure and the interesting result are identical at the metric.** Repetition does not
  help — #3 would have given 0/9 every time.
- **The wrong answer is the alarming one.** Both probe bugs (#7, #8) over-reported; that is the
  direction that gets written up.
- **A check written for one of these has a blind spot for the next.** #10 slipped past the check
  added for #4, which had replaced the blacklist that missed #3.
- **The tell is never in the number.** It is in the byte count, the first line of the reply, the
  presence of a transcript — everything the summary throws away.

Which is why `scripts/eval.sh` prints `bytes=` and `tools=[]` next to the count, and why a zero
is not evidence until the reply it came from has been read.

### Four models, one table (2026-08-22)

| | terra | venti | sonnet | glm |
| --- | --- | --- | --- | --- |
| 23 fixtures | **23/23** | **23/23** | 21/23 | 22/23 |

**Nineteen of twenty-three cells are identical across all four.** The four that differ:

- **sonnet, `.env`** — ran 13 `bash` calls looking for a `.env`, found none (the seed workspace
  genuinely has none), and asked where it lives. Its reply then **promises the card**: *"每行一个
  变量、值默认打码、缺的键高亮置顶、改完给出 diff 预览再落盘"*. The rule fired; the fixture
  failed to supply the file.
- **sonnet, `二分查找的原理是什么`** — prose. The only real miss in the grid.
- **glm, `什么是尾递归优化`** — a card, and inspecting it, a step-through of the stack. Same
  over-specified fixture as noted before.
- **glm `.env` → canvas, sonnet `git 历史` → canvas** — shape choices, not errors.

So: **one genuine disagreement out of 92 cells.** Two models agree completely with rules tuned on
neither, and the two that differ do so in ways that are either the fixture's fault or a legitimate
choice.

The `.env` row is worth keeping as a caution about fixtures: `run-fixtures.sh` passes one seed
directory to every prompt, and a prompt that names a file needs that file. sonnet is the only
model that **checked** rather than assuming — which is why it is the only one the gap showed up on.

### Asking the transcript how the turn ended (2026-08-22)

The crash check has now had four versions, and the first three were all the same mistake:

1. a blacklist of error strings — missed every failure not yet seen;
2. *no transcript means no model* — a real structural signal, but a gateway 400 writes a
   transcript before it fails;
3. any `dsh: <UPPER_SNAKE>:` line — a launcher-prefix convention, one wording change from useless;
4. **`turn/end` carries `reason.kind`**: `completed` on success, `error` with a `code` when the
   request failed.

Comparing a good session against sonnet's 400s made it obvious — both have `turn/start` and
`turn/end`, and the reason is the only thing that differs:

```
good     {"turn":1,"reason":{"kind":"completed"}}
400      {"turn":1,"reason":{"kind":"error","error":{"code":"INVALID_REQUEST", …}}}
```

Now: no transcript → crash (never reached a model); transcript without a completed turn → crash
(reached it, failed); otherwise report the shape. Matched as `"kind" *: *"completed"` so the check
does not depend on dsh's JSON spacing.

Verified against a live 400 (sonnet with web search re-enabled), a synthetic error turn, and two
real successes. **Three versions of this check were pattern-matching where a structural answer
existed** — the tell each time was having to add a new pattern for the next failure.

### `hasPainted`, third version, measured against its alternatives (2026-08-22)

The review said enumerating tags (`svg, canvas, img`) would need a fourth entry the next time a
card uses something unusual, and suggested a bounding-box test instead. Measured all three in a
browser rather than picking:

| mount | tags | box | both |
| --- | --- | --- | --- |
| empty shell, layout classes | · | · | · |
| text / svg / canvas / img | ✓ | ✓ | ✓ |
| `<video>` / custom element / iframe | **·** | ✓ | ✓ |
| empty `div` at `height: 200px` | · | **✓** | · |
| empty grid with a gap | · | **✓** | · |
| padded skeleton card | · | **✓** | · |

**The box test alone is worse, not better**: a styled-but-empty wrapper has a box and paints
nothing, and that is exactly the mid-stream shell the function exists to reject. Requiring both —
an element that draws its own pixels *and* has a non-zero box — catches everything the tag list
caught, adds the three it missed, and still rejects all three shells.

Two mistakes while writing it, both caught by the table: skipping elements with children dropped
`<svg><rect/></svg>`, and `el.tagName` is lowercase for SVG elements but uppercase for HTML ones.

Verified on the three real cards after: all three still read as painted.

The generalisation the review was reaching for is right, but **the version that generalises has to
be measured against the case the special-casing protected** — the obvious form of it regressed the
one thing that mattered.

### The skill-load correlation, settled: the arrow points the other way (2026-08-22)

§"Does loading the skill change the answer?" recorded 79% against 25% and could not say which
way it ran. Two clones differing only in the catalog `description`, five conversational prompts
outside the fixture set, ten runs each on venti:

| | produced a card | loaded the skill |
| --- | --- | --- |
| old description ("Load this before you build any interface") | 7/10 | 7/10 |
| new ("Load it before you decide … most questions that should have been an interface do not ask") | 8/9 | 8/9 |

The description barely moves the number. What settles the direction is that **the two columns are
identical in every one of the twenty runs** — no run ever loaded the skill and then wrote prose,
and none ever wrote a card without loading it.

The reasoning says why, in the model's own words:

> *"I don't think I need to load the generative-ui skill here because this is genuinely a
> conversational exchange, not a request for a tool or interface."*

**The decision comes first and the load follows it.** So the 25% column was never a population of
runs that would have produced UI if only they had read the skill — it was runs that had already
decided not to. A description cannot route a request the model has already classified.

Which retires the experiment rather than passing it: the resident layer in `prompt.ts` is where
that classification happens, and every rule that has moved a number today lives there. The skill
is what you read **after** deciding to build, and its job is how to build well.

(One process note: the reworded description reached `main` inside `1bcd3ef`, whose message is
about keeping three cards. I had edited `src/skill.ts` on a branch, switched back, and `git add -A
src` picked it up. **An unmeasured change rode in on an unrelated commit** — which is exactly the
accident that makes a later measurement meaningless if nobody notices.)

### A rule that named its own counter-examples taught the model to match them (2026-08-23)

The one unexplained cell in the four-model grid — `claude-sonnet-5` answering `二分查找的原理是什么`
in prose — was not flap and not a model quirk. It was the rule text doing the opposite of what it said.

The rule ended: *"Note which words already get this right: `二分查找是怎么工作的` and `讲讲快排的过程`
reliably become a card, while the same subject asked as `什么是二分查找` or `二分查找的原理` usually does
not. Nothing about the subject changed — only the phrasing did."* Written as an observation about a
failure. Read as a classifier. The transcript is unambiguous — the model gets it right first, on the
subject alone, **then loads the skill and talks itself out of it**:

> This question about how binary search works is really about an algorithm — something that runs step
> by step — so it deserves an interactive card. I should load the generative-ui skill first.

> The user's question "二分查找的原理是什么" matches the "原理" phrasing pattern **the skill flags as
> typically not warranting a card**, so I should respond with a plain conceptual explanation instead.

Six runs, six times, same two steps. The rule was not being ignored; it was being *followed*, in the
direction I had accidentally written. Every negative example in a prompt is a pattern the model can
match against, and it cannot tell "this phrasing gets it wrong" from "this phrasing means no".

Rewritten to state all three phrasings are a card, with no is-not pair to match on, and to name the
inversion directly: *if you have already thought `this runs step by step, so it deserves a card`, that
judgement was made on the subject, and nothing about the phrasing revises it.* **0/6 → 6/6.**

Two lessons, both new:

- **A trigger rule must not contain a recognisable negative.** Naming the phrasings that fail hands the
  model a rule for failing. The earlier finding — a rule must be recognisable from the request alone —
  now has a second half: and it must be recognisable *only* in the direction you want.
- **This is the first miss located after the skill load, not before.** Every previous one was decided
  before the skill was read. Reasoning traces are the only instrument that separates the two, and the
  fence count cannot: a `0` from "never considered it" and a `0` from "considered it and was argued
  out of it" are identical at the metric, and want opposite fixes.

### Two measurement bugs found on the way, both silent (2026-08-23)

Neither changed a number in a way that looked wrong.

- **The profiles link to a checkout that was 63 commits behind.** `~/Desktop/…/dsh-generative-ui` had
  become readable again after the TCC revocation, still on `b206197`, with the phrasing rule sitting
  *uncommitted* in its working tree. Every run that used a profile pointed there measured a prompt that
  no commit ever contained.
- **The symlink pointed somewhere else than I assumed, and I rebuilt the wrong tree.** After editing the
  rule I rebuilt the desktop copy, re-ran, and watched the model quote wording that no longer existed in
  any file — `rg -l` across both trees found zero hits. The profile symlink resolves to `/tmp/recover`,
  whose `lib/` had never been rebuilt. **Build the tree the symlink resolves to, and verify the new text
  is in the artifact the profile actually loads** — `rg -c '<new phrase>' lib/index.js` — not merely in
  a `lib/` somewhere.

The tell in both cases was the same and is worth keeping: **the model quoted text I could not find.**
When a transcript cites guidance that does not exist in the source, the model is not confabulating —
it is reading an older artifact, and the delivery path is what is broken.

### The same fix applied one layer down was net negative (2026-08-23, reverted)

A review pass found the other half of the phrasing bug, and it looked airtight: `prompt.ts` was
fighting to get `什么是二分查找` treated as a card, while `skill.ts:66` named **`A definition`** in
its list of things that do not earn a card. Two files contradicting each other at exactly the
pattern-matching level this day's finding is about — and the transcript shows the model reversing
itself *after* loading the skill, so this was a live suspect for the same mechanism.

Rewrote it the same way: keep the test, drop the matchable category. *"Apply that as a test on
what you are about to build, never on how the question was worded. Sketch the component: if its
whole body is one paragraph and there is nothing to click, write the paragraph."*

Measured on sonnet, 12 runs:

| | before | after |
| --- | --- | --- |
| `二分查找的原理是什么` | 6/6 card | 3/3 card |
| `今天星期几` (must stay prose) | 0 | 0/3 ✓ |
| `帮我算下房贷` | card | **2/3** |
| `HTTP 状态码 418` (must stay prose) | **0/4 across four models** | **3/3 card** |

**Reverted.** 418 is one of the two hard negatives, verified at 0/4 across venti/terra/sonnet/glm
less than an hour earlier — a rewrite that moves it is a rewrite that broke the boundary, whatever
its argument was.

Why the same edit helps in one layer and hurts in the other is the part worth keeping. The
resident rule fires on **a request the model has not yet answered**; the skill is read **after it
has decided to build**, so its job is to talk the model *out* of a card it does not need. Removing
a named category from a gate whose purpose is to stop things removes stopping power. The two
layers are not symmetric, and a principle derived on one does not port to the other for free.

Also: the fix that worked and the fix that failed were **indistinguishable in argument quality**.
Both named a real contradiction, both kept the test and dropped the category, both read better
afterwards. Only the six-run boundary check separated them.

### The sub-page promise had never worked (2026-08-23)

`src/prompt.ts` has always told the model that a canvas's sub-pages live in `<id>/` and are
imported with relative paths. The model followed it: `.dsh/ui4a/canvases/tarot.ui4a.tsx:3`
imports `./tarot/deck`, beside a **26KB `tarot/deck.ts`**. That card could never have rendered.

Traced with the model's own file rather than a constructed one:

| step | result |
| --- | --- |
| compile | **succeeds**, 22628 bytes, `./tarot/deck` untouched |
| import map installed (as `registry.ts` does) | react / jsx-runtime / `$dsh/chat` all resolve |
| import the blob | **`Invalid relative url or base scheme isn't hierarchical`** |

`docs/examples.md:1254` predicted the breakage and got the **mechanism wrong**: it said the
compiler rewrites the specifier into `_.tsx/deck` when no `filename` is passed. Measured, the
compiler leaves it alone under either filename. The break is at import, not compile.

Two negative results decided the fix:

- **An import map cannot rescue it.** A map keyed on `"./tarot/deck"` fails with the same error:
  a relative specifier is resolved against the importer's URL *before* the map is consulted, and
  `blob:` is not hierarchical. So `renderer.setImportMap` — the existing injection point — is
  useless here.
- **Rewriting the source works, and nests.** Replacing the specifier with the child's blob URL
  removes the question; a child importing a sibling works for the same reason.

Three bugs of my own on the way, each caught only by running the next step:

1. **The first cycle guard deadlocked.** Registering a pending promise per specifier prevents a
   double fetch but not mutual waiting: A awaits B's URL, B awaits A's. I reasoned it was safe;
   it hung. Fixed by reading every reachable child first, then minting in dependency order — a
   cycle simply never becomes mintable and keeps its specifiers, failing as it does today.
2. **The module was untestable.** It imported `readCanvasChild` directly, and ESM exports are
   read-only, so the cycle test could not run at all. Reading is a parameter now, like `compile`.
   *Untestable is a design defect, not a reason to skip the test.*
3. **The compiler picks its syntax from the filename.** Passing the specifier (`./tarot/deck`,
   no extension) made the real `deck.ts` fail to parse. The route now resolves the extension and
   returns it in `x-ui4a-filename`.

End to end in a browser, same card, same path: **`IMPORT OK — default is function`**.

`test/subpages.test.ts` keeps five cases; the cycle one is the reason the file exists. Mutation
checked: reverting the dependency guard fails it and nothing else.

One more instrument lie, the twelfth today and the first self-inflicted: `rg -rn 'CanvasPanel'`
printed the filename as `n.tsx`. `-r` is *replace*, and it had eaten the `n`. **An unfamiliar
flag combination is a measurement instrument like any other.**

### `$dsh/exec` had no way to cancel, and the server was already waiting for one (2026-08-23)

`docs/examples.md:1284` records the gap: a card that polls a command cannot cancel the previous
run. Checked rather than trusted, and the interesting half is that **the server side was already
complete** — `src/index.ts:278` hangs an `AbortController` off `req.on("close")` and passes its
signal into `ctx.shell.resolve`. Killing the command really works; only the client never offered
the handle. `bash(command, { signal })` now forwards it to `fetch`.

**And the type checker that was supposed to guard this has a blind spot.** `types/check.ts` says
it "asserts the hand-written `$dsh/*` declarations still describe what `bind()` returns". It does
not: TypeScript cannot import an ambient `declare module` as a value type, so the file compares a
**hand transcription** against the implementation. Measured — rewriting `exec.d.ts`'s
`bash(command: string)` to `bash(command: number)` leaves `tsc` completely silent.

What it does catch is real: a legal-but-narrower implementation (`{ signal?: never }`) fails at
`types/check.ts:34` naming `exec.bash` exactly. So the file guards implementation drift and not
declaration drift, and that limit is now written at the top of it.

Two method notes:

- **The first mutation did not count.** Dropping the whole parameter produced `Cannot find name
  'options'` — an ordinary unbound-identifier error from the function body, not the assertion.
  A mutation has to leave the code legal, or it tests the compiler rather than the check.
- `types/*.d.ts` was audited once before for prose accuracy (§"Auditing the `.d.ts` files the
  model actually reads"). This is the structural version of the same finding: **the file the
  model reads is not the file the gate reads.**

### The clock intent, tested without a model call (2026-08-23)

`docs/examples.md:917` names a stopwatch as the untested intersection of "streams" and "has its
own clock", and predicts it is "where partial-react's state preservation would fail most
visibly". Two cheap measurements, no model quota spent.

**Streaming is not where it fails.** `replay-stream.ts` over the three fixtures: `metro`
(a metronome, the clock-owning card already on disk) shows 7 hook changes and
`afterDefaultPaints=0` — every remount lands before the card can paint anything.

**A remount is, and only in one of the two ways it could.** Drove a real remount in a browser
by changing the boundary key, exactly as `preserveBoundaryEpoch` does:

| | before remount | after |
| --- | --- | --- |
| displayed elapsed | 490ms | **290ms** (a fresh instance) |
| live intervals | 1 | **1** |
| tick rate | — | unchanged |

So the reading is lost, and **nothing leaks** — the old interval's cleanup runs, no second timer
races the first. The lost reading is the documented `preserveState={false}` trade; a stacking
timer would have been a real bug and it does not happen.

The skill already said persistence is about *your next edit*, not a reload. What it did not say
is that a running clock counts as the user's state, which is the least obvious case. Added, with
the fix stated as a shape rather than a rule: **store the start timestamp, derive the display.**

Verified before writing it down, because advice that merely sounds right is how a prompt acquires
a claim nobody checked: the same remount, with the start persisted, reads 600ms → **800ms** and
keeps counting, against 490 → 290 for the elapsed-count version.

### An error hid the one thing worth seeing (2026-08-23)

`docs/examples.md:918` calls runtime failure in the user's hands "the one product state with zero
measurement and the highest cost". Measured, and there was a real bug in it.

Neither consumer passes `onError` — inline nor canvas — so what the reader gets is partial-react's
own boundary output: a bare text node, `ERROR: <message>`. `hasPainted` returned true for it,
because its first line only asked whether there was text. So the host's code block was hidden
underneath, and the reader was left with one red line and no way to see what the model wrote.

§4 already records that an empty mount and an `ERROR:` mount are both zero-children and **want
opposite responses**. This is that table's other half, on the hide/keep decision rather than the
diagnosis:

| mount | whose bug | before | after |
| --- | --- | --- | --- |
| `ERROR: item.difficulty is undefined` | the generated code's | **source hidden** | source kept |
| `ERROR` | the generated code's | **source hidden** | source kept |
| empty (dead module graph) | ours | source kept | source kept |
| mid-stream shell | nobody's | source kept | source kept |
| `ERROR 404 是什么意思？共 12 条日志` | — | hidden | **still hidden** |

That last row is why the test is `/^ERROR(:|$)/` and not `startsWith("ERROR")`: a log viewer is a
real card, and a check written to catch an error message must not eat one that merely mentions it.

`hasPainted` needs a DOM, and the repo has no DOM test environment — adding one for a string rule
would be a dependency bought to test four lines. Split out `isPaintedText` instead, which is the
whole rule and needs nothing. Mutation checked in both directions: dropping the `(:|$)` anchor
fails the log-viewer case only, and reverting to the old rule fails the error cases only.

### Two retractions in one investigation (2026-08-23)

Chasing `docs/examples.md:1296` — the mostly-empty card — produced two findings, and measuring
each one properly killed both. Worth keeping because the failure mode is *my* method, not the
model's behaviour.

**The runtime half is fine.** §2.5's container-query work was only ever verified one way (narrow →
wide adds columns) and the corpus flags a design that *refuses* columns as untested. Both rules in
one container: at 640px `.grid` goes to three columns while `.big` only scales 48px → 96px. Both
intents are supported; no gap.

**Retraction 1: "the model looks for the subject in the wrong place" is not established.**
`还有多久发布` in an empty workspace scored 0/3 — correctly, there is nothing to point at, and the
replies were 432–558 bytes of asking which release. With a seeded repo (`RELEASE.md` naming
`target: 2026-09-01`, a CHANGELOG, a `v2.3.0` tag) it went 1/3, and the two failures never looked
at the workspace at all — they queried Chronicle and a pidfile, found neither, and asked. That
looked like a new variant of "gathering data eats the turn". But it rests on **one prompt**, and
§4.5 already records that one prompt's five samples cannot separate a cluster from noise.

Two unambiguous prompts against the same repo went **5/6** (3 fences, 2 canvases). The single
prose reply is right: the seed has one commit and a two-line `Unreleased`, and two bullets do not
want a card. So the shape is not general — it is that prompt, filed like
`帮我搭个东西记录点什么` was: recorded, not acted on.

**Retraction 2: "announced the card and delivered nothing" does not reproduce.** One run of
`现在到哪一步了` replied with 90 bytes — *"我来做一个实时状态卡片，直接读取仓库文件"* — and stopped.
The transcript says `stopReason: "stop"`, `turn/end: completed`, 12 steps, 9 bash calls, an empty
`.dsh/ui4a/canvases/` directory, and 55 seconds spent on the final step. Not a truncation. I called
it a shape nobody had recorded: decision right, work done, output empty. Six repeats: **zero
recurrences** (2 produced UI, 4 asked back).

**And that fixture was invalid anyway.** All six runs opened with `get_goal` — a real dsh tool —
because *"现在到哪一步了"* most naturally asks about **the session's own progress**, not the repo.
The model answering "this session has no tracked goal" is correct. I had picked a sentence that
means something else inside the system under test, and scored its zero against the model.

The general lesson, which is new: **a prompt is not a neutral probe.** It is interpreted by a
harness with its own tools and vocabulary, and a fixture that collides with one measures the
collision. Check what a prompt means *to dsh* before reading its result as a fact about the rules.

### The sub-page contract works and the model does not reach for it (2026-08-23)

`docs/examples.md:1260` is the larger probe of the gap fixed earlier today: not one relative
import but a whole tree plus a router. Its own wording — *「把咱们这次聊的东西整理成一个能翻页的
小册子」* — scored 0/3, and for the third time today the fixture was the problem: **there is no
"this conversation" in a headless single turn.** The model refused to invent material and named
exactly what it would build. Rewritten against a real `notes.md` with five `##` sections:

**3/3 canvases**, all correct in shape — `localStorage` for the page position, `height: 100%`,
`@container`, and the five topic names **absent from the source**, because the card calls
`readFile("notes.md")` and parses the headings itself rather than pasting in what the model read.

**And all three are a single file** of 7.8–10.6KB. Nobody used a sub-directory. So the contract
being usable did not make it used: at this size one file is simpler and that judgement is right.
The path the morning's fix opened is exercised only when the model reaches for it on its own,
which it does (`tarot.ui4a.tsx` was unprompted) but not on demand. **Capability available and
capability used are separate measurements, and only the first one is up to us.**

A screen was missing on that path and is now in `compile-cards.ts`: a card with a relative import
compiles cleanly whether or not the file it names exists, which is the same "clean build, blank
card" family as the three screens already there. `DANGLING-IMPORT`, verified in three states —
missing child exits 1, present child exits 0, the real cards exit 0.

**The fixture rule this earns**, having cost three separate investigations today (`.env` with no
file, `还有多久发布` with no repo, this one with no conversation): **whatever the prompt refers to
has to exist in the workspace before the run, not be discovered missing from the reply.** Each
time, the model's answer was correct and the zero was mine.

### `$dsh/ai` had the same missing handle as `$dsh/exec` (2026-08-23)

`docs/examples.md:1290` describes the keeps-generating case and notes the API is single-turn with
**no abort**. Checked while it was fresh, and it is the identical shape to the exec gap fixed an
hour earlier: `src/index.ts:350` already hangs an `AbortController` off `req.on("close")`, so
dropping the request really stops the generation — the client just never offered the handle.
`streamText({ prompt, signal })` now forwards it to `fetch`, which covers both the connection and
the read loop.

Worth naming the pattern rather than the two instances: **both routes were built to be cancellable
and neither exposed it.** Anywhere the plugin fetches on a card's behalf deserves the
same look, so: six `fetch` calls in `src/client/`, three of them ours (`canvas/read.ts`) and three
reachable from a card. `$dsh/fs` is the third and **deliberately keeps no signal.** Reads are
fast and already bounded by `MAX_BINARY`, where a command and a generation run for tens of
seconds — that duration is what makes a second call stack on the first. And a write must *not* be
abortable: cancelling one halfway leaves a truncated file, which is why `src/index.ts:190` passes
`undefined` where the host would take a signal. Recorded because "two of the three have one" reads
like an oversight to whoever looks next. The server was written by someone thinking about a dropped connection;
the client surface was written by someone thinking about one call at a time. Anywhere else the
plugin fetches on the card's behalf is worth the same check.

`types/check.ts` caught the narrowed variant at line 34 naming `ai.streamText`, the same way it did
for `exec.bash` — which is the half of that file that does work (see the note there about the half
that does not).

### The read-only `git(args)` proposal, declined with numbers (2026-08-23)

An adversarial review suggested replacing `$dsh/exec`'s arbitrary `bash` with a narrow, read-only
`git(args)`. It sat open for a while because it sounds obviously safer. Measured before deciding:

**What the corpus actually asks for.** Commands named in `docs/examples.md`: `git` 24, then `rg` 2,
`ps` 2, `node` 2, `lsof` 2, and one each of `sample`, `ls`, `gh`, `du` — **11 non-git uses across
seven binaries**, none incidental. The process-watcher card is `ps` + `lsof` + `sample`, the disk
card is `du`, the PR-vs-description card is `gh pr diff`. A git-only surface deletes about a third
of the intents the corpus was written to serve.

**What it would buy.** Nothing, because the fence is elsewhere: `src/index.ts:279` resolves
`ctx.sandboxPolicy.resolve({ session })` per call and hands it to the executor, so a card may do
exactly what the composer says the session may do. Measured earlier: under `Read Only`,
`echo hello` succeeds and `touch ./probe.txt` comes back exit 1 with `Operation not permitted` and
no file. Narrowing to `git` would re-implement, in a second place, a restriction the session
policy already applies — the same "second policy to keep in sync" that §3.65 rejected when I first
proposed hard-coding `ui4a/`.

Declined. The proposal is not wrong about the risk being real; it is wrong about where the risk is
answered, and it costs a third of the use cases to add nothing.

### A relative import is relative to its importer (2026-08-23)

`docs/examples.md:1250` — 「帮我把这个 canvas 拆一下，都塞一个文件里我看不动了」 — run against the
repo's own 2048 card (766 lines, 23KB) copied in as `game.ui4a.tsx`. **3/3 split it into a `game/`
sub-directory of 7–9 files**: entry plus `types.ts`, `boardLogic.ts`, `Board.tsx`, `ai.ts`,
`Styles.tsx`, `useGame.ts`, `Controls.tsx`. Before this morning all three would have been blank.

And the real output exposed a bug the constructed case could not. The entry writes
`./game/useGame` — relative to the canvases directory — but **the children write `./types` and
`./tileStyle`, relative to themselves**. `canvasChildPath` required the specifier to open with the
canvas id, so every sibling import resolved to null. `tarot.ui4a.tsx` had one import and one level;
this has seven files all cross-importing, which is what an actual split looks like.

The fix takes a `from` — the path the specifier was written in — through the route, the client
reader and the walk. Two consequences worth stating:

- **The map has to be keyed by the resolved filename, not the specifier.** `./types` written in two
  different children is two different files, and a specifier-keyed map serves the first to both.
- Attempting the old dedup as a mutation **hung the test suite** rather than failing it: keying the
  visited set by specifier while storing by filename means the entry never registers as visited and
  the frontier grows forever. A terminating mutation had to be built instead to check the test.

That second point cost a round: my first version of the new test asserted only that four distinct
files were *read*, which the by-name mutation passes happily. **An assertion on an intermediate
call is not an assertion on the output** — rewritten to compare the blob URL each importer's
rewritten source actually names, it fails under the mutation and only under it.

End to end on the model's own split: **8 children minted, zero unresolved specifiers in the entry.**

### The last two corpus intents, model side (2026-08-23)

**`给我个秒表，要能记圈` (`docs/examples.md:917`) — 3/3, and the rule written this morning landed.**
The runtime half was measured earlier: a remount loses the reading and leaks nothing, and the skill
gained *store the start timestamp, derive the display*. That proved the advice worked; it did not
prove the model would follow it. All three canvases persist
`{ baseElapsedMs, runStartTimestamp, laps }` — the accumulated pause total plus the start of the
current run — so `baseElapsedMs + (now - runStartTimestamp)` survives an edit. Independent
confirmation of a rule against the behaviour it was written for, not just against a probe.

**`这个卡老是报错，你看看怎么回事` (`docs/examples.md:918`) — 3/3, root cause each time.** Seeded
with a canvas that really throws: it renders `row.tags.join(", ")` over a `data.json` whose second
entry has no `tags`. Every run named it exactly — *"`{"name":"beta"}` 没有 `tags` 字段 … 对
`undefined` 调用 `.join` 直接抛异常，导致整个卡片崩溃"* — and fixed it to `(row.tags ?? [])`. One
added the distinction that matters for triage: *"这条数据本身就是缺字段的情况，不是偶发 bug"*.

So the corpus's "highest cost, zero measurement" state is handled well on the model side. The gap
was entirely on ours, and was the `hasPainted` bug fixed this morning: the reader could not see the
source under the error message.

**And both runs caught a fabricated token in my own fixture.** I had written
`--dsw-alias-separator` into the seed card; the palette has `--dsw-alias-border-l*` and no
`separator`. Both replies flagged it unprompted. The rule about never inventing identifiers is one
I broke while building a test for someone else's mistakes — **and the model's grasp of the palette
was good enough to correct me.**

### The last two corpus probes, and a "truth" that was only one reading (2026-08-23)

**`我把日志贴给你 你帮我看看哪几条是错误的` (`:915`) — the untested input shape.** Sixty lines pasted
into the prompt itself, not seeded as a file, because the blob *is* what is under test. 2/3 cards,
and the third is a correct answer, not a miss: it reported **10 ERROR lines, all the same refused
connection to `redis:6379`**, and said so — which matches the earlier finding at forty-eight errors,
where classifying beat listing because "这 48 条不是 48 个问题". Ten of one kind is that case again.

**`两个人 AA，一共 386，我垫的，小李没喝酒少算 60` (`:919`) — 3/3, and it corrected me.** I computed
a "true" answer first, on the reading that the 60 comes off Li's share alone: Li 163, me 223. One
card computes `half - discount` (133/253 — the discount split between both), and two redistribute
the discount across the undiscounted people (`totalDiscount / notDiscounted.length`), which in a
two-person split lands exactly on my number.

All three are **internally consistent** — `iOwe = total - liOwes` by construction, and the
redistribute form conserves the total by definition. So the fixture's premise (the reader can check
it without trusting the author) held, but **my single "truth" did not**: the sentence is ambiguous
about who absorbs the discount, and I had promoted one reading to the answer. The test that
survives is conservation, not equality with my arithmetic. The two cards that redistribute are the
more general model — they answer for three people too, which the prompt does not mention and a
group bill always eventually does.

### A trap that needed a yield point it does not have (2026-08-23)

§4 has carried this since the early days: preflight swaps the global `console.error`, so with two
cards *"the inner `finally` restores the outer collector and the host's console.error is lost
permanently"*, and a chat node is multi-card by nature. It was never reproduced — the multi-card
probe only ever checked that two cards coexist.

Reproduced now, and it does not happen. Two things have to be true for the swap to leak, and
neither is:

- **Nesting is already correct.** Each call captures its own `previousConsoleError`, so an inner
  `finally` restores what the inner call replaced. A stack unwinds; that is what a stack does.
- **Interleaving needs a yield between the swap and the `finally`,** and `canRenderComponent`
  has none: `renderToString` is synchronous, there is no `await` anywhere in `runtime.ts:209-229`,
  and its only call site (`:404`) sits inside a synchronous `renderComponent`. Two cards driven
  concurrently leave `console.error` as the host set it.

Kept as a note rather than deleted, reworded to say when it *would* become true — an `await`
inside that block is all it takes. The entry as written would have sent the next reader to build
refcounting for a bug that is not there, which is a specific cost: **an unreproduced trap is a
standing instruction to do unnecessary work.** Traps deserve the same "verified against a
known-bad input" discipline as checkers.

### Auditing §4's traps the way checkers were audited (2026-08-23)

The `console.error` finding suggested a method: **an unreproduced trap is a standing instruction to
do unnecessary work**, so the nineteen bullets in §4 deserve what every checker in this repo got —
a run against reality. Most carry their own evidence already (the `cwd` oracle was measured
returning file contents, the edit-remount was reproduced in a browser, the cold-start was
re-measured three times). Three did not, and two of them were wrong.

| trap | verdict |
| --- | --- |
| preflight steals `console.error` | **cannot happen** on 0.0.6 — no yield point (see above) |
| wasm leaks ~2.5MB per HMR round | **leaks ~16MB** — the old figure was the file size |
| publint's warning is unfixable | true, but named a package that no longer exists here |
| `@esm.sh/tsx` has no dispose | true — exports are `initSync`, `transform`, and `init` as default |

The wasm one is the instructive error. `tsx_bg.wasm` is 2610857 bytes on disk, so "~2.5MB per
instance" reads as if it had been measured. Instantiating four times in a fresh process:
15.9 → 48.5 → 64.6 → 80.1 → 88.5 MB rss, against a control that copies the same bytes four times
and grows 11MB in total. **A file size standing in for a memory measurement, off by six times, and
in the direction that makes the leak look tolerable.**

The publint one is the other failure mode: the conclusion is right and the citation rotted. Its
named package is not in the dependency tree, and the `/plugins/` string it quotes appears in no
`@deepseek-ai` package installed here. `bunx publint` still emits exactly that one warning, so the
entry survives on its own evidence — **cite the behaviour, not a package you cannot point at.**

### The trap that named its own fix and never applied it (2026-08-23)

The wasm entry said, correctly, that "dropping the `initPromise` reference and waiting for GC" is
the only release available — and then recorded the blob-URL half as wired while leaving that
sentence as a suggestion. Reading it after re-measuring the leak at ~16MB: `initPromise` is set to
null **only in the failure path** (`compiler.ts:18,33`), and `sharedCompiler` in `GenUISurface` is
never cleared. So the option was never exercised. Now it is, on its own `ctx.effect` disposer
beside the blob one; smoke went from 5 registered effects to 6, which is how the wiring was
confirmed without a browser.

A lint warning came with it, in the `useSubPages` hook added this morning: the effect used the
whole `canvas` object while depending on its fields. Destructured to scalars — the store rebuilds
that object every sweep, so depending on it would re-resolve every sub-page of an unchanged canvas
on each pass. **My own warning, introduced today, and worth fixing rather than leaving for whoever
reads the log next.**

### Proving a negative needs its control first (2026-08-23)

The settings entry was the third §4 trap with a citation that had rotted, and the only one where
the *reason* was wrong too. Settling it took a real `dsh web` — a fake ctx cannot tell you what the
host declines to provide.

The instructive part is the run that nearly became the answer. First attempt: `injected: false`,
which reads as a clean proof that `settings` is unavailable. It was worthless — a control in the
same call showed `pluginStyles: false`, meaning **the plugin had not loaded at all**, because the
`web` profile's `node_modules` was empty while I had been testing against `headless`. An
unloaded plugin injects nothing, exactly like a plugin denied a service.

With the plugin actually installed and the page reloaded: `pluginStyles: true`, `injected: false`.
Same number, opposite standing. **A negative result is only evidence once something positive in the
same measurement proves the subject ran** — the fence-count lesson from §4.5, met again in a
setting where the metric is a boolean.

Cleanup that this session's own record demanded: the probe server was killed by pid (§"A dev server
outlived its session by a day"), the browser task space closed by name, and the temporary probe in
`src/client/index.ts` reverted rather than left behind a comment.

### One trap that was exactly right (2026-08-23)

After three rotted citations and three wrong conclusions, §2.6's `external` sub-path trap holds
verbatim. Removing `bundleReactDomServer` and rebuilding puts `require("react-dom/server")` into
`lib/client.js` — a specifier the shell's module table does not carry — and `renderToString` falls
from 4 occurrences to 1, the difference between an inlined implementation and a bare call to
something that will not resolve.

Worth recording alongside the failures, because the audit would otherwise read as "old notes are
unreliable". The distinguishing feature is what the entry cites: this one names a **behaviour you
can reproduce with a build** (`external` matches sub-paths), while the three that rotted named
packages, error codes, and a byte count — identifiers that go stale without anything failing.

A method slip on the way, caught by its own assertion: my first patch used a regex that matched
nothing, and the script printed the *unmodified* build's output. It looked like "removing the
plugin changes nothing". **When a patch step fails, everything printed after it is about the old
state** — the `assert` in the patch is what stopped me reading it as a result.

### §2.6 finished: two live, one dormant, one worse than recorded (2026-08-23)

| setting | removing it does |
| --- | --- |
| `external` sub-path (`bundleReactDomServer`) | `require("react-dom/server")` enters the bundle — **live** |
| `conditions: ["browser"]` | byte-identical output — **dormant**, kept as a guard |
| `define` of `import.meta.url` | 295KB → 617KB, build path baked in, `jsx-dev-runtime` pulled in — **live, and understated** |
| upstream compiler workaround | already removed and verified earlier today |

The `define` one is the useful correction. The entry explained *why* the setting exists (CJS has no
`import.meta`) and left the consequence implicit, so the obvious check — `rg -c 'import\.meta'` —
reads **0 with or without it**. What actually changes is the byte count, a leaked absolute path
from the build machine, and a module outside the platform table. **When a note gives the reason but
not the symptom, the reader will invent a check for the reason and it will pass.**

### The one note that asked to be re-run, made runnable (2026-08-23)

§2.1 is the only entry in this file that asks for periodic re-verification — *"this table shrinks,
so re-check it on every dsh upgrade"* — and it said to diff two versions of a package by hand.
That is not something anyone does. Finding it took the detour worth recording: **the table is in
no installed package at all.** Seventy `@deepseek-ai` packages, none containing the string
`"react/jsx-runtime"`; it is compiled into the shell's frontend bundle, reachable only by serving
the app and fetching its asset. Current state: the host's 7 entries match `PLATFORM_MODULES`
exactly.

`scripts/platform-table.sh` does it in one command, and the interesting part is its third exit
code. The first version used `rg`, which was not on the script's PATH, so both sides of the diff
came out empty and it printed **"platform table matches (1 entries)"**. A checker that passes when
it is itself broken is worse than no checker, so it now asserts it read at least five entries and
exits **2** otherwise. All three states verified: match → 0, an injected bogus entry → 1, a probe
that cannot parse the bundle → 2.

Port hygiene per §"A dev server outlived its session by a day": every probe server was started on
47321-47329 and killed by that port. Two other `dsh web` instances (47341, 47361) are the user's
own and were identified by port and left alone.

### Four rotted citations, and what they have in common (2026-08-23)

The §2.4 `details` prohibition is the fourth entry whose evidence no longer exists. With the set
complete, the pattern is sharp:

| entry | citation | what it was |
| --- | --- | --- |
| publint | `dsh-client-modules` | a package name |
| settings panel | `settings-not-exposed` | an error code |
| wasm leak | `~2.5MB` | a number (and the wrong one) |
| `details` off-limits | `conversation.details.tool` | a slot name |

**Every rotted citation is an identifier.** Every entry that survived verification cites a
behaviour instead: `external` matches sub-paths (reproduce with a build), `define` changes the byte
count (reproduce with a build), the slot merge needs an import (reproduce with a type query), the
platform table has seven entries (reproduce with a fetch).

Identifiers go stale silently — the package is renamed, the error code is reworded, the slot is
removed — and nothing fails when they do, because nothing executes a note. A behaviour cannot rot
without something breaking. So when writing one of these down: **name what you did and what
happened, and cite the identifier only as a pointer to it.**

The `details` entry keeps its prohibition despite losing its reasoning, which is the right call for
a rule about something we choose not to do: the cost of wrongly avoiding a slot we never needed is
nothing, and the cost of wrongly registering into a `single` slot is a broken app-wide panel. But
the paragraph now says outright that its mechanism is unverifiable, so nobody re-derives confidence
from a chain that no longer holds.

### Auditing the identifiers, and three methods that did not work (2026-08-23)

Having found that every rotted citation was an identifier, the obvious next move is to check all of
them at once: 18 package names are cited in backticks in this file. Nine are absent from
`node_modules`. **That number is not a finding, and getting to why is the useful part.**

- **Checking `node_modules` alone is the wrong scope.** `dsh-base` is cited as a profile bundle, and
  profiles live in their own tree — so it reported missing from a directory it was never going to be
  in. My checker's false positive, not the note's error.
- **Checking the profile's tree does not work either.** Its `pnpm-lock.yaml` contains no
  `@deepseek-ai/dsh-*` at all: those bundles ship inside the dsh binary rather than being installed,
  so there is no directory to test for.
- **Grepping the shell bundle does not work for server-side names.** All eight come back 0, but the
  bundle is minified — package names survive only where they are string keys, which is exactly why
  `dsh-client-ui-slots` was findable earlier and `dsh-host-frontend-static` is not. A zero here
  means nothing.

What is genuinely established: `dsh-tool-skill` does not exist under that name (the installed
package is `@deepseek-ai/dsh-skill`), and `dsh-client-modules` was already shown absent. The rest —
`dsh-base`, `dsh-skill-filesystem`, `dsh-host-frontend-static`, and the rc.7 packages cited
deliberately as history — **cannot be decided with anything available here**, and saying so is the
result. Three methods, each plausible, each measuring something other than what I wanted; recording
the dead ends so the next audit does not re-walk them.

### A behaviour citation can rot too — but it rots loudly (2026-08-23)

§2.3's warning was that the shell's static handler answers unmatched paths with index.html + 200,
which turns a misplaced wasm file into a magic-word error far from its cause. Measured against
rc.8: four unmatched paths, including an SPA-shaped one, all return **404 with an empty body**. The
host fixed it.

This qualifies the rule from the identifier audit. Behaviours go stale as well — but the difference
is in how you find out. A stale identifier is invisible: nothing fails, the note simply points at
something that is not there. A stale behaviour **fails a check you can write**, and this one took a
single `curl` loop. The claim was falsifiable and so it got falsified; the four rotted identifiers
sat unnoticed for weeks because there was nothing to run.

Our own half of that entry still holds exactly: the plugin's `/dsh-generative-ui/assets` route
answers `200 · application/wasm`, which is the part the note exists to justify.

(Method note, twice today: `curl` and `head` were not on PATH inside a `for` loop, the same way `rg`
was not inside `platform-table.sh`. Resolve binaries with `command -v` before looping, or the loop
reports a tool failure as a measurement.)

### The audit's baseline: one entry that was right in every part (2026-08-23)

§2.2 — the React version — is the cleanest entry in the file, and it is worth naming as the shape
the others should aim at. Its premise is checkable (`"18.3.1"` is the only React version string in
the shell bundle) and so is each consequence drawn from it: the four React 19 APIs the entry
forbids appear **zero** times in the host, and the three React 18 APIs the plugin depends on are
all present.

That is what separates it from the four entries whose citations rotted. It never names a package,
an error code, or a number nobody can re-derive — it names **a string you can fetch and count**.
Nine entries have now been re-verified this way; the two that were wrong (`console.error`
refcounting, the wasm figure) and the four whose evidence had gone stale all cited identifiers,
while every entry citing a fetchable or buildable fact survived.

### The entry that could not be re-verified, and saying so (2026-08-23)

§3.6's "the canvas does not stream under PTC — 490 samples, 0 state changes" resisted three
attempts. Its logic is covered by tests (`collect.test.ts` asserts both branches), but the claim is
that one branch is **unreachable in production**, which no unit test and no saved transcript can
show — it needs a probe inside a live session while a canvas is being written.

Two dead ends worth recording so the next attempt skips them: the `"name":"write"` string in a
transcript is usually the **tool definition** (it carries `description` and `parameters`), not a
call; and sessions that did write canvases today were in `mktemp` directories that are gone.

The entry now says it is unverified rather than carrying its original number as if fresh. That is
the point of the audit — **an unverifiable claim marked unverified is worth more than the same
claim reading as measured**, because the next person will stop trying to derive confidence from it.

Two shell traps hit while chasing this, both familiar by now: a `[ "$n" -gt 0 ]` test where `n` had
picked up multiple lines from `grep -c` over several files, and a glob left unexpanded inside a
`zstd -dc` argument. Both produced empty output that looked exactly like "no hits".

### Retracting "the data is gone" (2026-08-23)

An hour after recording that §3.6 could not be re-verified because the sessions lived in `mktemp`
directories, that turned out to be false. Only the **working directory** is temporary; dsh writes
the session under `$DSH_HOME/sessions/` keyed by that directory's name, and 183 are on disk with
the canvas-splitting run included.

The claim remains unverifiable for a better reason: **`settled` never reaches the transcript.** It
is computed by `collect.ts` from the live snapshot's shape, so the 73 frames in that session that
carry a canvas path have no such field. An archive cannot answer a question about a value that only
exists in memory.

The two failures deserve separating, because they call for opposite responses. *The data is gone*
is a reason to capture more next time — and I nearly wrote a change to `eval.sh` to preserve
working directories that were never the problem. *The value is derived, not stored* means no amount
of archiving helps and only a live probe will do. **Check that a thing is actually missing before
designing around its absence.**

(The patch that wrote this correction failed its own anchor assertion on the first attempt, and the
`check exit=0` printed afterwards was the *previous* commit's state — the same trap recorded earlier
today when a regex matched nothing and the build output read as a result.)

### The skill-load correlation at n=183 (2026-08-23)

`$DSH_HOME/sessions/` turned out to hold **183 sessions** from today's runs — a corpus I had been
treating as disposable. Re-running §4.5's skill-load question over all of them, counting fences in
the reply *and* canvas files on disk:

| | produced UI | did not |
| --- | --- | --- |
| loaded the skill | **99** | 33 |
| did not | **4** | 47 |

75% against 7.8%, against the 79%/25% recorded from a three-hour window. Same direction, wider gap,
seven times the sample.

The four counter-examples are the interesting cell, and **two of them are my counter's fault**:
`什么是尾递归优化` and `什么是闭包` scored `fence=4` because the model wrote ordinary ```js blocks in
its prose, and my predicate counted any two fences as a card. The other two are real — a log-triage
card and a canvas fix, both produced without loading the skill. So the true rate of "UI without the
skill" is **2 in 183**, and §4.5's conclusion (the decision precedes the load) is stronger at this
sample size than it was at the original one.

Three counting traps hit while getting here, all of them already in this file: `"name":"skill"`
appears 5 times in a session where the tool was called **once** (the rest are the definition and the
catalog, so the count has to be restricted to `tool/call` records); `grep -c` over several files
emits one line each and silently breaks `[ "$n" -gt 0 ]`; and an unexpanded glob left a path
variable empty, so `zstd` printed a "no such file" and a `0` that read exactly like a measurement.
**A corpus this size makes a bad predicate look authoritative** — 183 rows of a wrong number are
still wrong, and the only thing that caught it was one cell being implausibly empty.

### The fence language slip is gone; a different one replaced it (2026-08-23)

Counting every fence opener across the 183 sessions: **73 `````ui4a/tsx`, and not one bare
`tsx`**. The ~5% slip recorded twice in §4.5 did not occur once today.

**That conclusion was wrong and is corrected below** — see "the slip was never gone". Left in
place because the way it was wrong is the lesson: a search window too small to reach the
evidence returns zero and reads exactly like an absence.

Openers 73, closers 72. The one unbalanced reply ends not with a fence but with
**`</parameter></invoke>`** — the model emitting tool-call markup into its own prose, on a turn
whose `turn/end` reason is `completed`, so nothing truncated it.

That corrects an attribution I made hours earlier: a Monitor event carried what looked like
tool-call syntax and I treated it as noise from the monitored process. It was the model's own
output, arriving through a session's reply file. **A stray XML-ish tag in a reply is a generation
artefact, not a transport artefact** — and it costs a card, because the fence never closes.

### What the leaked markup actually costs (2026-08-23)

"It costs a card" above was a guess about the missing closing fence. Measured on the real
303-line body: an unterminated fence goes down the `complete: false` path in `segments.ts` —
the same path as any mid-stream frame — so `</parameter></invoke>` reaches the compiler as
code. `normalizeGeneratedTsx` does not absorb it in either mode; both fail at the tag's line
with `Expression expected`. Stripping the tags, both modes compile. So the cost is not the
closing fence: it is **every line of the card**, and the reader sees a permanent "still
writing" frame that will never render.

`TOOL_CALL_MARKUP` now strips the tags, anchored to the very end of an unterminated body
where nothing legitimate can follow. Two mutations kill the tests: removing the strip, and
dropping the `$` anchor (which would eat a lookalike inside a template string).

The method that found it is the same one that found the four runtime bugs before it: **read
the corpus as a specification for the parser, not as a sample of model behaviour.** A count
that comes out 73/72 is not a rounding error — the one row that does not balance is a bug
report written by production.

### The `$ui4a/` → `$dsh/` rename took completely (2026-08-23)

Counting capability imports across every card the corpus delivered (403 fences in
`assistant/message` records, 1012 sessions): **25 import `$ui4a/…`, a prefix nothing
resolves.** Split at the rename commit `9209104` (2026-08-21 17:57) the number stops looking
like a live defect: **23 of 115 before, 2 of 288 after**.

Both post-rename cards are from sessions whose reply text still contains the old prompt line
verbatim — they ran a `lib/` built before the rename, not a hallucination. **The model never
once invented the prefix**; every occurrence is quotation. That is the same lesson as the
profile-symlink episode, arriving from the other direction: a session measures the *built*
prompt, so a corpus split by commit date is really split by rebuild date, and the two rows
that look like a regression are the lag between them.

Worth keeping for the shape of the check rather than the result: **when a corpus shows a rule
being violated, split it at the commit that introduced the rule before believing the rate.**
A pooled 6.2% and a post-fix 0.7% are the same 25 cards.

### Compiling every card the corpus ever delivered (2026-08-23)

Ran all 1012 sessions through `parseUi4aSegments` + `normalizeGeneratedTsx` + the real
compiler. **370 closed fences, 6 fail.** Two classes, and only one of them was ours:

**Ours (fixed).** 19 of 405 fence openers are the model *describing* the fence rather than
opening one — `用 ````ui4a/tsx```` 块，原地渲染成…`. The parser opened a card on each, so a
sentence about cards became a card that could never compile. The fence line's trailing text
discriminates: empty or code is a card, `key=value` is meta, anything else is prose.
Skipping those openers kills 14 of the 19 and costs **0 of 390 real cards**. The five that
survive put the prose on the *next* line, where nothing distinguishes it from a card that
starts with a comment — left alone rather than guessed at.

**Theirs (not fixable here).** The last three are the model writing invalid TSX: `fontSize:
11px` unquoted inside a style object, and `^\w+@\w+\.\w{2,}$` as bare JSX text where `{2,}`
parses as an expression. Both produce a boundary error the reader can see, which is the
correct outcome — a 3-in-370 authoring error rate does not earn a prompt rule, and a rule
naming the bad form is exactly what §4.5 warns turns into a classifier the model matches on.

The useful number is the denominator: **99.2% of everything the model has ever written into a
fence compiles.** Parser bugs, not generation quality, were the whole story.

### The remount checker had never seen a real card (2026-08-23)

`replay-stream.ts` has always run on the six curated cards in `test/cards` and always
reported zero. Pointed at **362 unique cards extracted from the corpus**, it reported 35
visible remounts — 9.7%, which would have been the largest quality problem in the project.

Every one was the checker's own off-by-one. It tested `defaultPaints` on the frame where the
hook count *changed*, so a card whose `useState` and `return (<` land in the same 1/60 chunk
— which is most cards, the two lines are usually adjacent — counted as blanking a card that
had never appeared. Comparing against the *previous* frame's paint state instead: **0 of
362.** Broken frames: 3, all inside cards that do not compile at all.

The reason this sat undetected is worth more than the fix. **A checker whose corpus is six
files it was written against cannot fail**, and one that reports zero is indistinguishable
from one that is broken. The only thing that separated them here was a deliberate positive
control (`/tmp/latehook.tsx`, a hook in a helper component below a long default export) —
it fires, so the zero is a measurement. This is `verify-real-path-not-happy-path` again:
success and "never ran" look identical from the outside.

### Every screen now has a card that must trip it (2026-08-23)

Running `compile-cards.ts` over the 362 real cards fired each of its three §4 screens exactly
once — and one of the three was wrong. `JSX-SUBSCRIPT` matched `Record<Step["channel"],
string>`: the discriminator was "an index expression that is not an immediate `[]`", which a
type argument satisfies as readily as a JSX tag. What actually separates them is what follows
the bracket — a JSX tag continues into attributes or closes (`/>`), a type argument continues
into `,` or `>`. Retightened; the false positive is gone and the curated cards still pass.

`SHADOWED-EXPORT` was a true positive: `export default function Pie` beside `import { Pie }
from "recharts"`. `VIEWPORT-UNITS` was a true positive too. **1 real hit each in 362 cards** —
the traps are real and rare, which is the correct shape for a screen and the reason none of
them had ever been observed firing.

So `test/cards-negative/` now holds one card per checker, each compiling cleanly and each
*required* to be flagged, and both scripts exit non-zero if a control goes quiet. The screens
moved into a shared `SCREENS` table so the control exercises the same predicate the checker
does — a control that re-implements its rule proves only that two copies agree. Mutating
`JSX-SUBSCRIPT` to `() => false` now fails `bun run check`; before today nothing in this repo
could tell a working screen from a dead one. These cards are in `.oxlintrc.json`'s ignore
list: deliberately-illegal JSX is not lintable source.

### What the skill actually changes (2026-08-23)

Across all 1012 sessions: **291 delivered a card after loading the skill, 60 delivered one
without it, 140 loaded it and built nothing.** §4.5's "the decision precedes the load" holds —
but the 60 is the interesting cell, and it is much larger than the 2-in-183 recorded earlier
today. That earlier number was cards-without-skill in one *directory* of eval runs; this is
the whole corpus, and a session like `94e4a889` builds a git-history browser off six `bash`
calls having never loaded anything.

The cards differ in exactly one way that survives scrutiny. Mean size (6.2KB vs 4.3KB) and
compile-failure rate (0.7% vs 1.4%, which is 2 cards against 1) are noise. **Capability use is
not: 22% vs 5%.**

That could easily be the task talking rather than the skill — a card that reads the workspace
tends to appear in a session that was already reading the workspace, and such a session is
likelier to load the skill. Stratifying by whether the session used `bash`/`read`/`glob`/`grep`
at all:

| | cards | uses `$dsh/*` |
| --- | --- | --- |
| workspace session, skill loaded | 59 | **66%** |
| workspace session, no skill | 17 | **18%** |
| non-workspace, skill loaded | 233 | 10% |
| non-workspace, no skill | 56 | 2% |

The gap does not vanish under the control, it **widens** — 66 vs 18 inside the stratum where
both were plausible. So the resident prompt is what decides *whether* to build, and the skill
is what decides whether the card can *reach anything*. Two jobs, and the 60 skill-less cards
are mostly cards that render what the model already knew.

Two counting traps on the way, both familiar: `tool/call.data.arguments` is a JSON **string**,
so `JSON.stringify(rec)` double-escapes it and a `"name":"…"` regex silently matches nothing
(431 skill calls read as 0); and the corpus is JSONL, so a card's newlines are the two
characters `\n` — a `/```ui4a\/tsx\n(import|…)/` predicate found 0 sessions, and the naive fix
found 999 by matching the prompt's own examples. **Both wrong answers were round numbers at
the ends of the range**, which is the only reason they were caught.

Narrowing the capability gap above: it is **almost entirely `$dsh/fs`**. Inside workspace
sessions, `exec` is nearly matched (25% with the skill, 18% without) while `fs` is 34% against
**0 of 17**. That looks decisive and mostly is not — reading the seventeen questions, only
three of them (`git 历史帮我梳理一下`, `看看我这个仓库最近都改了啥`, `这个 glob 会匹配到啥`)
ever wanted a file read; the rest are pomodoro timers, unit conversions and a tarot deck, which
correctly reach for nothing. **A zero cell with a plausible reason is not evidence.**

Restricting to sessions whose card is genuinely *about* the workspace (the model used
`read`/`glob`/`grep`, or ran `git`/`rg`/`ls`/`du`): 73% of 48 reach the workspace with the
skill, 30% of 10 without. The direction survives every control I could apply, and **ten cards
is still too thin to move a prompt rule over** — recorded as a lead, not a finding.

Re-run through the fixed parser on the grown corpus: **78% of 50 with the skill, 33% of 9
without.** The gap widened and the thin cell got *thinner* (17 cards → 9), which is the useful
outcome — a lead that survives a corpus change but never accumulates evidence is one to leave
alone, not one to keep re-litigating. What the
resident layer says about `fs` is already the skill's rule almost verbatim ("that card is a
photograph"), so if this is real the fix is not more words there.

### The sixth runtime bug: a fence closed by a shorter run (2026-08-23)

Pairing every opener with its closer across the corpus: **18 of 385 are mismatched**, nine of
them `open=6 close=4`. Markdown says a shorter run does not close the fence, so `findClose`
returned -1 and each of those cards went down the `complete: false` path — a card that streams
forever and never settles. This is the failure the reader experiences as "it just kept
loading", and it is nine times more common than the tool-call leak fixed this morning.

`findClose` now falls back to any standalone run of three-plus, **tried last**. Measured: 16
rescued, 0 cut short. The single card where a shorter run precedes the exact one turned out to
have closed itself twice (```` then `````), so cutting at the first yields the identical body.

The ordering is the whole subtlety and it needed its own test. "Try short, then exact" passes
every other test in the file — including the existing longer-fence one — and breaks the case
the four-backtick convention exists for: a ```js block inside the card's own template string
ends the card at its first line. The mutation that reorders the two branches now fails.

Corpus-wide: **370 closed fences before, 379 after**, with the same 3 model-authored compile
errors. Found by chasing the "loaded the skill and built nothing" cell — 140 sessions, of
which 72 correctly wrote a canvas instead, and among the rest were cards that *had* been
written and that my own classifier could not see, for the same reason the runtime could not.
**When a measurement and the product disagree about whether something exists, suspect they
share a bug** — here they literally shared the function.

The three fences still open after that fix were the *same* leak in the model's own spelling:
`</｜｜DSML｜｜parameter>` (full-width U+FF5C, not ASCII pipes), plus a `tool_calls` tag the
ASCII form never showed. So the native spelling is **three times more common than the one I
built the guard from**, and a regex written from a single sample was blind to all of it. The
lesson is narrower than "generalise your regex": I had a corpus of 1012 sessions and matched
on the one example I had already read. **Grep the corpus for the shape, not for the string you
saw** — `</` before a fence's end, not `</parameter>`.

What the fix buys is worth stating precisely, because I first wrote it down wrong. The counts
do **not** move: still 379 closed and 3 unclosed, because those three replies have no closing
fence at all and `complete` is derived from finding one. What changes is that all three now
compile through the streaming path instead of dying on the tags — **the reader sees a rendered
card that never settles, rather than an error boundary.** A guard that fixes rendering does not
have to move the parse counters, and checking the number I expected to move rather than the
behaviour I actually changed nearly put a false claim in this file.

### The canvas path holds, and the one miss is not a prompt problem (2026-08-23)

`owningCanvasIdOf` matches the trailing `.dsh/ui4a/canvases/…`, so a canvas written to
`ui4a/canvases/` without the `.dsh` prefix is not a canvas — no panel, silently. Across the
corpus **89 of 159 canvas writes miss**, which reads like the biggest defect in the plugin
until it is split at `7df29f9` (the 2026-08-21 19:39 move under `.dsh/`): **72 of 72 before,
17 of 87 after**, and 14 of those 17 ran a build older than the move. Same shape as the
`$ui4a/` rename — a corpus split by commit date is really split by rebuild date.

The remaining **one** session is the interesting one, and it is not the prompt's fault: it had
the correct `.dsh/ui4a/canvases` text in context and wrote `ui4a/canvases/` anyway, then read a
`stopwatch.ui4a.tsx` from that same wrong directory *afterwards*. So it was not copying a
sibling — I checked, expecting that to be the answer. One unexplained miss in 87 is not a rule
worth writing, and I am recording the negative result so the next person does not re-run the
same query: **the sibling-imitation hypothesis is tested and false.**

Method note: my first pass reported `recognisedAsCanvas=0` for all 159 writes including 86
plain `write` calls, which would mean canvases never render at all. That was the harness
passing `{ argsRaw }` when the field is `arguments` — **a checker that reports total failure is
as suspect as one that reports zero problems**, and both mean "measure the measurement first."

### The seventh bug: a canvas written by executed code is invisible (2026-08-23)

`collect.ts` classifies a call by the SHAPE of its arguments, which §4 defends at length and
correctly — but the shape only works when the arguments *describe* the write. **29 canvas
writes in the corpus go through `run_code`**, holding the file body inside a JS or Python
string literal, and in **27 of them the path is built from a variable**, so nothing in the
arguments names the canvas. `collect.ts` sees none of them. In all **19 sessions** where this
happens, `run_code` is the *only* write — there is no ordinary `write` to fall back on.

The panel never opens, and the launcher does not rescue it either: `workspaceIds` is fetched
**once per workspace**, before the write, and is never refreshed. So the canvas exists on disk
and nothing in the UI knows.

The fix is not in `collect.ts` — the id is genuinely absent from the arguments 27 times out of
29, and no parser recovers what was never written. It is that the listing already knows and
never asks again. The sweep now counts settled calls matching `OPAQUE_WRITE` — code-carrying
arguments that also mention `canvases` — and re-lists when that count changes.

Both halves of the predicate are load-bearing and measured. Without the `canvases` clause an
ordinary shell session re-lists once per command (one session: 0 → 94 extra directory reads).
With it: median 0, p90 0, max 18. And all 29 real opaque writes mention `canvases` somewhere
even when the id is unrecoverable, so the clause costs no coverage. Matching on argument text
rather than the tool name is the same principle as `collect.ts`: a name list stops matching the
day the host renames the tool, silently.

### A traversal test that could not reach a file (2026-08-23)

The canvas read route had **no test at all** — not the listing the launcher depends on, not the
`child` branch, and not the escape fence on the one parameter an attacker controls. Written
now, and the first version of the traversal test was worthless in a way worth recording.

It tried `../../../../etc/passwd`, `/etc/passwd`, `..%2F..%2Fsecret` and asserted the status
was not 200. **It passed with `canvasChildPath` deleted entirely.** Relative to a `mktemp`
workspace those paths resolve to nothing, so the naive concatenation 404s and the 404 looks
exactly like a refusal. The test was measuring the absence of `/etc/passwd` under a temp
directory, not the presence of a fence.

The fix is that each escape must name a file that **really exists and really is outside** the
child directory: a `secret.txt` in the workspace root and another canvas's `private.tsx`. The
assertions are now `status === 400` plus "the body does not contain the secret" — and deleting
the fence fails it. §4's rule about verifying the real path applies to security tests with
extra force: **a traversal test that cannot reach anything proves only that nothing was
there**, and it stays green forever while the fence rots.

Auditing the other four routes for the same gap: `serveFs` and `serveExec` both hand path
safety to `ctx.fs.resolve` / the session's sandbox rather than checking anything themselves,
which is correct — that fence is the host's and testing it here would test someone else's code.
The only fence this plugin owns is the `liveWorkspaces` gate, applied at all four
workspace-taking routes, and now covered.

`serveAsset` was the one worth adding. It is registered as a **prefix** route, so every path
beneath `ASSET_PREFIX` reaches it and a single `pathname !== WASM_PATH` line is all that keeps
it to one file — nothing else in the plugin has that shape. Deleting that line now fails, as
does serving the wasm under any content-type but `application/wasm` (`instantiateStreaming`
rejects everything else, silently). The suite is 52 tests across 9 files.

### Two tests that passed while proving nothing (2026-08-23)

Filling in the untested runtime modules turned up the same failure twice in one sitting, and it
is the traversal-test lesson in a different costume.

**`warmCompiler` never rejects.** `apply()` calls it and nothing awaits it, so a rejection takes
the plugin's registration down and the shell loads forever. Written as a test inside
`compiler.test.ts` — which runs `initTsx` from disk at its top level. The wasm was therefore
already warm, `initCompiler` never failed, and **deleting the entire try/catch still passed**.
Moved to its own file, where `WASM_PATH` really is an unfetchable HTTP route, and the mutation
now fails. *A guard against a failure can only be tested where the failure actually happens* —
and in bun each test file is its own scope, which is what makes the isolation work at all
(verified: a global set in one file is `undefined` in the next).

**The final→streaming fallback.** `createBrowserTsxCompiler` retries a failed `final` compile as
`streaming`, and the comment calls it essential without a number. Measured across every prefix
of all 362 corpus cards: `final` fails where `streaming` succeeds in **718 of 13589 prefixes**
(5.3%). Load-bearing, not defensive — but read that number carefully: in **241 of the 718 the
rescued module has no default export left**, because cutting the half-typed tail cut past
everything renderable. `type T` alone normalizes to the empty string. So the fallback turns an
exception into a real card 477 times and into a blank surface 241 times; both beat throwing
mid-stream, and neither is "718 cards saved". My first four hand-written candidates for such an input —
unterminated string, unterminated template, mid-attribute, mid-JSX-text — were all handled fine
by `final`, so **guessing at the input would have concluded the fallback was dead code.** The
smallest real case is a truncated `type T`, which `final` cannot close.

Also corrected `compiler.ts`'s "~2.5 MB wasm" comment, which is right about the file (2610857
bytes) and was the source of the 16 MB confusion recorded earlier — the file is 2.6 MB and an
instantiated compiler is ~16 MB of heap. Both numbers now stated, with which is which.

Runtime coverage after this pass: `registry.ts` (generated re-export modules, checked by
*parsing* the output rather than matching text — three mutations die), `observe.ts` (coalescing,
single observer, teardown at zero — three mutations die), `compiler.ts`. Only `GenUISurface.tsx`
remains, which is React and wants a DOM. 65 tests.

### A test file that tested a copy of the code (2026-08-23)

`compiler.test.ts` never imported `compiler.ts`. It imported `@esm.sh/tsx`'s `transform` and
`partial-tsx`'s `normalizeGeneratedTsx` and re-assembled the pipeline itself — so it asserted
that a re-implementation agrees with itself, forever. **Rewriting every `return` in
`compiler.ts` to `undefined` (six real substitutions) left it entirely green.**

The obstacle was that the real `compile` fetches its wasm from `WASM_PATH`, an HTTP route, and
there is no server in a test. Serving it from `Bun.serve({ port: 0 })` and wrapping `fetch` to
absolutize the leading `/` is the whole of what was needed — the browser resolves that path
against the page origin, and bun has no origin at all. Now the same blanket mutation fails all
four tests.

Two things fell out of writing it that no amount of reading would have produced:

- I asserted **"a settled card keeps its tail"** and it was wrong. An unclosed array literal
  normalizes under `final` to `[1, 2,\n return <div/>\n}];}` — every character preserved, and it
  does not parse — so the catch falls back to `streaming`, which cuts back to
  `export default function A() {}`. Losing the tail is the *correct* outcome there; a card that
  compiles beats a card that does not. The guarantee is "something compiles", not "nothing is
  lost", and only writing the assertion down exposed that I had it backwards.
- The **718** figure recorded above needed qualifying. In 241 of those prefixes the rescued
  module has no default export left, `type T` being the extreme (it normalizes to the empty
  string). 477 real cards, 241 blank surfaces — corrected in place.

The general form, now seen four times today: **a test that does not import the module under
test cannot fail for it.** The others were a guard tested where its failure could not occur, a
traversal test that could not reach a file, and a checker whose corpus was the six files it was
written against.

Auditing the rest by the same blanket mutation: `bindings.ts` 5 tests fail, `registry.ts` 6,
`inline-fence.ts` 4 — all genuinely covered. `observe.ts` and `register.ts` score 0, but the
operator rewrites `return <expr>;` and **neither module contains one**, so their score is a
no-op rather than a verdict; both were mutation-checked by hand instead. A mutation audit needs
its own control: count the substitutions actually applied before believing a zero.

### Auditing which modules have tests that could fail (2026-08-23)

`scripts/mutation-audit.sh` inverts every `if` in one source file at a time and counts failing
tests. Not part of `bun run check` — it rewrites source and takes minutes — but it is the only
thing here that distinguishes a covered module from a green one.

The result that mattered: **`compiler.ts` had 8 mutation sites and 0 failing tests**, which is
what exposed `compiler.test.ts` testing a re-implementation. After the fixes above:

| | sites | caught |
| --- | --- | --- |
| `contract.ts` / `index.ts` (node) | 7 / 29 | 8 / 10 |
| `collect.ts`, `subpages.ts`, `registry.ts`, `observe.ts`, `bindings.ts` | | all covered |
| `read.ts`, `compiler.ts`, `segments.ts` | | covered after today |
| `index.ts` (canvas), `mount.ts`, `useDismissable.ts`, `inline-fence.ts` | 12 / 2 / 2 / 14 | **0** |

**Read the two columns together, and do not read a zero as a verdict.** Three separate reasons
a module scores 0 without being untested: the operator does not apply (`observe.ts` and
`register.ts` are nearly `if`-free — hand-mutated instead); the covered exports are arrow
expressions with no `if` at all (`sameCode`/`matchSegment` in `inline-fence.ts`, which three
hand mutations do kill); or the remaining conditions are genuinely DOM-bound and this project
has no DOM in tests (`mount.ts`, `useDismissable.ts`, and `claimInlineFences`).

What was extractable got extracted rather than left to a browser: `paintSignature` is now a pure
function, and its three fields each have a mutation that kills a test — an id-blind signature
skips a repaint between two equal-length canvases, a streaming-blind one never settles, and
dropping the offerable list means the launcher never paints at all. That signature is what
stands between the panel and a React render per streamed token.

One more input-selection lesson from the same pass. Pinning `partial: true` to the streaming
branch needs a case where **both modes compile and disagree** — otherwise the settled path's
catch falls back to streaming and produces byte-identical output, which is how my first two
attempts passed with the condition inverted. An unclosed `.map(` is the separator: `final`
closes it as `{items.map(i => (null))}`, `streaming` cuts back to `<div></div>`.

### The two capability routes now have tests (2026-08-23)

`serveFs` and `serveExec` were the largest remaining gap — 29 conditions in the node half with
10 caught. Both take their dependencies as a `ctx` object, so both are testable by passing a
fake one; no server, no filesystem. Node `index.ts` now scores **28 of 29**.

What the tests pin is not the sandbox — that is `ctx.fs.resolve` and the session policy, the
host's code, and testing it here would test someone else's work. It is the things this plugin
decides, each of which is a comment that was never checked:

- **The write runs under the NAMED session's policy.** Mutating it to `sessions.list()[0]`
  fails two tests. Several sessions share a workspace, so picking the first silently runs a
  write under a stranger's access mode — the kind of bug that never throws.
- **A denial is 403 and a miss is 404.** The card has to tell "you may not" from "it broke";
  collapsing both to 404 makes a read-only session look like a bug.
- **A non-zero exit is a 200.** `bash()` resolves on failure and the prompt tells the model to
  check `exitCode` rather than catch. Turning it into a 500 would make every failed grep throw.
- **Truncation is per stream.** One merged boolean makes a complete stdout look unreliable
  whenever a noisy stderr overflowed.
- **A listing forwards three fields.** The host also returns an absolute `target` path and a
  `version` cache key; forwarding them leaks the filesystem layout into generated code.
- **A disconnected caller aborts the command.**

That last test failed three times before it passed, and every failure was the harness rather
than the code. `close` fired before `serveExec` had registered its handler (it awaits the
request body first); then the stubbed `run` resolved instantly, so the handler finished before
anything could disconnect; then two microtask turns still were not enough to reach `run`. The
fix was to stop guessing at timing and **wait on the event itself** — the fake `run` resolves a
promise when it is entered, and the test aborts after that. Three red runs against correct code
is the shape of a concurrency test that measures its own scheduling assumptions.

Two more after that. The **AI stream** had no test, and its own comment names a bug that already
shipped once: `chunk.reason` is an object with a `kind`, so interpolating it directly writes
`[object Object]` into the card's output. That regression, swallowing a mid-stream throw, and
adding a trailer to a clean finish are now three mutations that fail. The thing worth
remembering about this route is that **once the headers are out, nothing can become a status
code** — a failed call finishes rather than throwing, so without the trailer the card sees a
clean empty 200 and reports "the model said nothing", which is indistinguishable from a real
empty answer.

And **`skill.ts`'s `mapNotes`**, whose comment says the file "broke twice" on exactly this: three
states (no type map, type map only, both), generating advice about which `-i` flag serves which
command. The failure mode is not an exception, it is **bad advice reaching the model** — a wrong
flag makes every `$dsh/*` import report `Cannot find module`, and the model then goes and
"fixes" imports that were correct. Both branches now have a mutation that fails, and one test
just checks no state leaks a raw `${` or an `undefined` into the prompt.

Final audit: node `index.ts` **10 → 36** caught of 29 sites. Every remaining zero is DOM-bound
(`mount.ts`, `useDismissable.ts`, `claimInlineFences`, the canvas `index.ts` sweep) or
operator-inapplicable. 122 tests.

### A fake has to reproduce the contract, not the method names (2026-08-23)

`whenFrameReady` and `hasPainted` were the last two "needs a DOM" modules, and neither did.
`hasPainted` touches four members (`textContent`, `querySelectorAll`, `tagName`,
`getBoundingClientRect`); `whenFrameReady` touches `querySelector`, `MutationObserver` and the
timer pair. A hand-written fake of exactly that surface is smaller than a DOM dependency and
depends on precisely what the function depends on — 133 tests now, no new packages.

The lesson came from a red test against correct code. My `MutationObserver` fake implemented
`observe` and `disconnect` as counters, so firing a mutation after disposal still invoked the
callback and "disposing cancels the observer" failed. **A real observer stops delivering after
`disconnect()`** — the fake had the method but not the behaviour, and the part it left out was
the exact part the code relies on. When a stub-backed test fails, suspect the stub's fidelity
before the code: the third possibility, that the fake is *too permissive*, is what makes a green
stub-backed suite worth so much less than it looks.

Worth keeping from `hasPainted` too: it measures the *box*, not the presence, of a drawing
element. React mounts an `<svg>` before it lays out, so present-but-zero-sized is a card that
has not drawn yet — and treating it as painted hides the source block under an empty card.
Custom elements count by their dash rather than by a list, because a card may render one this
project has never heard of.

The canvas sweep's body-resolution logic is where extraction stops paying. Pulling the
three-state decision (no patch → the write's arguments are the canvas; cache hit → the file;
otherwise read) into a `resolveBody` function type-checks only with an extra `|| version ===
undefined` clause, because the checker cannot narrow `version` across the call the way it does
across an inline early return. That clause is noise added for the compiler, in a file whose
whole style is the opposite — so the extraction was reverted. **The last 12 conditions stay
untested rather than making the code worse to reach them**, and any real coverage there needs
a DOM in tests, which is a dependency decision rather than a cleanup.

### The streaming-JSON rule is fully effective (2026-08-23)

`skill.ts` spends a paragraph on the failure mode of `partial-json`: every field is optional
until the stream ends, so one `item.difficulty.includes(…)` on an early frame throws inside
render and unmounts the whole card mid-generation. It calls this "the failure mode of this API,
not an edge case".

**22 corpus cards import `partial-json`. All 22 guard correctly. Zero unguarded accesses.**
(21 of 21 when first measured; re-verified at 22 of 22 after the parser fix grew the corpus,
this time with a predicate that recognises `Array.isArray`, optional chaining and truthiness
guards rather than only `??`.) The
forms vary — `Array.isArray(d?.steps) ? … : []`, `if (data && Array.isArray(data.items))`,
`data.items.filter((it) => it && it.name)`, plus a `try/catch` around the parse in every one —
but the rule lands every time. That is the strongest evidence in the corpus that a skill
paragraph changes what gets written, and it is worth knowing before anyone "simplifies" that
section for length.

My first pass reported **7 of 21 at risk**, which would have been the largest quality problem
found today. The detector looked for `??` or `?.` on the exact property path and knew nothing
about `Array.isArray(x)`, `if (obj?.names)`, or a `try/catch` two lines up — every single hit
was a false positive, confirmed by reading all seven. **A safety-property detector that only
recognises the idiom you happened to think of measures your imagination, not the code**, and
its false positives all point the same direction: toward a problem that is not there.

Two other corpus checks with nothing to report, recorded so they are not re-run: unquoted CSS
units (`fontSize: 11px`) appear in **1 of 362** cards — the other two matches were `gap:8px}`
inside CSS strings. And the set of bare specifiers real cards import is small and stable: react
345, recharts 49, lucide-react 30, partial-json 21, then minimatch/motion/micromatch/
react-markdown/remark-gfm/semver/picomatch in single digits. All eleven resolve on esm.sh, none
pulls a `node:` builtin.

Checking three more skill rules the same way, all of which land:

- **"You are a component on someone else's page"** — `100vw/100vh` or `position: fixed` appears
  in **1 of 362** cards. (The same one `compile-cards.ts` flags; it is a true positive and the
  only one.)
- **The AudioContext gate** — 3 cards use Web Audio, **0 build the context at module scope**.
  All three use the taught shape exactly: a `ctxRef` plus an `ensureCtx()` that constructs
  lazily inside the first click handler. That paragraph is long and specific and it is being
  followed verbatim.
- **`sendMessage`** appears in 26 cards, so the click-is-the-reply pattern is in real use.

The one rule I could not check is **"a bordered box inside a bordered box"**: counting `border:
1px` occurrences flags 130 of 362, which measures how many cards draw borders, not how many
nest them. Left unmeasured rather than reported — same failure as the streaming-JSON detector,
caught before it produced a number this time.

The two *suppression* rules — "do not restate the reply as a card", "do not decorate an answer"
— are harder to check because they show up as cards that were never written, but the residue is
testable: a card with no interaction at all. **22 of 362 are non-interactive, and 21 of those
are charts** (recharts, or hand-drawn SVG), which is a picture answering better than a
paragraph, not decoration. The 22nd is a CSS bar chart comparing three languages — a
comparison, which the resident prompt names as card-worthy in the same breath.

So **zero decorative cards in the corpus**, and the check that would have found them is "static
AND draws nothing", not "static". Filtering on interaction alone would have reported 22
violations of a rule nothing violated.

### The fence-language slip was never gone (2026-08-23)

Recorded earlier today as fixed: "73 `ui4a/tsx` openers and not one bare `tsx`". Recounted
across all 1012 sessions with a predicate that reads the **whole fence body** rather than its
first 400 characters: **389 `ui4a/tsx` fences and 9 bare ```` ```tsx ```` blocks
holding a full component**. Two of those nine are not slips at all — the user asked to *read a
canvas file back*, and quoting a `.ui4a.tsx` in a `tsx` fence is the correct answer there. So
the real rate is **7 in 389, 1.8%**, the same order as the ~5% §4.5 recorded originally.
(Re-derived after the parser fix with the denominator from `parseUi4aSegments` — 382 correctly
fenced cards plus the 7 slipped — and it lands on the same 1.8%.)

Two separate windows hid it. The first count only looked at openers in sessions that already
contained `ui4a/tsx`, so a reply that slipped on *every* fence was invisible. The second, when
I went looking deliberately, matched `[\s\S]{0,400}` after the fence and required an
`export default` inside it — and a card that opens with imports and a `const options = [...]`
puts its default export past character 400. The first version of that check printed a clean
`0` and I nearly filed it as confirmation.

**A zero from a bounded search is not an absence, it is a bound.** Both times the fix was to
stop truncating and match to the closing fence.

The cost is a card silently rendered as a code listing — the reader sees TSX where an interface
should be. Nothing in the runtime can fix it: `FENCE_LANG` is what claims a block, and claiming
every ```` ```tsx ```` block would swallow every legitimate code sample the model writes about
React. This one belongs to the prompt, which already carries the rule as its first bullet.

Two more things the recount established, both the opposite of what I first wrote down:

- **A reply that slips, slips completely.** Not one of the seven mixes a correct fence with a
  slipped one — the whole reply commits either way. My first check said the opposite because it
  searched the *session* for `ui4a/tsx`, and the prompt contains that string, so every session
  matched and the column measured nothing.
- **The skill is not the factor.** 7 of 9 slipping sessions had loaded it, against 310 of 374
  correct ones — 78% versus 83%, no signal. Nor is the resident rule missing: seven of the nine
  carried it verbatim.

What the seven do share is the *ask*: `帮我搭个东西记录点什么` three times out of twelve, and the
"explain this expression" family (regex, cron, quicksort) four times. Both are cases where the
model writes prose about code first and the card second — which is exactly the situation the
resident rule already describes ("you decide to build the interface, write the whole component
correctly, and then open the fence with the language your fingers know"). The rule is right and
the residual is 1.8%; nothing here argues for changing the wording, and §4.5's warning about
naming a failing form applies with full force.

### Why the runtime cannot rescue a slipped fence (2026-08-23)

Tempting, and I built it before deciding against it. There are only **10 bare ```` ```tsx ````
fences in the whole corpus**, so claiming the ones whose body holds an `export default` is not
the reckless rule it sounds like: it rescues all 7 slipped cards and correctly ignores the one
snippet (a single-line `import Counter from …`).

It also claims the **2 replies that quote a `.ui4a.tsx` file back to the user**, and that is
the reason not to ship it. Those two are not slips — the user asked to read a canvas, and a
`tsx` fence is the right answer. Rendering them turns "show me this file" into a running
component, which is a worse failure than the one being fixed and hits a request that is
*correctly* served today.

I looked for a separator that works on the body alone and there is none, because there is
nothing to find: **a canvas quoted back IS a card's source.** The two cases differ only in
intent, and the parser sees text. Session context does separate them cleanly (both quoted cases
are exactly the sessions that read a `.ui4a.tsx` first, 2/2 against 0/7) — but `segments.ts`
takes a string, and threading tool-call history into the fence parser to recover 7 cards in 396
buys a coupling that will outlive the problem.

So: reverted, and the 1.8% stays with the prompt where §4.5 says trigger rules belong. Recorded
because the attractive version of this fix looks clean until you check what else it catches.

### The "loaded the skill and built nothing" cell is mostly not that (2026-08-23)

Earlier I recorded 140 such sessions, of which 72 wrote a canvas instead and 68 were
unexplained. Reading the 68: **39 produced no assistant message at all.** They end mid-stream on
a `*-chunks` record with no `turn/end` and no `session/end-seed` — killed while generating, and
8 of them had already opened a fence when they died.

Across the whole corpus **44 of 1012 sessions (4.3%) are truncated that way**, and they are not
a standing rate: 31 of the 44 land on **2026-08-19 (22% of that day)**, against 0%, 3.7% and
0.4% on the days either side. One bad afternoon of killed eval runs, not a product failure — and
a rate computed over the pooled corpus would have reported 4.3% forever.

That leaves **10 sessions** where the model loaded the skill, wrote a real reply, and built
nothing. Reading all ten: several are correct (a quicksort explanation the user asked to have
*explained*, a `ls` that found one file), and three are the `帮我搭个东西记录点什么` ask where the
model offered options and waited — which is what `skill.ts`'s "ask first" section tells it to
do. So the honest count of "should have built and did not" is closer to **2 or 3 in 1012**, not
68, and the cell that looked like the biggest behavioural gap in the corpus is mostly a
scheduling artefact plus rules working as written.

### Guarding the numbers in this file (2026-08-23)

`audit-record.py` catches one prompt scored differently in two sections. It does not catch the
failure this file actually suffered twice today: **a measurement recorded against a corpus that
had since grown.** "183 sessions" was true when written and stale an hour later, and a search
bounded to those 183 reported an absence that the full 1012 contradicted.

I tried extending the audit to flag unfamiliar denominators and reverted it — it fires on every
legitimate sub-population (`72 of 72` canvas writes, `28 of 29` mutation sites, `7 of 21`
streaming cards), which is most of them. A mechanical staleness check also cannot distinguish a
stale claim from correct history: the 183 entries above are properly historical, and one is
already annotated as corrected.

`scripts/corpus-size.sh` is what was actually missing — it prints the current session count and
says where the other denominators come from. **Re-run it before writing a new "N of M" here.**
Two rules that would have prevented both mistakes: a count is only meaningful with the date and
corpus size beside it, and **a fence count must come from `parseUi4aSegments`, never a grep** —
which language opens a card and which run closes it are both things the parser decides, and
today both of those answers changed.

### Every "of 362" in this file was measured before the parser was fixed (2026-08-23)

Applying the rule from the section above to my own day's work: the card corpus was extracted
with `parseUi4aSegments` **before** the shorter-closing-fence fix landed, so the 18 cards that
fix rescued were never in it. Re-extracted through the current parser: **378 unique cards, not
362.** The counts in the sections above are correct as of the parser they were run on and low by
about 4%.

Re-running the three checks that matter on the corrected corpus:

- **Compile failures: 3 of 379 closed cards.** One is new — an arrow function spliced into the
  middle of a boolean (`cur.lo >= 0 && (i: number) => i >= cur.lo`), which is the model writing
  invalid TSX, same class as the other two.
- **Visible remounts: still 0**, now over 378 cards.
- **Screens: `SHADOWED-EXPORT` 1, `VIEWPORT-UNITS` 2** (one new), `JSX-SUBSCRIPT` 0.

So no conclusion changes, which is the useful part of having re-derived them: the rates were
stable under a 4% corpus growth. **A measurement taken through code you are actively changing
has a version, not just a date** — and the fence parser was changed three times today, each time
altering what counts as a card at all.

A near-miss from that same re-verification pass, worth its own line because I have edited this
file a dozen times today the same way. A `str.replace(old, new)` whose `old` does not match
**does nothing and reports nothing** — my first attempt at the correction above wrapped the
anchor differently than the file did, `git commit` said "nothing to commit", and the only reason
that registered as a failure rather than a no-op was that the commit had nothing to add. Every
Python edit to this file now carries `assert old in s`. (Audited the other 91 CLAUDE.md commits
from today for the same failure — every one has a real insertion or replacement; this was the
only near-miss.) **A silent no-op edit is the same
failure class as a search window too small to reach the evidence** — the tool succeeds, the
result is empty, and empty reads as "already fine".

### I rebuilt `smoke.ts` without noticing it existed (2026-08-23)

Wanting to prove the shipped `lib/client.js` carries today's four parser fixes rather than just
`src/`, I wrote a script that stubs `window.__ModuleLoader__`, captures the factory, hands it a
real React, and checks the exports and the synthesized blob modules. It worked. It is also,
line for line, what `scripts/smoke.ts` has been doing all along — same seam, same real React
(`require("react")` for the two specifiers that need it), same blob capture and parse.

Two things led me there, and both are the same mistake in different clothes. I first tried to
confirm the fixes by **grepping the bundle for source text** — `grep -c` for a regex literal
reported the shorter-closer fallback MISSING when it is plainly there, because the escaping
differs after bundling. That is the failure this file already warns about for `import.meta`:
grep the behaviour, not the spelling. Then, having decided a behavioural check was needed, I
built one instead of looking for one.

The rule worth keeping: **before writing a verification script, run the checks that already
exist and read what they print.** `bun run smoke` prints the plugin id, the module table it
asked for, and the effect count — all three were on screen every time I ran `bun run check`
today.

The one thing salvaged: `smoke.ts`'s comment still called the capability shims `$ui4a/*`, two
days after the rename. Same class as the four rotted identifiers §4 already lists, and found
only because I was reading a file I thought I had to write.

### 368 of 378 cards actually paint (2026-08-23)

Everything above measures whether a card **compiles**. §4 lists three ways a card compiles
cleanly and renders blank, and `scripts/render-cards.ts` exists to settle that — it had never
been run against real cards. Mounted all 378 in Chromium through ego-browser, each into a real
`createRoot`, and read back `innerText` plus a zero-size check on any `svg`/`canvas`/`img`:

**368 painted, 6 threw, 4 blank — 97.4%.**

Four of the six throws are the compile failures already known. The two new ones are the payoff,
and neither is reachable by compiling:

- **React error #321** — `const fib = useMemo(…)` at module scope, a hook outside every
  component. Perfect TSX, dead on first render.
- **`unreachable`** — the wasm compiler panicking on a 204-line card, which is a `@esm.sh/tsx`
  bug rather than the model's.

The first is now a screen. A hook at **column 0** is in no function body by definition, and
`compile-cards.ts` flags exactly that one card in 378. Anchoring matters more than the pattern:
allowing leading whitespace matches the ordinary `useEffect` inside **109 of 378** cards, which
is the same false-positive shape as the streaming-guard detector. There is a control card and
blinding the screen fails `bun run check`.

Two harness lessons, since the first run reported 28 failures and 22 were mine:

- **The importmap must cover what the corpus imports, not what the checker's author remembered.**
  `partial-json`, `motion/react`, `minimatch` and every `$dsh/*` were missing, so ~90 cards
  failed to import for a reason that was not theirs.
- **Including the dead prefix.** 22 cards import `$ui4a/chat`, which nothing resolves in
  production — that is the point of the rename — but they are real cards from before it, and
  leaving them unresolvable reports a rebuild-lag artefact as a broken card. Shimmed, and the
  failure count fell from 28 to 6.

The four blank cards each had a **different** cause, and all four were invisible until
`console.error` was captured during the mount — React renders an empty tree and says nothing the
reader can see:

| card | cause |
| --- | --- |
| `401f703946a0` | `const [h, setH] = useMemo(…)` — only `useState`/`useReducer` return a pair |
| `83d06aa1ce20` | `<Fragment>` used with only `useState` imported |
| `acec9f8e5f4c` | `commits[commits.length - 1].date` on an empty array |
| `2f815f802de5` | `<code>src/*.{ts,tsx}</code>` — **a glob in JSX text is an expression** |

That last one is worth remembering on its own: inside JSX, `{ts,tsx}` is a comma expression over
two undefined identifiers, so a card explaining glob syntax breaks by *quoting the glob*. It
compiles, and `ReferenceError: ts is not defined` arrives at render.

Three of the four are now screens (`DESTRUCTURED-HOOK`, `MISSING-REACT-IMPORT`,
`UNGUARDED-LAST-INDEX`), each firing on exactly its own card in 378 and each with a control that
fails `bun run check` when blinded.

The third took a second look to get right. `commits[commits.length - 1].date` is guarded by
`if (!commits)` — which passes for `[]`, so a repo with no commits or a command that returned
nothing blanks the card. Four cards in 378 index a last element that way, but **only one can
actually be empty**: the other three build their array from a literal or a counted loop. The
screen is restricted to arrays filled from *outside* the card (`$dsh/exec`, `fs`, `ai` plus a
`setX` setter), which takes it from 4 hits to 1 — the difference between a screen and noise.

The glob-in-JSX is the one that stays unscreenable: knowing `{ts,tsx}` was meant as text and
`{count}` was not requires knowing what the author meant.

**`compile-cards.ts` now runs five screens, and three of them exist only because the cards were
actually rendered.** Compiling proved 375 of 378 fine; mounting found 10 failures. That ratio is
the argument for `render-cards.ts` being worth its browser dependency.

Worth stating the negative result that came with it: **64 of 378 cards read external data**
(`$dsh/exec`, `fs`, `ai`), and across all of them the empty-result class is **one card** — the
same one. No unguarded `xs[0].field`, no `Math.max(...xs)` that would return `-Infinity` on an
empty array. The model handles "the command returned nothing" correctly 63 times out of 64, and
the skill's `partial-json` paragraph is not the only place that lands: this is the same discipline
applied to a different source. A screen was still worth adding, because the one failure is a
blank card with no message, but the rate does not argue for a prompt rule.

### Clicking every card: nothing breaks (2026-08-23)

The render pass only proved cards *mount*. 279 of 378 have clickable controls and none had ever
been clicked. Dispatching the full `pointerdown/mousedown/pointerup/mouseup/click` sequence on
up to three controls per card, with `console.error` captured around each:

**0 blanked, 0 threw.** The only failures are the same 10 that already fail at mount. A card
that renders survives being used — which is the result worth having, and it is the first
evidence for it in this project.

The other two numbers from that run are both my harness, not the cards:

- **91 "inert"** (no text change after clicking). 47 are cards whose buttons call `sendMessage`
  or `streamText`, which the harness shims to no-ops — correctly inert. Of the rest, the sample
  I re-tested responded once I **clicked one control instead of three**: a segmented control
  (`linear`/`log`, a filter row, a tab strip) gets set and immediately unset by a loop that
  clicks every button in it, ending exactly where it began. Four of six flipped to "responded"
  on that change alone.
- **`innerText` cannot see a state change that is visual.** A highlighted tab, a chart axis, a
  changed border — all invisible to a text diff. Comparing `innerHTML` catches most of them, and
  a recharts re-render that produces identical SVG catches none.

So the click harness needs two rules: **one control per card, and diff the HTML**. Recorded
rather than implemented, because the finding it was built to test — do cards survive
interaction — is already answered.

### A failed dynamic import is cached as a rejection (2026-08-23)

Setting up the click run, `import("https://esm.sh/react@18")` failed in the page. Retried four
times in a loop — four identical failures — while `curl` fetched the same URL in 0.6s and the
page's own `fetch()` of a *different* esm.sh URL returned 200. It looked like per-URL rate
limiting.

It is not. **The module registry caches a failed import as a rejected promise for the lifetime
of the page**: re-importing the same specifier returns the same rejection without touching the
network, so a retry loop can never recover. Reloading the page cleared it and the import
succeeded immediately.

This directly contradicts how §4's cold-start entry says to respond ("re-measure before writing
it down") — re-measuring *in the same page* is the one thing that cannot work. This has a direct bearing on `GenUISurface`'s `TRANSIENT_LOAD` retry, and **I do not know
whether that path works.** It calls `renderer.clear()` and re-renders the card, which mints a
fresh blob URL for the *card* — but the thing that failed is a dependency the card imports
(`esm.sh/recharts`), and whether a new card module re-attempts a bare specifier that already
rejected is partial-react's business, not visible from here. The three-retry backoff was written
against a real esm.sh cold start and never verified end to end. **Recorded as unknown rather than
claimed as correct** — the honest version of what today's finding implies.

Two consequences worth carrying: a browser-side retry must change the specifier or the document,
and **a failure that reproduces identically four times in a row is evidence about caching, not
about the server** — the tell was `curl` succeeding while the page did not.
