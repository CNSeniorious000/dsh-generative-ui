/**
 * What the model is told about a card that will not render.
 *
 * Split in two, deliberately, because the two halves want opposite lifetimes:
 *
 * - **The detail is state.** It goes out as a runtime-context snapshot, re-evaluated on every
 *   assembly and superseded by the next one. A card that gets fixed simply stops being mentioned.
 *   As a chat message it was the opposite — permanent, and still there three turns after the card
 *   started working.
 * - **The nudge is an event.** One short line through `followup`, whose only job is to open a turn
 *   so the model looks at the detail now rather than whenever the user next types.
 *
 * Neither is a user-role message any more, and that removes the paragraph the old body had to
 * carry: *"This was sent by the renderer, not by the user — nobody typed it, so do not apologise
 * or address it as a request."* That existed because the report arrived wearing the user's face.
 * A `kind: "plugin"` source does not, so the model is told what happened and nothing else — the
 * disclaimer cost more tokens than the error it was wrapped around.
 */

/** A card failure as the browser half reported it. */
export type CardFailure = { readonly message: string; readonly phase: string };

/** The runtime-context section name. Stable: it is how a later snapshot supersedes an earlier one. */
export const CARD_FAILURE_CONTEXT = "ui4a:card-failure";

/**
 * Ordered after the plugin's own guidance so the model reads how cards work before it reads that
 * one is broken.
 */
export const CARD_FAILURE_CONTEXT_ORDER = 250;

/**
 * The detail, as the model sees it.
 *
 * It says it is current state rather than an event on purpose: the same text is re-delivered on
 * every step while the card stays broken, and a model that reads it as a fresh report tries to
 * fix the card again on each one.
 */
export const failureText = (failure: CardFailure) =>
  `A ui4a card in this session is not rendering. It failed at the ${failure.phase} step:\n\n${failure.message}\n\nThis is current state, not a new event — it is re-read every step and disappears once the card renders. If the error names the correct usage (the available exports, for instance), fix the card and send it again. If it does not, look it up before you change anything.`;

/** The one line that opens a turn. The detail is already in context; this only asks for attention. */
export const WAKE_TEXT = "A ui4a card you wrote is not rendering — the failure is in the runtime context.";

/** Shown as the context row's label in the transcript, so a reader can see what fired without opening it. */
export const WAKE_SUMMARY = "ui4a card failed to render";

/**
 * The current failing card per session.
 *
 * Per session rather than per card: the nudge exists to get one turn spent on the problem, and a
 * reply that breaks three cards does not want three turns. The newest failure wins because it is
 * the one the model just wrote.
 */
export class CardFailures {
  private readonly bySession = new Map<string, CardFailure>();

  /**
   * Record a failure.
   *
   * @returns whether this is news — the caller wakes the model only then. Dedup lives here rather
   * than in the browser half because that half is reloaded by every navigation, and a dedup set
   * that resets on reload wakes the model again for a card it already knows about.
   */
  set(session: string, failure: CardFailure): boolean {
    const previous = this.bySession.get(session);
    this.bySession.set(session, failure);
    return previous?.message !== failure.message || previous.phase !== failure.phase;
  }

  clear(session: string): void {
    this.bySession.delete(session);
  }

  /** The context text for one session; empty contributes nothing to the assembly. */
  text(session: string | undefined): string {
    const failure = session === undefined ? undefined : this.bySession.get(session);
    return failure === undefined ? "" : failureText(failure);
  }
}
