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

It lives in `scripts/build.ts` as `PLATFORM_MODULES` (`scripts/smoke.ts`'s `PLATFORM` mirrors it — change one and you must change both, or smoke stops catching it).

**Neither `scheduler` nor `react-dom/server` is in the table.** The latter is required for preflight, so it has to be inlined, and **pinned to 18** to match the React bridged in.

### 2.2 React is 18.3.1, not 19

Measured on the host: `React 18.3.1`. Generated code reaches the host's **same** React instance through `host-bridge` — a second copy makes hooks fail silently.

Consequences:

- When writing components in this project, **React 19-only APIs are all off-limits** (`use()` / `useActionState` / `useOptimistic` / `cache` / `useEffectEvent` / ref-as-prop). Skip the whole `react19-*` section of `vercel-composition-patterns` — we still need `forwardRef`.
- `partial-react`'s peer is now `^18.3.0 || ^19.0.0` (widened in 0.0.5; it used to be `^19.0.0` only), and at runtime it only touches APIs 18 already has (measured — see MindLab-Research/macaron-genui-demo#1715). There used to be one spot in `runtime.ts:425` where `Promise<ReactNode>` wasn't assignable to 18's `ReactNode`; upstream has since fixed it with a cast.

  Note that **`skipLibCheck` does nothing here** — that option only skips `.d.ts`, and these two packages ship `.ts` source, so a value import really does compile them.

  **Do not patch around this.** What's left is the undeclared `typeof Bun` guard in `compiler.ts:13` (2 errors, tracked as MindLab-Research/macaron-genui-demo#1717 — #1715 was the peer-range half and is closed), which affects neither our runtime nor our build — only `tsc` complains. Patching trades long-term maintenance for one line of prettier output, hides the problem locally, and takes the pressure off upstream. `scripts/typecheck.mjs` prints upstream errors without counting them, and only judges `src/` — delete the script along with them once upstream lands the fix.
- `partial-tsx` / `partial-react` use `toSorted` / `findLast` / `toReversed`, so `lib` must be ≥ `ES2023`.

### 2.3 Non-JS assets only reach the browser through your own route

The `/plugins` route **hardcodes `/client.js` and `/client.js.map`**; everything else 404s. And `dsh-host-frontend-static` answers unmatched paths with **index.html + 200** (not 404), so dropping wasm into its dist "looks like it works" right up until `instantiateStreaming` reports a baffling magic-word error.

The fix is a route from the Node half — `ctx.webServer.register({ kind: 'prefix', path: '/dsh-generative-ui/assets', ... })` — with the browser half hardcoding that URL. Measured: `200 · application/wasm · 2,610,857 B`.

Two constraints: the path **must be namespaced by package name** (a duplicate `(kind, path)` throws, and throwing during apply means the whole plugin silently fails to load); and **the Electron shape has no webServer routing**, so desktop needs another answer (or falls back to base64 inlining, +3.3MB).

`import.meta` doesn't exist in the CJS output, so upstream's bundler-agnostic `import.meta.resolve(...)` trick is unavailable — the URL has to be a hardcoded constant.

### 2.4 Slots you may touch and slots you may not

| Slot | kind | Use |
| --- | --- | --- |
| `conversation.chat.node` | keyed | **Inline cards.** Unregistered kinds degrade gracefully into a JsonBlock |
| `conversation.view` | list | **Canvas view tab**, alongside Conversation / Trace |
| `shell.overlay` | list | Frame-wide overlay, available if we need it |

**`details` (the right-hand column) is off-limits.** It's `kind: 'single'` and currently held by ui-conversation's `DetailsPanel`. A dynamically loaded package gets a ctx facade that overrides priority (decrementing into the negatives per install), so **we necessarily beat the shipped 0** — registering silently evicts DetailsPanel, taking the `conversation.details.tool` sub-slot it declares with it, which **breaks tool-call inspection app-wide**. There is no handoff API.

Registration must be wrapped in `ctx.slots.inject(name, () => ...)`: these slots are declared by ui-conversation at runtime, and registering early throws `slot "..." is not declared`.

### 2.5 CSS has to mark itself

The loader's `claimStyles(id)` runs `document.querySelectorAll('style:not([data-plugin])')` and **claims every match** for whichever plugin is currently materializing. So every `<style>` this plugin appends must carry `data-plugin="dsh-generative-ui"` itself, or HMR and unload will tear each other's styles out. `injectStyles` in `canvas/mount.ts` is the one place that appends one.

**There is no CSS framework here, and that is a deliberate split from the playground.** The panel is hand-written CSS in `panel.css` (compiled into `panel-css.ts` at build time) over the host's `--dsw-alias-*` tokens, and §3.7's prompt tells the model to write inline `style` from those same tokens. Measured across 16 canvases this prompt produced: **0 utility classes, 592 inline `style` objects** — so there is nothing for an atomic-CSS engine to generate, and nothing needing class-name scoping.

`ui4a-playground` runs a real UnoCSS generator in the browser (`src/runtime/uno.ts`) because its prompt teaches Tailwind v4 syntax, and the model's classes therefore do not exist in any build-time stylesheet. Worth reading before dismissing it — it is **scoped**, not the global runtime §5 warns about: passing a string as `important` makes UnoCSS treat it as a selector prefix, so every rule comes out `.ui4a-root .hidden{…}`. That scoping is not optional, and their comment records why: the runtime sheet is appended last, so an unscoped `hidden` from generated code overrode the app's own `@md:flex` and made a sidebar vanish.

**What we do need from that half is responsiveness**, and it is not free either way. The same block renders in a chat column and in a panel the reader drags between 320 and 720px, so the viewport says nothing — and 16 of 16 canvases had no breakpoint at all. The smaller answer, given that our model already writes plain CSS: give the mount node `container-type: inline-size` (`GenUISurface`) and teach `@container` in the prompt. Measured: without `container-type` the guarded declaration is simply inert, which reads as the model writing something bad rather than as a missing container.

If an atomic engine is ever added anyway, the trap waiting is that the host themes by ancestor (`body[data-ds-dark-theme]`), so a scoping rewrite has to **hoist the theme selector** — `.dark .foo` → `.dark .genui-root .foo` — and prefixing without hoisting breaks the moment the theme flips.

### 2.6 Four bundling settings you cannot skip

See `scripts/build.ts`. All four let the plugin **build fine and blow up at runtime**, with errors far from their cause, which is why `bun run smoke` catches every one of them without opening a browser:

- **`external` lists only the platform table, and mind that bun matches sub-paths too.** Listing `react-dom` also externalizes `react-dom/server` — which is **not** in the platform table, so materialization throws `missed the module table`. A plugin that resolves it to an absolute path sidesteps specifier matching. (bun defaults to `--packages bundle`, so unlike tsdown there's no need for a reverse `noExternal`.)
- **The `browser` resolution condition must be explicit.** `react-dom`'s `exports["./server"]` only points at `server.browser.js` under that condition; otherwise you get the Node build and drag `require("stream"/"url"/"util")` into a browser bundle.
- **`partial-react/src/compiler.ts` must be swapped for `src/client/runtime/compiler-shim.ts`.** It has a top-level `import.meta.resolve`, which is a **syntax-level** error inside a CJS factory — it throws whether or not that branch runs, surfacing as the whole plugin `loaded without registering`. We ship our own compiler anyway, and the swap also drops its `Bun` global and its node:fs read path.
- **`define` away `import.meta.url`.** `@esm.sh/tsx`'s entry reads it. We always pass the wasm path explicitly, so a constant is enough.

### 2.7 Two traps in the type system

- `SlotMap` is stitched together from each package's `declare module`. **Miss one package and the official d.ts stops compiling** (without `dsh-client-ui-layout`, `'conversation'` / `'details'` raise TS2344). Installing isn't enough either — some file has to `import type {} from ".../client"` to trigger the merge.
- `allowImportingTsExtensions` must be on, because the source imports across files with `.ts` / `.tsx` suffixes.

## 3. The ui4a contract

Inherited from `../ui4a-playground/src/fs/contract.ts`; **the only difference is that the files are real** (not a browser VFS):

```
<workspace>/.dsh/ui4a/
├── canvases/<id>.ui4a.tsx   # → a canvas view, one mini app
└── canvases/<id>/*.tsx      # → that mini app's sub-tree
```

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
  - `src/skill.ts` is loaded **on demand** via `ctx.skills.register()`: the judgement calls (should there be UI at all, inline or canvas), framing rules, layout constraints. `dsh-base`'s bundle ships `dsh-skill` + `dsh-tool-skill` by default, so a runtime-registered skill lands in the model's `<available_skills>` catalog and the body is only fetched when it calls the `skill` tool.
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

**But the canvas gets no streaming under the web profile's default PTC mode** (measured 2026-08-20 with a probe inside `calls()`, 5000+ samples): under PTC every tool is called from `run_code`, and the host only exposes `write` as a subCall once `run_code` has **finished**, so the very first `write` frame we see is already `settled: true` with all 14388 characters. The outer `run_code`'s own `argsRaw` is just 165 characters (the calling code, not the file body). The panel therefore appears whole the moment the write lands — 490 samples on a real machine, **0** state changes. The `streaming: !call.settled` code is itself correct and would work off-PTC where `write` is a top-level call; the default path just never reaches it. Inline is unaffected (see §3.5).

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

Data visualization is the one exception — chart series need their own hues to be distinguishable, and the prompt carves that out explicitly.

## 4. Known traps

- **Intermediate streaming frames are supposed to fail compilation**, `No default export found` most often — partial-react explicitly treats these as transient and keeps the last good frame. That semantics must not leak to callers; `GenUISurface` filters them out while streaming, or the UI flashes red on every character the model types.
- **`GenUIRenderer.create` is async**, so the renderer must live in state, not a ref: in a ref, the first render's effect sees `null` and bails, and since `code` no longer changes it never re-runs — a surface that mounted and stays blank forever.
- **`preserveStateOnUpdate` only suits streaming growth.** It decides reuse by hook signature, so a whole-file replacement whose hooks happen to match will silently discard the new content. The canvas therefore passes `preserveState={false}`; inline keeps the default.
- **Pick a signal that actually renders.** Verifying file readback, I wrote the marker into a TSX comment — comments never reach the UI, so the "it's broken" conclusion was entirely fake and cost a lot of time. Writing the marker into JSX text found the truth.
- **Preflight steals the global `console.error`**: `partial-react/src/runtime.ts:215-224` swaps it and restores in `finally`. With concurrent cards the inner `finally` restores the *outer* collector, and **the host's console.error is lost permanently**. A chat node is multi-card by nature, so this needs refcounting or serialization.
- **An `edit` to a canvas resets every `useState` in it.** `canvas/index.ts` re-reads the body off disk when a patch marks it stale, so `code` changes, `GenUISurface` delivers it, and `renderComponent` runs — which increments `renderRound`, and with `preserveState={false}` the boundary key is `boundary:${renderRound}`, so the whole tree unmounts. Ask the model to tweak one colour in a running timer and the timer resets. The `preserveState={false}` above is deliberate and the comment explains why, but it is a trade, not a free choice: `localStorage` survives an edit and `useState` does not, which is the real reason a canvas must persist through storage rather than memory. Traced through the code, not yet reproduced on a machine — the honest status.
- **HMR has no react-refresh**: React state inside the plugin is lost on every reload, and adding or removing a plugin requires restarting dsh.
- **wasm instances leak, and upstream offers no release.** `@esm.sh/tsx` exports only `transform`/`init`/`initSync` — no dispose, no free — so "release explicitly" is not an option; dropping the `initPromise` reference and waiting for GC is. Each HMR round leaves another ~2.5MB instance behind, dev-only. The blob-URL half is already wired up (`disposeRegistry` hangs off a `ctx.effect` disposer).
- **One failed `import()` is a cold start, not a rule.** I once saw recharts fail to import inside the verification browser, recorded it here as "that browser cannot reach esm.sh", and nearly used the resulting blank card as evidence that streaming charts were broken. Re-measured later: three consecutive imports of the same URL all succeeded, ~270ms each, 101 exports. The first failure was the cold start §4's retry logic exists for. **Repeat a network measurement before writing it down** — and when a probe shows an empty card, `import()` the package by hand a few times before concluding anything about the code.
- **A dependency that fails to fetch looks exactly like broken code.** esm.sh cold-starts, and the symptom either way is a blank surface with nothing in the console. `GenUISurface` retries three times on backoff before letting the error through. `clear({ preserveVisualState: true })` is what makes it a real retry — the renderer skips an unchanged compile result, so re-delivering the same code without clearing is a no-op and the failed import is never re-attempted. Only retry a settled surface: while streaming, the next frame re-delivers anyway, and retrying there would replace the growing buffer with a stale prefix.
- **Bare specifiers need a fallback import map.** `registryImports()` only has the five React entries, so the moment the model writes `import { BarChart } from "recharts"` resolution fails — and ESM fails by killing the whole module import, so the surface goes **completely blank with no error at all** (onError doesn't fire either). `GenUISurface` calls `mergeFallbackImports` (`partial-react/import-map`) with the code's import set to probe esm.sh and fill the gaps. It costs ~36ms per run, so dedupe by specifier signature rather than recomputing per frame.
- **Every entry in `inject` is a hard dependency.** cordis's `Inject` type has no required/optional distinction (`registry.d.ts:13`) — one missing service and the entire fiber stays inactive, with not a single line of `apply()` running. That's why `webServer` and `skills` are nested fibers via `ctx.inject([...], cb)`: `dsh --profile headless` has no `webServer`, and listing it statically would leave the plugin unable to even teach the model there — which is precisely the profile batch evals run on. Only services that make the plugin pointless when absent (`systemPrompt`) belong in the static array.
- **publint's `client.js` warning cannot be fixed.** It wants the CJS `lib/client.js` renamed to `.cjs` (because `"type": "module"` makes it parse as ESM). But `dsh-client-modules` builds the URL as a hardcoded `/plugins/<id>/client.js?rev=...`, so changing the extension means the plugin never loads. That's a requirement of the host shape, not an oversight of ours.
- **cordis enforces `inject` at access time, not declaration time.** Reading an undeclared service (`ctx.sessions`) doesn't fail at apply; it throws `cannot get property "sessions" without inject` **inside the request handler**, which `dsh-host-webserver` turns into a **400 with no body and nothing in the logs**. It looks exactly like an unregistered route and is actually a missing dependency. Bypassing the type system (`as unknown as`) to dodge a client-side type conflict does not dodge this runtime check — the service still has to be declared, just inside a `ctx.inject([...])` scope.
- **`/dsh-generative-ui/canvas` must validate `cwd`.** The route answers **any** page the user has open (a plain GET skips preflight), so without validation it is a whole-disk file-existence oracle — `?cwd=/tmp/leak-probe` was measured returning file contents. The allowlist comes from each session's `header.cwd` in `ctx.sessions.list()`; the client only ever sends the current session's cwd, so nothing legitimate is caught by it.
- **A settings panel is impossible**: `dsh-host-apiproxy` only exposes settings for a compiled-in allowlist, and a third-party `ctx.settings.register` gets `settings-not-exposed`. Configuration goes through `cordis.patch.yml`.
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
