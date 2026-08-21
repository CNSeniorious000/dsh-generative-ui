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
