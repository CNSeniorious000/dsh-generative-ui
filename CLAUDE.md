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
`compiler.ts` used to carry. Three things were **deleted** together on release day: the build plugin
that swapped in a shim, `src/client/runtime/compiler-shim.ts` itself, and `scripts/typecheck.mjs`,
whose only job was filtering upstream's two type errors — `typecheck` is now plain `tsc --noEmit`.
None of the three exists any more; they are named here so the next reader recognises them in an
old diff.

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

*(The file is gone — `typecheck` is plain `tsc --noEmit` since upstream stopped emitting those
two errors. Kept because the lesson is about path predicates, not about that script.)*

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
own boundary output: a bare text node, `ERROR: <message>`.

(Two different `onError`s live in `GenUISurface`, and confusing them cost me a wrong conclusion
twice today. The one in `callbacks` is the **renderer's**, always wired, and it is what runs the
`TRANSIENT`/`TRANSIENT_LOAD` classification and the retry. `onErrorRef` is the optional **prop**,
consulted only after those return. So "no caller passes `onError`" is true of the prop and says
nothing about the retry, which is live in production.) `hasPainted` returned true for it,
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

**Anchored to unterminated bodies only, it missed the case that actually happens.** The one
card in the 378-card corpus carrying leaked markup — `6d82723c61a7.tsx`, the `｜｜DSML｜｜`
spelling — has a *closed* fence: the model wrote the tags and then still wrote the closing
backticks. The strip never ran on it. It is invisible to the compiler check (both modes
compile it — the tags land after the last statement, where TypeScript reads them as JSX) and
only the paint check sees it, as `CORRUPT EXTRACTION`. Stripping on the complete path too
recovers the card: it paints. The lesson is the anchor's own justification read backwards —
"nothing legitimate can follow" is a fact about the *tags*, not about whether the fence
closed, so scoping the strip to one of the two paths was never load-bearing.

The method that found it is the same one that found the four runtime bugs before it: **read
the corpus as a specification for the parser, not as a sample of model behaviour.** A count
that comes out 73/72 is not a rounding error — the one row that does not balance is a bug
report written by production.

### Two fatal defects had a rule and no screen (2026-08-23)

The paint check's remaining unexplained failures — the only two of six that no screen flagged —
were both **parse** errors, and both already had a prompt rule:

- `fontSize: 11px` in a style object. `11px` is not a JS token, so the whole file fails; the
  error points into the JSX several lines away, not at the property.
- `^\w+@\w+\.\w{2,}$` as bare JSX text. JSX reads `{2,}` as an expression and dies on the comma.

So the loop had a hole on the side nobody checks: **a rule with no screen is a rule you cannot
tell is working.** Writing the screens took three wrong versions each, and every wrong version
failed the same way — by matching the FIX:

- `UNQUOTED-CSS-UNIT` first fired on 35 of 39 clean cards, all inside `<style>` blocks where
  `font-size: 11px` is required. The discriminator is camelCase: a style object writes
  `fontSize`, CSS writes `font-size`, and no card mixes them.
- `REGEX-IN-JSX-TEXT` first fired on every card holding a regex LITERAL (`/^\d{1,2}$/.test(v)`),
  then on the three corpus cards that display a pattern the RIGHT way — quoted and escaped.
  Three discriminators, one per wrong version: no `/` or `(` on the line, no quote, and a single
  backslash. Only the unquoted unescaped form reaches the JSX parser.

Final: one corpus card each, zero false positives across 39 fresh cards and the reference set.
And asked to build the exact thing that broke — a regex tester displaying that pattern — a fresh
card writes `const DEFAULT_PATTERN = "^\\w+@\\w+\\.\\w{2,}$"` and is clean under all 20 screens.
It is `test/cards/regex-tester.ui4a.tsx` now, because no reference card contained a regex escape
at all and the construct entry would otherwise have been guarding nothing.

### "0 of 378" means two different things (2026-08-23)

Counting which screen is the SOLE detector on a card — the ones carrying defects nothing else
would catch — turned up a 21st screen missing from the list entirely. `JSX-SUBSCRIPT` fires on
nothing.

That is the same reading that condemned the React-import rule earlier today, and here it is the
opposite verdict. The distinction is whether the screen CAN fire:

- **React-import-first**: written for a mechanism that does not exist (imports are hoisted). No
  input could ever trip it. Dropped.
- **`JSX-SUBSCRIPT`**: trips on both spellings of `<Icons[kind] />` and stays quiet on the fix,
  on `Record<Step["channel"], string>`, and on `useState<Foo[]>`. It works; the corpus simply
  does not contain the defect. Its one historical hit was the type-argument false positive, and
  retightening it to zero was the fix.

So a zero is only evidence about the rule once you have shown the screen answers correctly on a
constructed case. `test/cards-negative/` is what supplies that, which is why every screen needs a
control even — especially — when the corpus is silent.

The sole-detector table is the other half. `NO-FOCUS-RING` is the only screen firing on 50 cards
and `UNLABELLED-CONTROL` on 28; six screens are sole detector on nothing, meaning every card they
catch is already caught. That is not an argument for deleting them — a screen exists to name a
cause, and a card flagged by five screens with the wrong one dropped gets diagnosed wrong.

Breaking the 54 flagged cards down by what they wrote INSTEAD of a label reshaped the rule:

| | cards |
| --- | --- |
| a `<span>` directly above the control | **38** |
| nothing nearby at all | 14 |
| a closed `<label>` beside it | 2 |

The rule said "the number beside it is a separate element". The dominant shape is not the number —
it is a `<span>` holding the actual name, sitting right above the slider, which looks labelled and
announces as nothing. Almost every card that fails this **has** a visible name and puts it one
element away from where it would count. The rule now says that, and names the closed-`<label>`
form too, which is worse still because it reads as done.

Auditing the second carrier, `UNLABELLED-CONTROL` (28 sole diagnoses), found a real defect in it.
The check cleared a control whenever ANY `<label>` appeared within 250 characters — so a card
labelling its number input correctly suppressed the finding on an unlabelled slider two lines
below. The corpus case escaped only by luck: its label sat **1273 characters** away, five times
the window. A constructed version of the same card, written tighter, went straight through.

Now the label must actually name the control: wrapping it (implicit association) or carrying an
id the tag references. That found two more corpus cards, both writing

    <label><span>贷款金额</span></label>
    <input type="range" … />

— a label CLOSED before the control, which associates with nothing. It reads as a label and
announces as none. **54 of 378 now, and still zero false positives across 44 fresh cards.**

The lesson is about the evidence, not the regex: every real hit examined was a true positive, and
the check was still wrong. A screen that is right on every card you have can be right by accident,
and only a case constructed to be hard tells the difference.

Auditing the other three heuristics the same way, since a proximity window is the shape that just
failed:

- **`UNGUARDED-NUMBER-INPUT`** (a 500-character lookback) is correct on both interleavings — a
  slider between the number field and the call, and a number field after a slider.
  `lastIndexOf("<input")` works here specifically because the call sits inside its own element's
  handler, so "nearest preceding" IS the owner.
- **`UNGUARDED-ASYNC-HANDLER`** is scoped by brace depth, so misattribution cannot happen — but
  its guard pattern had a different hole. `latest` and `stale` were alternations matching a BARE
  identifier, so a handler naming a variable `latest` cleared itself with no guard at all. Both
  matched **0 of 378** corpus cards: pure speculation, buying a false negative. Removed, and every
  verdict on the corpus, the fresh cards, and the reference set is unchanged. A word is not a guard.
- **`NO-FOCUS-RING`**'s 80-character window is the one audited above, 0 false positives in 73.

Twenty-one constructed cases are pinned across the four. The pattern worth carrying: **an
alternation that has never matched is not harmless** — it cannot help, and it can excuse.

Swept every regex in `screens.ts` for the same shape. Eight have alternations that match nothing
in 378 corpus cards plus 44 fresh ones, and four of those sit in CLEARING position, where a match
excuses a card: `aria-labelledby`, `onKeyUp`, `onKeyPress`, and a focus `box-shadow`. All four are
**correct** — each is a real alternate spelling of the fix, and a card written that way genuinely
does the right thing (checked, one constructed card each, now pinned).

So "never matched" is not the fault. `latest` was wrong because it was a WORD THAT APPEARS NEAR
the fix rather than a form of it; `aria-labelledby` is unused coverage waiting to be used. The
question to ask of the next one is not "has this ever fired" but **"does a card written this way
actually do the right thing?"** The remaining four dead alternations are in detecting position,
where the cost is only coverage, not a wrong verdict — and constructing a card for each shows
`position: fixed`, `StrictMode`, `forwardRef`, and `#fafafa` all fire correctly. The corpus simply
does not contain them.

`useReducer` looked like the exception and is not: `MISSING-REACT-IMPORT` skips every `/^use[A-Z]/`
name on purpose, because normalize extends an existing react import with any hook. Verified by
rendering one — it paints. The component names beside it in the same list (`Fragment`,
`StrictMode`, `forwardRef`) are NOT repaired, which is the entire reason that screen exists. Worth
pinning because the audit reported it as a hole and the right answer was the opposite.

Which makes `NO-FOCUS-RING` worth auditing on its own: a false positive there mis-diagnoses more
cards than a wrong answer anywhere else, and it has been retightened once already. Checked the
whole flagged set rather than a sample — **72 of the 73 do not contain the string "focus"
anywhere in the file**, and the 73rd's only mention is `onFocus={(e) => e.target.select()}`,
which selects text rather than indicating focus. Zero false positives in 73. Seven constructed
cases are pinned alongside, including the two forms that fooled earlier versions (a `focused`
flag driving `borderColor`, and `:focus` used instead of `:focus-visible`).

### The screens strictly contain the paint check (2026-08-23)

Cross-tabulating all 378 corpus cards, now that 303 of them actually render:

| | count | |
| --- | --- | --- |
| screens fire, paints nothing | 6 | both agree |
| screens fire, **paints fine** | 195 | what the renderer cannot see |
| silent, paints nothing | **0** | what the screens cannot see |
| clean both ways | 177 | |

(Re-run at 24 screens; it was 170/202 at 21. The third row has stayed **0** through every
addition, which is the only column that would signal a hole.)

**Zero.** Nothing in this corpus breaks without a screen naming why first — the screens are a
strict superset of the renderer on this input. That settles what each check is for: the paint
check is not a second detector, it is what keeps the screens honest. A screen can be written from
a hunch and quietly measure nothing; a card that renders is a fact, and a screen firing on 170
cards that all render is the evidence those 170 defects are real but invisible.

It also means the direction of travel matters more than the count: the useful question is never
"how many fire" but "is there a card that broke and nobody predicted it". Today there is not.

`bun run cross-tab <dir>` runs it, reading the paint check's own report rather than
re-implementing "renders nothing" so the two cannot disagree. It exits non-zero and names the
cards when that third row is not zero. Verified by disabling every screen: it lists all six and
fails. Disabling a SINGLE screen did not — the six broken cards are each caught by more than one,
which is worth knowing on its own.

### What the paint check skips, by package (2026-08-23)

"80 skipped" hides whether that is one dependency or eighty. Naming them:

    80 skipped: recharts ×51, $ui4a ×21, micromatch ×3

Two different things. `$ui4a ×21` is the dead prefix from before the rename — those cards cannot
be made to run and should not be. The rest split by cost, and asking the registry rather than
guessing is what made the split obvious:

| | cards | unpacked |
| --- | --- | --- |
| `recharts` | 51 | 7.5 MB, 11 deps |
| the glob family + `motion` | 11 | 1.4 MB, 5 deps |

The second row was not a decision at all — installed, and the count went **292 → 303 checked with
zero new failures**. The first still is: 7.5 MB for 51 cards is a trade for the user to make, and
the skip is honest and counted meanwhile, so nothing is blocked on it.

Sharpened on 2026-08-24: **32 of those 51 recharts cards are clean under all 24 screens.** That is
the precise value of installing it — not "51 more cards checked" but 51 cards of which 32 currently
have nothing said about them at all. A card the screens call clean and the renderer never sees is
the only kind that can be broken with nobody noticing, and the cross-tab's third row (`silent +
paints nothing`) cannot see them either. It has been 0 all day, across 303 checked cards; whether
it is 0 across 354 is unknown.

Stubbing is not an option in either direction: a stubbed chart renders as nothing, so the check
would PASS a card showing a blank chart. That is why `lucide-react` IS stubbed and `recharts` is
not — an icon that renders as nothing is still an icon-shaped hole in a working card; a chart that
renders as nothing is the exact failure being looked for.

### The same prompt, before and after (2026-08-23)

Grouping the corpus by which SET of screens fires turned up a signature rather than a
coincidence: `UNGUARDED-ASYNC-HANDLER + UNSTOPPABLE-MOTION`, 7 cards, and **four of them are the
same card** — `CatNames`, from 给我五个猫名. A card that streams from the model and pulses while it
waits fails exactly those two: a loading animation with no `prefers-reduced-motion`, and a
generate handler with nothing to invalidate a superseded run.

The fresh runs of that same prompt are the controlled comparison the corpus otherwise cannot
offer — same request, same card, same two rules:

| | `prefers-reduced-motion` | run guard |
| --- | --- | --- |
| 4 corpus `CatNames` | none | none |
| 2 fresh `CatNames` | present | `AbortController` threaded into `streamText` |

Better than an aggregate rate, because everything else is held constant. And the fresh ones go
past what was asked: partial-JSON tolerance mid-stream, `AbortError` distinguished from a real
failure, and a `finally` that only clears loading state if that run still owns it — which no rule
mentions.

The corpus supports this comparison better than expected — grouping by the default export's name
finds the same card answered many times (`Answer` 107, `Pick` 19, `Mortgage` 15, `CatNames` 13).
The mortgage pair is the second controlled result, and the sharpest, because a mortgage card is
all sliders and number fields:

| | n | unlabelled control | no focus ring | unguarded number field |
| --- | --- | --- | --- | --- |
| corpus `Mortgage` | 15 | 9 | 6 | 3 |
| fresh, same prompts | 6 | **0** | **0** | **0** |

Prompt-matched pairs are what the corpus is actually good for. An aggregate 47%-vs-0% invites the
objection that the fresh cards are different cards; this does not.

Three repeated card types fire a screen in **every** corpus instance, which is where a matched
pair says most:

| card type | corpus | what fires | fresh |
| --- | --- | --- | --- |
| `GlobTester` | 5/5 | `NO-FOCUS-RING` in all five | 3 cards, 0 screens, `:focus-visible` in 3/3 |
| `RegexTester` | 5/5 | `NO-FOCUS-RING` 4, `BRAND-PRIMARY-FILL` 1 | 9 cards, 0 screens, `:focus-visible` in 9/9 |
| `History` | 5/5 | unguarded async 4, no ring 3, unreachable 2 | 1 card, 0 screens, guarded |
| `Mortgage` | 13/15 | unlabelled 9, no ring 6, number field 3 | 6 cards, 0 screens |
| `CatNames` | 10/13 | unguarded async + unstoppable motion | 2 cards, both guarded |

`History` needed a seed to measure at all — replayed in an empty directory the model correctly
says there is no repo, which is not a card and not a failure. **`test/seed/` already did this**,
with a `setup.sh` building three commits over a real `src/` tree; I wrote a second one before
checking and deleted it. `test/eval-fixtures.md` says so in its first section, which is where I
should have looked. The card that comes back carries the async guard, the focus ring, AND the
empty-array guard, none of which the prompt mentions.

`GlobTester` is the cleanest single line in the comparison: **five for five strip the focus ring
and none replace it; three for three of the fresh ones define `:focus-visible`.** A card type
where the old behaviour was unanimous is the one where a rule landing is hardest to attribute to
luck.

### Parsing is not delivery (2026-08-23)

`loads.sh` proved the prompt sections PARSE — the failure that made a whole day's rules inert
earlier. It did not prove they reach the model. Every eval run tests that implicitly (a card only
appears if the rules landed), but nothing said so.

Added: boot dsh and ask for a string only this plugin could supply.

    你收到的卡片规则里，代码块的 info string 应该写什么？只答那个字符串。
    → `ui4a/tsx`

The first version asked the model to quote any rule back and grepped for one — it quoted a
different rule each time and the check failed on a working system. **Assert what only the plugin
could have told it, not which sentence it chooses.** Verified in both directions: pointing the
grep at an impossible string exits 1.

The skill is a second section, loaded on demand, and it delivers too — asked about the slider rule
it came back with the `<span>`-is-not-a-label warning added the same afternoon, so a section
edited now is in the next turn's context. That closes the loop the whole day rests on: measure the
corpus → write a rule → the model receives it → generate → measure again.

### The control that found the one thing nothing fixed (2026-08-23)

If the rules only improved what the screens watch, that is teaching to the test. So: measure six
accessibility properties **no screen checks**.

| | corpus | fresh |
| --- | --- | --- |
| `role=` | 2% | 14% |
| `aria-expanded` | 1% | 12% |
| `<th>` in a table | 3% | 7% |
| `lang`/`dir` | 0% | 3% |
| `alt=` on an `<img>` | 0% | 0% (no card uses one) |
| **`aria-live`** | **0%** | **2%** |

Five of six improved without being watched, which is the control passing — the change is in how
cards get written, not in what the checker sees.

The sixth is a finding. **0 of 64 corpus cards that fetch anything announce the result, and 0 of
13 fresh ones.** A sighted reader watches a spinner become a list; a screen reader user is told
nothing — focus has not moved and the content appears silently below it. The only defect measured
today that BOTH populations get wrong, and the reason is simply that no rule ever mentioned it.

The same table answers a harder objection — that clean cards might just be plainer cards. They are
not:

| | corpus | fresh |
| --- | --- | --- |
| uses lucide icons | 31/378 (8%) | 25/58 (**43%**) |
| ...of those, any `aria-label` | 4/31 (13%) | 23/25 (**92%**) |

The fresh cards reach for icons **five times more often** and label them seven times more often.
An icon-only button is the harder thing to get right, not the thing being avoided.

Measured directly, on medians across both sets:

| | corpus | fresh |
| --- | --- | --- |
| bytes | 5,669 | **10,440** |
| hooks | 3 | 4 |
| event handlers | 2 | **4** |

Nearly twice the size and twice the interactivity. Whatever the rules did, they did not do it by
making cards smaller. And the size costs nothing that matters: median compile is
2.0ms for a corpus card and 2.4ms for a fresh one — sublinear in the byte count, and far below
anything a reader could notice on a card that renders inline.

Considered narrowing it to user-triggered fetches, on the theory that a card loading once on
mount has nothing to announce — the reader arrives and it is already there. **Checked instead of
assuming: 9 of the 9 mount-fetching cards show a loading state first**, so the content does change
while the reader is present and the announcement is wanted. No refinement needed; the hypothesis
was wrong and testing it cost two minutes.

(It read as 7 of 9 until the two exceptions turned out to say `正在统计项目文件…` and `正在扫描
src…` — a loading state my English-only regex could not see. A measurement on a Chinese-language
corpus that greps for `loading|pending` is measuring the language, not the behaviour.)

Now `UNANNOUNCED-ASYNC-RESULT` (63 of 378) with a rule behind it, and the fifth member of the
prefix-unsafe set — the `aria-live` container is in the JSX, written after the fetch that fills
it. That set predicted both of today's additions before either existed.

### What was actually wrong with the corpus (2026-08-23)

Sorting the 178 dirty cards by which KIND of screen fires:

| | cards |
| --- | --- |
| accessibility only (focus ring, labels, keyboard, motion) | **117** |
| everything else only | 25 |
| both | 36 |

**Two-thirds fail on accessibility and nothing else.** The rest is a long tail — one card each
for a duplicate style key, a comma in a style object, an unguarded last index. Cards were rarely
broken; they were routinely unusable without a mouse.

Two capability rules turn out never to have been broken at all: every one of the 39 corpus cards
touching `$dsh/fs` or `$dsh/exec` handles failure (11/11 fresh), and 31 of 31 `sendMessage` cards
also record the choice. The model has always got the plumbing right. What it missed was that a
card is used by people who are not holding a mouse.

That is also why the `:focus-visible` figure is the one worth quoting: **0 of 378 before, 51 of 58
after.** It is not one rule among twenty-two — it is the headline of the whole corpus.

### A rule that is received, understood, and not applied (2026-08-23)

`UNANNOUNCED-ASYNC-RESULT` got a rule, and the first card generated to test it — a file browser
that reads directories — **still fails the screen.** The first fresh card to fail one in 58.

Delivery is not the problem. Asked what its rules say about async results arriving, the model
quoted the new rule back nearly verbatim, including the reasoning. The card itself is careful:
loading, error, empty, and populated states all handled separately. It simply never marked the
region live.

So the failure is between *understanding a rule* and *reaching for it while writing JSX* — a place
none of today's other measurements could see, because every other rule landed.

Which raises the question of whether accessibility care is one trait or many. Tested on the
corpus: a card using `aria-*` anywhere is **51%** clean on the five accessibility screens, and a
card using none is **51%**. Identical. `role=` is if anything slightly worse.

**There is no such thing as a generally careful corpus card.** Each attribute appeared in
isolation, from whatever the card happened to need, with no transfer to the others — which is
exactly why one rule landing at 92% (`aria-label`) said nothing about whether the next one would
land at all. It also means the fresh cards' across-the-board improvement is not the same
phenomenon. Counting how many of four independent signals (`:focus-visible`, `aria-label`,
`prefers-reduced-motion`, `role=`) each card carries:

| signals per card | 0 | 1 | 2 | 3 | 4 |
| --- | --- | --- | --- | --- | --- |
| corpus (378) | **337** | 35 | 6 | 0 | 0 |
| fresh (67) | 2 | 2 | 16 | **37** | 10 |

**Not one corpus card in 378 carries three of them. 47 of 67 fresh cards do.** The corpus's mode
is zero and the fresh set's is three — the change is not "more cards happen to use an attribute",
it is that accessibility became something a card does as a matter of course rather than something
one card in ten stumbled into.

The one structural difference: this rule went into `prompt.ts` alone, while every accessibility
rule that landed (`aria-label` on icon buttons, 13% → 92%) lives in the skill's accessibility
section, grouped with its neighbours and carrying a code line. Moved it there, with the code line
and the reason `aria-live` must sit on the container rather than the spinner.

**The A/B came back positive.** Same prompt, same card, three runs:

| prompt | rule in `prompt.ts` alone | rule in the skill |
| --- | --- | --- |
| file browser | absent | **present** |
| command runner | absent | **present** |

Both prompts flipped, so it is a replication rather than a single lucky generation.

And written the right way without being told twice — `<div aria-live="polite" style={{ minHeight:
64 }}>` on a persistent container with reserved height, which is what makes the change
announceable at all.

**Where a rule lives changes whether it is applied.** The prompt is what the model reads before
deciding what to build; the skill is what it reads while building. A rule about a JSX attribute
belongs in the second, next to the other rules about JSX attributes — and one about *whether to
build a card at all* belongs in the first. That is a distinction nothing here had tested, and it
was worth two generations to find.

Audited the other twelve code rules in `prompt.ts` for the same problem and found none — every
one holds at 0 in the fresh set. But they are all **rare** defects (1–4 corpus cards each:
a comma in a style object, a duplicate style key, `&&` into an arrow), where placement cannot be
told apart from scarcity. `aria-live` was the only high-frequency rule sitting in the prompt
alone (63 of 378), which is why the effect was visible there and nowhere else.

### Reduced motion, the largest single delta (2026-08-23)

    corpus: 7 of 130 animating cards honour prefers-reduced-motion (5%)
    fresh:  52 of 52 (100%)

Not a sampling artefact — 130 corpus cards animate and 123 of them ignore the setting, which
people turn on for vestibular disorders and migraine. Every animating card in the fresh set
honours it.

### Three more areas that turned out not to be defect areas (2026-08-23)

Looking for the next screen by measuring instead of guessing. Three candidates, all dead ends,
which is worth writing down so the next reader does not re-derive them:

- **Width media queries.** A card renders at the panel's width, not the window's, so `@media
  (min-width:…)` is the wrong tool. **0 of 378 and 0 of 58** use one. The mistake has never been
  made; `@container` went 23% → 38%.
- **Fixed widths that force overflow.** Four corpus cards set a `width` over 100px with no
  `max-width`; zero fresh ones. And no card in either set — not one — puts a `min-width` floor
  above 320px outside a container query, which is the shape that would actually break a narrow
  panel.
- **`sendMessage` without recording**, and **`$dsh/fs`/`exec` without a failure path**: 31/31 and
  39/39 correct in the corpus, before any rule existed.

The pattern across all of these: **the model has always got structure and plumbing right.** Every
real defect found today is about someone who is not looking at the screen or not holding a mouse.

### A rule nobody has ever broken (2026-08-23)

The skill says a card acted on should do **both** halves — `sendMessage` the result AND record it
in state, because "a form that looks untouched after submitting reads as broken". Measured:

    corpus: 31 of 31 sendMessage cards also record the choice
    fresh:   3 of 3

Never violated, before the rule or after. By the standard applied to the two deleted checks, a
rule that finds nothing should go — but the standards differ, and the difference is worth being
explicit about. **A check costs runtime and false confidence; a prompt rule costs tokens.** A
check that cannot fail is indistinguishable from a broken one, while a rule everyone follows may
be the reason they follow it, and nothing here can tell those apart.

So: delete checks that measure nothing, keep rules that measure nothing, and record which is
which rather than pretending the 31/31 is evidence the rule works.

### Two checks that measured nothing, and were not kept (2026-08-23)

**"Renders almost no text."** 30 of 378 cards produce under 20 characters. Reading them: a
counter renders `0` and `+1`, which is four characters and completely correct. Thin is not broken,
and the metric cannot tell a minimal card from a dead one.

**"Has a button with no handler."** Written, verified it CAN fail on a constructed card, then run
on the corpus: **0 of 209 cards with buttons**. Models do not make that mistake. A checker that
can only pass is indistinguishable from a checker that is broken, so it went in the bin rather
than into `bun run check`, where it would have added runtime and a false sense of coverage.

The general point, since three screens today came out of exactly this kind of exploration: **a
check earns its place by finding something, and the honest response to a zero is to delete it.**
`JSX-SUBSCRIPT` is the one exception, and it earns that by tripping on a constructed case with a
prompt rule behind it — the defect is real and fatal, just absent from this corpus.

### Injection, applied to all 22 screens (2026-08-23)

`bun run inject <dir>` writes one mutation per screen and reports how many real cards it is
caught in. Sixteen came back at or near 100% immediately. The three failures were all worth
having:

**`HARDCODED-BACKGROUND`: 0 of 48, and it was a real hole.** The screen was cleared by
`!/dsw-alias/.test(src)` — a WHOLE-FILE escape, so a card using a token once could hardcode every
background and never be seen. It existed to suppress 35 spurious hits whose real cause was the
match running past the declaration into the next property: `background: var(--dsw-…); color:
#fff` read as a hardcoded background. Stopping the value at `;` gives **the same 3 of 378 with
nothing excused**, and injection went 0/48 → 47/47. The braces still have to balance, because
`background: active ? cfg.color : "#fff"` is two of the three real hits.

