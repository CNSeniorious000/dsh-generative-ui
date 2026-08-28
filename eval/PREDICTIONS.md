# Pre-registered reads

Written *before* the round's data exists. A round changes several rules at once, and after the
numbers land there is always a story that fits them — this file is what stops that story from being
written backwards. Each entry names the metric, the direction, and what would count as the change
having failed.

The threshold everywhere is the one `delta.py` prints: **2 standard errors on the paired delta**.
Nothing below that is a result, in either direction.

---

## r005 (against r004)

Frozen at `rounds/r005/plugin`, verified to contain all three rules before the first run.
`UI4A_TURN_DEADLINE=600` pinned to r004's, so the harness is not a second variable.

### What changed

| # | Change | Where | Evidence it was written from |
|---|---|---|---|
| 1 | Ask every turn whether the answer wants an interface, not once at turn 0 | `prompt.ts` (resident) | 93 of 101 loaders decided at turn 0, 7 at turn 1, 1 at turn 2, **0 later**; 20 of 20 never-loaders produced 0 cards across 179 turns |
| 2 | Three shapes that hang off the column edge — `<svg width>`, an unwrapped `<pre>`, a `min-w-` table | `skill.ts` | 12 of 60 sampled cards overflowed at 380px, worst 705px |
| 3 | A title or control above a long list is `sticky` | `skill.ts` | one 266-line card with a heading, a search box and filter chips over a paginated list — `sticky` appeared 0 times |

Not testable here: the `external` retry fix. The eval mounts each card once and never retries, so the
failure it repairs (a second React on attempt ≥ 1 → `Minified React error #31`) cannot occur in this
harness. Its evidence is a real session, not this round. **Do not credit r005 with it.**

### The reads, in order

1. **Skill-load rate per run** — rule 1 is the only change that could move it. Success is the share
   of runs that ever load the skill going up; the sharper read is whether ANY run loads it after
   turn 2, which happened 0 times in 101 runs before. One such run is qualitative proof the rule
   landed; none means it did not, whatever the panel says.
2. **Card rate per turn, paired.** Rate, never the total: r005 runs may be shorter or longer, and a
   total silently mixes "fewer cards" with "fewer turns".
3. **`cards overflowing at 380`** — rule 2. This is the first round where BOTH sides have the probe,
   so it is the first time this counter can be read at all.
4. **Panel `hierarchy` and `craft`** — where rules 2 and 3 would show up if a judge can see them.
5. **Panel `trigger`** — rule 1. It moved +0.44 ± 0.41 from r003 to r004 without clearing 2 SE; if
   the same size shows again on an independent round that is worth more than one round clearing it.

### What would mean the round is not readable

- **`cut` runs materially above r004's.** The prompt payload grew 4.6% (124,345 → 130,061 bytes),
  and a longer prompt that pushes more turns past the 600s deadline would depress every metric for
  a reason that has nothing to do with the rules. Check this **first**; if it moved, subtract it
  before reading anything else.
- **A large paired swing in turn count.** Shorter conversations mean fewer chances to card, and the
  persona agent is stochastic. Read `done` reasons before reading scores.
- **Any counter clearing 2 SE whose denominator differs between the rounds.** This already happened
  once: `cards overflowing at 380` read `+0.118 ± 0.044` against a round that had no probe, purely
  because the denominator was `claimable` rather than `overflow_measured`.

### Already known, so not a finding

- `floor: 8` will produce a spike at exactly 8 turns again (24 of 48 last round). It is a minimum
  that most runs land on. Raising it is an r006 change, deliberately not made mid-series.
- The two negative controls (`closure`, `http418`) will card in the same two models they always do.
  That is a model habit, not a rule that over-fires.
