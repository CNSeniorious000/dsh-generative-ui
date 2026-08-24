/**
 * `$dsh/state` — the one capability the model asks for without being told it exists.
 *
 * Three runs of a habit-tracker prompt each wrote `import { usePersistedState } from "$dsh/state"`
 * against a module that did not exist, which does not degrade: the browser refuses the module and
 * the card renders blank. Rewording the skill to deny it did not help — the prior survives the
 * denial. So the module exists now, with the signature all three runs assumed.
 *
 * Unlike the other capabilities this needs nothing from the host: `localStorage` and React are
 * both already there. That is also why it is worth having — the alternative the skill used to
 * prescribe is fifteen lines of try/catch that every card rewrites and half of them skip.
 */
import * as React from "react";

/** Namespaced so two cards picking the same obvious key ("todos") do not read each other's data. */
const scope = (key: string) => `dsh-genui:${key}`;

function read<T>(key: string, initial: T | (() => T)): T {
  // `initial` may be a lazy initialiser — the idiom `useState` teaches, and what a card writing
  // `usePersistedState(KEY, loadFromSomewhere())` ends up passing by accident either way.
  const fallback = () => (typeof initial === "function" ? (initial as () => T)() : initial);
  try {
    const raw = globalThis.localStorage?.getItem(scope(key));
    return raw === null || raw === undefined ? fallback() : (JSON.parse(raw) as T);
  } catch {
    // Private mode, a full quota, or a value someone else wrote that is not JSON. A tracker that
    // starts empty is worth more than one that throws during render.
    return fallback();
  }
}

/**
 * `useState`, except the value survives a reload — and, more often, survives the remount that
 * every canvas revision and every inline transcript re-render causes.
 */
export function usePersistedState<T>(key: string, initial: T | (() => T)): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = React.useState<T>(() => read(key, initial));
  React.useEffect(() => {
    try {
      globalThis.localStorage?.setItem(scope(key), JSON.stringify(value));
    } catch {
      // Quota or private mode. The card keeps working in memory; failing the write must not
      // fail the render.
    }
  }, [key, value]);
  return [value, setValue];
}