A reference card carried the same error in prose — `near-misses.ui4a.tsx` asserted "35 of 378
corpus cards do this and are correct". Re-measured with the fix: **0**. No corpus card uses tokens
and hardcodes a background. A wrong measurement had been written into a fixture as a fact.

**`BRAND-PRIMARY-FILL`: 0 of 48, and the screen was right.** Two mistakes in my injection, the
second dangerous: the screen fires on the PAIRING not the fill, and the token is `brand-primary`,
not `state-business-primary`. Those are different colours — `brand-primary` is a FOREGROUND
despite its name, so filling with it and writing white on top is a white square with invisible
text, while `state-business-primary` is the real accent and white on it is correct. "Widening" the
screen to accept both spellings would have flagged 95 of 378 cards, **84 of them fine**.

**`UNGUARDED-LAST-INDEX`: 0 of 57, injection too weak.** It is scoped to externally-filled arrays,
so the mutation has to supply a capability import and a state setter, not just the index.

All 22 catch their defect now, so the 57-card streak is a result rather than a blind checker. One
exemption is named and tested for staleness: `piano.ui4a.tsx` fills keys with `#ffffff`, which is
white by definition rather than by theme.

**The same class showed up again immediately.** The first fresh card to trip a screen in 58 was
styling a `::-webkit-slider-thumb` white — a thumb is white the way a piano key is, by physical
convention, and a themed one looks broken. Excluded in the screen rather than exempted per card,
which costs nothing (the three corpus hits are all ordinary surfaces) and generalises: a
pseudo-element that draws a physical control is not a page surface. The piano stays a named
exemption because a `<div>` styled as a key has no such marker to test for.

Run against the 378-card corpus as well — a different population, three months older — and all 22
catch there too. That matters because a screen written from the corpus could easily only work on
corpus-shaped code; these work on both.

### Is a 57-card clean streak evidence, or an unfalsifiable checker? (2026-08-23)

A streak that long invites the question of whether the screens can still fire on anything a
current model writes. Answered by **injection**: take each fresh card, add one defect, see if the
screen notices.

| screen | caught |
| --- | --- |
| `DUPLICATE-STYLE-KEY` | 48/48 |
| `COMMA-IN-STYLE` | 48/48 |
| `NO-FOCUS-RING` | **0/56** |

The zero is the screen being right. Every fresh card defines `:focus-visible`, which clears it —
so injecting an `outline: none` changes nothing. Stripping the ring FIRST and then injecting gave
5 of 50, which looks like a hole and is also correct: **a card with no focus styling keeps the
browser default**, a real affordance. `outline: "none"` removes it; writing nothing does not.

That boundary was never stated, and the corpus makes it worth stating — **237 interactive cards
define no ring at all, three times the 73 this screen catches**. Widening it to "has no focus
ring" would triple the report and every new hit would be a card that is fine.

Injection is the general answer to "is this checker still alive?", and cheaper than it sounds: the
fresh cards are already on disk, and a one-line mutation per screen says whether the streak is a
result or an artefact.

### The trigger rules, measured for the first time (2026-08-23)

Twelve cases across the nine rules, one real model turn each: **11 cards, 1 prose.** All nine
rules land — a conversion, a calculation, a plan, an expression handed over, a request to browse,
a request for a few of something, and an explicit ask to visualise all produce an interface rather
than a paragraph.

The single miss is `98 华氏度是多少摄氏度`, re-run four times afterwards and a card every time. See
below on why one run per case is a smoke test and not a measurement.

