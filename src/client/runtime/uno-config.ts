import { presetWind4 } from "@unocss/preset-wind4";
import type { UserConfig } from "@unocss/core";

/**
 * Two things the host forces on this config, both non-negotiable:
 *
 * `important` receives a SELECTOR STRING, which is how UnoCSS scopes: every rule comes out
 * `.genui-root :is(.gap-4){…}`. The runtime sheet is appended to `<head>` last, so an unscoped
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
