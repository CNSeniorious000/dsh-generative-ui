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
| 3 | A title or control above a long list is `sticky` | `skill.ts` | **356 of 766 cards have a heading or control above a list; 3 pin it (0.8%)** — every case, every model. The rule IS in r005's frozen plugin; only this count was measured afterwards |

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

### Baselines measured after r005 was frozen

Corpus counts over r003+r004's 766 cards, measured after r005 had already started. The `read`
column is the round that can actually move each one — getting this wrong is how a round later takes
credit for a rule that shipped before it.

| Metric | Baseline | Rule that targets it | Read in |
|---|---|---|---|
| cards with a heading/control above a list that pin it | **3 / 356 (0.8%)** | sticky trigger | **r005** — the rule is in its frozen plugin |
| `hover:` and a selected-state variant colliding on one property | **308 in 193 cards** | pressed-and-hovered pair | r006 |
| runs where the reader clicked and nothing ever sent | **108 / 161 (67%)** | one control ends the step | r006 |
| `useEffect` timers with no cleanup | **0 / 39** | none — already correct, and a crude regex said 212 | never |
| cards carrying a `@container` breakpoint | **591 / 766 (77%)** | already landed; was the top panel criticism at 76% | already read |
| cards nesting the box recipe three or more deep | **256 / 766 (33%)**, worst 7 | countable nesting check | r006 |
| submissions that left the card looking untouched | **36 / 105 (34%)** | record-then-show, three statements | r006 |
| submissions recorded but lost on reload | **20 / 105 (19%)** | `usePersistedState`, not `useState` | r006 |
| reloads that re-fired the turn by themselves | **0 / 105** | none — the opposite mistake does not happen | never |

### r005 mid-flight, after the TCC block (2026-08-29)

The round lost its Desktop permission grant 42 runs in — `dsh` could not read its own overlay and
173 of 220 runs died at 0.1s with `EPERM`. Wave stopped, permission restored by hand, relaunched
from the 42 cached runs. The frozen plugin was verified byte-intact across the interruption.

Two things read on the surviving 42 before the relaunch, recorded here so neither can be quoted
later as a finished result:

- **The sharp predictor failed: still 0 runs load the skill after turn 2**, in both rounds. But the
  42 that survived are the wrong population to test it on — the six deep cases where r004's
  never-loading runs live (`sql-tune` 5, `css-layout` 4, `formula-derive` 2, `arch-draw` 2,
  `svg-badge` 2, `chess-open` 1 — 16 of 20) had **not run at all**. On those 42, r004's own load
  rate was 93% against 80% for the whole round: they are the cases where the skill was already
  being loaded, so the rule has nothing to do there. Not evidence against the rule.
- **Sticky, pooled, looked like a 10x move** — 0.5% (r003) → 1.3% (r004) → 12.8% (r005). **Paired,
  it is `+0.059 ± 0.043` on 21 pairs and does not clear 2 SE.** The pooled number is a denominator
  effect: r005's completed cards come from cases r004 has no completed run for. Two runs improved,
  zero got worse, nineteen unchanged — the right direction with nowhere near the sample to say so.
  This is the same trap as `cards overflowing at 380` earlier today, caught by the same rule:
  **a counter whose denominator differs between the rounds is not a result.**


## The prompt budget, and why nothing was trimmed (2026-08-29)

Every round so far has only ADDED rules, and the payload the model carries shows it:

| round | prompt + skill bytes | vs previous | largest block (the skill) |
|---|--:|--:|--:|
| r003 | 121,622 | — | 58,896 |
| r004 | 124,345 | +2.2% | 61,272 |
| r005 | 130,061 | +4.6% | 63,578 |
| r006 (current tree) | 136,156 | +4.7% | 68,759 |

That is +12% in three rounds and +16.7% on the skill. A loop that only adds eventually stops
working, so two things were checked before deciding to carry it:

- **Is any of it duplicated between the layers?** `prompt.ts` rides every request; `skill.ts` loads
  on demand, so a sentence in both is pure waste. Measured with a similarity sweep over 186 + 306
  sentences: **2 near-duplicates, 201 characters.** The split is clean. The growth is real content.
- **Can a rule whose defect now measures at zero be dropped?** No — and this is the trap worth
  naming. `useEffect` timer cleanup measures **39 of 39 correct**, and the 4,498-character section
  teaching it is the most likely REASON it does. Absence of a defect is evidence the rule works,
  not evidence it is unnecessary. Removing it would be an A/B with no control.

So nothing was trimmed. What is recorded instead is the number and the next move: if a round ever
shows the skill being skimmed rather than followed — a rule near the END of the file failing while
one near the top holds — that is the signal to spend a round on length, with the trim as the single
variable and the removed rule's own counter as the read.
