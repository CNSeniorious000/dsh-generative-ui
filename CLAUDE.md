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

### 2.35 The `minimal` agent preset silences the whole Node half, and the client half survives it

Two user-supplied transcripts, same machine, same plugin, different preset:

| | `standard` | `minimal` |
| --- | --- | --- |
| system prompt | 27524 chars | **45 chars** |
| tools | 25, including `skill` | **2** (`bash`, `str_replace_editor`) |
| `ui4a` in the request header | 6 | **0** |
| `canvas` in the request header | 8 | **0** |

`config/agent-presets/minimal/agent.cordis.yml` says why, in its own comment: the persona carries
`complete: true`, and *"the persona is the complete system prompt, so global identity, Web
orientation, tool guidance, and **later assembly listeners cannot add prompt text**"*. Our resident
section is exactly a later assembly listener (`ctx.systemPrompt.section()`), so it is dropped. The
skill is unreachable for a second, independent reason: the `skill` TOOL comes from the preset's own
`tool-skill` row, which `standard` has and `minimal` does not.

**The client half is unaffected, and that is measured, not inferred.** `src/client/index.ts`
injects only `slots` and `sessions` — both from the host composition, not the preset — and
`claimInlineFences` matches on rendered CONTENT (§3.5), never on a language tag or a prompt.
Verified in a real `dsh web` switched to 极简模式: asked to echo a four-backtick `ui4a/tsx` block
verbatim, the reply rendered as a card (a11y tree showed `heading` + `paragraph`, not a code
block), and the canvas launcher was still in the corner. So under `minimal` the model does not know
the format exists, but a user who dictates one still gets a rendered card.

**Putting it back is a preset copy, not a prompt change.** The instinct is to write the triggers
into `SKILL_DESCRIPTION` so the model loads the skill itself — but under `minimal` there is no
`skill` TOOL to call, so no description reaches anything. Both blocks have to be lifted, and both
live in the composition. Measured end to end:

    cp -R <dsh>/config/agent-presets/minimal ~/.dsh/.agent-presets/minimal-ui4a
    # in agent.cordis.yml: delete `complete: true`, append two rows —
    - id: skill-filesystem
      name: '@deepseek-ai/dsh-skill-filesystem'
    - id: tool-skill
      name: '@deepseek-ai/dsh-tool-skill'

`$DSH_HOME/.agent-presets` is the user root (`includeUserRoot` defaults true) and does not exist
until the first local preset is written. The new entry appeared in the composer's preset menu on
the next `dsh web`, and a session on it answered `帮我算下等额本息月供` with **a card**: the
transcript shows `上下文注入 · skill-catalog` and `Skill · generative-ui`, the input was **29.1K
tokens** where plain `minimal` would be a few hundred, and the reply rendered a mortgage panel with
the right figure (4,890.17), three stat blocks and three live inputs.

dsh ships a `创造模式` preset whose whole purpose is authoring these, which is the supported path
for a user; the copy above is the same thing done by hand.

Nothing to fix in the plugin: `minimal` is doing exactly what it says. Worth knowing before
debugging a report that "the plugin does nothing" — ask which 模式 the session was on first.

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

**UnoCSS generates the cards' CSS in the browser, and the panel's own CSS is still hand-written.**
`panel.css` (compiled into `panel-css.ts`) styles the chrome; everything a *card* writes goes
through `src/client/runtime/uno.ts`, which runs a real generator against the classes in the code
that just arrived. A build-time pass cannot do it: those classes are typed by the model seconds
ago and exist in no stylesheet of ours. Responsive is where that shows worst — a build-time sweep
generates no `@container` breakpoint at all, so every card is single-column at any width.

Four things about that setup are load-bearing, each measured rather than assumed:

- **`important` takes a SELECTOR STRING, and that is the scoping mechanism.** Every rule comes out
  `.ui4a-root :is(.gap-4){…}`. The runtime sheet is appended to `<head>` last, so an unscoped
  `hidden` from a card would beat the shell's own and make part of the app vanish — the playground
  has exactly that bug on record.
