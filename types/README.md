# `$dsh/*` type declarations

`importmap.json` exists for one flag: `genui check -i`. Its targets are `.d.ts` files, so it
types the capability modules and nothing else — `genui build` and `genui dev` want runnable JS
and fail on it with `Missing export`.

That is not a gap. `$dsh/chat`, `$dsh/ai` and `$dsh/fs` forward to dsh's conversation, llm and
fs services, so they only exist while the plugin is running inside dsh web. A standalone HTML
export or a Vite preview has no harness to forward to; there is no JS that would make them work
there, only JS that would lie about it.

The declarations are hand-written rather than emitted from `src/client/runtime/bindings.ts`:
what a card should see is the capability surface, not how it reaches the host. Keep them in
step with that file by hand — they are ten lines, and generating them would mean shipping the
implementation's types, which name things a card has no business knowing.
