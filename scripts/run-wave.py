# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Run one wave: 12 turns x 3 models x 2 samples, each with its real conversation context.

The context matters and is not decoration. Half the corpus turns are unintelligible alone —
`nah bro that is from today` is a diet-log correction only because the previous ten turns were
adding up calories. Sampling first turns to dodge that measured a distribution nobody has.

The summary is handed to the model as PRIOR CONTEXT, clearly labelled, rather than replayed as
fake turns: dsh would otherwise believe it had itself said those things, and a card built on a
false memory of its own output is not what production does either.

Usage: uv run run-wave.py <wave-index> [samples]
"""
import concurrent.futures as cf, hashlib, json, os, pathlib, shutil, subprocess, sys

ROOT = pathlib.Path(os.environ.get("WAVE_ROOT", "/tmp/genui-loop"))
REPO = pathlib.Path(__file__).resolve().parent.parent
# WHICH MODELS A WAVE SAMPLES.
#
# The first three are what dsh actually runs, so a rule is worth shipping when it holds on them.
# The other four are here for two reasons, and the second one matters more:
#
# 1. Throughput. `macaron-v1-*` share a backend capped at 3 concurrent, so a wave whose work is
#    mostly theirs runs 3-wide no matter how many workers exist — wave 5's retry was 27 macaron
#    jobs taking ~25 minutes with glm's three slots idle the whole time. Different upstreams fill
#    those slots instead of queueing behind a limit that is not theirs.
# 2. Evidence. A prompt rule that only holds on three models from two families is a rule about
#    those families. `font-semibold` going to zero is worth much more when it does so on Gemini,
#    Grok, GPT and Claude too — and a rule that holds on six models and fails on the seventh has
#    told you something specific, which one that holds on three cannot.
#
# Each needs its own eval home (`scripts/eval-home.sh <model>`), because a home carries exactly
# one default model and they must not share a settings.yaml.
MODELS = [
    "macaron-v1-venti", "macaron-v1-coding-venti", "glm-5.2",
    "gemini-3.7-flash", "grok-4.6", "gpt-5.6-terra",
]
# No Anthropic model: the headless profile composes `tool-web`, and every claude-* on this gateway
# answers a request carrying it with `The use of the web search tool is not supported` (400).
# Measured on sonnet-5, sonnet-4-6 and opus-4-8 — a gateway capability gap, not a model one, so
# revisit if the gateway changes rather than assuming the family cannot be sampled.

# Which upstream a model queues behind; models sharing one share its concurrency budget.
def upstream_of(model):
    if model.startswith("macaron-v1"): return "macaron"
    if model.startswith("glm"): return "glm"
    if model.startswith("gemini"): return "gemini"
    if model.startswith("grok"): return "grok"
    if model.startswith("gpt"): return "gpt"
    return "anthropic"
WAVE = int(sys.argv[1])
SAMPLES = int(sys.argv[2]) if len(sys.argv) > 2 else 2

outdir = ROOT / "waves" / f"w{WAVE:03d}"; outdir.mkdir(parents=True, exist_ok=True)
# Snapshot the wave into its own directory on first run and read it from there afterwards.
# `waves.json` is regenerated whenever the sample pool grows, and a wave that re-reads it
# mid-flight silently changes the questions under itself — this run lost 48 of its 72 runs
# that way, and the surviving 24 looked like a complete wave with a smaller denominator.
snap = outdir / "wave.json"
if not snap.exists():
    snap.write_text(json.dumps(json.loads((ROOT / "waves.json").read_text())[WAVE], ensure_ascii=False))
wave = json.loads(snap.read_text())

def prompt_for(r):
    prev = r["prev"].strip()
    turn = r["q"].replace("用户：", "").strip()
    return (f"以下是我们此前对话的摘要，供你了解上下文：\n\n{prev}\n\n"
            f"---\n\n（以上是此前的对话。现在是我这一轮说的话：）\n\n{turn}")

def run(job):
    i, model, s = job
    r = wave[i]
    tag = f"{i:02d}-{model}-s{s}"
    dest = outdir / f"{tag}.txt"
    # Cache only a POSITIVELY IDENTIFIED success. Enumerating failure strings was tried and it
    # leaked: `bash: ./scripts/eval.sh: Operation not permitted` is not `crash/` or `Terminated`
    # or `timeout after`, so 58 of wave 3's 72 runs were written to disk as legitimate "0 cards"
    # answers and cached forever. `eval.sh` emits exactly one shape on success — a line starting
    # `skill=` — and every failure path (stale, timeout, crash/*, and anything the SHELL says
    # before eval.sh even runs) is something else. So test for the success, not against the list.
    if dest.exists() and dest.read_text().startswith("skill="): return tag, "cached"
    env = {**os.environ, "DSH_HOME": os.path.expanduser(f"~/.dsh-eval-{model}"), "EVAL_TIMEOUT": "900"}
    p = subprocess.run(["./scripts/eval.sh", prompt_for(r)], cwd=REPO, env=env,
                       capture_output=True, text=True, timeout=1200)
    dest.write_text(p.stdout + p.stderr)
    return tag, (p.stdout.strip().splitlines() or ["(empty)"])[0][:90]

jobs = [(i, m, s) for i in range(len(wave)) for m in MODELS for s in range(SAMPLES)]
# Fingerprint the halves separately. `lib/index.js` carries the prompt and the skill and is what
# decides whether a card is attempted at all — a change there mid-wave invalidates the run. A
# change in `lib/client.js` only alters how a card RENDERS, so the runs stay valid and the
# screenshots have to be retaken. `bun test` rebuilds both, so this moves more often than expected.
def fp():
    import hashlib
    return {f: hashlib.md5((REPO / "lib" / f).read_bytes()).hexdigest()[:8] for f in ("index.js", "client.js")}
before = fp()
# `eval.sh`'s guards (stale build, wrong symlink, missing credential) exit 4 in milliseconds, and
# a wave that hits one does not fail — it "completes". Measured: waves 5 through 9 reported
# `WAVE DONE ... 72 runs` across four seconds, 360 files all reading `stale  src/ is newer than
# lib/`, and the reflection that followed was written about them. So ask the guards ONCE, before
# spending anything: a wave with nothing to measure should refuse to start, not finish instantly.
# A REAL run, not a stubbed one. The guards above are static checks and a stub would clear them
# while telling us nothing about the credential's VALUE: a key that is set but rejected produces
# `AUTH: 401` on every job, 72 times, and the wave still reports DONE. Measured — that is how the
# second attempt at wave 5 was lost, minutes after the stale-build guard had just been added for
# the first. One cheap turn up front is the only thing that distinguishes a working key.
# One probe PER MODEL HOME, because that is the thing being checked. The first version ran a
# single probe under the default `DSH_HOME`, whose model is neither of the three — it failed on
# an unrelated upstream 400 and refused a wave that would have run fine. Each home carries its
# own settings.yaml and its own credential, so only its own turn can clear it.
for probe_model in MODELS:
    probe = subprocess.run(["bash", str(REPO / "scripts" / "eval.sh"), "hi"], cwd=REPO,
                           env={**os.environ, "DSH_HOME": os.path.expanduser(f"~/.dsh-eval-{probe_model}"), "EVAL_TIMEOUT": "180"},
                           capture_output=True, text=True)
    if probe.returncode != 0:
        line = ((probe.stdout + probe.stderr).strip().splitlines() or [f"eval.sh exited {probe.returncode}"])[0]
        sys.exit(f"wave {WAVE} refused to start — {probe_model}: {line[:160]}")
# FREEZE what the wave reads. Each eval home reaches the plugin through a symlink into this
# working copy, so every job re-reads `lib/` as it starts — and an edit to `src/` plus any rebuild
# lands under jobs already in flight. That has now cost five waves: the `bun run build` guard stops
# the rebuild but cannot stop the EDIT, and `eval.sh`'s mtime check then calls the run stale. This
# wave lost 27 of 72 that way while `$dsh/web` was being written in another window.
#
# So the wave gets its own copy and points the homes at it: `src/` is then free to move, the
# fingerprint below cannot change under the run, and the numbers are about one prompt. Restored in
# a `finally` — a wave that dies mid-flight must not leave the homes pointing into /tmp.
snapshot = ROOT / "waves" / f"w{WAVE:03d}" / "plugin"
if snapshot.exists(): shutil.rmtree(snapshot)
snapshot.mkdir(parents=True)
for item in ("lib", "types", "package.json"):
    src = REPO / item
    (shutil.copytree if src.is_dir() else shutil.copy2)(src, snapshot / item)
# `node_modules` is SYMLINKED, not copied: `lib/index.js` imports real packages (`schemastery`,
# the dsh peers) and a copy in /tmp resolves none of them — measured, every job of wave 6 died with
# `Cannot find package '@deepseek-ai/schemastery'` before reaching a model. A symlink is safe here
# where a copy of `lib/` is not: the wave never writes to node_modules, and installing into it
# mid-wave is the same mistake as rebuilding, caught by the same instinct rather than by this.
(snapshot / "node_modules").symlink_to(REPO / "node_modules")
LINK = "profiles/headless/node_modules/dsh-generative-ui"
homes = [pathlib.Path(os.path.expanduser(f"~/.dsh-eval-{m}")) / LINK for m in MODELS]
restore = [(h, os.readlink(h)) for h in homes if h.is_symlink()]
for h, _ in restore:
    h.unlink(); h.symlink_to(snapshot)
# Tell `bun run build` a wave owns `lib/`. The pid is the point: a lock left behind by a wave that
# crashed answers `kill -0` with ESRCH, so it cannot block a build forever the way the earlier
# pgrep guard did. Removed in the same `finally` that restores the symlinks.
lock = REPO / ".wave-running"
lock.write_text(str(os.getpid()))
print(f"wave {WAVE}: {len(jobs)} runs  lib={before}  frozen at {snapshot}", flush=True)
# One budget per UPSTREAM, not one for the wave. `macaron-v1-*` share a backend that stalls above
# three concurrent requests — and stalling arrives as 900 seconds of silence, not an error — while
# `glm-5.2` is a different backend behind the same gateway and is not bound by that. A single pool
# of 3 would leave glm idle two thirds of the time for no reason.
import threading
# One budget per UPSTREAM, keyed by `upstream_of`. `macaron-v1-*` share a backend that stalls
# above three concurrent — and stalling arrives as 900 seconds of silence, not an error — while
# every other family is a different backend behind the same gateway and is not bound by that.
# A single shared pool would make the slowest upstream's limit everyone's: measured, wave 5's
# retry was 27 macaron jobs running 3-wide for ~25 minutes with every other slot idle.
GATES = {u: threading.Semaphore(3) for u in {upstream_of(m) for m in MODELS}}
def gated(job):
    with GATES[upstream_of(job[1])]: return run(job)
try:
    # Enough workers for every upstream to hold its full budget at once; the semaphores,
    # not the pool, are what keeps any one backend from being overrun.
    with cf.ThreadPoolExecutor(max_workers=3 * len(GATES)) as ex:
        for tag, line in ex.map(gated, jobs):
            print(f"  {tag}: {line}", flush=True)
finally:
    lock.unlink(missing_ok=True)
    for h, target in restore:
        if h.is_symlink(): h.unlink()
        h.symlink_to(target)
after = fp()
if after["index.js"] != before["index.js"]:
    print(f"CONTAMINATED: lib/index.js changed mid-wave ({before['index.js']} -> {after['index.js']}) — the prompt moved under the run", flush=True)
elif after["client.js"] != before["client.js"]:
    print(f"note: lib/client.js changed mid-wave ({before['client.js']} -> {after['client.js']}) — verdicts stand, RE-SHOOT the screenshots", flush=True)
print("WAVE DONE", WAVE, flush=True)
