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
import concurrent.futures as cf, hashlib, json, os, pathlib, subprocess, sys

ROOT = pathlib.Path(os.environ.get("WAVE_ROOT", "/tmp/genui-loop"))
REPO = pathlib.Path(__file__).resolve().parent.parent
MODELS = ["macaron-v1-venti", "macaron-v1-coding-venti", "glm-5.2"]
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
    if dest.exists() and dest.stat().st_size: return tag, "cached"
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
print(f"wave {WAVE}: {len(jobs)} runs  lib={before}", flush=True)
# One budget per UPSTREAM, not one for the wave. `macaron-v1-*` share a backend that stalls above
# three concurrent requests — and stalling arrives as 900 seconds of silence, not an error — while
# `glm-5.2` is a different backend behind the same gateway and is not bound by that. A single pool
# of 3 would leave glm idle two thirds of the time for no reason.
import threading
GATES = {"macaron": threading.Semaphore(3), "glm": threading.Semaphore(3)}
def gated(job):
    g = GATES["glm" if job[1].startswith("glm") else "macaron"]
    with g: return run(job)
with cf.ThreadPoolExecutor(max_workers=6) as ex:
    for tag, line in ex.map(gated, jobs):
        print(f"  {tag}: {line}", flush=True)
after = fp()
if after["index.js"] != before["index.js"]:
    print(f"CONTAMINATED: lib/index.js changed mid-wave ({before['index.js']} -> {after['index.js']}) — the prompt moved under the run", flush=True)
elif after["client.js"] != before["client.js"]:
    print(f"note: lib/client.js changed mid-wave ({before['client.js']} -> {after['client.js']}) — verdicts stand, RE-SHOOT the screenshots", flush=True)
print("WAVE DONE", WAVE, flush=True)
