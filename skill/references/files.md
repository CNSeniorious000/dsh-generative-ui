## Reading and writing workspace files

`$dsh/fs` gives a card `readFile(path) -> string`, `readBytes(path) -> Uint8Array`, `readdir(path) -> {name, type, size}[]`
(`type` is `"file"` or `"directory"`, so a tree needs no probing; `size` is bytes, absent on
directories) and `writeFile(path, content)` over the workspace. Paths are workspace-relative and
`path` is required — there is no "current directory" argument-less form, under the
session's own access mode — the same fence the file tools run behind. So a read-only session
refuses the write, and the card should say so rather than looking broken: catch it and tell
the user the session is read-only.

**Anything that is not text goes through `readBytes`.** `readFile` decodes as UTF-8, so a png, a wav
or a `.mid` read that way comes back with every byte above 0x7f replaced by U+FFFD — corrupt, and
silently so. And there is **no HTTP route that serves workspace files**: `<img src={`/${path}`}>`
resolves against the app, 404s, and the reader gets a page of broken icons. Measured on a real
canvas that found 357 images and showed none of them. The whole shape is three lines:

```tsx
const [url, setUrl] = useState<string>()
useEffect(() => {
  let live = true, made: string | undefined
  void readBytes(path).then((bytes) => {
    if (!live) return
    made = URL.createObjectURL(new Blob([bytes]))
    setUrl(made)
  })
  return () => { live = false; if (made !== undefined) URL.revokeObjectURL(made) }
}, [path])
```

Revoking is not optional in a browser that keeps a long transcript: one object URL per image per
mount, never released, is a leak the reader pays for in memory. A grid of them wants an
`IntersectionObserver` too — read the bytes when the cell comes near, not all of them on mount.

Reach for it when the data **belongs to the workspace** — a file the user can also open, edit
and commit.

**You reading the file is not the card reading the file.** You have your own tools, so it is
easy to open the README, summarise it, and paste the summary in as a string — and the result
is a photograph: right the moment you took it, silently stale from the next edit on. If the
card is about workspace content, the card calls `readFile`. Reserve your own reading for
deciding *what to build*, not for supplying what it displays.

**Read on demand, not all at once.** A list of twenty files does not want twenty
`readFile` calls before it can draw — it wants to draw immediately from `readdir` (which
already carries the type and the size), and to fetch a body only when the reader asks for one.
Hovering a row, clicking to expand it, selecting it in a two-pane layout: all of these are one
read at the moment of interest, cached after. That is what makes a card feel instant on a big
tree, and it is also the difference between a browser and a table — a table answers what you
guessed the reader wanted, a browser answers what they actually reach for.

A useful default: draw from the cheap call, fetch on `onMouseEnter` (with a short delay so a
sweep across the list does not fire twenty reads) or on click, keep what you fetched in a
`Map`, and show a quiet placeholder in the gap. Never read a file the reader has not looked
at yet.

Keep `localStorage` for a canvas's own private state (which tab was open, the draft they were
typing); writing that to disk just litters the repo.
