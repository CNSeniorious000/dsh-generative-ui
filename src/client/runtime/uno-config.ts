import { presetWind4 } from "@unocss/preset-wind4";
import type { UserConfig } from "@unocss/core";

/**
 * Two things the host forces on this config, both non-negotiable:
 *
 * `important` receives a SELECTOR STRING, which is how UnoCSS scopes: every rule comes out
 * `.ui4a-root :is(.gap-4){…}`. The runtime sheet is appended to `<head>` last, so an unscoped
 * `hidden` written by a card would win over the shell's own `hidden` and make part of the app
 * vanish. The playground has that bug on record (a sidebar disappearing); we start scoped.
 *
 * `preflights: { reset: false }` drops presetWind4's global reset — 3.5KB of `*, ::before,
 * ::after { margin: 0; border: 0 solid }` that would land on the HOST's DOM, not just ours.
 * The `theme` layer survives it and is the part we need: `--spacing` and `--radius-*`, which
 * every `gap-*` and `rounded-*` resolves against. Without preflights entirely those rules
 * generate but compute to nothing.
 */
export const unoConfig = (scope: string): UserConfig => ({
  presets: [presetWind4({ important: scope, preflights: { reset: false } })],
  // The reset above is dropped because it targets `*` and would land on the HOST's DOM. But
  // dropping it leaves form controls carrying the browser's own chrome, and that is not
  // theme-aware: measured on a card in dark mode, two unselected `<button>`s rendered as light
  // grey blocks with black text, because a button with no background class falls back to the UA's
  // `buttonface`. The card looked right in light and broken in dark, which is the failure this
  // whole colour system exists to prevent.
  //
  // So: the same normalisation, scoped to our root. Only the properties whose UA default is a
  // fixed colour or an inherited-font break — not margins, not box-sizing, which cards set
  // themselves through utilities and which would surprise anyone reading the class list.
  preflights: [
    {
      getCSS: () => `${scope} button, ${scope} input, ${scope} select, ${scope} textarea {
        background: transparent; color: inherit; font: inherit; border: 0 solid; cursor: pointer;
      }
      ${scope} input, ${scope} select, ${scope} textarea { cursor: auto; }`,
    },
  ],
  theme: {
    colors: {
      // The host's 12 semantic tokens, under names short enough to write in a class.
      // A card can still reach any variable through an arbitrary value: `bg-[var(--dsw-…)]`.
      base: "var(--dsw-alias-bg-base)",
      layer: "var(--dsw-alias-bg-layer-1)",
      "layer-2": "var(--dsw-alias-bg-layer-2)",
      line: "var(--dsw-alias-border-l1)",
      "line-2": "var(--dsw-alias-border-l2)",
      label: "var(--dsw-alias-label-primary)",
      muted: "var(--dsw-alias-label-secondary)",
      accent: "var(--dsw-alias-state-business-primary)",
      hover: "var(--dsw-alias-interactive-bg-hover)",
      danger: "var(--dsw-alias-state-error-primary)",
      success: "var(--dsw-alias-state-success-primary)",
      warn: "var(--dsw-alias-state-warn-primary)",
    },
  },
});
