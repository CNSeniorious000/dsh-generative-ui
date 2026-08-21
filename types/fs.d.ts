/** `$dsh/fs` — the workspace, under the session's own access mode. See `types/chat.d.ts`. */
declare module "$dsh/fs" {
  /** The file's text. Rejects when it does not exist or the session may not read it. */
  export function readFile(path: string): Promise<string>;
  /** One directory entry. `size` is absent for directories. */
  export type DirEntry = { name: string; type?: "file" | "directory"; size?: number };
  /** A directory's entries — enough to draw a tree without probing each name. */
  export function readdir(path: string): Promise<DirEntry[]>;
  /**
   * The file's raw bytes — for audio, MIDI, images, anything not text.
   *
   * `readFile` decodes as UTF-8 and would corrupt them silently. Capped at 8MB.
   */
  export function readBytes(path: string): Promise<Uint8Array<ArrayBuffer>>;
  /** Rejects with `FS_SANDBOX_DENIED` when the session is read-only. */
  export function writeFile(path: string, content: string): Promise<void>;
}
