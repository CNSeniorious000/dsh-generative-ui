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

### Read #1 came back, and it retired its own sharp predictor (2026-08-29)

The registered read for the per-turn decision rule was the skill-load rate, with a sharper backup:
*"whether ANY run loads it after turn 2, which happened 0 times in 101 runs before. One such run is
qualitative proof the rule landed; none means it did not."*

| | r003 | r004 | r005 |
|---|---|---|---|
| runs that load the skill at all | 124 / 155 (80.0%) | 85 / 105 (81.0%) | 147 / 175 (84.0%) |
| first load on turn 0 / 1 / 2 | 118 / 5 / **1** | 78 / 7 / **0** | 141 / 5 / **1** |

Paired on the 85 common cells, the rate is **+0.059 ± 0.045 — 1.3 SE**, short of the threshold.

And the sharp read does not rescue it, because **the "0 in 101 runs before" was measured on r004
alone**. r003 has exactly one run loading at turn 2 (`api-shape/macaron-v1-venti`), and r005 has
exactly one (`sql-tune/macaron-v1-venti`). One versus one versus zero, on n≈1, is not a signal in
either direction — and a predictor whose whole force came from a baseline of exactly zero loses all
of it the moment the baseline is one.

**The predictor is retired, not re-scoped.** Widening the denominator to r003+r004 and declaring
"1 in 260 before, 1 in 175 now" would keep a test that cannot resolve anything at these counts.
The honest version of this read is the rate, and the rate says the round did not clear 2 SE.

Recorded because the mistake is easy and one-directional: a baseline that happens to be zero on the
subset in front of you makes any single instance look like proof, and the check that catches it is
looking at the round BEFORE the one you drew the baseline from.

### The sticky read at 143 of 220, and why it is not readable yet (2026-08-29)

`eval/sticky.mjs` reads the trigger shape off the syntax tree — a `.map()` list with a heading or
control above it in the same parent — so "above" is a sibling relation rather than a regex guess.
Three numbers on the same instrument, and they disagree in a way that matters:

| Read | r004 | r005 (partial) |
|---|---|---|
| pooled, any card containing `sticky` | 1.9% | **7.4%** |
| paired by (case, model), per-card | 1.2% | 4.6% — **+0.047 ± 0.027, 1.7 SE** |
| paired, restricted to cards that HAVE the shape | 0 / 251 | 2 / 245 — **+0.017 ± 0.017, 1.0 SE** |

The pooled number is four times the paired one and neither clears 2 SE. Reading the hits explains
the gap: the runs where r005 pins — `diet-log/macaron-v1-venti`, `diet-log/step-3.7-flash`,
`palette/macaron-v1-coding-venti` — are runs where **r004 produced no cards at all**. r004's
`diet-log/macaron-v1-venti` directory holds zero `.tsx` files. Those cells are excluded from the
pairing, correctly, and what is left is the 59 cells where both rounds carded.

So the improvement visible in the pooled number may not be the sticky rule at all: it is equally
consistent with cells that used to produce nothing now producing something, which is a different
rule's win. **Do not attribute it until the round completes** and the pairing has the cells back.
The usages themselves are right — `sticky top-0 z-10 bg-layer border-b`, a pinned header over a
scrolling list, which is exactly what the rule asks for — so this is a question of attribution, not
of whether the models understood it.

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
| cards stacking three box recipes | **216 / 755 (29%)**; four or more **41 (5.4%)**, worst 5 | countable nesting check | r006 |
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

---

## r006 (against r005)

Written before the round exists. Six rules, plus a fixture change that has to be read separately
from them or it will be mistaken for them.

### What changed

| # | Change | Where | Baseline it is aimed at |
|---|---|---|---|
| 1 | `aria-pressed:hover:*` in the button recipe | `skill.ts` | **308 collisions in 193 cards** — `:is()` makes `hover` and the pressed variant both `(0,2,0)`, `hover` is written last, so the selection repaints neutral under the pointer |
| 2 | Exactly one control ends the step | `skill.ts` | **108 of 161 clicking runs (67%) never sent anything**, 468 dead clicks |
| 3 | The nesting check made countable — walk up and count ancestors repeating border+rounded+padding | `prompt.ts` | **216 of 755 (29%)** stack three, **41 (5.4%)** stack four or more, worst 5 — read off the syntax tree after two cheaper methods gave 33% and 60.7% |
| 4 | Record *and render* — three statements, `usePersistedState` | `skill.ts` | **36 of 105 (34%)** looked untouched after submitting, **20 (19%)** lost it on reload |
| 5 | Hand-rolled `<pre>` named as the thing to stop doing | `skill.ts` | **182 of 194 cards showing code hand-roll a `<pre>` (94%)**; only 4 use `shiki`, and they are the same blocks as the widest overflows |
| 6 | `drive.py` keeps the turns when the transport drops | `eval/` | not a prompt rule; it stops a dropped channel from being scored as a model that produced nothing |