- **`preflights: { reset: false }`**, because presetWind4's reset is 3.5KB of `*, ::before,
  ::after { margin: 0; border: 0 solid }` aimed at the HOST's DOM. The `theme` layer survives it
  and is the half we need: `--spacing` is defined there and every `gap-*` / `h-*` / `p-*` resolves
  against it. Dropping preflights entirely makes those rules generate and compute to nothing.
- **Form controls need their own scoped reset.** With the vendor reset gone, a `<button>` keeps the
  UA's `buttonface`, which is not theme-aware: measured in dark mode, two unselected buttons
  rendered as light grey blocks with black text while the rest of the card was dark.
- **A merged vendor rule has to be split, or Chromium drops the half it understands.** UnoCSS
  merges selectors that share a declaration, so a card styling a slider for both engines produces
  `…::-moz-range-thumb, …::-webkit-slider-thumb { height: … }` as ONE rule — and one unrecognised
  pseudo-element makes the browser discard the whole list. Measured on a real card: 75 of 87 rules
  survived parsing, the slider computed to `height: 0px`, and three controls were simply not
  there. Order is irrelevant; either vendor first gives zero surviving rules. The model writing
  both prefixes is correct, so `splitVendorRules` in `uno.ts` fixes it at generation time. **This
  is the shape to fear here**: it compiles, it renders, no screen fires, and only reading
  `getComputedStyle` off the real element shows it.

`ui4a-playground` runs the same design (`ui4a-playground/src/runtime/uno.ts`) and our file is a
port of it — diff the two rather than skimming, since ported files drift (§5).

**Responsiveness comes from the container, not the viewport.** The same block renders in a chat
column and in a panel the reader drags between 320 and 720px. `GenUISurface` gives the mount node
`container-type: inline-size` and the prompt teaches `@[30rem]:` prefixes. Measured: without
`container-type` the guarded declaration is simply inert, which reads as the model writing
something bad rather than as a missing container.

The trap still waiting: the host themes by ancestor (`body[data-ds-dark-theme]`), so if a rule
ever needs the theme in its selector, the scoping rewrite has to **hoist** it — `.dark .foo` →
`.dark .ui4a-root .foo` — and prefixing without hoisting breaks the moment the theme flips.

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

## 3.7 Colors: name the tokens, in the spelling the model will write

Generated UI doesn't know the host is dark by default and will paint white cards onto a dark app.
The fix isn't runtime CSS rewriting — it's **naming the host's semantic tokens in the prompt** and
stating flatly that literal colours are never allowed. Measured on the inline-`style` era of that
rule: 106 token uses across the generated code, zero literal hex.

Since the UnoCSS switch the tokens are named as **classes** (`bg-layer`, `text-muted`,
`border-line`, `bg-accent`) mapped in `uno-config.ts` onto the same twelve `--dsw-alias-*`
variables. Two consequences worth keeping: a card can still reach any variable through an
arbitrary value (`bg-[var(--dsw-alias-bg-base)]`), and **`brand-primary` deliberately has no short
name** — it is a foreground colour that 50 of 378 corpus cards used as a fill, and leaving it out
of the map makes the commonest colour defect unspellable rather than merely discouraged. The two
screens that used to read `background:` out of a style object are blind to class syntax and were
replaced (`HARDCODED-COLOUR-CLASS`, `BRAND-PRIMARY-FILL-CLASS`); a probe confirmed the old pair
fired on neither `bg-[#fff]` nor a fixed-palette ramp.

**A colour name that collides with a Wind4 utility wins, silently.** The map used to call the
page ground `base`, so `text-base` — Wind4's *body font size*, and the commonest way a card writes
body text — resolved to `color: var(--dsw-alias-bg-base)`, which is `#ffffff` in light. Measured
live on a wave-2 card: `<h2 className="text-base font-semibold">` computed `color #ffffff`,
`font-size 24px`, `opacity 1`, sitting on a white card. The title was present, laid out, and
invisible; the shot showed an empty top row and **no probe could see it** — it does not overflow,
it is not crushed, the text is in the DOM. 18 corpus cards wrote `text-base`. Renamed to `page`
(8839ffb) with a test that every `text-<size>` still generates `font-size`. Any colour name added
later has to clear the same bar.

**In light theme the three background tokens are all pure white.** Measured on the real harness
at 440, computed values:

    light   base #ffffff   layer #ffffff   layer-2 #ffffff
    dark    base #151517   layer #232324   layer-2 #2c2c2e

So a card that separates a nested panel from its parent with a background token has *no*
separation in light and looks right in dark — the host's light theme separates with borders and
its dark theme with fills. Three of the five judges found this independently on wave 2 and read it
as a card defect ("`bg-layer-2` melts into the card"); it is not, and the model cannot know it.
Anything nested needs `border border-line` to read as nested. `bg-layer-2` stays correct for a
HOLE (an input, a well) because the border there carries the shape anyway — which is also why the
"an input is a hole in a surface" rule has been landing: the border was doing the work all along.

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
- **The types this package ships for CARDS are not the types it ships for ITSELF, and a registry viewer will say so.** `types/*.d.ts` are the `$dsh/*` facades the checker's `-i` flag points at (§4.5); they describe what generated code may import, not what a consumer of this package imports. So `lib/` carried no declarations at all and npmx flagged `✗ Types` on 0.0.1 — correctly. Every dsh plugin on npm ships them (`@deepseek-ai/dsh-base` and `dsh-client-locale` both publish `exports["."].types → lib/types/index.d.ts`), so this was our drift, not a house style. Emitting them takes a second tsconfig: the base one sets `allowImportingTsExtensions`, which REQUIRES `noEmit`, and the two are reconciled by `rewriteRelativeImportExtensions` (it rewrites `./x.ts` to `./x.js` on the way out, which is what an emitted `.d.ts` must reference) plus an explicit `rootDir`, without which tsc refuses with TS5011. `types` must also come BEFORE `default` in each `exports` entry — resolution takes the first match.
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
  it. **This entry used to forbid `usePersistedState`, and that is no longer true** — the denial was written when
  `$dsh/state` did not exist here, then the model kept importing it anyway (five of six habit-tracker runs, and a
  reworded denial did not stop it), so `bindings.ts` implements it: `useState`'s signature, `localStorage` behind
  it, no host needed. The prompt now teaches it. Kept as a correction rather than deleted, because the lesson is
  the general one: **when the model reaches for the same missing API run after run, implementing it beats
  rewording the refusal** — and a stale prohibition costs more than the thing it forbids, since it sends the next
  reader to remove working code.
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

## 6. What five days of measuring established

`docs/measurements-log.md` is the raw session-by-session record — 8,000 lines of it, kept for
provenance. This section is what survived: each lesson once, with the measurement that earned it.
**Add findings here, not as another dated section**; if a new one is a fresh instance of a lesson
already below, add its number to that lesson and stop.

### 6.1 Every measurement lied at least once

Twelve times a metric said something plausible and false. The failures share a shape worth
recognising before trusting any number in this project.

| what looked true | what was true | the tell |
| --- | --- | --- |
| a rule failed, `fence=0` | it wrote a **canvas** | count canvases too |
| a commit caused a regression | one flap in seven | repeat the *old* side as well |
| a rule did not generalise, 0/9 | the plugin symlink was dead | check the subject ran |
| a rule was refused, six zeros | `QUOTA: Insufficient Balance` | short well-formed output is suspicious |
| a card's state was broken | a bare `.click()` unlocks nothing | drive it as input |
| a card remounted while visible | the probe matched any `return (` | a helper component has those too |
| a gate was broken, exit 0 | `cmd \| tail; echo $?` reads `tail` | never pipe when the code is the measurement |
| sonnet refused a fixture | gateway 400, empty reply | a transcript exists before the model answers |
| the whole eval batch timed out | the upstream stalled, `bytes=0` | `assistant/chunk` present or absent |
| a verification run learnt the wrong rule | it ran a build from two minutes earlier | `stat -f %Sm` session vs `lib/` |
| a `min-width` fix did nothing | `<input>` sizes from `size`, not placeholder | construct the trigger, verify it triggers |
| the panel found a redundant border | light paints every layer `#fff` | render it before believing it |
| a whole wave of runs stalled upstream | `$LITELLM_24000_API_KEY` was unset | a live process writing nothing |
| the wave was not running at all | `find -newermt` errored, piped to `wc` | run the check unpiped, read its exit |
| a card truncated with 800px to spare | the ellipsis is in the DATA | `scrollWidth > box`, not the pixels |
| 4 of 6 sliders forgot their fill | all four are "pick a value", which must NOT fill | read what the number means |
| the canvas paint rate fell 100% -> 86% | 5 canvases re-snapshotted 17 times, 2 of them my own harness | dedupe by (run, canvas id) first |

**A canvas is counted once per turn it changes, and three of the five ways to fail are not the
card's.** Reading r002's 17 unpainted canvases end to end: they are **5 distinct canvases**, each
re-snapshotted 3-6 times, so a 14-point "regression" in the pooled paint rate is four numbers wide.
Of the five, three are genuine model defects (`import { write } from "$dsh/state"` — an export that
does not exist; `low is not defined`; `@radix-ui/react-tabs` imported as `TabList` when it exports
`List`/`TabsList`) and **two are the harness**:

- `sort-compare.ui4a` imports `./quicksort-trace.ui4a`. Production inlines sub-pages into child
  blob URLs (§3); `eval/card-driver.mjs` mounts the source raw, so a split canvas can only ever
  score unpainted there. One card in three rounds, named here rather than special-cased in code.
- `diet-log.ui4a` imports `@number-flow/react` and scored unpainted on **four** consecutive turns
  with `errs=[]` — then painted 1434px within one second when re-mounted later on a machine that
  reached esm.sh. A bare specifier that fails to fetch kills the module graph silently (§4), which
  is indistinguishable from a card that renders nothing. **An unpainted card with an empty error
  list is network-suspect until re-mounted**; one with a message in it is the card's own fault.

So the paint rate splits the way the pooled number cannot: fences 98.3%->97%, canvases the rest. And
`eval/delta.py` reports the two arms separately for that reason — pooled it reads -0.054 ± 0.024 and
looks decisive, split it is -0.025 ± 0.023 and -0.137 ± 0.081 and neither arm clears 2 SE on its own.

**A sixth class, found by reading 29 cards' screenshots in one sitting: the pixels are real and
the intent is inferred.** Five times in a day I read a defect off a shot that did not survive one
look at the source — and the fifth time I nearly rewrote a working probe to match the misreading:

| what the shot showed | what it was |
| --- | --- |
| a filled form with a disabled button | four `placeholder="30"` on empty fields |
| five cards celebrating going over a limit | the user is eating UP TO a target — green was right |
| `truncate` firing with 800px to spare | the ellipsis is a literal in the data |
| a pending row logged as `0` | `value=""` with `placeholder="0"` — the total was correct |
| 1100px of wasted width | a justified header reaching 704 of 720 |

A CSS ellipsis and a typed one are the same pixels; a placeholder and a value are the same pixels;
correct green and wrong green are the same pixels. **When a shot suggests a defect whose evidence
is what the pixels IMPLY rather than what they ARE, the source or a DOM probe settles it in a
minute** — and a probe's silence is often the correct answer to the question it asks, not a gap.

Four properties they share: **the failure and the interesting result are identical at the metric**,
so repetition does not help; **the wrong answer is the alarming one**, which is the direction that
gets written up; **a check written for one has a blind spot for the next**; and **the tell is never
in the number** — it is in the byte count, the first line of the reply, whether a transcript exists.

Hence `scripts/eval.sh` prints `skill=`, `bytes=` and `tools=[]` beside every verdict, and a zero
is not evidence until the reply behind it has been read.

**A first-pass detector over-reports by roughly an order of magnitude, in the direction you
expected.** Six times: streaming guards 7→0, remounts 35→0, hardcoded colours 80→2, nested borders
130→unmeasurable, `UNREACHABLE-CONTROL` 41→18, `flex:1` rows 97→(unscreenable). The regex encodes
the shape of the mistake and knows nothing about the shapes of correct code around it. **Never
report a count from a new detector without reading every hit**, or a sample past a dozen.

### 6.2 What makes a prompt rule land

Measured across ~300 model runs. The pattern is consistent enough to use as a checklist.

- **Show the fix as code, not as a consequence.** Identical content, one variable: the undo rule as
  prose ran 0 of 2 eligible runs, as a code block **2 of 2**. Across the skill, rules shown as code
  land at 88–100% (`prefers-reduced-motion` 102/109, `:focus-visible` 100/113, `exitCode` 18/19)
  and rules described in prose land at 0–7% (`AbortController` on a poll: 0/11). If a rule is not
  landing, the question is not how to say it more clearly — it is whether the model must write
  anything to obey it that the rule does not already show.
- **Name a shape visible in the code being written**, not a property of the answer. `conditional
  background inside a .map` works; "a process rather than a rule" does not, because the model has
  to fetch the answer to apply it and by then the shape is decided. Two rewrites keyed on the
  answer were reverted for net-negative results.
- **A rule must not contain a recognisable negative.** Naming the phrasings that fail hands the
  model a rule for failing — `二分查找的原理` went 0/6 while the rule said that phrasing usually
  does not warrant a card, and 6/6 once the negative was removed. Same defect in a header: `**A
  border or a background, never both**` with the exception in the body was matched on the header
  by five judge models and would be by any reader.
- **A recipe is followed as a recipe.** `display: block; width: 100%; text-align: left` was written
  for one layout; cards reaching for `display: flex` took none of the three, including the
  `text-align` that mattered. The rules that transfer name one property and why it is needed.
- **Widening the skill's own description does not widen what loads it.** Naming five concrete
  shapes in `SKILL_DESCRIPTION` — a markdown table, doses that vary by age, a numbered option set,
  anything the user is logging — moved the load rate on real questions from 3/11 to 2/10: nothing,
  or slightly worse. The description is what the model reads *while choosing among skills*; a
  question it never classified as UI-adjacent never gets that far. The lever is the resident layer,
  which is read on every turn.
- **Where a rule lives decides whether it is applied.** `aria-live` in `prompt.ts` alone: absent.
  The same text moved into the skill, next to the other JSX-attribute rules: present, replicated on
  two prompts. The resident layer is read before deciding *what* to build; the skill is read while
  building.
- **A skill rule can only reach the runs that load the skill**, which was 62% until one sentence in
  the resident layer named what the skill carries *after* the decision to build — then 17 of 17,
  and the residue on every screen went to zero. The skill-load rate is part of the measurement, not
  context: 4 of 4 runs that loaded it followed the rule; 0 of 2 that did not.
- **The cleanest flip this project has measured, and what made it measurable.** The rule "if your
  last answer restated a running total, the answer was already a card" went **0 of 18 → 5 of 8** on
  the same six conversations and the same three models, with the prompt as the only variable.
  Three things made that readable rather than suggestive:
  - **The baseline was an absolute zero, not a low rate.** 18 runs, 0 fences, 0 canvases, 0 skill
    loads — while 17 of those 18 replies carried a markdown list, half of them eight rows or more.
    A rate moving from 2 to 5 is noise; a rate moving off zero is not.
  - **One sample in the set was supposed to stay prose, and did.** `oki ha calorie?` — asking what
    a single food costs, in a conversation that happens to be tracking calories — stayed 0 of 3
    after the change. Without that control the result reads equally well as "the model now builds a
    card whenever it sees a number".
  - **The model quoted the mechanism back.** *"ya no necesitas que te vuelva a escribir toda la
    lista cada vez"* — the rule's own sentence, in the model's words, in the reply that then built
    the canvas. §4.5 records the same tell on `v-bmi`; it is the difference between a rule landing
    and a rate drifting.
- **A trigger rule has a rate, not a verdict.** One run decides nothing (`98 华氏度` reads 0/1 and
  4/5). With ~30% of runs skipping the skill, a nominal three-run test yields about two eligible
  samples — enough to see never→always and nothing smaller.
- **Measure on the models dsh actually runs.** Every number in this section up to 2026-08-24 was
  taken on `macaron-v1-tall`, which is small; a rule that helps it may be patching around the model
  rather than teaching it anything, and is not worth carrying into the prompt for that. The models
  worth optimising for are `macaron-v1-venti`, `macaron-v1-coding-venti` and `glm-5.2`. One eval
  home per model (`~/.dsh-eval-<model>`), and check `settings.yaml` there is a real file rather
  than the symlink the bootstrap makes — otherwise every home shares one model and the comparison
  is between a model and itself.
- **Every rate above was measured on prompts written to test a rule, and real user questions are a
  different distribution.** 11 first-turn questions pulled from the warehouse — a recipe, period
  cramps, protein powder for a child, a comparison of two cell types, "what date was last week
  Thursday" — loaded the skill **3 times and produced one card**. Not one of them asks for an
  interface; they are short, multilingual, and conversational, and the model answers them in
  markdown without ever reaching the decision the skill exists to make. A rule measured at 100% on
  a written prompt can be at 0% here simply because nothing loads it. Sample the corpus, not the
  test set, before believing a trigger number.
- **A corpus turn is unintelligible without the turns before it, and so is the judgement about
  it.** `nah bro that is from today` is a diet-log correction only because the previous ten turns
  were adding up calories; `Yeah. What should Bailey eat?` looks like a nutrition question and is
  the tail of a conversation about complimenting someone's sister. Sampling first turns to dodge
  the problem measures a distribution no user is in — real turns arrive mid-conversation. The
  warehouse carries `previous_ten_turns_summary` beside every row; both the labelling and the eval
  have to use it, the latter as clearly-marked prior context rather than replayed as fake turns
  the model would then believe it had said.
- **`fence=0` has two causes and only one of them is a model getting it right.** Measured on a
  calorie-log turn: six runs across three models each answered with a 7-to-9-line markdown table —
  per-item numbers, a total, a range — and not one loaded the skill. That is not prose winning a
  judgement; it is a card written in the wrong language. `scripts/score-wave.py` counts list and
  table rows in the reply for exactly this reason, because every earlier eval here stopped at
  `fence=0` and recorded it as "no UI wanted".

### 6.3 What the cards get wrong

Screens are pure text predicates over a card's source; `scripts/corpus-rates.ts` prints every rate,
which is why none are transcribed here. The distribution is the finding:

**Two thirds of defective corpus cards fail on accessibility and nothing else** — 117 of 178. The
rest is a long tail of one card each. Cards were rarely broken; they were routinely unusable
without a mouse, because a card is written as a *picture* of an interface and the author has a
mouse and eyes.

The largest single delta after the rules landed: `:focus-visible` appears in **0 of 378** corpus
cards and in 66 of the first 77 written after. A behaviour absent from an entire prior distribution
cannot appear by sampling luck. `prefers-reduced-motion` went 7/130 → 52/52.

Three things the model has always got right, before any rule existed: capability failure handling
(39/39), `sendMessage` recording its own result (31/31), and never using `100vw` or `position:
fixed` (0 of 378). **The gap was never structure or plumbing** — it was people not looking at the
screen or not holding a mouse.

### 6.4 A checker that has not been fooled is not a checker

Every gate here has been wrong in a way that reported success:

- **`compile-cards.ts` counted failures and never exited on them**, while pointing at a directory
  that no longer existed — crashing with ENOENT and reporting ok.
- **`smoke.ts` registered six effects and ran none of their disposers**, then reported "4 of 6"
  because it counted the two that could not run there as clean.
- **`paint-cards.ts` skipped 120 of 378 cards** for unresolvable imports and printed `ok`, one of
  them a reference card inside `bun run check`.
- **`mutation-audit.sh` could not see a third of the source** (a two-directory glob, `.ts` only)
  and printed "every condition is constrained".
- **`compiler.test.ts` never imported `compiler.ts`** — it re-assembled the pipeline and asserted
  a re-implementation agrees with itself. Blanket-mutating every `return` left it green.
- **A traversal test that could not reach a file** passed with the fence deleted.

So each screen now answers three questions, one test apiece: does it fire on the defect
(`test/cards-negative/`), does it stay quiet on the fix (`screens-quiet-on-fix.test.ts`), and does
any real card exercise it (`screens-exercised.test.ts`). **"No failures" has two causes that look
identical** — nothing is wrong, or nothing was examined.

Two rules fall out. **Write the count of what you skipped next to the result**: every gate that
ever lied did it by omission, never by a wrong answer. And **an exemption should be a consequence
of something, not a claim about it** — where that is impossible, print the exempted items, because
a name can be checked at a glance and a number cannot.

### 6.5 Verification has to take the path production takes

Twice the checker and the runtime diverged, once in each direction, and neither showed up as a
wrong answer: `compile-cards.ts` was **stricter** than production (no streaming fallback, so a
working card read as FAIL) and `paint-cards.ts` was **looser** (no normalize, so 18 cards that only
import because normalize repairs them were never rendered). `test/mirrors-production.test.ts` now
fails if a script compiles a whole card without `compileSettled`.

**When a checker and reality disagree, suspect the checker.** An hour went into bisecting a card
that was never broken.

**The screenshot pipeline can only measure a card whose content is in its source**, and that
fraction is falling because the skill is working. Wave 2 was 100% literal data; wave 3 is 5 of 11,
the rest reaching for `usePersistedState` or `$dsh/ai` as the skill asks. A persisted card's shot
is its genuine first-run screen, which is fair. A streaming card's is not: `surface-harness.ts`
now forwards `$dsh/ai` to a real model (501, never a canned success, when no key is configured),
but the shot is taken a second after mount and glm-5.2 spent **7432 reasoning characters before
its first content token**, so the picture is the loading state. Two settle heuristics were tried
and both reported success on the spinner — three equal heights (the loading panel is the same
height as the list that replaces it) and height+text-length (nothing had started, so stillness
before and stillness after are identical samples). `judge-cards.py` therefore skips any card
importing `$dsh/ai`, by name. Canned data is worse than exclusion, not better: these cards feed
the stream to a `partial-json` parser against a schema their own prompt declares, so a generic
`{items:[…]}` fills one field per row and photographs as a layout defect.

The layers, and what each can see:

| | catches | cost |
| --- | --- | --- |
| screens (`screens.ts`) | known defect shapes in source | 0.27ms for all of them |
| `compile-cards.ts` | syntax the model cannot ship | ~2s / 378 cards |
| `paint-cards.ts` (`react-dom/server`) | 7 of 9 blank-render causes | ~2s, no browser |
| `render-cards.ts` (Chromium) | the other 2 — React #321, effects | minutes |
| `mount-card.sh` | what a card *announces* (a11y tree) | ~15s / card |
| `judge-cards.py` (5 vision models) | **what it looks like** | ~2min / card |

The expensive one is what proves the cheap one looks at the right thing. Compiling proved 375 of
378 fine; mounting found 10 failures; a screenshot found a reference card whose 4×4 board had every
cell overlapping the next by 91% — clean under 30 screens, painting, announcing correctly.

### 6.6 The judge panel is a source of hypotheses

Five vision models grading six screenshots per card (320/440/720 × light/dark) plus the TSX.
**No card scored above 6 of 10.** They agree on rankings, and on 2048 all five independently found
the overlapping board, three of them finding more than I had.

Of their four recurring criticisms, **one survived checking**:

| theme | verdict |
| --- | --- |
| the slider is unstyled | **right** — 43 of 52 corpus cards, and no rule existed |
| border + background is redundant | wrong for these tokens — light paints every layer `#fff` |
| 720 is a dead single column | sampling — the set had nothing to put in columns |
| dark is light inverted | false premise — cards reference tokens, not palettes |

**Wave 2 is 26 runs, not 72, and they are all one family.** `score-wave.py` counted files, and 46
of that wave's 72 said `stale  src/ is newer than lib/` — runs that never reached a model, each
scored as `skill=no card=no`, i.e. as the model deciding against a card. Corrected, the wave reads
**26 runs, skill 100%, cards 100%, markdown-instead 0%, turns 00-03, every one of them 饮食**. So
no cross-family or trigger-rate claim can come out of wave 2 at all; what survives is everything
derived from the 26 cards themselves (the panel below, the screenshots, the paired `text-base`
delta, the reflow ratios). Both the runner and the scorer now test for eval.sh's one success
shape (a line starting `skill=`) rather than enumerating failure strings — the leak that started
this was `bash: ./scripts/eval.sh: Operation not permitted`, which is on nobody's refuse-list —
and the scorer prints every excluded run by name, because a count of skipped runs can only be
believed where a list can be checked.

**Second run, wave 2** (24 cards, 117 scored verdicts, mean 5.45 sd 0.94). No ranking claim:
the three generators land at 5.12–5.67 with SE ≈0.15, judge self-variance is ≈2.0, and 6 of the 8
overflowing cards belong to the lowest-scoring family, so its mean is confounded with a defect
that turned out to be mine. What the panel was worth was its *prose*:

| theme | verdict |
| --- | --- |
| `bg-layer-2` melts into the card in light, fine in dark | **right, and not a card defect** — measured `#ffffff` for all three background tokens in light. Recorded in §3.7; the model cannot know it |
| `max-w-[34rem]` wastes 180px at 720 | **half right.** Four judges got the fact from the SOURCE while I read the same screenshot and saw a full-bleed form — the clip is taken at the host width, so unused width has no visible edge, and `shot-card.mjs` now reports `UNUSED`. But the *verdict* was wrong on the card I then looked at: five meal rows stretched full-bleed put a name and its number a screen apart, which is exactly what §Width's `max-w-[28rem]` rule exists to prevent. Unused width is a signal to look, not a defect to minimise |

**The `text-base` fix, measured against its own control.** Re-shot and re-judged wave 2 — same 27
cards, same source, same five models, only the rendering fixed — and split the cards by whether
they write `text-base`:

| | n | mean delta | |
| --- | --- | --- | --- |
| cards that write `text-base` | 12 | **+0.45 ± 0.16** | 8 up |
| cards that do not | 10 | −0.01 ± 0.08 | 4 up |

The control group did not move at all, and several of its cards drew the *identical* score from
every judge twice. That is what makes the +0.45 readable: the panel's spread is ~2.0 and the
pooled delta was a meaningless +0.23, but paired and split by exposure it separates cleanly.
`scripts/judge-delta.py` does the paired read and refuses to call anything significant below 2 SE.

**A row split wide is not a defect — measured, and it looked like one.** Two cards for the same
food-log turn, from two models, both 5.5/10, both put a meal name at one edge and its kcal at the
other with 400px of 720 between them. That is the failure §Width already names, so it read as a
rule that exists and is not landing. `shot-card.mjs` grew a `STRETCHED` probe to count it, and the
count says otherwise: of wave 0's 22 cards the 9 it fires on average **6.08** and the 13 it does
not average **5.96**. The widest split in the wave — 4 rows at 567px of 720 — scored 6.62, above
the median; the wave's worst card at 1.25 is not flagged at all, because it threw before rendering
anything to split. An ingredient table at 455px reads fine, because its quantities line up as a
right-aligned column the eye runs down; a food log at 407px does not, because there is nothing to
run down. Geometry cannot separate those, and the two cards that started this were marked down for
empty vertical bands and thin content — the stretch came along for the ride. The probe stays as a
signal to look at, on the same footing as `UNUSED`; it is not evidence for a prompt rule.

**Which judge, measured — the panel is four rulers, not four opinions.** Waves 0 and 1 on the
rebuilt corpus (45 cards with all four judges, 180 scored verdicts) give a mean of 6.01 and 6.50.
The between-wave gap is the noise floor, not a result: same prompt, different questions, 0.5 apart.
What is stable is the *offset* — every pair holds its direction on 38 to 43 of the 45 cards:

| pair | mean delta | sd | same direction |
| --- | --- | --- | --- |
| `claude-opus-5` − `grok-4.6` | −0.11 | 0.71 | 38/45 |
| `claude-opus-5` − `gpt-5.6-sol` | −0.62 | 0.82 | 42/45 |
| `claude-opus-5` − `gemini-3.7-flash` | −1.11 | 0.92 | 42/45 |
| `grok-4.6` − `gpt-5.6-sol` | −0.51 | 0.69 | 43/45 |
| `grok-4.6` − `gemini-3.7-flash` | −1.00 | 0.88 | 43/45 |
| `gpt-5.6-sol` − `gemini-3.7-flash` | −0.49 | 0.73 | 40/45 |

Strictness runs `claude ≈ grok < gpt < gemini`, and it is a property of the judge, not of the card.
So a wave whose per-card spread is 2.0 is not a wave of controversial cards — reading it that way
was a wrong call made here once. The number that carries information is the PAIRED delta, whose sd
is 0.7–0.9 against a between-wave swing of 0.5 in the pooled mean: with the panel held fixed, a
paired read sees effects the pooled mean cannot. Absolute scores are worth nothing on their own.

The panel's cache used to key on `md5(model + card + SOURCE)`. That is wrong for a check whose
whole input is the images: the `text-base` fix changed how every card rendered without touching a
byte of source, so a rerun would have replayed 117 stale verdicts at full confidence and I would
have compared a fix against itself. Keyed on the image bytes now.

Four probes now report what the eye cannot, in `shot-card.mjs`: `OVERFLOW` (content past the
card's right edge), `CRUSHED` (a control narrower than its own label), `UNUSED` (width the card
declined to paint), and `FLUSH` (text sitting against the host edge — a card whose root has no
padding, where the other three are all silent because nothing goes PAST the host, the content is
flush TO it). `FLUSH` measures **text-bearing leaves only**: the first version measured every
element and fired on the control too, because a card's own root div is supposed to fill the host
and a perfectly-padded card still has a 0px-from-edge container. **Each was verified to fire on a case that should fire AND stay silent on one
that should not** — the first `UNUSED` was silent on the very card four judges flagged, because
`.ui4a-root` is a full-width wrapper and "furthest painted right edge" always found it at the host
edge. A probe that reports nothing looks identical to a clean wave.

The general lesson is the one the second row states: a screenshot clipped at the host width cannot
show overflow (the lost strip is absent, not cut) and cannot show unused width. Reading the images
myself and having five models read them is not redundant — they fail differently.

**Two of wave 2's three biggest defects were in my own config, not the model.** `box-sizing` was
missing from the scoped preflight (every text field 10px past its own edge, at *every* width — the
tell that it was never a breakpoint bug), and the colour named `base` was shadowing `text-base`
(§3.7). Both times my first instinct was to write a prompt rule teaching the model to work around
it. A defect that reproduces identically at 320, 440 and 720 is nearly always infrastructure;
check the config before spending prompt budget on it.

**Reading all 29 wave-2 cards myself found what five vision judges did not: a contrast failure.**
20 of 29 write `bg-accent text-white` — the primary button, every badge. Measured on the live
harness in both themes, that is **2.66:1 in dark**, against 4.5 for the 10px text it is usually
applied to. No judge mentioned it in 117 verdicts; they grade composition, and contrast is
arithmetic on two computed colours. It is also invisible to all four probes.

The cause is structural, and the host had already solved it: `accent` flips WITH the theme (dark
gets the *lighter* blue), so any foreground that also flips with the theme moves the same
direction and the gap closes. `--dsw-alias-label-primary-foreground` flips against it — 4.23
light / 7.11 dark — and a tinted ground (`state-business-tertiary` + `label-primary`) does better
still at 16.04 / 9.79. `test/probes/badge-contrast.ui4a.tsx` renders all four spellings side by
side so the claim is checkable by eye.

**I found that only after reading the token table instead of my own notes.** The authority is
`@deepseek-ai/dsh-client-ui-theme/lib/styles/` — `design-platform.css` carries **162 colour
aliases** (`body` = light, `body[data-ds-dark-theme]` = dark, over a static scale), and the **30-step
type scale is in `gradient-shadow-text.css`**, a filename that says nothing about it. `uno-config.ts`
maps **12 of the 162**. Whole groups are unreachable from a card: the host's own button recipes
(15), the secondary and tertiary steps of every status colour (7), `label-tertiary`/`caption`
(7), `markdown-*` prose styling (8). Checked the harness fixture against that table: the 162 agree
exactly, so every contrast figure here stands, and none of the five sheets styles a bare element
— which is why a harness screenshot is faithful on colour and type. **Before reasoning about a
design system, read its table**; I spent an hour computing against 13 values transcribed from
memory and was one edit from inventing a name for a token the host already publishes.

One more, from the same read: Wind4's line-height for `text-sm`/`text-xs` is **2px tighter** than
the host's own (20 vs 22, 16 vs 18), and those two sizes are **74% of all font-size uses** in
wave 2. Fixable in `theme.font.*`, no prompt rule needed.

One in four is the hit rate a first-pass regex gets here, for the same reason: a criticism is
generated from a principle, and the principle assumes a context. Still worth its cost — the one
that was right had gone unnoticed through 378 cards and 30 screens.

**The slider criticism outlived the rule written for it, twice.** A rule teaching the overrides in
a `<style>` block produced a card that put the class on the `<input>` and wrote
`.r input[type=range]` — asking for an input inside the input, so nothing matched and the OS-blue
track shipped anyway. The utility syntax fixed that by attaching the selector to the element, and
then the SAME control failed a third way: the model correctly wrote both `-moz-` and `-webkit-`
prefixes, UnoCSS merged them into one rule, and Chromium discarded the pair (§2.5). Three
mechanisms, one symptom, and each one only visible in a screenshot or a `getComputedStyle` call.
**When a defect survives the rule aimed at it, the next question is whether the rule was even
reaching the element** — not how to word it better.

### 6.7 Traps that stayed true

Audited the whole of §4 against reality. **Every rotted citation was an identifier** — a package
name, an error code, a slot name, a number — and every entry that survived cites a *behaviour* you
can reproduce with a build, a fetch, or a type query. An identifier goes stale silently; a
behaviour cannot rot without something breaking. When writing one down: **name what you did and
what happened, and cite the identifier only as a pointer to it.**

Two were simply wrong. The `console.error` refcounting trap **cannot happen** (no yield point
between the swap and the `finally`), and the wasm leak is **~16MB per HMR round, not 2.5MB** — that
figure was `tsx_bg.wasm`'s size on disk standing in for a memory measurement, off by six times and
in the direction that makes the leak look tolerable. **An unreproduced trap is a standing
instruction to do unnecessary work.**

### 6.8 Working on this project

- **Commit each verified step rather than batching.** The working copy is not the durable artefact;
  a macOS TCC grant for `~/Desktop` disappeared mid-session and recovery was `git clone`.
- **Anything you have done twice while intending not to needs a mechanism.** Two red pushes became
  `.git/hooks/pre-push`; three commits with a failing record audit became `pre-commit`. Install
  both with `scripts/hooks/install.sh` — `.git/hooks` is not versioned.
- **Name and close what you start.** A `dsh web` outlived its session by a day; seven
  `surface-harness.ts` processes pushed load average to 51 and made a timing test fail on its own
  timeout. A 200 on the port you asked for is not proof your server started.
- **Order the refusals by what they cost, not by where the thing they protect lives.** The
  stale-`lib/` check was written directly above the snapshot it guards, which reads well and put
  it AFTER the live probe — so a tree that could not be measured still spent one real model call
  per upstream before being turned away, which is the exact waste the guard exists to prevent. It
  costs two `stat()`s; it belongs beside the other millisecond refusals. Two smaller things from
  the same edit: the mtime was being `stat()`ed inside the comprehension, once per source file for
  a value that never changes, and the FIRST read of `lib/` in the script is the fingerprint, not
  the guard — so an existence check added later in the file still crashed with a bare
  `FileNotFoundError` on a fresh clone, where `lib/` legitimately does not exist yet because it is
  built by `prepare` and not in git. **A precondition has to sit before the first use, not before
  the use you were thinking about.**
- **A guard that cannot pass is indistinguishable from a subject that is broken.** `eval.sh`'s
  staleness check read the profile symlink with `readlink`, which returns the target VERBATIM —
  and pnpm writes a RELATIVE one, relative to the symlink's own directory. Resolving it against
  the CWD therefore failed silently: `cd` errored, `pwd -P` produced an empty string, and the
  comparison could never match, so a correctly-linked checkout reported `stale` and every eval
  exited 4. The suite's own timeout test had been failing on it. Resolve a symlink from the link,
  never from wherever the script happens to run. The general shape is the one 6.4 states from the
  other side: a gate that always fires and a gate that never fires are both gates that measure
  nothing, and only the first one announces itself.
- **A measurement in flight owns its inputs, and this is the easiest rule here to break.** Broken
  three times in one session: `waves.json` regenerated while a wave was reading it (48 of 72 runs
  lost, and the surviving 24 looked like a complete wave), `lib/index.js` rebuilt mid-A/B by a
  stray `bun test`, and a `pkill` aimed at one batch's leftovers that killed the batch that had
  just started — five runs cached as `crash/nosession`, which reads exactly like the real
  "0 cards" answer. Each one is invisible in the numbers. The three defences that work:
  **snapshot the inputs into the run's own directory**, **fingerprint `lib/index.js` and
  `lib/client.js` separately** (a prompt change invalidates the run, a render change only means
  re-shoot), and **never cache a result whose text says the process died**.

  Broken a fourth, fifth and SIXTH time since, and the escalation is worth following because each
  fix was correct and each was too shallow. First: **`bun run build` refuses while a wave runs**
  (`--force` to override) — which stops the rebuild but not the EDIT, and `eval.sh`'s mtime check
  then calls every in-flight run stale. Wave 5 lost 27 of 72 that way while `$dsh/web` was being
  written in another window, with the build guard working perfectly the whole time. So the real
  fix is one level down: **a wave now FREEZES the plugin into its own directory** (`waves/wNNN/
  plugin`) and repoints each eval home's symlink at it, restoring them in a `finally`. `src/` is
  then free to move — the thing the wave reads is a copy nothing writes to. `eval.sh` recognises
  such a link and skips both mtime checks (a frozen copy cannot go stale) while still refusing a
  link to any OTHER checkout, which is the failure that guard was written for.

  The general shape: when a guard keeps firing correctly and work keeps being lost anyway, the
  guard is on the wrong noun. Guarding the ACTION (building) needed a list of every way to reach
  the artefact; guarding the ARTEFACT (what the run reads) needed one copy.

  Also still true: **`bun run build` refuses while a wave is running** (`--force` to override). Both later breaks
  were the same shape — an unrelated edit, a reflexive rebuild, and a wave whose verdicts mix two
  prompts. Note the second-order effect the first time you meet it: with the build refused, `lib/`
  stays at whatever it was, so a *test* failure or a smoke error right after an edit may be
  reporting the OLD bundle. Read the build's own output before diagnosing the failure.
- **A wave that cannot measure anything must refuse to start, not finish instantly.** `eval.sh`'s
  guards exit 4 in milliseconds, so waves 5-9 once reported `WAVE DONE … 72 runs` across four
  seconds — 360 files all reading `stale`, and a reflection written about them. `run-wave.py` now
  probes before spending anything, and the probe is a **real turn against each model home**, not a
  stubbed one: the static guards only check that the credential variable is *set*, and a key that
  is set but rejected produces `AUTH: 401` on all 72 runs while the wave still reports DONE.
- **An eval home reads its gateway key from an env var, and unset it hangs rather than fails.**
  `apiKeyEnv: LITELLM_24000_API_KEY` in each `~/.dsh-eval-<model>/settings.yaml`; with it unset,
  dsh starts, opens a session and sits there — process alive, connection open, nothing returned,
  nothing logged. A wave of 72 spent itself that way and was diagnosed as the upstream stalling,
  which looks identical. `eval.sh` now refuses with `nocreds`, alongside its two existing guards.
  The key is the `master_key` in `~/litellm_config_24000.yaml` on sd (`m sd` prints the ssh line);
  it is **not** the `:4000` one, and it lives in the shell that launches the wave, nowhere else.
- **Evals: concurrency ≤3.** The `macaron-v1` family stalls under sustained load and the eval chain
  has no fallback, so it arrives as 900 seconds of silence.
- **A prompt is not a neutral probe.** `现在到哪一步了` calls dsh's own `get_goal`; a fixture whose
  subject is absent measures the fixture. Whatever a prompt refers to must exist in the workspace
  *before* the run.
- **Read one card by hand before believing a surprising result.** Four times in one afternoon a
  measurement said something was wrong and one `grep -A3` said otherwise — including a "regression"
  that argued for reverting a rule and existed only in the regex.

### 6.85 Match the host, and measure it rather than assuming it

Three "looks bolted on" complaints in one session all turned out to be one thing: the card is
styled against a design language nobody measured. The host publishes the answer; read it.

- **Weight.** dsh web uses exactly two: measured on a live window, **54 of 61 visible text nodes
  at 400 and 7 at 500, none at 600 or above**. The generated corpus does the opposite —
  `font-semibold` **246 times**, `font-bold` 6. A card therefore lands a whole step heavier than
  every surface around it, which is most of what "inconsistent" means here. The prompt now says
  body default, `font-medium` for emphasis, and that `font-semibold`/`font-bold` have no
  counterpart in this app at all.
- **Hairlines the host does not draw.** The panel had a `border-l1` under its title bar and under
  its tab strip. dsh web's own conversation header (`wSkVaW_header`) computes
  `border-bottom-color: rgba(0, 0, 0, 0)` on a transparent background with no box-shadow — it
  separates itself with 76px of height and nothing else. Two lines across a panel inside that same
  frame read as chrome the app does not have.
- **`bg-base` is the page's own colour.** Light `#fff`, dark `#151517` — the same value the
  transcript behind the card is painted with. A wrapper painted with it draws nothing visible: an
  invisible 16px inset and a rounded corner nobody can find, while the `bg-layer-1` blocks inside
  read as the real frame. A frame inside an invisible frame.
- **A rule in the skill only fires where the skill is loaded.** The `Sparkles`-is-slop rule has
  been in the skill for a while; a real dsh web session still produced a `Sparkles` header, because
  the model never loaded the skill (the `skill` tool call landed at seq 190, after the user asked
  for a card in so many words). Measured: `icon`, `lucide`, `Sparkles` appeared **zero times** in
  the prompt. Anything decided in the first thirty seconds belongs in the prompt, with the
  reasoning left in the skill.

  This also explains a corpus rate that looks like a dead rule: an AI-slop icon rendered beside a
  heading is **1 of 378 cards (0.3%)**. The corpus is Macaron production, where the skill is always
  loaded — the population where the rule fires is the one the corpus does not contain. Do not read
  a low corpus rate as "the rule does nothing" without asking which environment the corpus samples.

### 6.855 The host-matching rules, measured after

The three rules in 6.85 landed together and wave 5 is the after-measurement — 45 verdicts, the
same corpus questions, the same three models:

| wave | `font-medium` | `font-semibold` | `font-bold` | semibold share |
|------|---------------|-----------------|-------------|----------------|
| w000 | 33 | 26 | 0 | 44% |
| w002 | 67 | 54 | 3 | 44% |
| w003 | 117 | 80 | 2 | 40% |
| w004 | 102 | 118 | 2 | 53% |
| **w005** | **76** | **0** | **0** | **0%** |

Over the same 45 cards: AI-slop icons rendered **0**, wrappers painted `bg-base` with a radius
**0**. So all three went from a stable 40-53% (or a known-present defect) to absent — which is
what a rule looks like when the model simply did not know the constraint, as opposed to one it
keeps breaking under pressure. Worth remembering which kind this was: the earlier design rules
that needed eight rewrites were fighting a habit; these three were filling a gap.

Two process notes from the same wave. **27 of 72 runs were `stale`** because `src/` was edited
mid-wave (again — see 6.8), so the measurement is 45 verdicts and not 72. And **40 runs were kept
that the old guard would have discarded**: the split stale check reported them as
`note: src/client/ …`, a render change that leaves the verdict standing.

### 6.857 Sampling more models, and what the gateway will not give you

A wave sampled three models from two families, which makes every result a claim about those
families. It now samples six across six upstreams — `macaron-v1-venti`,
`macaron-v1-coding-venti`, `glm-5.2`, `gemini-3.7-flash`, `grok-4.6`, `gpt-5.6-terra` — for two
reasons, and the second is the one that matters. **Throughput**: `macaron-v1-*` share a backend
capped at 3 concurrent, so a wave whose work is mostly theirs runs 3-wide however many workers
exist (wave 5's retry: 27 macaron jobs, ~25 minutes, every other slot idle). One semaphore per
upstream and `3 × len(upstreams)` workers took in-flight calls from 6 to 18. **Evidence**: the
weight rule going to zero on three models was suggestive; holding on Gemini, GPT, Grok and GLM
too — measured on wave 6's first 21 verdicts, `font-medium` 75/3/12 and `font-semibold` **0**
everywhere — is a rule about the constraint rather than about one family's habits.

Three things this cost, all worth knowing before adding a model:

- **Each model needs its own eval home** (`scripts/eval-home.py <model>`), whose `settings.yaml`
  is a REAL FILE naming one model. Symlinked back to the shared home, setting one home's model
  sets every home's and the wave measures one model N times while reporting N.
- **No Anthropic model can be sampled here.** The headless profile composes `tool-web`, and every
  `claude-*` on this gateway answers a request carrying it with
  `The use of the web search tool is not supported` (400). Measured on sonnet-5, sonnet-4-6 and
  opus-4-8 — a gateway capability gap, not a model one.
- **`reasoningEffort: low` does not work yet, and would be worth having.** dsh rejects the field
  with `UNSUPPORTED_REASONING_EFFORT` unless the model ENTRY declares `reasoningEfforts`, and none
  of the seven do. Declaring them means writing each provider's own wire value, and a wrong one
  sends the gateway a parameter it will not understand. `EVAL_EFFORT=…` is wired and off.

  The probe that "confirmed" all six supported it was measuring nothing: it used `timeout 60`, and
  **macOS has no `timeout(1)`**, so every command failed at the shell and every model came back
  `ok`. Same class as the build-vs-test artefact confusion in 6.8 — a plausible result from a
  measurement that never ran. `command -v` the tool before trusting a loop built on it.

### 6.86 Errors that reach only the reader teach the model nothing

`onError` had no consumer: a card that failed to compile painted a red panel and the model never
learned anything. Measured on a real session — the surface reported *"'modern-monaco' has no
export named 'MonacoEditor'; module exports: Workspace, errors, hydrate, init, lazy"*, which
contains the fix, and the records after that point mention `MonacoEditor` six times and
`no export named` **zero**. The reader saw the answer; the one party who could act on it did not.

`report-error.ts` now sends it back through `conversation.send`, and the three constraints are all
load-bearing: only errors that survived settling and retries (`GenUISurface` already separates
those), **once per message** (a settled card that fails re-renders on every later frame, and a
message per render is a loop the user has to kill), and **announced as automatic** (the model is
about to read a user-role message nobody typed; without saying so it apologises to a person who
said nothing). Verified end to end in a browser: the card failed, the `[自动]` message appeared
16.5s later, and the model replied *"its actual exports are Workspace, errors, hydrate, init, and
lazy … instead of using the named import I assumed existed"*.

### 6.865 A repaint is not a recovery, and a cancelled report must stay reportable

The reporting above shipped with two defects that cancelled each other into silence, and both were
found by review rather than by use — which is the point: the failure mode is *nothing happening*.

- **`partial-react` answers a render throw by repainting the LAST GOOD component**
  (`runtime.ts:416-419`, whenever `preserve` is on — which is every INLINE card, since
  `GenUISurface` defaults `preserveState` to true; canvases pass `false`, so the bug was invisible
  there). That repaint fires `onRendered` about 16ms later, and `cardRendered()` treated it as the
  card being fine — cancelling the report the very same throw had armed. So the one case the
  feature exists for, a card that worked and then broke on an edit, showed the reader stale content
  and told the model nothing. `cardRendered(restored)` now takes the distinction, and
  `GenUISurface` sets it from a ref the render throw wrote a tick earlier.
- **The dedup key was claimed when the timer was ARMED, not when the message was sent.** Cancelling
  is the normal path, so a cancelled report still burned its key: the same failure on a later edit
  reported nothing at all, twice. Claim it inside the timer.

Both are the same shape as §6.4's rule about gates — *"no failures" has two causes that look
identical* — one level down: **a callback named for the happy path will be called on the sad one
too, if the recovery goes through the same code.** Ask what the library does about an error before
deciding what its success callback means.

### 6.87 What dsh gives you, and one seam that does not fit

Read `deepseek-ai/deepseek-harness/docs` before hand-rolling: `capability-seams.md` is the index of
every `ctx.*` service, and `defensive-patterns.md`'s first rule ("report orthogonal outcomes
independently — `timedOut`, `signal`, `exitCode`") is the same bug class as the card that renders
"no matches" for a search that was killed at 15s.

- **Settings are a seam, not a config field.** `installSettingsSection(ctx, ns, schema, entry,
  hooks)` from `@deepseek-ai/dsh-settings`, with `Config` a **schemastery** `z.object(...)` — not a
  TypeScript interface, which compiles to nothing and leaves the host with no schema to validate
  or render. The whole helper sits inside `ctx.inject(["settings"])`, so on a host without that
  service `onChange` never fires: mount once explicitly as well, and dedup so a host that *has*
  settings does not mount twice. `dsh --profile headless` is such a host, and getting this wrong
  costs the entire plugin there.
- **`ctx.approval` is the right question and the wrong seam for a card.** It answers "may this
  specific action proceed?", `tool-bash` consumes it, and it fails closed. But `request()` takes an
  `agent` and throws outright without an open turn — *"approval.request() outside an open turn …
  Ask from inside the turn that needs the decision."* A card's command fires on the reader's
  keystroke, long after that turn ended. `ctx.userQuestions.ask()` does work outside a turn (its
  `agent` is optional), so a per-command prompt is buildable — what stops it is that a card runs
  one command per keystroke, and a dialog per keystroke is not a safety feature. Hence a
  capability-level setting plus the session's own sandbox policy per command.

### 6.9 The tools, and what each is for

Everything under `scripts/`. `bun run check` chains the gates; the rest are run by hand.

| | |
| --- | --- |
| **gates** (`bun run check`) | |
| `screens.ts` | the defect predicates, shared by every checker |
| `compile-cards.ts` | compiles each card, runs the screens, fails on a screen with no control |
| `paint-cards.ts` | renders with `react-dom/server` — catches 7 of 9 blank-render causes, no browser |
| `replay-stream.ts` | every prefix of a card through normalize+compile: remounts, broken frames |
| `cross-tab.ts` | screens × paint, and fails if a card breaks that no screen predicted |
| `smoke.ts` | loads the built bundle, runs `apply()` **and every disposer** |
| `build.ts` / `gen-standalone.ts` | the bundle, and the `$dsh/*` stubs a standalone export links against |
| `platform.ts` | the shell's module table, imported by both build and smoke so they cannot drift |
| `audit-record.py` / `audit-rates.py` | one prompt scored twice in this file; a rate that no longer matches |
| `test-shuffled.sh` | N seeded orders — a leaked global only bites in some |
| **corpus** | |
| `corpus-rates.ts` / `fresh-rates.ts` | every screen's hit count, so no rate is transcribed here |
| `corpus-size.sh` | the current denominator — **run before writing a new "N of M"** |
| `hollow.ts` | does a created behaviour actually work, or is it cargo-culted |
| `sample-prompts.py` | draws eval prompts from the session corpus, not from what I thought of |
| `extract-fences.py` | pulls every `ui4a/tsx` fence out of a reply |
| **eval** | |
| `eval.sh` | one prompt → `skill= fence= canvas= bytes= tools=[]`, with crash and staleness guards |
| `run-fixtures.sh` / `trigger-cases.txt` | the fixture grid; lowercase marks a run that never loaded the skill |
| `make-seed.sh` | a workspace a prompt can refer to (a repo with real history, files) |
| `loads.sh` | boots dsh and asks for a string only this plugin could supply |
| `pickup.sh` | resumes a session for a second turn |
| `run-wave.py` | one wave of 12 corpus turns × 7 models × 2 samples, each with its real prior context; snapshots its own questions AND the plugin it measures, so neither a growing pool nor an edit to `src/` can change them mid-run |
| `eval-home.py` | one eval home per model — its own `settings.yaml` naming that model at `reasoningEffort: low`, everything else shared by symlink. A wave needs one per entry in `MODELS` |
| `score-wave.py` | that wave's skill / card / **markdown-table-instead** rates, by model and by family |
| `shoot-wave.sh` | every card the wave produced, at 320/440/720 in both themes. `SHOOT_JOBS` pairs at a time (default 6): every (card, theme) is independent, and the serial version spent most of its wall clock waiting for servers to boot. `xargs -P`, not a hand-rolled gate — macOS bash 3.2 has no `wait -n` and a counter gate there fails open |
| `close-wave.sh` | score → shoot → judge, in order. Reading the screenshots is deliberately NOT in it |
| `wave-pipeline.sh` | shoot and judge OVERLAPPED. Judging a card needs that card's six shots and nothing else, so waiting for the whole shoot leaves the gateway idle for the slowest stage — one bun server plus a headless Chromium per card-theme pair. The judge's refuse-incomplete guard is what makes the overlap safe; it stays as it is, and the loop simply comes back for what was not ready |
| `wave-root.sh` / `wave_root.py` | where the waves live, one place per language. The default was written out in ten consumers with the same comment beside six of them, and the two that forgot to read `WAVE_ROOT` at all measured an empty directory and printed that as a result. Shell scripts `. "$(dirname "$0")/wave-root.sh"`; Python does `from wave_root import ROOT`, which resolves because `uv run scripts/<name>.py` puts `scripts/` on `sys.path[0]` whatever the cwd |
| `run-waves.sh` | drives a range of waves back to back. `nohup … &` dies with the shell that started it — wave 2 lost a whole run that way, so this is what the harness backgrounds instead. A long run WILL be interrupted (shell exit, a stray `pkill`, the harness reaping tasks); the per-run cache in `run-wave.py` is what makes that survivable — restarting the same range replays the finished runs from disk. Monitor the process count alongside the file count, because a dead runner and a slow one look identical from the output directory |
| `ab-rule.sh` | one rule, the same corpus turns before and after, three models. Refuses to cache a run whose text says it crashed |
| **visual** | |
| `surface-harness.ts` | serves one card on the real `GenUISurface`, with the real design tokens |
| `shot-card.mjs` | screenshots it at 320/440/720, cropped to content, `THEME=dark` for the other |
| `mount-card.sh` | mounts in Chromium and reports the a11y tree and `localStorage` |
| `render-cards.ts` | the browser render sweep (`render-check.md` says why compiling is not painting) |
| `judge-cards.py` | five vision models grade the screenshots — see §6.6 |
| `judge-delta.py` | pairs those verdicts before/after a change, per card — the panel's own spread is ~2.0, so only a paired read says anything |
| `card-shape.py` | what the cards ARE, not whether one appeared: which libraries they reached for, whether anything folds, how long they run. Card rate is noisy (an 8-point move measured 1.4× SE and said nothing); "did it import `@headlessui/react`" is deterministic, so a change of a few points is a change |
| `card-height.py` | how tall they render, in CSS pixels, against the viewport fraction the prompt asks them to fit. Measured on wave 15: at 320px wide, **90% run past 60vh and 23% past two screens** — the density rule had no measurement behind it until this |
| **maintenance** | |
| `mutation-audit.sh` / `invert-ifs.mjs` | inverts one condition at a time; names what no test constrains |
| `check-exports.ts` | a package's real exports, through the same esm.sh URL the runtime resolves |
| `platform-table.sh` | re-checks the host's module table (§2.1) — the one note that asks to be re-run |
| `stub-unresolvable.ts` | the `$dsh/*` and icon stubs, read from `types/standalone/` so it cannot go stale |
| `tsx-node.ts` | `compileSettled` — the pipeline production takes, so checkers cannot diverge |
| `append-section.py` | inserts a dated section in date order (three hand-inserts landed out of order) |
| `flaky-dep-server.py`, `flaky-dep-new.html`, `flaky-dep-old.html` | a dependency that 503s twice then works — the only way to show the import retry does anything |
