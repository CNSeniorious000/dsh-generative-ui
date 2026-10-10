## Check it before you hand it over

A canvas is a file, so you can run a checker over it. `@genui/cli` validates exactly this
kind of TSX. Substitute the type import map path printed in the skill entrypoint; if it says
none is installed, omit `-i` and verify harness calls in the live panel:

```
BUN_INSTALL_CACHE_DIR="$TMPDIR/bun-cache" bunx --yes genui@https://pkg.pr.new/MindLab-Research/macaron-genui-demo/@genui/cli@main check <file> -i <type import map from the skill entrypoint>
```

**`bunx` needs the package NAME in front of the URL** — `genui@https://…`. Bun reads the whole
argument as `<name>@<spec>`, so a bare URL gives it an empty name and it stops at
`unrecognised dependency format` before fetching anything. Any name works; it is a label, not a
lookup.

If bun is not there, in order:

```
pnpx --config.blockExoticSubdeps=false https://pkg.pr.new/MindLab-Research/macaron-genui-demo/@genui/cli@main check <file>
npm_config_cache="$TMPDIR/npm-cache" npx --yes https://pkg.pr.new/MindLab-Research/macaron-genui-demo/@genui/cli@main check <file>
```

Both take the bare URL. The pnpm flag is **not** optional — the CLI pulls `@genui/unocss` by URL
as well, and pnpm refuses URL-resolved SUBdependencies by default, so without it you get
`ERR_PNPM_EXOTIC_SUBDEP` naming a package you never asked for. Do **not** add
`--config.cacheDir` beside it: pnpm then loses the package's own bin and dies with
`spawn cli ENOENT`, which reads like the package is broken and is not. It needs no cache redirect
anyway — its store is the one of the three your sandbox lets you write.

**The other two do**, and the reason is worth knowing because it disguises itself. Sandboxed,
`touch ~/.npm/_cacache/x` and `touch ~/.bun/install/cache/x` both come back
`Operation not permitted`; the directories exist, they are simply not yours to write from in
there. npm reports this as `EPERM mkdtemp` **and a message about root-owned files**, which sends
you looking for a permissions problem in your home directory that is not there. `$TMPDIR` is
writable, so pointing each cache at it is the whole fix.

`check` includes TypeScript diagnostics; `lint` is the faster syntax-only pass.

Either way, the way to see your work actually run is to write the canvas and look at the panel.

**Two mistakes it reports that do not blow up**, both found in real cards written here, and both
the kind you never notice because the thing still works:

- **Two utilities that set the same property.** `className="grid … flex"` does not merge and does
  not error — which of them wins is decided by the order the rules were generated in, not by the
  order you wrote them, so it can differ between a streaming frame and the settled card. The
  older form of this was a duplicate key in a style object (`{ display: "block", …, display:
  "flex" }`, last one wins, first silently dropped); the class form is harder to see because the
  two words sit inside one string. Read the whole class list before adding a layout word to it.
- **Writing a ref during render.** `statusRef.current = status` in the component body reads as a
  cheap way to keep a loop's view of state fresh, and React is explicit that it is not one; do it in
  an effect. A long-running AutoPlay is exactly where this bites, because the loop outlives the
  render that set it.

It is worth the round trip because it catches the mistakes that cost the most here — the ones
that otherwise reach the user as a blank card with nothing in the console. Each of these was
run through it and the message is quoted as it actually comes back:

- `<META[key].icon />` — JSX allows the member form `<a.b />` but not a subscript.
  "JSX element type '<the object>' does not have any construct or call signatures".
- `import { Pie } from "recharts"` beside `export default function Pie()` — "Import
  declaration conflicts with local declaration". Nothing fails at build time; at runtime the
  component recurses into itself until React throws #185.
- `<Fragment>` used without importing it — "Cannot find name 'Fragment'". A `ReferenceError`
  at render, so the card mounts and shows nothing.
- A glob or a regex quantifier written as JSX text — `<code>src/*.{ts,tsx}</code>` reports
  "Cannot find name 'ts'", which is precisely what it will throw when the reader opens it.

What it does **not** catch is worth knowing too, so you do not read a clean run as a working
card: a hook called at module scope, and a hardcoded `#fff` background, both pass. Those are
yours to get right.

Skip it for a small inline block you can read in one screen. Run it on anything long, and on
anything you are about to leave in the workspace as a canvas.

**Read the report, do not obey it.** Run over 378 real cards it reported something on 136 of
them, and 97 of those were `implicitly has an 'any' type` on a lambda parameter — a card that
runs perfectly. Annotating every parameter to quiet it costs lines and buys nothing. The lines
worth acting on name a *mechanism* that is wrong (a conflicting declaration, a duplicate key, a
name that does not exist, a comma operator), not a type that could be narrower.
