/**
 * The shell's frozen module table (`packages/client/web/src/platform.ts`).
 *
 * One list, two consumers that must agree: `build.ts` externalizes exactly these, and
 * `smoke.ts` answers `require()` for exactly these and throws on anything else. Kept apart they
 * were identical by luck — a module externalized but not answered is a blank app, and one
 * answered but not externalized is a second React, which is the singleton bug this project
 * already has a whole section about.
 *
 * No `scheduler`, no `react-dom/server` — both get bundled.
 */
export const PLATFORM_MODULES = ["react", "react/jsx-runtime", "react-dom", "react-dom/client", "@deepseek-ai/cordis", "@deepseek-ai/dsh-client-ui-slots", "@deepseek-ai/dsh-client-ui-primitives"];