### The fixture also changed, and that is a confound

`floor` 8 → 10 on the six deep cases, and four new cases at `floor: 10`. Raising the floor is what
the goal asks for and r004's spike says is needed — **24 of 48 healthy runs stopped on exactly 8**,
so the declared minimum was acting as a ceiling and turns 9-10 barely existed. But turns 9-10 are
also exactly where a clarification would have to surface a SECOND time, which is what rules 2 and 4
are about. A rate that moves could be either.

**So the paired read truncates.** r006's six deep cases are compared to r005's on their **first 8
turns only** — identical floor pressure on both sides, confound removed. The turns past 8 are read
on their own, against nothing, as description rather than as a delta. Any claim of improvement on
these six comes from the truncated read; if the two disagree, the truncated one is the result.

The four new cases (`orbit-3d`, `log-dig`, `game-tune`, `shift-plan`) are paired against nothing and
**cannot show improvement this round**. They exist to reach shapes the first six never ask for: a
thing in space, a card that runs something, a control whose only verification is playing with it,
and a list long enough for the sticky rule to bite. Their numbers are r007's baseline.

### The per-run timeout goes 1800 → 2700, measured rather than guessed

Read off r005's deep cases before launching, because `cut` being the first read is worth nothing if
the round is launched into a configuration already known to cut. Those six currently time out **0
times in 26 results**; median 412s, p90 950s against the 1800s cap. Adding two turns at each run's
OWN measured seconds-per-turn puts p90 at **1610s and 2 of 26 over the cap** — so `floor: 10` at
1800s would have manufactured an ~8% cut rate on exactly the cases the round is about, and the
first read would have called the round unreadable for a reason that was set at launch.

2700s clears the projected p90 by 1090s. It cannot bias the paired read in the optimistic
direction: a longer cap only lets more runs REACH turn 8, and a pair is only read when **both**
sides reached it, so r006 runs with no r005 counterpart are dropped rather than averaged in.
`UI4A_TURN_DEADLINE` stays at 600 — it is paired across every round so far and is not a free knob.

### The reads, in order

1. **The `cut` rate first.** If runs are being cut by the deadline more than r005, nothing below is
   readable — a truncated run produces fewer cards for reasons that have nothing to do with a rule.
   `floor: 10` and four 14-turn cases both push runtime up, so this is the read most likely to
   invalidate the round.
2. **Dead clicks per run** (rule 2). The sharp form: share of runs where the reader clicked at least
   once and nothing ever sent. 67% → below 40% is the win. This is the one metric with a large
   enough baseline that 2 SE is easy to clear.
3. **Submissions the card kept** (rule 4), two numbers that must move together: looked-untouched
   34% → under 15%, and lost-on-reload 19% → under 5%. The second moving without the first means
   the card is persisting into state nothing renders — the exact failure the rule names.
4. **Hover/pressed collisions** (rule 1), counted in the generated CSS rather than the source: a
   card is a hit when one property is set by both a `hover` and a pressed selector of equal
   specificity. 308 → under 50.
5. **Nesting depth** (rule 3), from `eval/nesting.mjs`, which reads the syntax tree — the regex and
   indentation versions of this counter were both wrong by more than 5x, in opposite directions.
   Three-stacks 29% → under 15%; four-or-more 5.4% → under 2%. The second is the one the rule
   actually names, and it is small enough that 2 SE will be hard to clear — so a null there is not
   evidence the rule failed, only that this round could not see it.
6. **Hand-rolled `<pre>`** (rule 5). 94% → under 60%, read together with the overflow counter: these
   are the same blocks, so if `<pre>` falls and overflow does not, the replacement is also too wide.
7. **The panel, last.** It has never been the thing that decided a round and is not going to start.

### What would make r006 unreadable

- `cut` rate up by more than 2 SE — runtime ate the round; drop `floor` back to 9 and re-run.
- Any of the six rules missing from `rounds/r006/plugin` — verify before the first run, not after.
  r005 shipped three rules while the corpus sweep had produced five, and only checking the frozen
  copy made that visible.
- The four new cases erroring out at a higher rate than the twelve — a fixture that does not run is
  not a fixture. `log-dig` was the suspected risk, and the suspicion was checked rather than left
  standing: `$dsh/exec` **is** reachable from the eval homes, and cards already use it in **9 files
  in r004 and 9 in r005**. That is also the argument for the case. Against `$dsh/chat`'s 256 files
  and `$dsh/state`'s 294, exec is the least-exercised capability the plugin offers, and until now no
  fixture asked for it — so its 4% share measured the fixtures, not the models.
