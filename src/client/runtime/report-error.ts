/**
 * Sends a card's compile error back to the model as a chat message.
 *
 * Until this existed, `onError` had no consumer at all: a card that failed to compile painted a
 * red panel for the reader and the model never learned anything. Measured on a real session —
 * a card imported `MonacoEditor` from `modern-monaco`, the surface reported *"has no export named
 * 'MonacoEditor'; module exports: Workspace, errors, hydrate, init, lazy"*, and the transcript
 * ends there: `MonacoEditor` appears 6 times in the records after that point and `no export named`
 * zero. The reader saw the answer on screen; the one party who could act on it did not.
 *
 * Three constraints, each of which this got wrong in an obvious first version:
 *
 * - **Only errors that survived.** `GenUISurface` already separates a mid-stream prefix failure
 *   and a retryable network blip from a real one — the `report` branch of its error action. That
 *   branch is the only caller, so a half-written expression never reaches the model.
 * - **Once per card, not once per frame.** A settled card that fails re-renders on every later
 *   frame of the transcript, and a message per render is a loop the user has to kill. Keyed on
 *   the message text.
 * - **Announced as automatic.** The model is about to read a user-role message it was not sent.
 *   Saying where it came from is what stops it replying "sorry about that" to a person who typed
 *   nothing.
 */
const sent = new Set<string>();

/** Exported for the test: a fresh card in a fresh session should be able to report again. */
export const forgetReportedErrors = () => sent.clear();

export type ErrorReporter = (text: string) => void;

/**
 * The message body. Kept short and factual: it is spent from the user's context window, and the
 * one thing the model needs is what failed and that nobody typed it.
 *
 * English, like the prompt and the skill it sits beside. This message is the only text this
 * plugin puts into the conversation, and writing it in Chinese did two things: it read as a
 * different voice from everything else the plugin says, and — because a card must be written in
 * the language the USER wrote in — it pushed the model toward answering a Spanish or French
 * speaker in the wrong language for the rest of the turn.
 */
export const reportBody = (message: string, phase: string) =>
  `[automatic] The card you just wrote did not render. It failed at the ${phase} step:\n\n${message}\n\nThis was sent by the renderer, not by the user — nobody typed it, so do not apologise or address it as a request. If the error names the correct usage (the available exports, for instance), fix the card and send it again. If it does not, look it up before you change anything, and answer in the language the user has been writing in.`;

export function reportCardError(send: ErrorReporter | undefined, message: string, phase: string): void {
  if (send === undefined) return;
  if (sent.has(message)) return;
  sent.add(message);
  send(reportBody(message, phase));
}