Notable in passing: the two prompts that read least like card requests — 给我五个猫名 and
周末晚饭吃什么好 — both produced one, and the cat-names card came back with `$dsh/ai` and a
regenerate button, which is precisely what its rule asks for ("a block that regenerates on demand
answers the question they will ask next").

### A trigger rule has a rate, not a verdict (2026-08-23)

The first trigger-suite run reported a miss on `98 华氏度是多少摄氏度` — a prompt quoted **verbatim
in its own rule**, answered as prose. That looks like the cleanest possible refutation.

Re-ran it four times: card, card, card, card. Four of five, so the rule works about 80% of the
time and the single miss measured nothing. The trigger decision is a model judgement made fresh
each turn; unlike a screen, which is a pure function of the source, it does not have a verdict.

`triggers.sh` takes a repeat count now and prints `card 4/5` rather than pretending. One run per
case is a smoke test — worth having, since a rule at 0% would still show — but a miss is not
evidence until it repeats. **The failure mode this avoids is the expensive one**: deleting or
rewriting a working rule because one sample went the other way, which is exactly what the earlier
12-seed ablation did to the flake fixes.

### A script that does something on import cannot be a library (2026-08-23)

Extracting `stubUnresolvable` from `paint-cards.ts` and importing it into the canvas test meant
**every test run silently painted every reference card** — that script does its work at module
level, so importing it for one function ran the whole check. Visible only as a stray `paint: ok`
line in the test output, which reads like a passing gate rather than a mistake.

It is `scripts/stub-unresolvable.ts` now, and a test keeps it there. An `import.meta.main` guard
would work equally well; a separate module says it in the file layout instead of in a condition.

Worth noticing how it hid: the side effect PASSED. A stray success is not something anyone looks
at twice, and the suite got faster once it was gone.

### Prompts I did not choose (2026-08-23)

Every fresh-card batch until now used prompts I wrote, which measures the rules against the cases
I thought of. `scripts/sample-prompts.py` draws them from the session corpus instead — 742 real
user prompts, 215 unique after filtering — and prints the seed so a surprising result replays.

Two unbiased batches so far: **9 cards, all clean, all painting**, plus one prose answer that was
correct (a prompt asking about "这仓库" replayed in an empty temp directory — there is no repo, and
saying so is the right response). That one exposed a flaw in the sampling, not the rules: a prompt
whose subject is absent cannot measure a card-triggering rule, so `NEEDS_WORKSPACE` filters them.

Also built `scripts/triggers.sh` for the nine trigger rules, the only ones with nothing behind
them — a screen asks whether a card is wrong; these ask whether there should have been a card at
all, answerable only by running the prompt. The cases come from the rules' own examples, and the
two spot-checked so far both produce cards: the glob expression, and 给我五个猫名, which is the
text of its rule.

### A transition that animates nothing (2026-08-23)

Asking of `UNSTOPPABLE-MOTION` the same question that reshaped the slider rule — *what did the
card write instead?* — split its 37 hits into 16 with `@keyframes` and 21 with only a
`transition:`. Sampling those 21 found every one a true positive, and found something else:

    transition: "transform .12s ease, border-color .12s ease"

on an element whose `transform` is **never set**. Four of 378 cards. The transition animates
nothing; it reads as polish and is not there. Now `TRANSITION-WITHOUT-TRANSFORM`, 22 screens.

Two false positives while writing it, both instructive:

- One card sets the transform **imperatively**, `e.currentTarget.style.transform = "scale(0.95)"`
  from `onMouseDown`. That is real motion, and it never appears in a style object.
- The negative control **described** the imperative form in a comment, and the words cleared the
  screen. Every other screen strips comments first; this one now does too. A card explaining a
  fix in prose is not a card applying it — and a control is exactly the shape that does that.

It also joins the prefix-unsafe set, which the file predicted: the fix (`transform:`) is written
after the promise (`transition:`), so a mid-stream cut shows the defect alone. That list said "a
fourth screen with the same shape should be expected rather than investigated" before there was
a fourth.

### The multi-file canvas nothing tested (2026-08-23)

Running the six fixture files through the screens produced the first hit on fresh output in 44
cards — `NO-FOCUS-RING` on `Tasks.tsx`. It is noise, and of a kind not seen before: **the entry
defines `button:focus-visible` once for every sub-page**, so the canvas is fine and only the file
looks wrong. A screen asks a question about a CARD, and a canvas is one card spread over files.

No gate does this today (`cardsIn` is non-recursive), which is why it had never surfaced. Pinned
as a test so it stays a decision: a checker taught to walk canvases must concatenate first.

The fixture renders too — 3769 characters of text, so the assertion is on a real dashboard rather
than an empty shell. Getting there needed `paint-cards.ts`'s stub chain, which was inline in its
loop; it is `stubUnresolvable` now, one export used by both. `recharts` stays deliberately
unstubbed there and here: a stubbed chart renders as nothing, so stubbing it would make the check
PASS a canvas showing a blank chart. That page is dropped from the render instead — an honest
hole beats a false negative.

Generated one to check the `lastIndex` fix on something real — six files, an entry importing
five sub-pages, four of those importing `./ui` and `./data` from each other. Two harness mistakes
before it worked, and both are worth keeping:

1. **`./project-dashboard/Overview`, not `./Overview`.** Beside the entry file the contract
   requires the id prefix; without it the specifier would resolve into another canvas's
   directory. The model wrote it correctly and my reader did not.
2. **`from` must be the path the server resolved, not the basename.** `src/index.ts` returns
   `path + suffix` in `x-ui4a-filename` for exactly this reason. With a bare `Overview.tsx`,
   every child-to-child sibling import comes back `null` — indistinguishable from a missing file.

Production was right both times; the harness was wrong. But the gap was real: **nothing exercised
a multi-file canvas end to end**, which is how a bug dropping every sibling import shipped — the
unit tests each passed one hand-written specifier, and the shape that broke needed two calls on
the same string in production's order. `test/canvas-e2e.test.ts` now runs the real fixture through
the real contract and the real compiler; reverting the regex fix fails it deterministically.

### A shuffled-order flake that was a production bug (2026-08-23)

Three of 20 shuffled orders failed on `inlineSubPages`, reporting zero rewritten imports. The
instinct — and the shape of every earlier flake here — says test isolation. It was not.

`SPECIFIER` is one module-level regex shared by `importsSibling` (a `.test`) and `inlineSubPages`
(a `matchAll` and a `replace`). It was `/g`, and **`.test` on a global regex leaves `lastIndex`
past the match it found**, so a `matchAll` on the same string immediately after returns zero:

    SPECIFIER.test(code)          // true,  lastIndex = 23
    [...code.matchAll(SPECIFIER)] // 0 matches

That is exactly the order `CanvasPanel` calls them in — ask whether there are sibling imports,
then go resolve them. The panel was told yes and resolved none. **The card rendered without its
sub-pages, silently, in production**, and the only reason it showed up as a flake is that whether
the poisoned `lastIndex` outlives the call depends on which test ran first.

Fixed by deriving two regexes from one pattern (`matchAll` requires `/g`; nothing else should
have it) rather than the previous fix, which was to share one — sharing is what introduced this.
Reverting now fails 3 tests deterministically, in every order.

**A flake that reproduces in 3 of 20 orders is not thereby an isolation problem.** The question
that separated them was "what does production call, in what order?" — and it called exactly this.

Confirmed end-to-end on the real path with the real compiler, not just in a unit test — a canvas
importing `./row.tsx`, run through `importsSibling` then `inlineSubPages`:

| | sub-pages inlined | entry still imports `"./row.tsx"` |
| --- | --- | --- |
| before | 0 | yes |
| after | 1 | no, rewritten to a blob URL |

The "before" row is what shipped: the relative specifier reaches the browser, where nothing
resolves it, and the canvas renders blank. Verified present in `lib/client.js` after a build.

Swept the rest of the codebase: `SPECIFIER` was the only module-level `/g` regex in it. A test
now bans the shape (`test/subpages.test.ts`), the same way one bans `[^>]*` against a JSX tag —
function-local `/g` is fine, since each call builds a fresh object, and `new RegExp(pattern, "g")`
derived from a non-global literal is the safe form the fix uses. Verified by adding one and
watching it fail.

### The first fresh card that was clean and did not paint (2026-08-23)

Four cards generated specifically to bait the newest screens — a regex log filter, a glob
cheatsheet, a `&&`-condition panel, a contrast checker — all came back clean, and one did not
paint: `document is not defined`.

It was **the check's fault, not the card's.** The contrast checker parses CSS colours through a
canvas `fillStyle` round-trip, which is legal, and calls it during render, which `react-dom/server`
has no `document` for. Same shape as `localStorage` and `matchMedia`, stubbed here earlier for
exactly this reason: reporting a working card as broken is the failure this script exists to avoid
making. The stub is `createElement` only, returning `getContext: () => null` — what a browser does
for an unsupported type, so a card handling that path still paints and one assuming success still
fails. **Corpus verdict is unchanged at 6**, which is the check that it recovers a working card
rather than hiding a broken one.

Worth stating because the instinct on a clean-but-blank card is to go add a screen. 44 of 44 fresh
cards paint now, and the screens still predict every corpus loss.

### Auditing rules→screens found a rule that is factually wrong (2026-08-23)

The audit is a test now (`every code rule in the prompt has a screen enforcing it`), so the next
rule added cannot skip it. Two things it forced: a screen may pin more than one phrase (the same
defect gets argued in more than one bullet — `MODULE-SCOPE-HOOK` is spelled out both where hooks
are introduced and where `useMemo` is), and the match runs against the WHOLE bullet, not its bold
header, because a screen's phrase is usually the sentence after the header. Verified by rewording
one rule: 3 tests fail, and restoring it passes.

The suite checks every screen has a rule. Nothing checked the reverse, and running it by hand
left two of the 13 code rules unscreened.

**`&&` does not chain into an arrow function** was real: one corpus card, `2f7a87253134.tsx`,
writes `cur.lo >= 0 && (i: number) => i >= cur.lo`, and it is one of the six paint failures.
The screen found it independently. (First version matched across newlines into the `.map((x) =>`
inside a multi-line `cond && ( … )` block — 8 of 39 clean cards. Same-line, and the parens must
hold a parameter list.)

**"The React import line comes first, before anything else in the file"** was not. The screen
found **0 of 378**, and a card written with a `const` table above the import **paints** — ES
imports are hoisted, so the stated mechanism does not exist. It came from `92550ce`, whose
finding was the *missing* import; "comes first" was an inference about why, never measured.

Rewritten to say the true thing: write the import first not because a later one breaks, but
because a card that starts with the data reaches `useState` without having thought about
importing it — and that does throw. **A screen that finds nothing is not a screen that is idle;
it is a measurement, and here it measured the rule wrong.** Kept the rule, dropped the screen,
because there is nothing left to detect.

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

**As of the end of this session no module scores zero.** Every source file with mutation sites
has at least one test that fails when it breaks — the last three were `useDismissable.ts` (the
dismiss effect extracted so its four rules are testable without a renderer), `register.ts` (the
document import map: install once, defer to a host-owned map, prepend not append), and the
canvas sweep's final two conditions. `mount.ts` scores 16 on 2 sites because `whenFrameReady`
gates every canvas test, which is a real dependency rather than an inflated number — verified by
running the mutation by hand.

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

The glob-in-JSX I first recorded as unscreenable — "knowing `{ts,tsx}` was meant as text and
`{count}` was not requires knowing what the author meant". **That was wrong, and it is now the
seventh screen.** The author's meaning is not needed: a real JSX expression names something
**bound somewhere in the file**, and a glob's parts are bound nowhere. `GLOB-IN-JSX` flags a
brace pair in JSX text holding only comma-separated bare identifiers, none of which has a
declaration, parameter, or import binding it — exactly 1 hit in 378.

Getting there needed one correction. My first `declared` filter asked whether the name appeared
on a line containing a keyword, which matches `.tsx` inside any string on an `import` line, so
every candidate looked declared and the screen reported **0** — a clean zero from a filter that
was too loose, not an absence. Requiring a genuine binding site fixed it. **All four
blank-render causes are now screened.**

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
it down") — re-measuring *in the same page* is the one thing that cannot work. **This makes `GenUISurface`'s `TRANSIENT_LOAD` retry a no-op**, and the chain is now measured
end to end rather than argued:

1. A probe page imports a dead URL twice, counting `fetch` calls in between: the second import
   rejects with **0 network requests**. Same URL, same rejection, no attempt.
2. `mergeFallbackImports` (partial-react's `toEsmShImportUrl`) maps each bare specifier to a
   **deterministic** esm.sh URL — `https://esm.sh/<pkg>?target=es2022`, no cache-buster.
3. So `renderer.clear()` + `render(code)` mints a fresh blob for the *card*, and that new card
   module imports the **same** dependency URL that already rejected. Nothing re-fetches.

The three-retry 0.4/0.8/1.2s backoff was written against a real esm.sh cold start and cannot
recover from one. **Fixed.** `retryRef` now re-runs `mergeFallbackImports` and appends `&ui4a-retry=<attempt>` to
every `https://esm.sh/` entry before re-rendering; blob URLs are left alone, and esm.sh returns
200 for the unknown parameter.

Proved end to end with a probe page that imports a missing module three times — same URL twice,
then a busted URL — and counts **`PerformanceObserver` resource entries**: `2 entries for 3
imports`, the same-URL retry making no request and the busted one making a real one.

Then A/B'd against a **genuinely flaky dependency** — a local server that 503s the first two
requests for `/dep.js` and serves it on the third, which is exactly the esm.sh cold start the
backoff was written for:

| | requests the server saw | outcome |
| --- | --- | --- |
| old (same URL each retry) | **1** for 4 attempts | NEVER RECOVERED |
| new (`&ui4a-retry=n`) | **3** for 3 attempts | RECOVERED on attempt 2 |

The dependency was healthy by the third request and the old code never asked for it. That is
the whole defect in one line, and it needed a server that fails *transiently* to show — a
permanently-missing module makes both versions look equally broken, which is why the first
probe could only prove the mechanism and not the consequence.

That measurement method is the part to remember. My first probe wrapped `window.fetch` and
reported "0 network requests" for *both* retries, which I read as confirmation. **A module
`import()` does not go through `window.fetch`** — the counter could not see any module load at
all, so it reported zero for the working case too. A zero from an instrument that cannot observe
the thing is not a measurement, and it agreed with my hypothesis, which is exactly when it is
hardest to notice.

Two consequences worth carrying: a browser-side retry must change the specifier or the document,
and **a failure that reproduces identically four times in a row is evidence about caching, not
about the server** — the tell was `curl` succeeding while the page did not.

The classifiers now have tests, and writing them turned up the thing the retry fix depends on.
Every input is a string **captured from Chromium**, by importing a module that fails in that
particular way — a 404, an unknown esm.sh package, a dead host, an unresolvable bare specifier:

| what failed | message | retried? |
| --- | --- | --- |
| 404, unknown package, dead host | `Failed to fetch dynamically imported module: …` | yes |
| bare specifier with no map entry | `Failed to resolve module specifier '…'` | **no** |

The second row is correct and worth protecting with a test: an unresolvable specifier means the
import map has no entry, and no number of retries adds one — `mergeFallbackImports` is what fixes
that, and it runs on an import-set change rather than on an error. Widening the pattern to
`failed to (fetch|resolve)` now fails a test.

All three engines' wordings are covered (`NetworkError…` for Firefox, `Load failed` for Safari),
which was already true and is now held. **Chromium produces exactly one string for three quite
different failures**, so testing against invented messages would have proved almost nothing
about the one that matters.

`scripts/flaky-dep-server.py` is the fixture, checked in with both pages (`/` the fixed retry,
`/old` the pre-fix one, `/hits` the true request count). It exists because **a permanently
missing module cannot show the difference** — both versions fail identically against one, and
only a dependency that recovers on its third request separates "retried and failed" from "never
retried at all". Threaded, because a single-threaded server deadlocks the moment the page
fetches `/hits` while the browser still holds the HTML connection.

### Testing the canvas sweep, and two harnesses that proved nothing (2026-08-23)

The sweep's 12 conditions were the last real gap. Extraction was tried and reverted (the
body-resolution logic only type-checks inline), so it is tested where it lives: `mountCanvasHost`
takes its inputs as callbacks, and the only globals it needs are the ones `observe.test.ts`
already stubs plus a `createRoot` that records what it was handed. Assertions are on the
`Canvas[]` the panel is rendered with — what the reader sees. Canvas `index.ts` went from **0 of
12** caught to **10**, covering body resolution, the re-list rules, and the launcher-opened path.

Three traps, each of which produced a passing test that measured nothing:

- **`mock.module`, not namespace assignment.** An ESM namespace object is read-only
  (`TypeError: Attempted to assign to readonly property`), and the import binding resolves at
  evaluation time — so the mock must be registered *before* the module under test is imported,
  which is why that import is dynamic.
- **Import the module under test with a cache-busting suffix; import its collaborators
  without one.** `index.ts` imports `../runtime/observe.ts` plainly, so `observe.ts?<suffix>` is
  a *different* module with its own listener set and its `scheduleSweep` drives nothing. My
  "extra sweeps" did not sweep, and every test still passed because the first sweep was enough.
- **A tool call that was present at mount never changes anything.** The re-list is keyed on the
  settled-opaque *count changing*, so both listing tests had to push their call in **between**
  sweeps. Written the obvious way — all calls present from the start — they passed with the
  `canvases` clause deleted from `OPAQUE_WRITE`.

The third is the one worth generalising: **a test for "X causes Y" must make X happen during
the observation, not before it.** All three were caught the same way, by mutating the code the
test claimed to cover and finding it still green.

A fourth, from the last two conditions, took five attempts: **teardown produced the same
observable as the behaviour under test.** The panel collapses the column when its last canvas
goes away (`setWidth(0)`, restoring the frame's original padding) — but `dispose` restores that
padding too, so the working code and the version with the collapse *deleted* both end at `8px`.
Asserting on the final padding passed three times running. Recording every width change shows
the real difference: `[420, 0, 0]` working versus `[420, 0]` broken, and the assertion has to be
"a collapse happened **before** teardown" (`widths.slice(0, -1)`). **When cleanup does the same
thing as the feature, the end state cannot distinguish them — only the sequence can.**

A process note from the same session, because it nearly shipped: I ran `bun run check`, read the
`154 pass` from the `bun test` line, and committed — while `check` had actually **exited 1** on a
lint error two steps later. The passing line I read was real and belonged to a stage that ran
before the failing one. **`bun run check` prints many summaries and only its exit code is the
answer**; the fix landed a commit later, but a less obvious lint failure would have gone in.
Every check in this session that mattered was run without a pipe for exactly this reason, and
this is the one time I looked at the text instead.

### The colour rule lands too (2026-08-23)

The resident prompt's token table is the longest thing in `prompt.ts` that is not a trigger rule,
and it works: **371 of 378 cards use `--dsw-alias-*` tokens** (98%).

Getting the failure rate right took three passes, each narrower than the last, and the narrowing
is the whole lesson:

- **80 cards contain a literal colour** in a background/color/border. Meaningless — the prompt
  explicitly permits chart series hues.
- **59 hardcode black or white.** Still meaningless: almost all are `color: "#fff"` on a
  *coloured* background (a brand-tinted chip, a filled button), which is correct and stays
  correct in dark mode.
- **2 hardcode a black or white *background*.** That is the real defect — a white panel with
  `color: "#374151"` text becomes a white slab in a dark theme. Both are genuine, both in long
  cards, and 2 in 378 is 0.5%.

**Only the background is theme-dependent.** Text colour on a surface the card itself painted is
theme-independent by construction, and a detector that cannot tell those apart reports 30× the
real rate. This is the fourth time today a first-pass detector over-reported by an order of
magnitude — streaming guards (7 → 0), remounts (35 → 0), nested borders (130 → unmeasurable),
and now colours (80 → 2). Every one of them pointed at a problem that was not there.

The pattern is consistent enough to state as a rule. **A first-pass detector for a code-quality
property over-reports by roughly an order of magnitude, and it over-reports in the direction you
expected.** Four for four today, each caught only by reading the individual hits:

| property | first pass | after reading the hits |
| --- | --- | --- |
| unguarded streamed fields | 7 of 21 | **0** |
| mid-stream remounts | 35 of 362 | **0** |
| hardcoded colours | 80 of 378 | **2** |
| nested borders | 130 of 362 | unmeasurable, abandoned |

The mechanism is the same every time: the regex encodes the *shape* of the mistake and knows
nothing about the shapes of the correct code around it — `Array.isArray(x)` guards, white text on
a painted chip, a segmented control returning to its initial state. So the rule is not "write a
better regex", it is procedural: **never report a count from a new detector without reading
every hit, or a sample if there are more than a dozen.** If reading them is too expensive, the
number is not worth having. And the direction is not random — a detector built while suspecting
a problem finds that problem, which is exactly when the reading is most necessary and feels
least so.

### The mutation audit was under-reporting for its whole life (2026-08-23)

The audit's job is to name conditions no test constrains. It reported "no module scores zero" and
was believed. Rewriting it to mutate **one condition at a time** turned up **nine live guards**
that no test would have noticed being deleted — including `$dsh/fs` and `$dsh/exec` with no host
bound, both `!response.ok` denials, the `canvasChildPath` traversal fence, and the panel's
collapse-when-empty. Three separate flaws, each of which fails silently in the safe-looking
direction:

- **Mutating a whole file at once.** A module that then throws on import collapses its entire
  test file into one error, so the count reads like poor coverage when it is the opposite:
  `segments.ts` scored 1 of 17 while all six of its conditions were in fact covered (5, 1, 1, 16,
  14, 14 individually). The reverse is worse — one loud mutation masks eight silent ones in the
  same file, which is exactly how `bindings.ts` read as "3 failing tests, fine".
- **`perl -pe 's/if \(([^)]*)\)/if (!($1))/'`.** A regex cannot match parens. Any condition
  containing a call — 27 across this source tree — became a **syntax error** rather than a
  mutant, and a file that will not parse scores as though its tests were weak. Replaced with
  `scripts/invert-ifs.mjs`, which counts depth.
- **`echo "$out" | grep`.** zsh's `echo` expands the `\u` and `\t` that appear in *test names*,
  corrupting the lines grep was matching. Three covered modules read as 0. `printf %s\\n` does not.

**A sweep that prints nothing is indistinguishable from a sweep that cannot see.** The rewritten
loop reported zero uncovered conditions on its first run and it was wrong: the predicate was
`[[ -z "$(grep -oE '[0-9]+ fail')" ]]`, which never fires because `grep` happily matches ` 0 fail`.
Proving the detector could detect required planting a **deliberately inert** condition
(`if (Date.now() > 0) unusedProbe = 1`) — the first control planted, an always-throwing one, was
too loud to prove anything, since a mutant that breaks the suite is exactly the case that already
worked.

Writing the missing tests found a real bug. `inline-fence.ts` skips re-scanning a claimed block
whose rendered text has not changed — but `complete` flips on the *segment*, and **the closing
fence adds no text to the block**, so a card whose last token completes it never left the
streaming path. The streaming path cuts back the still-being-typed tail, so such a card renders
permanently missing its last statement. The skip now also requires `claim.complete`.

Then a **fourth** flaw, introduced by the fix for the third. Teaching the mutator to skip `if (`
inside a string anchored the test at `^` — so it also skipped every **indented** statement, which
is nearly all of them, and the next run reported 118 covered conditions as unconstrained. A
mutator that declines to mutate and a branch that no test constrains produce the same line in the
report. `test/invert-ifs.test.ts` now pins all four cases (indented, nested parens, `else if`,
prose), and the audit distinguishes "the mutator declined this line" from "no test noticed" by
comparing the file before running anything.

Current state: **every condition constrained**, 195 tests, and the audit run leaves the tree
clean. The scores that used to be printed (`mutationSites=12 failingTests=11`) were never
meaningful — a high failure count is one loud condition, not eleven covered ones.

### Screening the dark-mode failures (2026-08-23)

The two cards rendering white-on-white in dark mode were recorded but never screened, so nothing
would have caught a third. `HARDCODED-BACKGROUND` now does, and getting it to the right number
took two corrections that each looked like a finished screen:

- **Anchoring on `background: "#`** found 2 of 3. The third writes its surface behind a
  multi-line ternary — `active ? "#dcfce7" : "#fff"` — which is how a model actually writes a
  selected state, so the screen matches the *value* of any `background`/`backgroundColor` key.
  `test/cards-negative/ternary-background.tsx` is a control in that shape.
- **Dropping the "card uses no design token" clause** after measuring that it changed nothing.
  It changed nothing *against the narrower regex*; against the widened one it takes the report
  from 38 to 3, because 35 corpus cards paint a `#fff` accent on a properly themed surface. **A
  measurement of a clause is only valid against the code it currently guards.**

Backgrounds only, and that is a decision rather than an oversight. Six of 378 cards ignore the
token rule outright, but three of them fail it with light *text* (`color: "#fff"` on a coloured
button), which reads correctly on both themes. Widening to "any extreme luminance" reports all
six and is wrong about half of them — it is the **surface** that has to come from the theme.

### Every screen should trace back to a prompt rule (2026-08-23)

The compile screens report; the prompt is what prevents. Checking one against the other found
**four screened traps with no rule in the prompt at all** — and two of them are live breaks in
the corpus, not style opinions:

- `const [x, setX] = useMemo(…)` — destructuring a value that is not a pair. The card renders,
  the slider never moves. Its author left a comment saying they had switched away from `useState`
  deliberately.
- A `useMemo` at **module scope** — a hook called outside a component, which throws before
  anything renders.
- `<Fragment key={…}>` with only `useState` imported — a `ReferenceError` at render. The card
  compiles and mounts and shows nothing, which is the worst failure shape in this project.

All three are the same confusion about what a hook is, so they are one rule plus an import rule
rather than four. `VIEWPORT-UNITS` already had one under Width.

`JSX-SUBSCRIPT` was exempted here — *it is a compile error the model cannot ship* — and that
reasoning was **wrong**, corrected later the same day. A compile error is not something the model
cannot produce; it is something the reader receives as a blank surface. Three corpus cards fail to
compile for exactly that class of reason, and they shipped. Screens now all have rules, enforced
by a map in `test/prompt.test.ts` whose keys must equal the screen list.

The general form: **a screen with no corresponding rule is a trap you have decided to keep
finding rather than stop causing.** Worth checking whenever a screen is added.

### The three cards that never compiled (2026-08-23)

`compile-cards.ts` reports 13 problems on the corpus; ten are warnings and **three are hard
compile failures**, which matter more and had not been looked at. Each is a distinct syntax
trap, each occurs exactly once in 378, and **none is rescued by `normalizeGeneratedTsx` in either
mode** — verified directly. All three reached a reader as a broken card.

- `<code>^\w+@\w+\.\w{2,}$</code>` — the regex quantifier `{2,}` is a JSX expression. This is the
  same trap as `GLOB-IN-JSX` (`{ts,tsx}`) with a worse ending: the glob *parses* and throws at
  render, the quantifier does not parse at all. Both come from the prompt telling cards to show
  the user their pattern, so this is a trap the prompt actively steers into.
- `fontSize: 11px` inside `style={{…}}` — bare CSS units in a JS object. The card also has a
  `<style>` block where the same text is legal, which is how it happens.
- `const inRange = cur.kind !== "done" && cur.lo >= 0 && (i: number) => i >= cur.lo` — an arrow
  function on the right of `&&`.

No screens added: `compile-cards.ts` already fails these loudly, and a screen for something the
compiler catches is redundant. Prompt rules added instead — **a compile failure is the one
category where prevention is the only useful lever**, since there is no card to salvage.

### `cp` to /tmp is not an undo, and a failing check is not a warning (2026-08-23)

Testing whether a screen's new half was load-bearing means breaking it, running the checker, and
putting it back. The put-back was `cp /tmp/cc.ts scripts/compile-cards.ts` — and `/tmp/cc.ts` was
a snapshot taken **two commits earlier**, so restoring it silently deleted the whole
`HARDCODED-BACKGROUND` screen written that same session. Then `bun run check` exited 1, and I
pushed anyway.

Two rules, both already learned here and both re-broken in one minute:

- **Restore from git, not from a snapshot.** `git checkout <sha> -- <file>` names the state you
  want; a `/tmp` copy names whenever you last remembered to make one. `git stash` or
  `git checkout -- <file>` covers the temporary-mutation case with no stale-copy risk at all.
- **The exit code is the answer.** `check=1` scrolled past under a `git push` on the same line.
  Never chain a push onto a check with `&&` unless the check's status is *read* first.

The recovery also mislanded twice: the grafting script bounded the replaced block by the *next
screen's comment*, and `HARDCODED-BACKGROUND` sits inside those bounds, so each "fix" deleted it
again. `git checkout` of the last good commit, then re-applying only the intended edit, worked
first try. **When a surgical patch has already gone wrong once, stop patching and re-derive.**

### The `@genui/cli` claims, run rather than recalled (2026-08-23)

The skill tells the model to check its canvases with `@genui/cli` and names two mistakes it
catches. Nothing had verified either claim, and a stale URL or a wrong flag there is **bad
advice reaching the model** — the failure mode `mapNotes` already exists to prevent. Ran the
whole negative-card set through it:

- The `pkg.pr.new` URL is live (133 KB tarball) and both documented claims are exact, down to
  the wording the skill quotes: "Import declaration conflicts with local declaration".
- It catches **two more** the skill did not mention — `Cannot find name 'Fragment'` and, for a
  glob in JSX text, `Cannot find name 'ts'`, which is the very error the card would throw at
  render.
- It **misses** `MODULE-SCOPE-HOOK` and `HARDCODED-BACKGROUND`: both report `OK`. Now stated in
  the skill, because a clean run reading as "this card works" is worse than no check at all.
- `-i types/importmap.json` does exactly what `mapNotes` says: without it `$dsh/exec` reports
  `Cannot find module`, with it that message is gone.

The general point: **a prompt that tells the model to run a command is making a claim about the
world, and it decays like any other.** Cheap to re-run, and the run turned up two facts that
make the tool more useful than the text describing it.

### One control per clause, not per screen (2026-08-23)

`test/cards-negative/` had one control per *screen*, which proves the screen fires — not that
every branch of it does. Deleting each clause and re-running the controls found **seven halves
that could vanish with every control still green**, and one of them was already dead:

- `MISSING-REACT-IMPORT`'s JSX arm was `<(Fragment)\b` — only Fragment. `<Suspense fallback={…}>`
  is the way Suspense is actually written, and it matched nothing, so the screen was
  Fragment-only in practice while reading as though it covered five names.
- `SHADOWED-EXPORT` knew only `export default function X`. 377 of 378 corpus cards write that
  form; the 378th writes `const X = …; export default X`, which shadows identically.
- `MODULE-SCOPE-HOOK` anchored on bare `const`, so `export const ROWS = useMemo(…)` walked past.
- `VIEWPORT-UNITS`' `100vh` half, `JSX-SUBSCRIPT`'s `attribute=` arm, `HARDCODED-BACKGROUND`'s
  long-hex list, and three of `DESTRUCTURED-HOOK`'s four hooks — all deletable unnoticed.

Now 20 controls over 9 screens, and **every clause has one that goes blind when it is removed**
— verified by deleting each in turn, not asserted. The corpus report is unchanged at 13, so none
of the widening cost a false positive.

The method generalises past this file: **a control that proves the feature fires does not prove
the feature is whole.** Delete each clause and see which controls notice. The ones that notice
nothing are the clauses you have been trusting for free.

### A positive control for over-reporting (2026-08-23)

`test/cards-negative/` proves a screen still fires. Nothing proved a screen still *stays quiet*,
and that is the failure that costs more: a screen reporting 356 of 378 cards trains you to
ignore it, and then it is worth nothing when it is right.

`DUPLICATE-STYLE-KEY` is the case. Two guards keep it honest, and dropping either is silent
against the negative controls:

- **Depth.** Keys are counted at depth 1 only. Without that, a nested object literal inside a
  value (`repeat(${Object.keys({ padding: 1 }).length}, 1fr)` beside the object's own `padding`)
  reads as a duplicate: **1 → 3** on the corpus.
- **Key position.** A key must follow `{` or `,`. Without that, `transition: "background .2s"`
  counts `background` as a key because it appears in the *value*: **1 → 356**.

So `test/cards/spread-override.ui4a.tsx` is a card built to be **clean**, holding one instance of
every shape that a looser version reports — spread-then-override, a nested literal that repeats
an outer key, and a key name inside a string value. Loosen either guard and it goes from `ok` to
flagged, and `bun run check` fails.

Two things fell out of building it. **A positive control has to be built the same way a negative
one is** — my first two attempts were clean under both the real screen *and* the loosened one,
which proves nothing; only the third actually collided a nested key with an outer one. And the
new screen's very first run flagged **`metro.ui4a.tsx`, this project's own reference card**:
`display: "block"` followed by `display: "flex"` in one object, confirmed by `@genui/cli`. The
dead line is now gone.

### The suite was passing on alphabetical luck (2026-08-23)

`compiler.test.ts` never imported `compiler.ts` — recorded here already, and `compile-pipeline.test.ts`
was written to cover the module for real. What was not noticed is that the misleading name was
also **load-bearing**: renaming the file to `normalize.test.ts` (which is what it actually tests —
`partial-tsx`'s two modes, asserted against the compiler) broke eight tests in
`compile-pipeline.test.ts` with `WebAssembly response has unsupported MIME type 'null'`.

The cause is one file away from anything the message names. `read.test.ts` installs a `fetch`
stub and never restores it; bun shares **one global across every test file**, so the next file to
fetch a real URL gets the stub. `compile-pipeline.test.ts` serves its wasm over a real
`Bun.serve`, so it is that file. It had been broken pairwise all along — `bun test
test/read.test.ts test/compile-pipeline.test.ts` fails 8 on the pre-rename tree too — and the
full suite passed only because `compiler.test.ts` sorted first and warmed the compiler before
`read` could poison it.

Three things to carry:

- **A green suite is not evidence of independence.** Run the files pairwise, or shuffled.

**That claim needed correcting the same day, and the correction is the more useful half.** Five
shuffled runs is not a measurement — it is a coin flip repeated five times. Re-run at scale, the
suite failed **half** the seeds, up to 25 tests at once, and had been doing so the whole time the
record above said it was verified. `--seed=N` makes each order reproducible, which is what turns
this from guesswork into debugging; without it every run is a different bug.

Four independent causes, none of which the symptom pointed at:

- `routes.test.ts` shared one tmpdir across its tests, and the one that writes a file into it
  polluted the listing the exhaustive test asserts.
- `bindings.test.ts` asserted "no host bound" — a state it never established. Its cleanup called
  `releaseBindings()`, which revokes cached blob URLs and **does not touch the host**. Reaching
  `host = null` from outside means registering a throwaway and calling its disposer.
- `openpath-wrap.test.ts` (new, mine) ran the canvas-column effect, whose success depends on
  whichever `document` another file had installed.
- The one that produced the 25-test cascades: `observe.ts` keeps **one module-level listener set
  for the process**, and `claimInlineFences` captures `document.body` as its root at
  registration. A host left alive by a failing assertion goes on being swept by every later
  file — against a root that no longer answers `querySelectorAll`. One real failure, twenty-five
  red tests, none of them in the file that caused it.

Two of those four were fixed by making a test clean up after itself; the cascade needed
`resetTranscriptObservers()` in `observe.ts`, called from both stubbing files' `beforeEach`.
Nothing in the plugin calls it — the shell disposes each host, which is the real path — and it is
exported anyway because the invariant it documents is real.

Now 70 seeds and 8 unseeded runs, all clean. **State the sample size when claiming a flake is
fixed**; "passes now" against a 50% failure rate is a 50% chance of being wrong.

Then the same rules were written down as `test/isolation.test.ts`, which reads the test sources
and fails on a file that stubs a shared global without restoring it, or mounts a transcript sweep
without clearing leftovers first. It immediately found **two more** — `mount.test.ts` leaving a
`document` with no `querySelectorAll`, and `compile-pipeline.test.ts` leaving a `fetch` stub, the
very leak the section above is about. Neither was failing anything yet.

**A discipline that has to be remembered is a discipline that will be forgotten.** The four fixes
above were each a habit applied by hand; the check is what makes the next file follow them.

One more line was quietly saying the wrong thing. `smoke.ts` printed *4 of 6 effects returned a
disposer*, which reads as two effects having nothing to undo. They are in fact the two that could
not **run** there — both reach for a DOM, which smoke deliberately does not provide — and they
are exactly the two that register into the process-wide listener set the flake above was about.
The number was counting non-participation as a clean result. Now:

    4 of 4 runnable effects returned a disposer, all torn down cleanly
    2 not run here, no DOM: canvas column, inline fences — their teardown is covered by test/

**A denominator that silently excludes the hard cases is worse than no number.** Both readings
are "passing"; only one of them tells you what was checked.

`scripts/test-shuffled.sh` now runs N seeded orders and prints the seed to reproduce any that
fail; it used to run **one** unseeded shuffle, which is why it had been passing throughout.

Two things about confirming it, both of which cost time and are the same mistake twice.

Re-running the *recorded* failing seeds after the fix proves nothing on its own: a seed maps to
an order over the **current** file list, and this work added two files, so those seeds no longer
name the orders that used to fail. **An ablation is only valid while the search space is
unchanged** — re-derive the failing seeds after any change to the file set.

Then the ablation itself, done over 12 seeds, came back *clean without the fixes* — which read as
"the fixes were unnecessary" and was simply too small a sample, the very error this section is
about, made again while writing it up. Over 40 seeds against the current file set:

| | failing orders |
| --- | --- |
| without `restoreGlobals` / `resetTranscriptObservers` | **15 of 40** |
| with them | **0 of 40** |

**Whatever sample size just fooled you is not a large enough sample size to check the fix with.**
- **Restore every global you stub**, even when nothing currently breaks. `stream.test.ts` and
  `canvas-sweep.test.ts` had the same leak and happened to sort harmlessly; both now restore.
- **A rename is a real test.** This one changed no behaviour and found a bug — the accidental
  coupling only shows up when the accident is removed.

### The whole corpus, replayed as streams (2026-08-23)

`replay-stream.ts` had only ever run on the six cards in `test/cards`. Run over all 378:

- **Zero late remounts.** `afterDefaultPaints=0` on every card — the "declare every hook before
  the JSX" rule holds across the corpus, and the rule earns its place in the skill on evidence
  rather than on the one card it was written from.
- **Four cards with broken frames.** Three are the compile failures already found
  (`0c24e4dad59d`, `2f7a87253134`, `5745802818e1`), which fail at *every* frame. The fourth,
  `c5f586e3ac6d`, fails **exactly one frame of 60** — the cut lands mid-way through a chained
  ternary, where normalization closes the object literal but not the `? :` chain.

That last one is worth knowing about because it looks alarming and is not. Verified by reading
`partial-react/src/runtime.ts:305`: a failed compile calls `onError` and **returns without
touching the slot**, so the previously rendered component stays on screen. Both settled modes
compile the card fine, and neither mode rescues that frame — but nothing needs to. 64 of 378
cards use a multi-line ternary chain and only this one produced a bad frame, so it is a narrow
`partial-tsx` gap costing one frame of one card, not a defect to design around.

**`brokenFrames=1` and `brokenFrames=60` are different findings**, and the script prints the
count rather than a boolean precisely so they can be told apart.

### The screen rates, derivable rather than transcribed (2026-08-23)

`bun scripts/corpus-rates.ts` prints every screen's hit count over the extracted corpus, with the
cards named. That is deliberately **not** copied into this file: `audit-record.py` exists because
a number transcribed into prose (`什么是二分查找` as both 2/3 and 1/3) outlives the measurement it
came from, and a widened screen silently invalidates every sentence quoting its old rate — which
is exactly what today's widenings would have done to four of them.

A screen at zero is not idle: it has controls in `test/cards-negative/` proving it still fires,
which is the only thing that distinguishes "nothing to find" from "stopped looking".
`JSX-SUBSCRIPT` is the one currently there.

The policy earns itself. A sentence here once read *every screen reports 0–3 of 378*, which was
true when written and false within the day — three screens now report 11, 18 and 73. Prose cannot
be re-derived, so it rots in place while the command beside it stays right. **Only the numbers
that carry an argument belong in the text**; the rest belong in a script, cited by name.

The ones that do carry an argument still have to stay true, so `scripts/audit-rates.py` now
checks every `N of 378` in this file against a live `corpus-rates.ts` run — the same job
`audit-record.py` does for the prompt scores, on the other kind of number the record states as
fact. It runs under `bun run audit`, and **skips** rather than fails when the corpus is not
extracted, because a check that fails for an environmental reason is one people learn to ignore.

Its first version flagged a sentence reading *`SHADOWED-EXPORT` knew only `export default
function X`. 377 of 378 corpus cards write that* — a count of a **syntax form**, not of hits.
Both look identical to a regex. **A checker that reports a false positive every run has the same
value as one that reports nothing**, so it now skips lines phrased as what cards write.

`scripts/screens.ts` now holds the predicates on their own, so a rate can be computed without
running the whole compile sweep as a side effect.

### The checkers, each tested against the failure it claims (2026-08-23)

Every stage of `bun run check` asserts something about what it catches. Those assertions are
prose until someone injects the failure, so:

- **`smoke.ts`** names three: a top-level `import.meta`, a bundle that never calls `load()`, and
  a bare `require()` outside the shell's module table. Injected all three into `lib/client.js` —
  all three exit 1, and the third reports `require("node:fs") is not in the shell's module
  table` by name. Note the near-miss: splicing the `require` at a random offset produced a
  *syntax* error instead, which also exits 1 and proves nothing. **An injected failure has to be
  the failure you meant**, or the test passes for the wrong reason.
- **`replay-stream.ts`** and **`compile-cards.ts`** already end by running their controls.
  `compile-cards.ts` now also fails when a screen has **no** control at all — the state every
  screen was in before `test/cards-negative/` existed, and the state a new one starts in.
- **`test:shuffled`** is new: bun shares one global per run, so file order decides whether a
  leaked `fetch` stub is visible. Verified by removing the restore — caught in 6 of 6 shuffles,
  so it is a gate and not a flake.

### The standalone stubs crashed on the one call the skill insists you make (2026-08-23)

`gen-standalone.ts` writes the `$dsh/*` stubs that `@genui/cli build` links against, so an
exported page keeps working with the harness gone. Its `EMPTY_RESULT` table exists precisely so
`await readFile(...)` does not return `undefined` and kill the page at the first call.

`bash` was not in the table. So `await bash("git log")` returned `undefined`, and the skill's own
rule — **"check `exitCode`, do not catch it"** — made every exported page with a command card
throw on the first line the card reads. `readBytes` was missing too. Both had been added to
`bindings.ts` long after the table was written, and nothing connected the two.

The root cause is the default, not the omission: an unlisted member silently produces a stub
returning `undefined`, which is *correct* for `sendMessage` and a crash for everything else, and
nothing can tell those apart from the binding alone. The generator now **fails** on an unlisted
member and asks for it to be classified — verified by adding a member to `bindings.ts` and
watching it exit 1.

Found by awaiting each stub and printing the shape, which took one script. The lesson is the
prompt-verification one again from a third direction: **the stubs are a claim about how the
exported page behaves, and a claim nothing exercises decays.** `readFile` and `readdir` were
fine — the two that were tested when the table was written.

### Two more checks that were checking a copy (2026-08-23)

`compiler.test.ts` testing a re-implementation of its own module turned out not to be a one-off
— the same shape was in two more places, and one of them **said so in its own doc comment**:

- **`types/check.ts`** compared `bind()` against a hand transcription of the `.d.ts` files, and
  the comment admitted "editing a `.d.ts` alone changes nothing — replacing `bash(command:
  string)` with `bash(command: number)` leaves `tsc` silent." That was accepted because
  TypeScript supposedly cannot import an ambient `declare module` as a value type. It can:
  `types/` is on the tsconfig `include`, so `import type * as Exec from "$dsh/exec"` resolves
  right there. The transcription is gone, and both drifts now fail `tsc`.
- **The `-i` map is weaker than it reads.** `genui check bad.tsx -i types/importmap.json`
  reports `OK` for `await bash({cmd: "ls"} as never)` and for reading a field that does not
  exist on the result — and reports `OK` just the same when the map points at **a file that
  does not exist**. So `-i` silences `Cannot find module` and leaves `$dsh/*` as `any`; the
  CLI's own help says as much ("Unlisted bare specifiers stay untyped"). The skill now says it
  too, because a card author reading "resolve facade imports against this map" will reasonably
  assume the calls are typed.

**A comment admitting a check is weak is a bug report with no assignee.** This one sat for as
long as the file existed, and the fix was three lines.

### Two hand-maintained copies of the shell's module table (2026-08-23)

`build.ts` externalized a list of platform modules; `smoke.ts` answered `require()` for a
separately written copy of the same list. They were identical, by luck rather than by anything
enforcing it, and drift is silent in both directions: a module externalized but not answered is
a blank app, and one answered but not externalized is **a second React instance** — the
singleton failure this repo already has a section about.

Now one `scripts/platform.ts`, imported by both. Verified by deleting an entry: `build` bundles
it and `smoke` rejects it in the same run, so the two can no longer disagree.

That is the fourth instance today of the same shape — `compiler.test.ts` testing a
re-implementation, `types/check.ts` transcribing its own `.d.ts`, `EMPTY_RESULT` listing members
`bindings.ts` had outgrown, and now this. **Whenever a fact is written down twice, one copy is
already wrong or about to be**; the sweep for it is `grep -rn 'transcrib\|by hand\|hand-written\|
re-implement'`, and every hit either explains why the duplication is deliberate or is a bug.

### When deriving is wrong: gate the hand list instead (2026-08-23)

Having removed four duplicated lists in a row, the next one looked identical: `gen-standalone.ts`
keeps an `ASYNC` set naming which stubs need `async`, which is obviously derivable from the
bindings. It is not. The real members are **arrow functions returning promises**, so
`constructor.name === "AsyncFunction"` matches exactly one of the five, and the derived version
silently emitted four synchronous stubs. An `await` on a non-promise shrugs; a `for await` does
not, and neither does anything reading `.exitCode` off a value that arrived a tick early.

Caught only because the generated files were diffed after the change. **A derivation that
compiles and produces a plausible-looking output is the dangerous kind** — the four missing
`async` keywords are invisible unless you count them.

So the list stays hand-written, and the honesty comes from a gate instead: a member that is in
neither `ASYNC` nor `VOID_MEMBERS` fails the generator by name. Same for `EMPTY_RESULT`. Both
verified by adding a member to `bindings.ts` and watching it exit 1.

The rule is narrower than "never write a fact twice": **derive it when the source really
determines it, and gate it when it does not.** A gate costs three lines and fails loudly; a
wrong derivation fails silently and looks like good engineering.

### `replaceAll` on a specifier rewrote the card's own text (2026-08-23)

`inlineSubPages` swapped each child's specifier for its blob URL with
`out.replaceAll('"./board"', url)`. That is every occurrence, not every *import* — so a card
that also writes `const label = "./board"` renders `blob:null/8f3a…` where a filename belonged,
or passes one to a component expecting a path.

The module already had `SPECIFIER`, the regex it uses to *find* the imports, which knows exactly
which positions are import positions. The rewrite threw that away and matched raw text instead.
Rewriting through the same regex is three lines shorter than what it replaced.

Zero corpus cards write a relative path as a string literal, so this was never observed — the
kind of bug that stays until someone reads the function asking what else the pattern matches.
**Whenever a parser's output is applied with string replacement, the replacement has forgotten
what the parser knew.**

### A duplicated regex, and the trap in sharing it (2026-08-23)

`CanvasPanel` kept `RELATIVE_IMPORT` — character-for-character `subpages.ts`'s `SPECIFIER` minus
the `g` flag — to answer "does this card import a sibling?" before paying for a resolve pass.
Two copies of the same pattern, and the drift is silent in the expensive direction: widen
`SPECIFIER` alone and the panel stops calling `inlineSubPages`, so the card renders **without its
sub-pages** and nothing errors.

Sharing the constant directly would have been worse. `SPECIFIER` is global, so `.test` advances
`lastIndex` and **the second call on the same string returns false** — the card would resolve on
one render and drop its sub-pages on the next, which is harder to notice than the bug being
fixed. Measured before writing the fix, not after.

So the export is `importsSibling(code)`, a predicate that owns the reset, with a test asserting
two calls agree. The whole tree has exactly one module-level global regex, and it is now behind
that function.

**Deduplicating a regex is not the same as exporting it.** A `g` flag makes it a stateful object,
and every caller sharing it shares the state.

### `@genui/cli` over all 378 corpus cards (2026-08-23)

Roughly three hours of `npx` invocations, and the honest summary is that **136 of 378 cards
report something and almost none of it matters**:

| | count | what it is |
| --- | --- | --- |
| clean | 242 | |
| `implicitly has an 'any' type` | 97 | untyped lambda parameters; the card runs |
| `Cannot find module '$ui4a/chat'` | 22 | the pre-rename prefix, a known build-lag artefact |
| everything else | 18 | see below |

Of the last 18, most were already screened here (`SHADOWED-EXPORT`, `GLOB-IN-JSX`,
`DUPLICATE-STYLE-KEY`, `MISSING-REACT-IMPORT`, the three compile failures). Type errors that are
correct TypeScript complaints and correct JavaScript — `[[1,0,1]]` annotated `boolean[][]`, a
call passing 3 of 4 parameters where the 4th is optional in practice — were confirmed to compile
and stream cleanly by replaying them.

**One genuine new bug**, and one worth the whole sweep on its own:

    <div style={labelStyle, { marginTop: 14 }}>

That is a comma operator. `labelStyle` is evaluated, discarded, and only the object after the
comma is applied, so the element silently loses every style the named object carried. The CLI
reports it as "Left side of comma operator is unused and has no side effects" — a message about
the mechanism, saying nothing about the fix. Now `COMMA-IN-STYLE` (1 of 378), with a control, a
prompt rule, and a clean-card guard.

Two things about the screen are worth keeping. It strips comments first: the near-miss card
*documents* the bad form in prose, and the first version reported the documentation. And its
`(?!\{)` matters — without it, `style={{ ...labelStyle, marginTop: 4 }}`, the correct spelling,
matches too.

**Verdict on the tool: worth running once over a corpus, not worth running per card.** The
signal-to-noise is one real find in 378, and `implicitly any` will bury it unless you filter.

### What actually catches a stray backtick (2026-08-23)

`prompt.ts` and `skill.ts` are each one long template literal, and an unescaped backtick inside
one has bitten three times today. The layers, measured rather than assumed:

- **Most cases break the parse**, and `oxlint` — the first stage of `check` — reports them with
  the right line. Two of the three were caught this way, in seconds.
- **A backtick that closes and reopens the literal cleanly changes nothing**, because the two
  halves concatenate to the same string. Harmless.
- **A backtick that closes the literal and re-opens it later silently drops everything
  between.** `lint` passes. `typecheck` passes. Only `test/prompt.test.ts` fails — it asserts
  each section heading and each rule is present, so a truncation loses one of them.

That third case is the reason the prompt test is worth its length: it is the only thing standing
between "the model silently stopped being told about dark mode" and a release. Verified by
injecting all three.

### The React components had no tests, and three testable things in them (2026-08-23)

462 lines across `CanvasPanel`, `CanvasLauncher` and `GenUISurface` had nothing exercising them,
on the reasoning that they need a DOM. Most of that is true, and three pieces were not — each
pure, each deciding something the reader sees, each extracted and mutation-checked:

- **`widthForPointer`** — the resize arithmetic. The panel is anchored right, so its width is
  `viewportWidth - clientX`; a flipped subtraction gives a panel that grows as you drag it shut,
  and a swapped clamp gives one that snaps to an unusable size. Both mutations now fail.
- **`activeCanvas`** — what the panel shows. The interesting case is a *selected* canvas
  disappearing when the session's calls are re-read: it falls back to the newest rather than
  blanking, and no test had ever asserted that.
- **`otherCanvases`** — what the "other canvases" menu offers, which must exclude what is
  already a tab.

Then two contracts between files that no compiler sees:

- `panel.css`'s `--dgu-panel-width: 420px` and `useResize(420)` were the same number written
  twice; diverging makes the panel visibly jump on its first frame, since the CSS default paints
  before React's inline style lands.
- **Every `dgu-` class the components render is styled, and every one styled is rendered.** A
  renamed class is an unstyled panel that still mounts — no error, a column of raw markup over
  the conversation. Verified in both directions by typo'ing a class and by adding an orphan rule.

**"It needs a DOM" is usually true of the rendering and false of the deciding.** The arithmetic,
the selection, and the filtering all came out without a browser.

### The `.dsh/` canvas path took as cleanly as the `$ui4a/` rename (2026-08-23)

Reading the 1012 sessions for the *keys* tool calls actually use — rather than the cards they
produced — turned up 88 `write` calls naming a canvas path, and **59 of them to a bare
`ui4a/canvases/`, which the contract does not recognise.** That looks like two thirds of every
canvas write being dropped.

Split at `7df29f9` (2026-08-21 19:39, "keep canvases under the workspace's `.dsh` directory"):

| | `.dsh/ui4a/canvases` | bare `ui4a/canvases` |
| --- | --- | --- |
| before | 1 | 58 |
| after | 28 | 1 |

Same shape as the `$ui4a/` → `$dsh/` result, found the same way, and the same lesson: **a corpus
spanning a contract change measures the change, not a defect.** Always split on the commit
before concluding anything from a rate.

The argument keys themselves confirm `collect.ts`'s design. Across every canvas-path tool call:
`file_path` 208, `path` 2 — both in `PATH_KEYS` — and the rest are `command` (81) and `code`
(75), which are `bash` and `run_code`. The parser collects neither, and only one of those is
right: `bash` genuinely only *mentions* the path (it is running `genui check` on it), but
**`run_code`'s 75 calls carry a real canvas write inside the `code` string.** Split the same
way, they are 66 pre-contract to 0 and 9 post-contract to 9 — so the `.dsh/` change took on both
write paths.

Those nested writes are exactly what `toolCallsOf` walks sub-calls for, and the reason they look
uncollected here is that **the persisted session log has no sub-call field at all** — the nesting
exists only in the live transcript the runtime reads. Worth knowing before concluding from a
disk-read corpus that a nested write is unhandled; the same file cannot answer that question.

Matching on argument shape rather than tool name is what makes `bash` fall out for free.

### `smoke.ts` registered the effects and never tore them down (2026-08-23)

The smoke test loads the built bundle, runs `apply()`, and asserts which effects registered.
Every one of those effects returns a **disposer**, and none of them had ever been called — so a
cleanup that throws shipped silently.

That matters more than it sounds. The shell runs these on every HMR round and on unload, and a
throw aborts the rest of the teardown: the *next* effect's cleanup never runs, so the blob-URL
and wasm leaks this file exists to catch happen anyway, one round at a time. The disposer that
pairs `disposeCompiler()` with `dropSharedCompiler()` — 16 MB per HMR round — is one of them.

Now they run, in reverse order, with the same DOM-absence tolerance the registration path has,
and the report says **"4 of 6 effects returned a disposer, all torn down cleanly"**. Verified by
planting an effect whose cleanup throws: `disposing probe failed: boom in teardown`, named.

**A lifecycle test that only runs setup is half a test**, and it is the half that fails in
development rather than in production.

### Teardown, swept (2026-08-23)

Having found `smoke.ts` never running a disposer, the same question went to the test files:
which of them *call* a teardown and assert nothing about it. Two did.

- **`inline-fence.test.ts`** called `stop()` nine times and asserted on zero. What disposal must
  do is give every claimed block back — the blocks belong to the host's React tree, so a claim
  left behind is a source block permanently `display: none` with an unmounted card over it. The
  reader loses the code and gets nothing in its place, and only a reload fixes it. Two mutations
  now fail: dropping the release loop, and releasing with `restore: false`.
- **`canvas-sweep.test.ts`** called `host.dispose()` in its shared helper for hygiene. The host
  owns a React root, a column appended to `document.body`, a stylesheet and a listener; dropping
  either half of `disposers.push(() => root.unmount(), column.remove)` now fails. The symptom it
  guards is a **second panel beside the first** after an HMR round, which produces no error.

`stream.test.ts` also calls `release()` without asserting, and that one is correct — it is
between-test hygiene, and `bindings.test.ts` owns the assertion about what releasing a host does.
**The distinction worth making is whether the teardown is the subject or the cleanup.**

### A comment that described a check the code did not do (2026-08-23)

`standaloneImportMap` was:

    try { return fileURLToPath(new URL("../types/standalone/importmap.json", importMetaUrl)); }
    catch {
      // Installed in a shape where the package root is not two levels up. The skill drops the
      // `-i` flag rather than passing a path that does not exist.
      return undefined;
    }

The comment states the intent exactly, and the code does not implement it. **`fileURLToPath`
only rejects a malformed URL** — for `../types/nope.json` it cheerfully returns
`/private/tmp/types/nope.json`. So in the very install shape the comment names, the skill was
handed a path to nothing and told the model to pass it to `genui check -i`. The model then gets
`Cannot find module "$dsh/fs"` on correct code and "fixes" imports that were right — the exact
failure `mapNotes` was written to prevent, arriving through the function that feeds it.

One shared `resolvedMap` with an `existsSync`, and a test that a missing map is `undefined`
rather than a path — which is what makes `mapNotes` drop the advice.

**A comment describing a guarantee is a place to check the guarantee exists.** This one was
written by someone who knew exactly what should happen, which is what made it convincing.

### The prompt's own example, copied into a reply (2026-08-23)

Re-measuring the fence parser against all 1012 sessions (389 openers, 384 segments) turned up
four messages where an opener produced no segment. Three are correct — prose *mentioning*
`ui4a/tsx` in inline backticks. The fourth is a bug, and its origin is this project:

    `````ui4a/tsx
    ````ui4a/tsx
    export default () => <div>hi</div>
    ````
    `````

The prompt shows the block wrapped in five backticks so the four-backtick fence survives the
example, and once in 389 openers the model copied the wrapper into its reply. The parser took
the outer fence, so **the card's body was the inner fence as text** — which compiles cleanly in
both modes, so nothing errors anywhere and the reader gets a blank card.

Fixed by treating an opener whose body immediately opens another `ui4a/tsx` fence as a wrapper
and descending into it. The corpus count is unchanged at 384; that one card now yields its real
contents instead of garbage. A second test pins the near miss — a card whose *body* merely
contains a backtick run (printing a markdown example) must not be descended into.

**The failure came from documentation being followed too literally.** Worth remembering when
writing an example: whatever scaffolding it needs to be shown, someone will copy.

### Which skill rules actually land, measured (2026-08-23)

Every rule in the skill is a claim that the model will follow it. Counting how often each one
appears in 378 real cards turns that into a number, and the numbers are not close together:

| rule | cards it applies to | cards that follow it |
| --- | --- | --- |
| take colours from the design tokens | all | 101 use `bg-base` alone |
| parse the stream with `partial-json` | 24 streaming | **22** |
| check `exitCode`, do not catch | 19 running commands | **18** |
| clean up a loop in the effect's cleanup | 32 with a loop | **31** |
| remove the listeners you add | 3 | **3** |
| size against the container, not the viewport | 94 with a query | **87** use `@container` |
| honour `prefers-reduced-motion` | 131 animating | **7** |
| abort the previous `streamText` | 24 streaming | **1** |
| abort the previous `bash` when polling | 11 polling | **0** |

The bottom three are the interesting ones, and they share a shape. **Every rule that lands is
one the skill shows as code or names as a field you can see** (`exitCode`, `partial-json`,
`cancelAnimationFrame`, `@container`). **Every rule that does not land is a paragraph
describing a shape** — "pass an AbortController's signal and abort the previous one" sits three
lines above "check `exitCode`", in the same section, and they land 0/11 and 18/19.

It is not about importance or wording: the abort paragraphs are emphatic and specific. It is
that a paragraph has to be *converted* into code by the reader, and the conversion is where it
gets dropped. All three now carry a code block; `prefers-reduced-motion` got its own bullet with
the one-line `@media` rule that covers everything, instead of being the last clause of a bullet
about animation continuity.

**The method generalises: for any prompt rule, count the cards it applies to and the cards that
follow it.** A rule at 0/11 is not a rule, and until you count you cannot tell it apart from one
at 18/19 sitting next to it.

### The most-broken rule in the prompt (2026-08-23)

Continuing the rule-adherence count into the colour section found the worst offender by a wide
margin. **50 of 378 cards fill a background with `--dsw-alias-brand-primary`, and 12 of those
put a light foreground on top.** The prompt says not to, in bold, with the reason.

It is worth being precise about why those 12 are broken and the other 38 are not. `brand-primary`
*equals the body text colour in both themes* — near-black on light, near-white on dark. A tile
filled with it under white text is legible on light and a **white square with invisible writing
on dark**. Fill it and put a dark foreground on top and you get the inverse, which is odd but
readable. So the screen looks only at what follows a fill within a hundred characters: over the
whole file it reports 17 instead of 11, catching cards where the two are unrelated.

`BRAND-PRIMARY-FILL` is now the highest-rate screen here — 11 of 378, against 0–3 for every
other. The name is the whole trap: a variable called *brand* reads as "the brand colour, fill
with it", and no amount of restating the rule fixes a name that means the opposite of what it
does. The prompt now ends with the two lines rather than the explanation, so there is nothing
for the reader to convert:

    background: "var(--dsw-alias-state-business-primary)", color: "#fff"   // a filled button
    color: "var(--dsw-alias-brand-primary)"                                // emphasis, no fill

### A phrase that appears twice cannot detect one of them going (2026-08-23)

The prompt test pins each measured rule by a distinctive phrase from its code block. The first
version pinned the `streamText` abort on `running.current?.abort()` — which appears **twice** in
that block, once in the regenerate path and once in the unmount effect. Deleting either leaves
the other, so the assertion passed on a block that had lost half its point.

Found the same way as everything else today: mutate the thing, check the guard notices. It did
not, so the phrase moved to `const ctrl = (running.current = new AbortController())`, which
appears once. All four rule assertions were then re-checked by weakening each block in turn —
all four now fail.

**An assertion on a substring is an assertion about how many times it occurs**, and `toContain`
never tells you. Count the occurrences when you choose the phrase.

### The rest of the rule audit (2026-08-23)

Continuing the count through every measurable rule. What lands, and what the numbers say:

- **Read on demand, not all at once**: 14 of 20 workspace-reading cards fetch on hover or click
  rather than pre-loading. Another rule the skill shows concretely; another one that lands.
- **Don't decorate**: 351 of 378 cards are interactive, and exactly **1** uses a decorative AI
  icon. The rule naming the specific banned icons (`Sparkles`, `Wand2`, …) works.
- **`position: fixed`, `100vw`, portals into `document.body`**: 0, 0, 0. The "you are a component
  on someone else's page" rule is followed absolutely.
- **Inline vs canvas**: 384 inline fences to 88 canvas writes, a 4:1 split — consistent with
  "inline is the cheaper mistake when it is genuinely borderline".
- **`localStorage` for canvas state**: 1 of 378. Almost every card is inline, where it does not
  apply, so this is not evidence either way.

Two gaps the skill had never mentioned at all, both found by counting rather than reading:

- **17 cards put `onClick` on a `<div>`** — no focus, no Enter, no Space. Not reachable by
  keyboard at all.
- **31 icon-only buttons carry no `aria-label`** — a screen reader announces "button".

Both are one word to fix and invisible to the author, since a mouse works either way. Now a rule
with the line in it, following the finding above that a rule shown as code lands and a rule
described in prose does not.

### Two accessibility screens, and a false-positive rate that had to be halved (2026-08-23)

`UNREACHABLE-CONTROL` covers the two gaps the rule audit found: `onClick` on a `<div>` (17 of
378) and an icon-only `<button>` with no `aria-label` (31 occurrences). Both work with a mouse,
which is exactly why neither author noticed.

The first version reported **41 of 378** — 11%, which would have made it the loudest screen here
and the first one worth ignoring. The cause was the button arm matching `{expr}` as a body, and
most of those are `{playing ? "暂停" : "播放"}`: a text expression that announces perfectly well.
Restricting the arm to an icon *element* took it to 18, and spot-checking three of those found
grid cells and calendar days that genuinely take no focus.

The `<div onClick>` arm was **unconditional**, and auditing it found no false positive in the
corpus — all 19 such divs have no `tabIndex`, `role`, `onKeyDown` or any other affordance, so
every hit was real. That is exactly the reading that lets a bad screen survive: a screen nothing
can satisfy flags the *fix* as loudly as the bug, and a corpus where nobody writes the fix cannot
tell you. It now requires the affordance to be absent, the rate is unchanged at 18 of 378, and
`test/cards/near-misses.ui4a.tsx` carries a `role="button" tabIndex={0} onKeyDown` div that must
stay unflagged — verified by restoring the unconditional form, which flags it.

**A screen with a 0% false-positive rate on the corpus is not thereby correct.** It may only mean
the corpus never contains the thing that would prove it wrong, which is likeliest precisely when
the screen is checking for a good practice nobody follows.

Two things about the near-miss card are worth keeping. Its guard for that arm needed the button
to have **no attribute containing braces** — `onClick={() => setRows([])}` makes `[^>]*>` and
`\{[^{}]*\}` unable to match together, so the card looked clean under the widened screen for the
wrong reason. And a `<div>` whose *child* has the `onClick` is not a clickable div, which is why
the div arm anchors on `<div\b[^>]*\bonClick=`.

**A screen's first number is a hypothesis.** 41 of 378 was not "this corpus has a big
accessibility problem", it was "this regex matches something else too" — and the way to tell is
to open three of the hits.

### The screens, complete in both directions (2026-08-23)

The screen system now enforces its own completeness, so neither half can rot silently:

- **A screen with no control** fails `bun run check` — the state every screen was in before
  `test/cards-negative/` existed, and the state a new one starts in.
- **A control card no screen claims** fails too. It looks like coverage in a directory listing
  and asserts nothing. (`late-hook.tsx` is the one legitimate exception: `replay-stream.ts` owns
  it.)
- **13 screens, 24 controls** — every clause of every screen has one that goes blind when the
  clause is removed, verified by deleting each in turn.
- **Two positive guard cards**, clean under all 13 screens, each holding the shapes a looser
  version reports. Verified the same way: loosen a screen, the guard card must flag.

Adding the prompt code blocks broke the mutation audit in a new way, worth knowing: the examples
in `skill.ts` contain real `if` statements, indented exactly like real code, so the audit
reported three "unconstrained conditions" that are documentation being taught. The mutator now
tracks fenced blocks inside template literals and declines them — **indentation cannot separate
an example from a statement, but the fence can.**

### Checking the reference cards against the rules they exist to demonstrate (2026-08-23)

`test/cards/` holds three cards this project wrote as examples. Running the rule audit over them
rather than over the corpus: `2048` and `piano` follow every measured rule, and **`metro` — a
metronome — did not honour `prefers-reduced-motion`**, which is the single clearest case the
preference exists for.

Fixing it exposed a flaw in the rule I had just written. The skill said "one rule at the end of
the `<style>` block you already have", and `metro` has no `<style>` block: its pulse is a
90ms inline `transition` driven by React state. Counting the corpus, **59 of the 131 animating
cards style entirely inline**, so the advice was unusable for 45% of the cards it addressed.

The rule now carries both forms — the `@media` line for a `<style>` block, and

    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    style={{ transition: still ? "none" : "transform 90ms ease" }}

for inline. `metro` uses the second, so the reference card demonstrates the rule rather than
contradicting it.

**Run your own examples through your own rules.** The example is the thing the model imitates
most directly, and a rule its author could not apply to their own card is a rule with a hole in
it. The occurrence-counting prompt test caught the edit too: adding the second form made
`prefers-reduced-motion: reduce` appear twice, and the assertion failed until it was split into
two — which is the check working, not a nuisance.

### The most-broken rule turned out to be one the skill never had (2026-08-23)

Sweeping for idioms that are *inert in this rendering context* found the largest single defect in
the corpus, and it is not a rule that was being ignored — it is a rule that was never written:

**77 of 378 cards set `outline: "none"`, and 0 of them put anything back.** Tabbing through such
a card moves a cursor nobody can see. The pattern is always the same shape: a borderless input
(`border: "none", background: "transparent", outline: "none"`), where the browser's default ring
does look wrong — so it goes, and nothing replaces it.

`NO-FOCUS-RING` now screens for it at **73 of 378**, five times louder than any other screen
here, and spot-checking the hits found real inputs every time. The skill carries the fix in both
forms (a `:focus-visible` rule for a `<style>` block, a focus-driven `boxShadow` for inline),
with the note that `:focus-visible` is what makes the ring keyboard-only — which is the reason
it was annoying to begin with.

And, as with `DUPLICATE-STYLE-KEY`, **the new screen's first run flagged a reference card**:
`metro`'s BPM field, the card's primary control, borderless with the ring stripped. Fixed with
the inline form, since that card has no `<style>` block.

A smaller finding from the same sweep: **15 of the 19 small-caps kickers apply
`textTransform: "uppercase"` to Chinese text**, where it does nothing at all. The idiom was
copied without the mechanism that makes it an idiom.

### Accessibility was the prompt's blind spot, and the numbers say so (2026-08-23)

Three of the fourteen screens here are accessibility screens, and they are the three loudest by
an order of magnitude:

| screen | rate | every other screen |
| --- | --- | --- |
| `NO-FOCUS-RING` | 73 of 378 | |
| `UNREACHABLE-CONTROL` | 18 of 378 | 0–3 of 378 |
| `BRAND-PRIMARY-FILL` | 11 of 378 | |

Those numbers come from `scripts/corpus-rates.ts`, and for a while `scripts/compile-cards.ts`
disagreed with them by one or two on some screens. The cause is worth keeping: it computed the
screen flags **inside** the `try` that compiles the card, so a card that failed to parse
reported its compile error and nothing else. Two defects were hiding behind that — a
`BRAND-PRIMARY-FILL` and a `NO-FOCUS-RING` on the three cards that do not compile.

A screen is a pure text predicate; whether it fires cannot depend on the card being parseable,
and **a card broken enough to fail compiling is exactly where a second defect hides**. Screening
now happens before the `try`. `test/screen-on-fail.test.ts` pins both halves — the predicate
works on unparseable source, *and* the caller still screens before it compiles, because the bug
was in the caller and only the second assertion would have caught it.

**Two scripts that count the same thing are a free cross-check, but only if you actually run
both and reconcile the difference.** The disagreement was small enough to read as rounding.

Before today the two prompts contained **zero** mentions of `aria`, `focus-visible`, `keyboard`,
or `screen reader` — the only accessibility line in either was the trailing clause of a bullet
about animation continuity. Every rule now covering these came out of counting, not reading, and
each is stated as code because the rule-adherence measurement showed prose does not land.

What is *not* worth a screen, checked and rejected: 27 cards use `fontSize <= 10` and 20 use an
opacity at or below 0.4, but the hits are index labels on visualisation elements where tiny type
is conventional — a screen there would report a fifth of the corpus for a judgement call. The
line between these and the focus ring is that **`outline: "none"` with no replacement is wrong
in every context, and 9px is only wrong in some.**

A screen firing on a fifth of the corpus is normally a sign the screen is wrong, so this one was
audited element by element before being believed. Of the hits, **57 sit inline on an
`<input>`**, one on a `<textarea>`, and the remaining 18 in a hoisted
`const input: React.CSSProperties` that is then applied as `style={input}` to a real `<input>` —
which is why a first pass, looking only at the nearest enclosing tag, could not classify them.
Zero sit on something a keyboard cannot focus. The rate is real: the corpus strips the focus ring
off a fifth of its controls and puts nothing back.

**When a check fires far more than its neighbours, the cheap read is that it is broken.** Here
the audit had to reach through a level of indirection to show it was not, and the indirection is
the same reason the models keep doing it — the `outline: "none"` is nowhere near the `<input>`.

That audit asked whether the hits were real. Asking the opposite question — whether the screen
would stay quiet on a card doing it *right* — found the other kind of error, and the corpus had
three: `9d5a008515d2` and `e38228c4050f` replace the ring with `:focus { border-color }`, and
`beaa3fbf962b` with a `focused` boolean driving the border. All correct, all reported, because
the predicate recognised only `:focus-visible` and a focus-paired `boxShadow`. **The ring does
not have to be an outline.** Widened to accept anything painting a border or shadow from a focus
state; 76 became 73, and all three cleared cards were checked individually rather than trusted
because the count moved in the direction I wanted.

The guard for it needed **its own file**. Adding the case to `near-misses.ui4a.tsx` looked like
it worked and proved nothing: that card already carries a `:focus-visible` block for a different
rule, so it stays quiet under the narrow predicate too. Reverting the screen is what exposed it —
the card did not light up. `test/cards/focus-border.ui4a.tsx` exists so the focus-driven border
is the *only* reason the screen is quiet, and reverting the widening does flag it.

**A guard card only has teeth if the property it guards is the sole reason the screen stays
quiet.** Verify one by breaking the code it guards and watching it fail — a guard that passes
before and after the change is decoration.

Having found one screen answering that question wrongly, the obvious move was to ask it of all
fourteen. `test/screens-quiet-on-fix.test.ts` pairs each screen with a card doing the same thing
right, and a test asserts the pair list and the screen list are **equal** — so a new screen
cannot be added without answering it. All fourteen pass.

Worth noting how the first pass of that audit read: five screens came back "blind on the bug",
which looked like a real finding and was not. Every one was my probe being wrong about what the
screen targets — `DESTRUCTURED-HOOK` is about destructuring a hook that is *not* `useState`, not
about `const { useState } = React`; `SHADOWED-EXPORT` is about colliding with an **import**, not
a local redeclaration. Reading the predicate and its negative control fixed the probes, not the
screens. **A sweeping audit that reports failures everywhere is usually measuring itself.**

The same pairing question applies in the other direction — **every screen should have a rule
telling the model not to do it**, or we are detecting a defect we never asked anyone to stop
making. `test/prompt.test.ts` now pins a screen → rule-phrase map and asserts its keys equal the
screen list, so adding a screen forces answering it.

Three screens had **no rule at all**: `DESTRUCTURED-HOOK`, `DUPLICATE-STYLE-KEY` and
`JSX-SUBSCRIPT`. All three were found by the checker, given negative controls, measured against
the corpus, written up here — and never turned into a sentence the model reads. Now written. As code, not prose — the adherence measurement already established
that a rule stated as a sentence lands at 0-7% while the same rule as two lines lands, so writing
the three as paragraphs would have closed the bookkeeping gap without changing any card. Each
ends with the pair:

    style={{ padding: 4, gap: 6, padding: "8px 12px" }}   // padding: 4 is gone, silently
    const [start, setStart] = useRef(0)                   // both undefined; dies on first use
    <Icons[kind] />                                       // not valid JSX

Pinning those in `test/prompt.test.ts` immediately failed on the `useRef` line, because it
appears in both the prose and the block and the assertions count **occurrences**. That is the
same guard that caught `running.current?.abort()` earlier: a phrase appearing twice cannot detect
one of them going. Pinned on the comment instead, which appears once.

That gap survived a first audit that said all fourteen were covered, because that audit matched
each screen against a **loose regex** (`/useRef|destructur/`) and `useRef` appears in an unrelated
abort-controller example. Re-running it with the exact rule phrase, the way the existing
assertions are pinned, disagreed immediately. **A presence check is only as strong as the
specificity of what it looks for**; a keyword that could plausibly appear for another reason
finds coverage that is not there.

Checking the third direction — rules with no screen — found nothing worth adding, and the way it
failed is the point. Most unscreened rules are judgements about *when* a card is the right answer
("'看看都有啥' is a request to browse"), which no text predicate can check. The two that looked
mechanical both produced numbers that evaporated on inspection: `&&` chained into an arrow scored
28 cards and is actually **1** (the counting was per-card over a pattern that matches the legal
form too — `rg -o` shows a single hit, the known FAIL), and `?? []` near an unguarded index
scored 11 because the predicate was an `||` of two loosely-related patterns and the second arm
matched alone.

**A number produced by a regex written in the same minute as the question is a hypothesis, not a
measurement.** Three times this stretch — 41 for `UNREACHABLE-CONTROL`, 28 here, 11 here — the
first count was several times the true one, and each time the tell was the same: the number was
interestingly large. Print the matches, not the count.

### The audit could not see a third of the source (2026-08-23)

`scripts/mutation-audit.sh` reported *every condition is constrained by a test* for weeks. Its
file list was `src/client/runtime/*.ts src/client/canvas/*.ts src/*.ts` — two directories at one
depth, `.ts` only. Five files matched none of those patterns, including `GenUISurface.tsx`, which
holds the two error decisions the suite was written to constrain, and `session.ts`, which runs on
every frame of every streamed reply. Switched to `fd -e ts -e tsx . src`: **28 unconstrained
conditions** appeared in code that had been reported clean.

Its summary line hid it a second way. A file where every condition came back UNCOVERED printed
`no branches (0 \`if (\` in prose, declined)` — the wording for a file with nothing to check, on
the file with nothing checked. Now `N conditions, NONE constrained by a test`.

Closing them found two things worth having beyond the tests:

- `deliveryFor` — the frame-delivery state machine, lifted out of an effect behind three refs.
  `pushCode` appends while a session event carries the whole prefix, so its four answers are the
  difference between a correct surface and a buffer that doubles every frame. Eight tests.
- `revokeAll` — a **real leak**, not just missing coverage. The disposer iterated the blob-url
  array while `inlineSubPages` was still appending to it, so a url added after the disposer ran
  was never revoked: one blob leaked per edit. Draining the array instead makes both callers
  idempotent whichever order they run in.

20 remained after that pass, and a later one took it to **14** without adding a DOM library —
`react-dom/server` was already in the tree for `paint-cards.ts`, and it reaches more than expected:

- `useSubPages` — render-path guards, driven by rendering the hook in a probe component. The
  property worth having: while the sub-page resolve is in flight the **original source** renders,
  because returning `""` would blank a working canvas on every sweep.
- `useResize` — drag-to-resize coalescing. `renderToString` gives you the hook's return value, and
  the listeners it registered are then driven by hand, which is what a drag is. Twenty
  `pointermove`s schedule **one** frame; releasing cancels a pending one.
- `compiler()` / `dropSharedCompiler` — a memoized singleton and its pair.
- `deliver` — the last pure block inside the effect, lifted out. `render` replaces the buffer and
  `pushCode` appends; swapping them doubles the card on every streamed frame, and it was a
  one-word difference nothing could reach.

The 14 that are left sit inside `useEffect` bodies, which `renderToString` does not run. That is
a real boundary rather than a missing test: reaching them needs a DOM, and a DOM library for four
components is still the worse trade.

**A hook is more testable than it looks.** Three of the four above were reported as needing a
browser and needed a nine-line probe component.

A further pass lifted two more decisions out of effect bodies — `importSignature` (what the
import-map probe is cached against) and `errorAction` (the three-way `ignore` / `retry` / `report`
routing the renderer's `onError` performs). The count stayed at 14, because the extraction
replaced two conditions with one, and **that is the honest reading**: the audit counts conditions,
not behaviour. `GenUISurface` went from 3 covered to 7, and the decisions that matter — which
error is transient, which retries, what the reader is told — are all constrained now.

One more — the `$dsh/chat.sendMessage` guard, which lives in a closure inside a
`registerUi4aHost` call inside an inject callback — took it to **13**, and every one of those is
verifiably inside a `useEffect` body: `x === null` guards and ref comparisons. Little is learned
by reaching them, which is a different statement from *they are hard to reach*.

The path from 28 to 13, for the next person who wants to go further: nothing was gained by
mocking a DOM, and everything by asking **what decision is this condition making** and lifting
that out. Nine of the fifteen closed were pure functions hiding inside a callback.

**A checker that reports success has to be checked against what it is looking at.** It ran, it
printed a reassuring line, and the answer was right about the two thirds it could see.

### The retry re-imported for a failure re-importing cannot fix (2026-08-23)

`GenUISurface`'s retry busts every esm.sh URL and re-imports, which fixes exactly one thing: a
dependency that failed to arrive. It was gated on the error *message* and not on the **phase**.

Both halves of that matter, and checking them meant reading `partial-react`'s runtime rather
than guessing. A failed dependency import is reported as **compile** —
`importCompiledComponent` runs inside the compile `catch` (`runtime.ts:338`). And `$dsh/fs`,
`$dsh/exec` and `$dsh/ai` all reject with the browser's own `Failed to fetch` when a route is
down, verified by stubbing `fetch` and calling each. So a card whose own body throws that during
render matched `TRANSIENT_LOAD` and got three re-imports it could not use — **2.4 seconds of
blank surface before the reader is told anything**, for an error that was ready immediately.

The decision is now `shouldRetry(message, phase, streaming, attempts)`, four lines, out of the
React and into a test: each of the three conditions fails a test when removed.

**"Does this repair actually address that failure?" is a question a message cannot answer** — the
phase can, and it was being discarded one parameter away from where the decision was made.

### Both error decisions were message-only; both needed the phase (2026-08-23)

Having found the retry ignoring `phase`, the suppression beside it turned out to have the same
shape. `TRANSIENT` matches `No default export found` and an unexpected EOF, and both come from
the parse stages — the first is thrown inside `importCompiledComponent`
(`partial-react/src/runtime.ts:360`, with its own comment explaining it is a "stream not finished
yet" frame), the second from the transform rejecting a prefix. Neither can arrive from `render`.

So a card whose own render throws a matching string was suppressed while streaming, leaving a
blank surface and an empty console — the failure this project cares most about, produced by the
code meant to prevent a *different* one.

Both decisions are now named functions taking the phase, four lines each and out of the React:
`isUnfinishedFrame(message, phase, streaming)` and `shouldRetry(message, phase, streaming,
attempts)`. Every condition in both fails a test when removed.

**Two handlers on adjacent lines had the same defect**, which is what you would expect: they were
written together, from the same idea that an error's message is what identifies it.

### The node half of `apply()` had never been run (2026-08-23)

`smoke.ts` loads the built **client** bundle and runs its `apply()`, and that has always been
described as covering registration. It covers half of it: the server half only ran in a real
profile.

That half is where the plugin's whole degradation story lives. Every capability is a **nested**
`inject` on purpose — a profile without `shell` loses `$dsh/exec` and keeps the rest, and the
skill and the prompt sit outside the `webServer` inject so a profile with no web server still
tells the model how to write a card. A static `inject` naming everything would take the whole
plugin down for one missing service, which is exactly what the comments in `index.ts` warn
about and what nothing checked.

`test/apply.test.ts` runs it against a fake context that answers only a named set of services,
and asserts which routes appear for a full profile, for one with no `shell`, and for one with
`skills` alone. Two structural mutations fail it: dropping `shell` from the exec inject, and
nesting the skill registration under the web server.

**A test that passes on its first run has proved nothing yet** — these did, and the mutations
are what turned them into evidence.

### A dependency no profile provides is a callback that never runs (2026-08-23)

Testing the registration surfaced a failure mode neither half guarded: cordis **silently skips**
a callback whose declared dependency is missing. A typo — `agentDefaultModal` for
`agentDefaultModel` — costs the whole `$dsh/ai` route, with no error anywhere and no way to tell
it from a profile that legitimately lacks the service.

The fake contexts both answer everything, so they cannot see it: the smoke test happily
*reported* an injection list containing `nonexistent-service` and passed. **A check that prints
what it found is not a check** — the same class as `compile-cards.ts` counting `bad` and never
exiting on it.

Both halves now hold the list of services a profile can actually provide and fail on anything
outside it. Verified by injecting a bogus name into each: the client half reports "apply()
injects nonexistent-service, which no profile provides — that callback would never run", and the
node half fails three tests on a one-letter typo.

### Sweeping for checkers that only print (2026-08-23)

`compile-cards.ts` had counted `bad` for its whole life and never exited on it — recorded, fixed.
So: which other scripts print a verdict nothing can fail against? Comparing "prints something" to
"can exit non-zero" across `scripts/`:

- **`mutation-audit.sh`** ended with `"$uncovered unconstrained"` and exited 0. It now exits 1.
  It is not part of `bun run check` (it takes about an hour), but a report nothing can fail
  against is a report that gets skimmed — and now a CI job or a `&&` chain can hold the line.
  Verified both directions: 0 on a clean tree, 1 with a deliberately uncovered condition planted.
- **`corpus-rates.ts`, `render-cards.ts`, `eval.sh`, `corpus-size.sh`** print by design — they
  are measurement tools with no pass/fail, and a threshold would be invented rather than
  measured. Left alone deliberately.

The distinction: **a script that computes a verdict must be able to fail on it; a script that
reports a number should not pretend to have one.**

### A third copy of the stubs, in the harness that measures whether cards paint (2026-08-23)

`render-cards.ts` serves `$dsh/*` shims so a corpus card can mount in a browser, and it kept its
own hand-written list of them — a third copy alongside `bindings.ts` and the generated
`types/standalone/*.js`. It was missing `readBytes` entirely and gave `bash` no `truncated` or
`timedOut`, so a card reading `r.truncated.stdout` **threw during a render sweep and was
reported broken for the harness's reason rather than its own.**

Checked before claiming it changed anything: **no corpus card actually reads those fields off a
`bash` result** — the one card that mentions `truncated` only declares the type and fills one in
its own error path — so the 97.4% paint rate stands. The gap was latent, not realised. Worth
saying plainly rather than leaving the stronger claim standing, because "this would have broken
a card" and "this broke a card" are different findings and only one of them is true here.

The route now concatenates the generated stubs. They are checked in, so a fresh clone still
serves them with no build step, and the shapes come from the same place the exported page gets
them.

That is the **fifth** duplicated-fact instance today, and the pattern in where they hide is
worth naming: every one was in a *measurement* tool rather than in the product — the mutation
mutator, the platform list, the stub table, the specifier regex, and now this. Test and harness
code gets copied because it feels like scaffolding, and then it decides what the numbers say.

### Every known failure now has both a screen and a rule (2026-08-23)

The browser run found four blank cards and six throws. Checking each against the current
screens closes the loop:

| card | how it failed | screened as |
| --- | --- | --- |
| `401f703946a0` | `const [h, setH] = useMemo(…)` | `DESTRUCTURED-HOOK` |
| `83d06aa1ce20` | `<Fragment>` never imported | `MISSING-REACT-IMPORT` |
| `acec9f8e5f4c` | `commits[…length - 1]` on empty | `UNGUARDED-LAST-INDEX` |
| `2f815f802de5` | a glob in JSX text | `GLOB-IN-JSX` |
| `6216b82af0b0` | `useMemo` at module scope | `MODULE-SCOPE-HOOK` |
| three compile failures | regex/px/arrow syntax | `compile-cards.ts` fails them |

And each now has a prompt rule as well — the hook confusion, the missing import, the empty
guard, the braces in JSX text, and the three syntax traps were all added today.

**That is the shape worth aiming for: a failure observed in a browser, a screen that finds it in
a corpus, and a rule that stops it being written.** The screen alone tells you the rate; the
rule alone is unverifiable; together the rate is the measurement of whether the rule works.

### Screens are prefix-safe, measured (2026-08-23)

The screens run on settled cards. The obvious next use is warning while the model is still
typing, and that only works if a screen never fires on a prefix of a card it clears when
finished — otherwise it reports a card that is fine, at exactly the moment the reader is
watching it appear.

Measured over every 10% prefix of all 378 corpus cards: **thirteen of fourteen screens never do
this.** The exception is `NO-FOCUS-RING`, and it cannot be otherwise — it fires on
`outline: "none"` and clears when the replacement arrives, so a card doing the right thing looks
wrong for the moment between the two lines.

`test/screens-prefix.test.ts` holds the property on the reference cards, with that one screen
named as the exception. Verified by making `MISSING-REACT-IMPORT` fire before `export default`
exists: the test fails.

**Worth keeping as a property rather than as a plan.** It costs one test, and it is precisely
the kind of thing that quietly stops being true the next time a screen is widened.

The cost is not the obstacle either: all fourteen screens over the largest card in the corpus
(13.8 kb) take **0.27 ms**, which is 1.6% of a 60fps frame. So "too expensive to run while
streaming" is not the reason they do not — nobody has needed it yet is.

### The sweep re-walked every argument on every streamed token (2026-08-23)

`collectCanvases` parses each tool call's argument string **by hand**, character by character —
that is what makes it correct on a half-arrived JSON prefix, and it costs about 0.16ms per
canvas. The canvas sweep called it unconditionally, then compared a paint signature to decide
whether to repaint. So the expensive half ran even when nothing had changed, on **every
transcript mutation**, which during streaming is every token.

Measured on the real distribution rather than a guess: across 1012 sessions, 229 have canvas
calls, the median is 1 and the maximum is 34. At 34 the sweep cost **3.725 ms per frame** —
about a fifth of a 60fps budget, spent re-deriving an identical result.

Keyed on the calls' own bytes (`count:total argsRaw length + settled flags`), the same frame
costs **0.014 ms**. 265×, and the key still moves on every frame that matters: a streamed
argument grows byte by byte, and the settled flag covers the one transition that adds no bytes.

Two things about testing it. The obvious test — "an unchanged sweep does no work" counted
through disk reads — **passed without the cache**, because those reads were already guarded by
`openedCode`; it was measuring a different guard. And `mock.module` on the collector *hung the
test run* rather than failing, since the module under test imports it. What works is asserting
the algorithmic property directly: the key must be an order of magnitude cheaper than the walk,
and must change when an argument grows or a call settles.

The rest of the per-frame path was measured too, rather than assumed: the `OPAQUE_WRITE` scan
over the same 34 calls is **0.055 ms** (the regex bails early because `"code"` rarely appears),
`matchSegment` over ten segments is **0.009 ms**, and parsing a 138 kb transcript for fences is
**0.095 ms**. The collector was the only hot spot, and now nothing on that path exceeds a
tenth of a millisecond. **Bounding the things you are not going to change is part of the
measurement** — otherwise "we optimised the slow one" is a hope.

### The compile is the frame budget, and it is already handled (2026-08-23)

Having measured everything in the sweep path, the honest ranking puts all of it far behind the
one thing nobody had timed:

| per-frame work | 34 canvases / 14 kb card |
| --- | --- |
| **normalize + compile, streamed frame** | **5.71 ms** (34% of a frame) |
| — of which `normalizeGeneratedTsx` | **3.42 ms** |
| — of which the wasm compile | 1.45 ms |
| normalize + compile, settled frame | 3.35 ms (1.93 + 0.93) |
| collect canvases (before the key) | 3.73 ms |
| collect canvases (after) | 0.014 ms |
| opaque-write scan | 0.055 ms |
| parse 138 kb of transcript for fences | 0.095 ms |
| `matchSegment` over ten segments | 0.009 ms |

The pair dominates, and **splitting them corrected an assumption worth stating**: the wasm
compile is the cheaper half at 1.45 ms, while `normalizeGeneratedTsx` — the bracket-balancing
pass that makes a half-written card parseable — costs 3.42 ms, more than twice as much.

Cost by prefix size is **not monotonic**, which is the more useful half of the finding:

| prefix of the same card | normalize (median of 30) |
| --- | --- |
| 25% — 3.4 kb | 0.87 ms |
| 50% — 6.9 kb | 1.95 ms |
| 75% — 10.3 kb | 4.31 ms |
| 90% — 12.4 kb | **4.64 ms** |
| 100% — 13.8 kb | 3.33 ms |

The complete card is bigger than the 90% prefix and costs a third less. Truncating at a
statement boundary instead (4.7 kb, everything balanced) costs 1.27 ms. So the price is the
**repair**, not the length — an input the model has left mid-expression makes normalize work
harder than a longer one that closes itself. The expensive frames are therefore exactly the
mid-stream ones, which is to say every frame the reader actually watches.

Neither half can be made cheaper here, so what matters is that the pair runs **once per genuine
change** — and both halves of that already hold: `partial-react` coalesces to a microtask and
single-flights (`runtime.ts:253`), and `GenUISurface` feeds it only the delta and returns early
when the code is identical (`code === deliveredRef.current`).

Across all 378 corpus cards at five cut points each, the mechanism holds and the size of it is
worth knowing. Bucketing 1512 samples by how many JSX elements are still unclosed at the cut,
and dividing out length so only the repair is left:

| unclosed JSX depth at the cut | normalize cost per kb |
| --- | --- |
| balanced (≤0) | 0.260 ms/kb |
| 1–3 open | 0.306 ms/kb |
| 4–8 open | 0.321 ms/kb |
| 9+ open | 0.393 ms/kb |

Monotonic, and a 51% penalty at the deepest — so depth-at-the-cut is the predictor, not size.
**No card blows a frame**: the worst mid-stream normalize in the whole corpus is 7.3 ms (a
16.3 kb card at 85%), and the median card's worst is 1.75 ms. That is the bound worth holding
onto — the ratio is alarming and the absolute number is fine, which is only visible because
both were measured.

**Then check the aggregate before calling it a problem.** Streaming this card as 60 growing
prefixes costs 305 ms in total — 1.5% of the ~20 s the stream itself takes. The bound is
per-frame latency (a 5 ms frame cannot also do much else), never throughput. Everything else
on the path together is under a tenth of a millisecond, so nothing here is worth optimising.
**Measure the thing you are not planning to touch first** — it is what tells you whether the
optimisation you were about to do matters.

### The plugin had not been loading at all (2026-08-23)

Every rule added this session was written, tested, screened, and recorded — and none of it had
reached a model, because `dsh` refused to load the section:

    dsh: UNKNOWN: malformed prompt variable reference "{{}}" in section "dsh-generative-ui:inline"

The loader reads `{{…}}` as a variable reference and rejects the whole section when the contents
are not a name. React's own `style={{ … }}` is exactly that token, and two had been added the
same day in **indented code blocks** — by the rules written to *show* a style object, which is to
say the failure was caused by the rules being specific.

The rule is simply that `{{` is fatal anywhere — inline code spans included, code blocks
included. The loader is a plain string scan and markdown means nothing to it.

Getting to that one-line answer took three wrong turns, all the same mistake. A probe inserted at
a different heading "showed" inline spans were exempt; an ablation that meant to reintroduce the
bug matched **nothing**, because the source already read `style={ { …` with spaces, and its
silence was read as *the brace is harmless here*. Both conclusions went into this file before
being checked. What settled it was asserting the edit happened —

    assert s.count(a) == 1, "pattern not found"

— which failed immediately on the next attempt and pointed at the real text. **An ablation that
edits nothing looks exactly like an ablation that proves the fix unnecessary.** Every
find-and-replace used as evidence has to verify it replaced something; three separate wrong
conclusions today came from skipping that one line.

Nothing in 305 tests caught it. Every test reads the exported string; `dsh` is the only thing
that **parses** it, and the parse has a syntax nobody had written down. Now
`test/prompt.test.ts` asserts neither text contains `{{` at all, `scripts/loads.sh` boots `dsh`
once and fails if a section was rejected, and the rules write `style={ { … } }` — same JSX, same
meaning to a reader, no collision.

**A prompt has a consumer, and the consumer has a grammar.** A string that exists, is complete,
is well-formed markdown, and is pinned by a dozen assertions can still be rejected in full by the
one program that reads it.

It was found by running `scripts/eval.sh` — by *using* the thing rather than testing it. That is
the whole lesson: the test suite verifies what the code says about itself, and one real
invocation checked something none of it could.

With it loading, nine fresh cards over nine prompts, screened the same way as the corpus:

| | n | any screen fires | `NO-FOCUS-RING` | uses `:focus-visible` |
| --- | --- | --- | --- | --- |
| corpus, before the rules | 378 | 47% | 19% | **0%** |
| fresh, after | 67 | 22% | 0% | **90%** |

The 24% is entirely `UNANNOUNCED-ASYNC-RESULT`, added after most of those cards were written: 15
of 67 fetch something and announce nothing, and **every one predates the rule** — all six async
cards generated after it pass, including one written after `SWALLOWED-CAPABILITY-FAILURE` landed
that satisfies both new rules on its first try. Under the screens that existed when each was
generated, all 67 are clean. **Both numbers are true and the second one is the honest one** — a
clean streak means clean under the screens you had, and adding a screen is what turns that into a
measurement. Fifty-seven cards is not a rate either. Two caveats before the number
is quoted anywhere: the screens were written *from* the corpus, so the corpus column is measured
by checks derived from it; and 47% is against all 22 screens, nine of which did not exist when
the earlier draft of this table said 28%. The corpus figure has only ever moved by screens being
ADDED — no card changed — which is the honest reading of why it climbed from 28% to 47%.

The column that carries weight is the last one, and it needs neither caveat: `:focus-visible`
appears **zero times in 378 corpus cards** — not rarely, never — and in 60 of the 67 written
since. A behaviour absent from the entire prior distribution appearing immediately is not
something a small sample can manufacture.

Final for the day: **34 of 34 clean under all 18 screens**, and all 31 whose imports this process
can resolve actually paint. The three skipped import `recharts`, which is deliberately not
stubbed.

`bun scripts/fresh-rates.ts` re-derives those two numbers, because they went 17 → 30 → 34 in a
day and two of the hand-edits were briefly wrong — the same rot `corpus-rates.ts` exists to
prevent, reintroduced for the other card set within hours of writing that down. The prompts that
produced them are in `test/eval-fixtures.md`.

That is the first evidence the rules do anything, and until the loader was fixed the honest
figure for all of them was zero.

The other high-rate screen moved the same way and more cleanly. `UNREACHABLE-CONTROL` fires on
19 corpus occurrences of `<div onClick>` with no keyboard affordance; the nine fresh cards
contain **none at all** — 22 `<button>` elements between them instead. Worth noting because the
rule offers `tabIndex`/`onKeyDown` as the remedy and the model took the better one: a control
that was never a div needs no affordance bolted on. **A rule that names the fix can still be
followed by removing the problem**, which is the outcome to hope for and not the one you measure
for, since the screen for the bad construct cannot see it.

### The reader clicks twice and the older answer wins (2026-08-23)

Mining the nine fresh cards for defects **no screen covers** — the way the existing screens were
found — turned up the second-largest one in the corpus, and it had been sitting there all along.

An async event handler that awaits something slow and then `setState`s, with nothing telling it a
newer run has started. Click 生成, click it again while the first stream is still arriving, and
both loops write interleaved; the one that started FIRST usually finishes last, so the answer the
reader replaced overwrites the one they are looking at. `useEffect` has the `let cancelled = false`
idiom and the corpus does use it — handlers mostly do not.

**23 of 378**, second only to the focus ring, and the majority await `bash`, which has no time
bound at all. `UNGUARDED-ASYNC-HANDLER` screens for it; the skill now shows the `runId` ref beside
the effect-cleanup section, since an effect's cleanup does not cover a handler.

Getting to that number took three passes, each one a smaller version of the same error:

- A regex anchored on `\n  };` — a formatting accident, not the pattern. Reported **1 of 378**
  while 21 cards visibly had async handlers.
- Brace-matched, but treating `.current !==` as the only guard spelling. Reported **93%
  unguarded**, including a card whose very first line is `const id = ++runId.current`. The corpus
  writes the comparison the other way round: `id !== runId.current`.
- Counting every await. `readFile` returns in a millisecond and cannot realistically be
  overtaken; screening it would have reported a third of the corpus for a race nobody can hit.

Only slow awaits (`streamText`, `bash`) count in the final screen. **Three wrong numbers before a
right one, and every one of them looked plausible enough to write down** — the tell each time was
reading the actual matches, which is the same lesson as `print the matches, not the count`, learnt
again on a day it had already been recorded.

The first card generated afterwards that needed the rule took it, and took more of it than was
asked — a live-search box over `bash`, which is exactly the shape that used to race:

    const id = ++runId.current
    abortRef.current?.abort()
    const res = await bash(cmd, { signal: ctrl.signal })
    if (id !== runId.current) return

The ref guard *and* an `AbortController` for the superseded run *and* an unmount cleanup, none of
which the rule spells out together. **The rules that land are the ones that show the shape**; the
model fills in what the shape implies.

The same mining pass turned up a candidate that **did not** meet the bar, and the reasoning is
worth keeping because the raw number looked compelling. 95 of 378 cards write `key={i}` over a
`.map`, which reads like a third of the corpus doing something wrong. It is not: an index key is
only a defect when the list **reorders**, and most of those are static renders where the index
genuinely does name the same item forever. Narrowed to lists that are sorted or filtered, the
corpus rate is **2**.

One fresh card has the real version — a sortable table keyed by row index, where re-sorting hands
a row's DOM node to a different row and any per-row state goes with it. A real bug, and still not
a screen: separating it from the harmless 93 needs to know whether the list reorders, which a
text predicate cannot do reliably, and a screen that reports 95 for 2 real hits trains people to
ignore it.

**A defect being real is not sufficient; a screen also has to be able to tell it apart from what
looks like it.** Recorded here instead, which is what the record is for.

The next candidate passed that bar, and the contrast is instructive because its raw number looked
just as unpromising. 74 corpus occurrences of `Number(e.target.value)` written straight into
state — but **43 are `type="range"` sliders**, where the value is always numeric and neither
failure can occur. Of the 26 attached to a `type="number"` field, **16 already guard**.

That leaves 10 real ones, and they are a genuinely bad experience: `Number("")` is `0`, so the
reader backspaces to retype and the field snaps to zero on the empty keystroke — they are
fighting it every time. A lone `-` gives `NaN` and blanks every derived value.

The difference from the `key={i}` case is not the rate, it is that **one telling attribute
separates the real ones from the rest**. `type="number"` is in the source, three characters from
the match; "does this list reorder" is not. A screen is viable exactly when the discriminator is
present in the text, and the 16 cards already doing it right prove the fix is one people reach
for unprompted.

It also turned out to be the **second** prefix-unsafe screen, for the same structural reason as
`NO-FOCUS-RING`: the guard follows the defect in the text, so a prefix cut between them shows the
defect alone. `01bf50a29bde` gets cut mid-`Number(e.target.value) ||` at 70%.

That was found by running the prefix property over the corpus, which `test/screens-prefix.test.ts`
had never done — it checks four reference cards, and **none of them contains a `type="number"`
field**, so the new screen would have sat on the exception list unexamined. The test now runs the
corpus when it is extracted, and a second test requires every named exception to be *reproducible*
— a screen listed as prefix-unsafe that nothing can demonstrate is a screen quietly excused from
the check. Verified by adding a bogus name to the list and watching it fail.

**An exemption list is a place where checks go to die.** Every entry needs a test proving it is
still needed, or removing it is the only way anyone finds out.

Auditing the repo's other two exemptions on that principle found both weak in the same way — they
were **assertions rather than derivations**:

- `compile-cards.ts` exempted `late-hook.tsx` from its ORPHANED check with a comment saying
  `replay-stream.ts` owns it. True, and written as a string literal in the exempting file, so
  deleting the owner's loop would have left the card exempt and run by nothing. The list now
  lives in `screens.ts` and both import it; emptying it orphans the card immediately, verified.
- `mutation-audit.sh` printed *4 in prose, declined* — a count that reads identically whether the
  mutator correctly skipped four prompt examples or its fence tracker desynced and skipped four
  real branches. It now names each declined line, and all five across both files are visibly
  prompt text.

**An exemption should be a consequence of something, not a claim about it.** Where that is not
possible, print the exempted items rather than their count — a name can be checked at a glance
and a number cannot be checked at all.

### The slider says its number and not what it controls (2026-08-23)

`UNLABELLED-CONTROL` — **54 of 378**, immediately the second-highest screen. A `type="range"`
with no `aria-label`, no `id`, and no wrapping `<label>` announces "slider, 3" and nothing else.
The `<span>` rendering `n = 3` beside it is a separate element; the two are related only on
screen. `<select>` has the identical problem — its options are its value, not its name, so an
unlabelled one announces "combo box, 每天" — which is why it was folded in here (6 more cards,
same fix) rather than given a screen of its own, and why the name is CONTROL and not SLIDER.

Controls with no text of their own, not inputs generally. A text field usually has a placeholder to fall back
on, and 106 of the corpus's unlabelled inputs sit inside a `<label>` that labels them properly —
screening all of them reports 148 cards for a much smaller real problem. A range control has
neither fallback, which is what makes the rate trustworthy.

Two things worth carrying:

**The first count was 241, and the cause was a regex.** `<input[^>]*>` stops at the first `>`,
and `onChange={e => …}` puts one *inside the tag* — so the match ended early and never saw the
`aria-label` that follows. Tag ends have to be found by brace depth. Every large number this
session has been wrong in a way that made the problem look worse than it is; this is the fourth.

**It fired on a reference card.** `test/cards/metro.ui4a.tsx` — hand-written, read many times
over many sessions, and its BPM slider had no label. A new screen paying for itself against the
repo's own examples on the first run is the strongest evidence that the rate is real and not an
artefact of how the corpus was made.

Each screen now has to survive **three** questions, one test apiece:

| question | file | what it catches |
| --- | --- | --- |
| does it fire on the defect? | `test/cards-negative/` + `compile-cards.ts` | a screen that went blind |
| does it stay quiet on the fix? | `screens-quiet-on-fix.test.ts` | a screen that flags the remedy |
| does any real card exercise it? | `screens-exercised.test.ts` | a screen quiet because **nothing it looks at exists** |

The third was added because two screens were in exactly that state: no reference card contained
`type="range"` or called `bash`, so both were silently untested against whole working code while
appearing perfectly clean. Each test asserts its map's keys equal the screen list, so a new screen
cannot skip any of the three.

**"No failures" has at least two causes and they look identical**: nothing is wrong, or nothing
was examined. Every check worth keeping needs something that distinguishes them.

The pairing data also said something the individual rules did not. 221 of 378 cards are clean
under every screen, and the two commonest *pairs* are a stripped focus ring beside an unlabelled
slider (8 cards) and an unlabelled slider beside an unguarded number field (6). Those are not
three defects, they are one: **a card written as a picture of an interface**, correct through a
mouse and an eye and broken through a keyboard or a screen reader. The skill now names that cause
above the rules rather than leaving it to be inferred from a list.

Tested with the card shape most likely to fail — a media panel with two sliders and a seek
field, exactly the combination that trips three screens in the corpus. It came back clean: both
sliders labelled, focus rings replaced, and the number field keeping its raw string in state and
coercing where it is used, which is the better fix than the ternary the rule shows. It also put
an `aria-label` on the number field, which nothing asked for.

**A rule tells you what to do; the cause tells you when.** The card generalised past the three
examples it was given, which a list of three fixes cannot do.

### Judgement is not a control (2026-08-23)

I pushed a red commit. Again — this session already records doing it once and resolving not to.
The second time the evidence was even plainer: I had just run `bun run check 2>&1 | grep -icE
'\(fail\)|error'`, it printed **4**, and I committed and pushed in the same command.

The failure itself was small and expected in hindsight: `UNSTOPPABLE-MOTION` is prefix-unsafe,
because `@keyframes` is written before the `@media (prefers-reduced-motion)` that clears it. That
is now the **third** screen with that shape, alongside `NO-FOCUS-RING` and
`UNGUARDED-NUMBER-INPUT`, and it is not a coincidence: **the fix is written after the thing it
fixes**, in CSS and in JavaScript alike, so any cut between them shows the defect alone. A fourth
should be expected rather than investigated.

The fix for the push is not resolving harder. `.git/hooks/pre-push` now runs `check` and refuses
the push on failure, and `scripts/hooks/install.sh` puts it in a checkout — `.git/hooks` is not
versioned, so a hook living only there protects one clone and nobody learns it is missing from the
others. Verified by breaking a screen deliberately and watching the push refuse.

**Anything you have done twice while intending not to is not a discipline problem.** Two identical
mistakes in one session is the signal to spend the ten minutes making it mechanically impossible.

### Five screens, and the loop closing on each (2026-08-23)

The corpus-mining pass took the screen count from 13 to 18: `UNGUARDED-ASYNC-HANDLER` (23),
`UNGUARDED-NUMBER-INPUT` (10), `UNLABELLED-CONTROL` (52) and `UNSTOPPABLE-MOTION` (37), plus the
`<div onClick>` arm of `UNREACHABLE-CONTROL` made conditional. Each got a negative control, a
quiet-on-the-fix pair, a construct entry, and a rule shown as code.

Each was then checked the only way that means anything — by asking for a card that would trip it:

- *live search over `bash`* → `const id = ++runId.current` **and** an `AbortController` **and** an
  unmount cleanup, more than the rule spells out.
- *media panel, two sliders and a seek field* → both sliders labelled, focus rings replaced, and
  the number field keeping its raw string in state, which is the better fix than the ternary
  shown. It labelled the number field too, which nothing asked for.
- *"add some animation so they look like they're growing"* → `matchMedia` guarding the rAF loop
  **and** an `@media (prefers-reduced-motion)` block disabling the decorative animations, on a
  card explicitly asked to animate.

The rate to compare against: **7 of the 131 animating corpus cards honoured the setting at all.**

`prefers-reduced-motion` also became the third prefix-unsafe screen, which is the useful
generalisation from all this: **the fix is written after the thing it fixes**, so the streaming
prefix always shows the defect alone. Expect the fourth.

Scored against all 18 screens at the end of the day:

| | clean under every screen |
| --- | --- |
| 378 corpus cards, written before the rules | **203 (54%)** |
| 17 cards generated after them | **17 (100%)** |

Seventeen is a small number and the screens were written *from* the corpus, so some of the gap is
that these defects are exactly the ones now being warned about — that is the intent, not a
confound, but it does mean the honest claim is narrow: **the specific things measured, screened,
and written down stopped happening.** Not that the cards are better in general, which nothing
here measures.

The one figure that resists that caveat is `:focus-visible`: **0 occurrences in 378 cards** before,
and present in 7 of the first 9 after. A behaviour absent from the entire prior distribution
cannot appear by sampling luck.

One eval produced no card at all and looked like a failure until read: asked to show a dependency
tree, the model checked the workspace, found it genuinely empty, said so precisely, and offered to
build the view once given a path. Correct behaviour, and my fault — `scripts/eval.sh` takes a
**seed directory** as its second argument and `test/seed/` already holds a `package.json`, a `src`
tree and a `setup.sh` that runs `git init`. Passing it, the same two prompts produced cards
immediately.

**A prompt that needs a project needs the seed**, and a zero from a harness run without one
measures the harness. Worth stating because the reflex on seeing an empty result is to go looking
at the prompt.

### The screens said clean; the render said otherwise (2026-08-23)

All 17 freshly generated cards passed all 18 screens. Rendered for real through
`scripts/render-cards.ts` — compile in-page, import as a blob module, `createRoot().render()`,
read `innerText` back — **two of them were blank**, and an error boundary said why:

    ReferenceError: useState is not defined

Both open with a `const` lookup table or a `type` and call `useState` further down, never
importing it. `MISSING-REACT-IMPORT` looked only for `Fragment|StrictMode|Suspense|memo|
forwardRef` and could not see it.

**Correction, found later the same day: a reader would not have seen this.**
`normalizeGeneratedTsx` *inserts the missing React import* — verified on both cards — and
production runs every settled card through it. The blank rectangles were my browser harness's,
which compiled the raw source without normalizing, exactly the divergence recorded two sections
below as *the checker was stricter than production*, discovered from the other direction and not
recognised as the same thing for another hour.

The screen is still right to fire: a card that only works because a repair pass patches it is one
upstream change away from breaking, and the repair is there for **truncated** input, not for
missing imports. But the severity was wrong, and the correction matters more than the finding —
*compiles, mounts, shows nothing* was the claim, and it was not true.

The repair's boundary is by **name**, not by line, and getting it wrong twice in one afternoon is
the story worth keeping. Measured:

| | |
| --- | --- |
| no react import at all + `useState` | inserts the whole line → renders |
| `import { useState }` + `useMemo(…)` | **extends** the existing line → renders |
| `import { useState }` + `<Fragment>` | not supplied → `Fragment is not defined`, blank |

It supplies **hooks** and never JSX **components**. My first reading was "adds a missing line,
never extends one" — which fit the two cases I had looked at and produced a negative control card
that did not actually break. The second reading came from testing seven names in a form
(`const x = useMemo`) that the pass ignores for every name, so everything looked un-repaired. Only
writing each case the way a card actually writes it gave the real answer.

`MISSING-REACT-IMPORT` now stays quiet on anything matching `^use[A-Z]` and fires only where the
repair cannot reach — 1 of 378, `83d06aa1ce20`, one of the six corpus cards that genuinely paint
nothing. *Import every name you write, `Fragment` included* was always aimed there, which is why
its example shows `useState` already imported: the detail I read as a gap this morning.

**The whole chain, because the shape recurs:** a render harness that skipped normalization found
two blank cards → recorded as "compiles, mounts, shows nothing" → a screen widened around them →
found later that production repairs both, so the finding was overstated → the boundary
mis-measured with a probe written in a form no card uses → a negative control that fired on the
screen while the card it described rendered fine → measured properly, screen narrowed, control
rewritten to a case that demonstrably paints blank.

Every step was checked, and four of the six were wrong. What caught each one was the same thing:
**running the artifact instead of reasoning about it** — `paint-cards.ts` on the control card is
what showed it did not break, one command, after two rounds of confident prose. The tests now pin
all three boundary cases, so the next person gets the answer instead of the search.

And the gap that let it happen is now closed generally. A negative control proved its screen
**fires**; nothing proved the card was actually broken, so a wrong screen and a wrong control
agreed with each other and both passed. `test/controls-break.test.ts` renders the ten controls
whose defect is render-fatal and requires each to genuinely throw or paint nothing — verified by
turning the `<Fragment>` in one of them into `<>`, which makes the card render and the test fail.

The other twenty controls are deliberately not listed: a stripped focus ring, an unlabelled
slider, an unguarded number field all render perfectly and are still defects. **Splitting the
controls by whether the defect is fatal is itself information** — it says which screens are
catching a broken card and which are catching a bad one.

**Zero of 378 corpus cards do this. Two of the first 17 written after this session's prompt
edits do.** The rule I touched says *Import every name you write, `Fragment` included* and its
example shows `Fragment` missing while `useState` is already imported — which teaches the
opposite of what these cards needed. The prompt now leads with the import line itself.

The screen was widened to cover hooks too, and then **narrowed again the same day**: a card with
no react import at all is repaired downstream, so firing on it overstated the problem. It now
fires only where the repair cannot reach — a component name beside an existing import. The
boundary and the three cases are pinned in `test/normalize-complete.test.ts`.

Three things worth carrying:

- **A screen suite that is all green is evidence about the screens, not about the cards.** Every
  one of these 18 was written from a defect someone had already found. A defect nobody has found
  passes all of them by construction.
- **Rendering is the only check that cannot be fooled this way** — but only if it renders the way
  production does. This run did not: it compiled raw source while production normalizes first,
  and so reported two cards as blank that a reader would have seen render. It still found a real
  gap in the screens; it just overstated what the gap costs.
- **Changing a prompt is a change to a program whose output you have not run.** This regression
  was introduced by an edit made carefully, tested, and recorded — and would have shipped as an
  improvement.

### The judgement boundary survived the day's prompt edits (2026-08-23)

Today added six rules and rewrote two. The thing most at risk from that is not any single rule but
the **boundary**: a widened prompt that starts building a card for `今天星期几` has made the
plugin worse in a way no screen can see, because the card it builds will be perfectly clean.

Re-ran both sides of `test/eval-fixtures.md`:

| | result |
| --- | --- |
| `今天星期几`, `HTTP 状态码 418 是什么意思` | prose, `fence=0 canvas=0` both |
| all six of the "Must produce UI" prompts | UI, 6/6 |

All eleven cards generated across those runs compile, pass all 18 screens, and paint. The glob
one is worth naming: `这个 glob 会匹配到啥 src/**/*.{ts,tsx}` is the request that produced the
corpus card throwing `ts is not defined`, and this time every glob is a string literal.

**A prompt change needs the boundary re-measured, not just the new rule tested.** Every rule
added today argues for building something; nothing in a day of that work would have noticed the
prose side eroding, and it is the side with no checker at all.

A later spot-check produced a **useful near-miss**: `把这几个环境变量整理成一张表` — *organise
these env vars into a table* — came back as a markdown table, no card, and looked at first like
the `.env` fixture regressing. It is not the fixture. That one reads
`帮我把 .env 弄明白，有几个值我要改` — *there are values I need to CHANGE* — which is a request to
edit, and it still produces UI, verified. The other prompt asks for a table and gets a table.

**Read the fixture's phrasing before calling a nearby prompt a regression.** The difference
between the two is one clause about intent, and it is exactly the distinction the trigger rules
are supposed to make. (The prose reply also noticed the seed's `.env` is committed to git with a
live-looking key in it, which nothing asked for and is the right thing to say.)

*(Housekeeping, from the same day: this section spent an hour **inside** the one before it,
because the phrase I anchored the insert on sat in the wrong place and the edit succeeded
anyway. `test/record-structure.test.ts` now checks dated sections are in order and titles are
unique — the failure mode reading is worst at catching in a 5,600-line file.)*

*(It also checks that every `scripts/…`, `test/…` or `src/…` path this file names actually
exists. Three were dangling: one already flagged in-line as fictional, and two naming files
deleted on a release day — described as having "come out together", which a reader could take
either way. A path in prose is a promise that something is there, and a wrong one costs whoever
believes it. Passages about another repository, or that say the file is gone, opt out.)*

### All 378, actually rendered (2026-08-23)

Having built the driver, the corpus went through it too — every card compiled in-page, mounted
under an error boundary, and read back. **369 of 378 painted (97.6%).** The nine that did not:

| | |
| --- | --- |
| 3 never compiled | the three already known: a regex in JSX, `px` in a style object, `&&` into an arrow |
| 1 `ts is not defined` | `GLOB-IN-JSX` — the glob's braces read as an expression |
| 1 `useMemo is not iterable` | `DESTRUCTURED-HOOK` |
| 1 React #321 | `MODULE-SCOPE-HOOK` — a hook outside a component |
| 1 `Fragment is not defined` | `MISSING-REACT-IMPORT` |
| 1 reading `'date'` of undefined | `UNGUARDED-LAST-INDEX` |
| 1 `Expression expected` | a leaked `</｜｜DSML｜｜parameter>` token — a corrupt extraction, not a defect |

`paint-cards.ts` now reports that last one as `CORRUPT EXTRACTION` in its own category rather
than as a failure, because a leaked control token means the generation was truncated mid-write —
the card was never finished, let alone wrong. **A category for "the input is damaged" keeps the
defect count honest**; without it, one broken download reads as one broken card forever, and the
next reader goes looking for a bug in code the model never got to write.

**Eight of the nine map exactly onto an existing screen, and the ninth is not a card problem.**
That is the useful result: the screens were derived from reading code, and rendering — an
entirely independent method — finds the same set and nothing else. Each of the six runtime
failures is a card that compiles, mounts, and shows the reader a blank rectangle.

Batching matters if this is repeated: `Runtime.evaluate` times out well before 378 cards, so
prime the wasm and modules once into `window`, then render 30 at a time accumulating into
`window.__results`.

Then the whole thing got cheap enough to keep. `scripts/paint-cards.ts` compiles each card and
renders it with **`react-dom/server`** — no browser, no server, ~2s for the reference cards, and
it runs in `bun run check`. Against the corpus it finds **7 of the browser's 9 and nothing
else**: no card that paints in a browser fails here. The two it cannot see both need more than a
first synchronous render (React #321 wants a real root; an unguarded `[0]` wants the effect to
have run).

Two details made it work rather than skip half the corpus:

- `$dsh/*` does not resolve in this process, and a card using a capability is exactly the kind
  worth rendering. Rewritten to `types/standalone/*.js`, which already stands in for every member
  with the right shape — the same stubs the browser harness serves.
- A card is imported from a **`data:` URL**; `blob:` is not importable outside a browser.

**The expensive verification is worth building even if you run it once — it tells you what the
cheap one has to catch.** The browser run is what proved this covers the ground; without it the
`react-dom/server` version would be a guess about what a first render is worth.

It then did the thing it was built to expose. The first version printed `paint: ok — every card
renders something` while **silently skipping 120 of 378** for unresolvable imports (51 recharts,
31 lucide-react, 22 partial-json, and four smaller) — and one of the skipped cards was
`test/cards/metro.ui4a.tsx`, a reference card, inside `bun run check`. A gate reporting success
about a card it never opened is precisely the failure this script exists to catch, reproduced in
the script within an hour of writing it.

Now the count is printed, and `lucide-react` — icons and nothing else — is rewritten to
`const Play = () => null`, which renders `metro` faithfully (4300 bytes of markup, the real BPM
UI) at no dependency cost. Zero skipped in `check`. The corpus still skips 120, which is stated
rather than hidden; installing seven UI packages as devDependencies of a plugin to fix that is a
worse trade than knowing the number.

**Write the count of what you skipped next to the result.** Every gate in this repo that has ever
lied did it by omission, never by a wrong answer.

Auditing the other scripts for the same shape found one more: `replay-stream.ts` had
`catch { continue }` around its normalize, so `frames=12` on a 60-prefix card would read as a
short card rather than as a pass that gave up on 48 of them. Now counted and printed.

The count turned out to be **zero on every reference card and zero across all 378 corpus
cards** — `normalizeGeneratedTsx` repairs every prefix it is handed, and the `catch` was dead
code concealing nothing. That is worth knowing on its own, and it was only knowable once the
skip was counted. **A silent skip that never fires and a silent skip that fires constantly look
identical from the outside**, which is the whole argument for counting even where you are
confident.

### The checker was stricter than production (2026-08-23)

A freshly generated card — a 243-line regex tester — came back `FAIL Expression expected at
243:1` from `compile-cards.ts`. It compiles perfectly on its own. `normalizeGeneratedTsx`, whose
whole job is making a **half-written** card parseable, appended

    ]</span></div></div>);})}</div></div>)}</div>)}

to a complete one and broke it. Zero of the 374 corpus cards that compile raw hit this, so it is
rare and construct-specific — something about a `<style>` block whose CSS braces the tracker
reads as JSX braces, though the minimal cases all behave.

**A reader would never have seen it.** `compiler.ts` already tries `final` and falls back to
`streaming` on failure, precisely because *the final compile must never be more fragile than a
streaming frame* — and the streaming cut-back recovers this card. The bug was in the checker,
which had no fallback and so reported a working card as broken.

Now `compile-cards.ts` performs the same two steps, and `test/normalize-complete.test.ts` holds
the fixture. That test pins **current** behaviour, not desired: a permanently-red test breaks
`check` and teaches everyone to read past failures, which costs more than the bug does. When
upstream fixes it, the test fails and says so.

Two lessons, and the second is the one that nearly cost an hour:

- **A checker that is stricter than production produces false alarms about real cards**, and a
  false alarm about a real card is how a checker stops being read. Verification should mirror the
  path being verified, fallbacks included.
- **When a checker and reality disagree, suspect the checker.** I spent that hour bisecting the
  card — counting braces, counting parens, hunting an extraction bug in my own `awk` — on the
  assumption that a `FAIL` meant a broken card. The card was never broken.

Auditing the rest for the same divergence found `paint-cards.ts` failing it the **opposite** way:
it compiled the raw source with no normalization at all, so it tested a path production never
takes — missing both damage normalize repairs and damage normalize causes. Aligning it dropped
the skipped count from 120 to 102: eighteen corpus cards are only importable *because* normalize
repairs them, and the render check had never seen any of them.

Both now call one `compileSettled` in `tsx-node.ts`, and `test/mirrors-production.test.ts`
fails if any script calls `compileCard` on a whole card without it — with `replay-stream.ts`
exempted and the reason written down (it renders streaming frames on purpose, which *is* what
production does mid-stream).

**Verification has to take the same path as the thing it verifies, fallbacks included.** Twice in
one file's history the checker and the runtime differed, once in each direction, and neither
showed up as a wrong answer — one as a false alarm, one as a silent gap.

The skipped count then came down from 102 to 80 by stubbing `partial-json` — 22 cards, and the
stub is *faithful*: it parses a half-arrived JSON string, so on a complete one it is `JSON.parse`,
which is all a first synchronous render ever sees.

`recharts` is 51 more cards and is deliberately **not** stubbed. A stubbed chart renders as
nothing, so the check would start PASSING cards that show a blank chart — trading an honest skip
for a false negative. **A stub is only legitimate when it is faithful for the thing being
measured**; where it is not, the skip is the correct answer and the count is the record of it.

### The streaming path, measured over the whole corpus (2026-08-23)

`replay-stream.ts` had only ever run over the reference cards — it takes file paths while every
sibling script takes a directory, so pointing it at the corpus failed with `EISDIR` from inside a
read. Now it accepts both. Over all 378 cards, 60 prefixes each:

- **0 visible remounts.** The `afterDefaultPaints` measure — a hook count changing after the card
  has already painted, which is React tearing down and rebuilding in front of the reader — fires
  on nothing. The `late-hook.tsx` control still detects it, so the measure is live.
- **0 unnormalizable prefixes.** `normalizeGeneratedTsx` repairs every one of 22,000-odd prefixes
  it is handed.
- **4 cards with a frame that fails to compile mid-stream.** Three are the cards that never
  compile at all, so every frame fails; the fourth, `c5f586e3ac6d`, has exactly **one** bad frame
  at 27%, where the cut lands inside an object literal and the repair produces `{…, }` with a
  trailing key expected.

One blinked frame in ~22,000, on one card. **A measure that reports zero across a whole corpus is
worth as much as one that finds something** — provided a control proves it still fires, which is
what `late-hook.tsx` is for.

### Which rules already work (2026-08-23)

A day spent on the rules that fail is worth ending with the ones that do not. Scored across the
378-card corpus, counting only cards a rule applies to:

| rule | adherence |
| --- | --- |
| no `@media (min-width)` — size against the container | **378/378** |
| a settled card exports a default | **378/378** |
| `--dsw-alias-*` tokens rather than literal colour | 371/377 (98%) |
| `bash()` result: `exitCode` checked | 18/19 (95%) |
| `streamText` parsed with `partial-json` | 22/24 (92%) |

Zero media queries in 378 cards is the striking one — the rule is stated once, in prose, with the
reason, and nothing in the corpus violates it. Only four cards write a fixed 3-digit `px` width
and every one is a `min-width: 140px` flex floor or a 116px tarot card, none of which breaks a
narrow panel.

Against this, the accessibility rules sat at **5% (`prefers-reduced-motion`) to 19%
(`NO-FOCUS-RING`)** before today. The difference is not that one set is stated better. It is that
**a rule about the card's own structure is checked by the card working**, and a rule about
someone else's experience of it is checked by nobody — the author has a mouse and eyes, and the
card looks right. That is the whole argument for screening the second kind and not bothering with
the first.

Applying that filter to find the next screen turned up nothing worth adding, and the search is
worth recording so it is not repeated. Reader-experience properties, scored:

| | |
| --- | --- |
| a loading state while awaiting | 60/67 (90%) |
| a button that says what it does | 276/276 (100%) |
| an error surfaced rather than only caught | 44/81 (54%) |

The 54% looked like the next screen until the catches were read. **41 empty `catch` blocks across
36 cards, and 21 are the deliberate `partial-json` idiom** — swallowing a parse error on a
half-arrived object is the documented pattern, not a defect. Of the nine wrapping a capability
call, most are *this file might not be there*: a directory that cannot be read is skipped in a
tree walk, `.env.example` is optional. One is a real miss (a clipboard write that silently fails,
so the reader clicks 复制 and nothing happens) and one card is not a class.

**The discriminator has to be in the text, and here it is not**: "was this failure expected?" is
the whole question and nothing distinguishes a deliberate skip from a swallowed error. Same
conclusion as the `key={i}` case, reached the same way — by reading the matches rather than
trusting the rate.

### The import-map probe fires once per card (2026-08-23)

`GenUISurface` re-probes esm.sh whenever the set of things a card imports changes, and the probe
is a network round-trip. The obvious worry is that a growing prefix looks like a changing set on
every frame.

Measured across all 378 corpus cards at 60 prefixes each — probes per streamed card:

| probes | cards |
| --- | --- |
| 1 | 310 (82%) |
| 2 | 63 |
| 3 | 5 |

Imports arrive in the first frames and never move, so the signature settles almost immediately.
Extracted as `importSignature` so it could be measured at all; it compares by **value**, meaning
re-ordering the same imports re-probes, which the numbers say costs nothing worth a set
comparison's extra code.

**A cache key is worth measuring against real inputs before optimising it.** The intuition that a
growing prefix invalidates constantly is wrong here for a structural reason — the thing being
keyed lives at the top of the file, and the file grows downward.

### The arrow in a handler ends the tag, for a regex (2026-08-23)

Third time, in three different screens: `<input[^>]*>` and `<div\b[^>]*onClick=` both stop at the
`>` in `onChange={(e) => …}`, which is **inside** the tag. Everything written after the handler —
`aria-label`, `role`, `tabIndex`, `onKeyDown` — is invisible to the match.

The cost each time was a false positive, and the third one was the sharpest: a freshly generated
JSON editor did the keyboard-reachable div **exactly right** —

    <div className="je-head" onClick={() => onToggle(path)}
      role="button" tabIndex={0} aria-expanded={open}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(path) } }}>

— and `UNREACHABLE-CONTROL` reported it. A screen that flags the model for following the rule is
worse than no screen: it is evidence *against* a rule that is working.

All three now find the tag end by **brace depth**. `test/screens-quiet-on-fix.test.ts` holds the
five shapes that separate a tag parser from a regex, kept together because the next screen to
match a tag will need the same ones — verified by reverting to `[^>]*` and watching them fail.

**Attributes come in any order, and JSX handlers contain the delimiter.** Any screen that reads a
tag needs a parser; there is no regex spelling of this that works, only ones that have not met an
arrow yet.

### The trigger suite, second pass (2026-08-24)

Six more cases, and two lessons that had nothing to do with the rules:

**A prompt whose subject is absent measures the fixture.** `这个目录里都有啥` in an empty temp
directory got the correct answer — "basically empty, one 0-byte file" — and scored as a rule
failure. Browsing a set of one is not browsing. `trigger-cases.txt` takes a third field now, a
seed directory, and both browse cases pass against `test/seed`. This is the third time today the
same mistake appeared in a different place: `NEEDS_WORKSPACE` in the sampler, the `History` pair,
and now here.

**A crash is not a refutation, and the harness already knew that.** One case reported `CRASH`
with an empty prompt; re-run by hand it produced a card immediately. `eval.sh` asks the session
transcript how the turn ended rather than grepping stdout, so a transient upstream error is
reported as a crash instead of a quietly-refuted rule — exactly what that check exists for, three
versions after the ones that grepped for error strings.

**All four "misses" in the 18-case run were the fixture, not a rule.** Two were prompts whose
subject is absent (`这个目录里都有啥` in an empty directory), and two used a demonstrative pronoun
with no antecedent — `比较一下这三个方案的成本` and `这个配色我想调一下`, which got the correct
reply ("there is no such thing here") and scored as failures. A standalone case has no earlier
turn, so the thing being asked about has to be named in the prompt itself. Rewritten as
`比较一下 t2.micro、t3.small、t3.medium 三种机型的月成本` and `按钮的圆角我想调一下`.

That makes **19 cards, 0 real prose refusals, 1 transient crash** — and the failure mode worth
carrying is that a trigger suite mostly measures whether its prompts can be answered at all.

`aria-live` after the move to the skill: **5 of 5**, and not all the same shape — three read files
or run commands, one streams from the model, one searches as you type. That last is the hardest
case, since results change on every keystroke, and it came back with `polite` (which queues rather
than interrupts) on a persistent scroll container, debounced. Nothing in the rule says any of that. Each puts the region on a persistent container, and
the two that can be rendered headlessly have it in their **first paint**, which is the property
that makes a live region work at all: a region that enters the DOM together with the content
announces nothing.

### Catching an error is not showing one (2026-08-24)

39 of 39 corpus cards touching `$dsh/fs` or `exec` handle failure in code — measured earlier and
recorded as a rule nobody breaks. Handling is not surfacing, so: does the reader ever learn?

| | shows the failure | rethrows to the boundary | genuinely silent |
| --- | --- | --- | --- |
| corpus (64) | 45 | 0 | **19 (30%)** |
| fresh (20) | 15 | 3 | 2 (10%) |

Then read the two fresh "silent" ones: one catches a `localStorage` write that is explicitly
non-fatal and renders `stderr` directly for the command it runs — better than a generic error
message — and the other returns `false` from an invalid glob, which is the right answer. **Zero
fresh cards swallow a failure.** Three more use a strategy no corpus card uses at all: rethrow and
let the surface's error boundary handle it.

Two measurement lessons, both mine rather than the model's: `setError` is not the only spelling
(`setErrMsg`, `setStatus("error")`, `错误`, rendering `stderr`), and a `catch` that rethrows is the
opposite of a swallow. The first pass said 60% and the real number is 100%.

### Appending to the record, correctly (2026-08-24)

Three times in one session I inserted a dated section by anchoring on a neighbouring heading, and
twice that put a 2026-08-24 entry above 2026-08-23 ones. The pre-push hook caught both — that is
the third structural gate to hold the line today, after `bun run check` and the rate audit.

`scripts/append-section.py` does it correctly: find the last section whose date is `<=` the new
one's, insert after its body. The record is oldest-first, which is not obvious from reading it,
because the most recent work is at the bottom of a 6,600-line file.

    python3 scripts/append-section.py 2026-08-24 "Title" < body.md

The fourth attempt failed differently and is worth noting: `git checkout CLAUDE.md` did not revert
the bad insert because the file was already staged, so the helper appended a **second copy** of the
same section. `no section title appears twice` caught that one. A gate that only catches ordering
would have let a duplicate through, and vice versa — the two checks are not redundant.

### The failure the reader never learns about (2026-08-24)

The 19 silent corpus cards are not spread evenly: **14 of them call `$dsh/ai`**. An AI request
failing is the likeliest outcome worth explaining, and the shape is always the same —

    } catch {}
    setLoading(false)

The spinner stops, the card is empty, and nothing distinguishes "it failed" from "it found
nothing". 44% of corpus AI cards surface a failure; the three fresh ones all do.

`SWALLOWED-CAPABILITY-FAILURE`, 15 of 378, 0 of 66 fresh, 24 screens. Three earlier versions each
fired on a card that was RIGHT, and each false positive named a form that counts as surfacing:

- state named for the failure, however spelled — `setErrMsg`, `setStatus("error")`, `错误`;
- **rendering `stderr`**, which for a command runner is better than a generic message;
- a **rethrow to the surface's error boundary** — a strategy no corpus card uses and three fresh
  ones do.

And the scope that made it usable: the `catch` must WRAP the capability call. A card catching a
half-arrived `JSON.parse` mid-stream, or a `localStorage` write that is explicitly non-fatal, is
handling something it should handle — flagging those made the first version fire on every fresh
card that was correct.

Sixth member of the prefix-unsafe set, which the file predicted before any of the last three
existed: the error handling is written after the call it guards.

### Where the corpus actually fails, ranked (2026-08-24)

The corpus's defects, ranked, after a day of adding screens:

| screen | of 378 | added |
| --- | --- | --- |
| `NO-FOCUS-RING` | 73 | before today |
| **`UNANNOUNCED-ASYNC-RESULT`** | **63** | today |
| `UNLABELLED-CONTROL` | 54 | before today |
| `UNSTOPPABLE-MOTION` | 37 | before today |
| `UNGUARDED-ASYNC-HANDLER` | 23 | before today |
| `UNREACHABLE-CONTROL` | 18 | before today |
| **`SWALLOWED-CAPABILITY-FAILURE`** | **15** | today |
| everything else (17 screens) | 1–11 each | mixed |

The two added today went in at second and seventh. Both were found the same way — not by looking
for defects, but by asking what an **unmeasured** property looks like in both populations, and
noticing the one where corpus and fresh cards were equally bad.

That is the method worth keeping. Twenty-two screens found nothing new by 2026-08-24 morning
because they were all derived from defects already known; the two that landed came from measuring
six accessibility attributes nobody had screened, and from asking whether "handles failure" (39 of
39, a rule nobody breaks) meant the reader ever learns. **A screen set converges on what it
already knows; the way out is to measure something it does not check.**

### All eighteen trigger cases pass (2026-08-24)

Both rewritten cases came back as cards:

- `比较一下 t2.micro、t3.small、t3.medium 三种机型的月成本` → card
- `按钮的圆角我想调一下，看看多大合适` → card

So the final tally across all 18 cases is **18 cards, 0 prose refusals**, with one transient crash
that produced a card on re-run. Every one of the nine trigger rules lands, and **every apparent
failure was the fixture**: two prompts whose subject was absent from the workspace, two using a
demonstrative pronoun with no antecedent, one upstream error, and one 80%-of-the-time rule
measured with a single sample.

Six failures, none of them a rule. That ratio is the finding — a suite that runs real model turns
mostly measures whether its own prompts are answerable, and reading the reply on every miss is
what separates the two. `triggers.sh` prints the workspace path for a miss precisely so that is
one command rather than a re-run.

### The regression that was a regex (2026-08-24)

Eight more properties no screen checks, measured in both populations. Five improved without a
rule (empty states 27% → 57%, truncation 4% → 24%, scroll containers 7% → 21%, tabular figures
25% → 39%, tooltips on truncated text 7% → 18%). Three looked unchanged.

The most promising was "a button that fires an async call and is not disabled while it runs" —
which came back **44% corpus, 14% fresh**. The first apparent regression of the day.

It was wrong. The regex wanted `disabled={` followed immediately by a loading-ish word, and the
cards write `disabled={loading}` where `loading` is the whole expression. Widened to count any
protection — disabling, an early return, or **aborting the previous request**, which is stronger
since the click still works and only the stale response is dropped:

    corpus: 26 of 64 (41%)
    fresh:  13 of 21 (62%)

An improvement, not a regression. And the eight unprotected fresh cards all fetch once on mount
with no user-triggered refetch, so there is no second run to guard: **21 of 21 are correct.**

Worth recording because of what nearly happened. A regression is the most consequential thing a
measurement can report — it argues for reverting a rule — and this one existed only in the regex.
The check that caught it was reading a card that the measurement called wrong, which is the same
move that fixed the error-handling number an hour earlier (60% → 100%). **Any surprising result
gets one card read by hand before it gets written down.**

### Two more candidates, both correctly rejected (2026-08-24)

The other two unchanged properties, checked the same way and both correctly rejected:

**`key={index}`** — 29% corpus, 33% fresh. Already investigated and rejected once (95 of 378 looks
compelling; narrowed to lists that actually reorder it is 2). The fresh instances are the same
shape: `gen19-3` keys highlighted substrings of a search match by position, where the index names
the same segment forever.

**A number field with no `min`/`max`** — 61% bounded corpus, 50% fresh. The unbounded ones are
height and weight inputs. A hard maximum on a person's weight is presumptuous, not careful, and
`UNGUARDED-NUMBER-INPUT` already covers the failure that does bite (`Number("")` → 0).

So of eight unscreened properties, five improved without a rule, two are non-defects, and the
eighth was a measurement error. **The vein that produced two screens this morning is worked out**
— which is itself the useful signal: the next screen will have to come from a population these
measurements do not cover, not from another pass over the same 378 cards.

### Every disposable resource, audited (2026-08-24)

The fresh cards are a population of their own now, and they reach for APIs the corpus never used —
so: every resource that needs releasing, and whether the card releases it.

| | corpus | fresh |
| --- | --- | --- |
| `setInterval` → `clearInterval` | 31/31 | 5/5 |
| `setTimeout` in an effect | 22/25 | 5/6 |
| `addEventListener` | 3/3 | 1/2 |
| `requestAnimationFrame` | 0/1 | 4/7 → **7/7** |
| `ResizeObserver` | (none) | 2/2 |
| `createObjectURL` | (none) | 1/1 |

The rAF row is the fourth measurement error of the day caught by reading a card. All three
"uncancelled" ones are a **single-shot** rAF restoring the caret after a controlled-input update —
`requestAnimationFrame(() => { el.selectionStart = start + 2 })`. It fires once; there is nothing
to cancel. Counting them as leaked loops is the same category of mistake as counting
`disabled={loading}` as unguarded.

`ResizeObserver` is genuinely new — 0 corpus cards, 2 fresh — and both disconnect from the
effect's cleanup. New API surface, handled correctly on first contact, with no rule mentioning it.

The `addEventListener` row went the same way on reading: the one "unremoved" listener is
`signal.addEventListener("abort", …, { once: true })` on a per-request `AbortSignal` — it removes
itself, and the signal is garbage after the request either way. More precise than a manual
`removeEventListener`, not less.

**Every row is 100% once read properly.** Which is the real finding: resource teardown, the thing
a React card is most often accused of getting wrong, is not a defect area in either population —
and two of the six rows only looked like defects because the measurement did not understand the
idiom.

### Read one card before believing a measurement (2026-08-24)

Four times today a measurement said something was wrong and reading one card said otherwise:

| the claim | the reality | what the regex missed |
| --- | --- | --- |
| 60% surface errors | 100% | `setErrMsg`, `setStatus("error")`, rendering `stderr`, rethrow |
| 7 of 9 show loading | 9 of 9 | `正在统计项目文件…` — the check was English-only |
| async guards **regressed** 44%→14% | improved 41%→62% | `disabled={loading}`, and abort-previous |
| rAF leaked in 3 cards | 0 leaked | a single-shot rAF has nothing to cancel |

Every one was a false alarm, and every one would have been written into the record as a finding.
The third is the dangerous one: a regression argues for reverting a rule.

The common shape is not carelessness with regexes — it is that **a measurement encodes one
spelling of a correct answer and the model knows several.** `setError` is the spelling I thought
of; `setStatus("error")` is better. A manual `removeEventListener` is what I looked for;
`{ once: true }` is more precise. Rendering `stderr` beats a generic error message.

Working rule: **any surprising result gets one card read by hand before it is written down.** A
result that confirms what you expect can wait; a result that would change a rule cannot. Cheap
enough that there is no excuse — it is one `grep -A3` — and it caught four out of four today.

This is also why the checked-in screens survive and my ad-hoc scripts did not: a screen goes
through `screens-quiet-on-fix.test.ts`, which forces writing down what a card doing it RIGHT looks
like. Every false positive above would have been caught by that discipline; none of these
throwaway measurements had it.

### A number worth recording is worth a script (2026-08-24)

The strongest claim in this record — *no corpus card in 378 carries three accessibility signals,
most fresh cards do* — came from a throwaway script that no longer existed when the set grew, and
the figure went stale within the hour ("43 of 60" against a set of 67).

Two fixes, in the right order.

**Automate the total.** `bun run audit` now checks every `N of <total>` written about the fresh
set against what the set actually holds. It found the stale figure on its first run. Only the
denominator is checked, deliberately: `43 of 67` passes with a right total and a wrong count,
because nothing knows what 43 counted. A total moves whenever a batch lands and is worth
automating; a one-off count has to be re-derived by whoever doubts it.

**Make the count re-derivable.** `fresh-rates.ts` prints the histogram itself, for any directory:

    bun scripts/fresh-rates.ts /tmp/corpuscards
    0 of 378 carry three or more accessibility signals (0→337 1→35 2→6 3→0 4→0)

    bun scripts/fresh-rates.ts
    47 of 67 carry three or more accessibility signals (0→2 1→2 2→16 3→37 4→10)

The rule this suggests: **a number worth putting in the record is worth a script that prints it.**
Not every number — most of today's measurements were one-offs answering a question that stayed
answered. But the ones quoted as evidence for a claim, and the ones that move as the sets grow,
need to be one command away or they rot within hours. Four of the day's numbers went stale in
under a day; the audited corpus rates never did.

### The one fresh card with real defects (2026-08-24)

`gen24-log.tsx` — the log viewer from the `aria-live` A/B — fires two screens, and reading it
confirms both:

- **`UNREACHABLE-CONTROL`**: `<div className="lv-row" onClick={() => onCopy(line)} title="点击复制">`.
  Click-to-copy on a virtualised row, with a tooltip and no keyboard path at all.
- **`UNGUARDED-ASYNC-HANDLER`**: three async handlers, two carrying an `AbortSignal` properly, and
  a third — a mount-time `find` populating the file picker — with none. Its `setFileCandidates`
  can land after unmount.

Worth writing down because it is the counterexample to a day of clean fresh cards. The card is
long (the largest generated today), does several things at once, and gets the guard right twice
and wrong once. **Rules land per-construct, not per-card**: the same file threads a signal through
two handlers and forgets on the third.

It is also the card that needed `react-window`, so the paint check skips it — a card that is both
screen-flagged and renderer-invisible, which is the combination with the least evidence behind it.

