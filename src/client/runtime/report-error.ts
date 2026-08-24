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
 */
export const reportBody = (message: string, phase: string) =>
  `[自动] 你刚生成的卡片没有渲染出来，${phase === "compile" ? "编译" : phase === "transform" ? "转换" : "渲染"}阶段报错：\n\n${message}\n\n这条是渲染器自动发的，用户没有说话。如果错误里已经写明了正确的用法（比如可用的导出名），直接改好重发卡片；如果不清楚，先查清楚再改。`;

export function reportCardError(send: ErrorReporter | undefined, message: string, phase: string): void {
  if (send === undefined) return;
  if (sent.has(message)) return;
  sent.add(message);
  send(reportBody(message, phase));
}
