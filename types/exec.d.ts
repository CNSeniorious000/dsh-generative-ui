/** `$dsh/exec` — one command in the workspace, under the session's own sandbox mode. */
declare module "$dsh/exec" {
  /** What a command left behind. `truncated` means output was cut, not that it failed. */
  export type ExecResult = { stdout: string; stderr: string; exitCode: number | null; truncated: boolean; timedOut: boolean };
  /**
   * Runs `command` and resolves with its output.
   *
   * A non-zero exit RESOLVES — check `exitCode` rather than catching. Only a failure to run
   * at all rejects. Commands are killed after 15 seconds.
   */
  export function bash(command: string): Promise<ExecResult>;
}
