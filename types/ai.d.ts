/** `$dsh/ai` — stream from the app's own model. See `types/chat.d.ts` on why these are hand-written. */
declare module "$dsh/ai" {
  /** One user turn plus an optional system prompt; there is no conversation here. */
  export type StreamOptions = { prompt: string; system?: string };
  /** Yields characters as they arrive. Inherits the app's model and credentials. */
  export function streamText(options: StreamOptions | string): AsyncIterable<string>;
}
