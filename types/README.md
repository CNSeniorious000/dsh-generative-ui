# `$dsh/*` type declarations

`importmap.json` exists for one flag: `genui check -i`. Its targets are `.d.ts` files, so it
types the capability modules and nothing else — `genui build` and `genui dev` want runnable JS
and fail on it with `Missing export`.

That is not a gap. `$dsh/chat`, `$dsh/ai` and `$dsh/fs` forward to dsh's conversation, llm and
fs services, so they only exist while the plugin is running inside dsh web. A standalone HTML
export or a Vite preview has no harness to forward to; there is no JS that would make them work
there, only JS that would lie about it.

The declarations are hand-written rather than emitted from `src/client/runtime/bindings.ts`:
what a card should see is the capability surface, not how it reaches the host.

`check.ts` keeps them honest — it asserts the declared surface and `bind()`'s return type are
assignable **both ways**, so a declaration that is narrower than the implementation (hiding
capability) fails just as a wider one does (promising what the runtime will not do). Verified
it catches both an added method and a changed signature. Editing a `.d.ts` therefore means
editing the transcription in `check.ts` too; that duplication is the point, since a check that
derives from the thing it checks proves nothing.

Pointing the map at the real `.ts` sources instead was measured and rejected: `paths` targets
are compiled as part of the program, so the implementation's own diagnostics — a module it
imports, an error in a file beside it — surface as errors on the model'"'"'s card, about code the
model cannot see or fix.
