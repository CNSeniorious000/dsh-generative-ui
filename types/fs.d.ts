/** `$dsh/fs` — the workspace, under the session's own access mode. See `types/chat.d.ts`. */
declare module "$dsh/fs" {
  /** The file's text. Rejects when it does not exist or the session may not read it. */
  export function readFile(path: string): Promise<string>;
  /** Entry names in a directory. */
  export function readdir(path: string): Promise<string[]>;
  /** Rejects with `FS_SANDBOX_DENIED` when the session is read-only. */
  export function writeFile(path: string, content: string): Promise<void>;
}
