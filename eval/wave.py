# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx~=0.28", "pyyaml~=6.0", "pillow~=11.0"]
# ///
"""One round: every case against every model, then the judge panel.

Three things this does that a plain `for case: for model:` would not.

**It freezes the plugin.** `lib/` is copied into the round's own directory and each eval home's
`dsh-generative-ui` symlink is repointed at that copy for the duration. Five waves in this repo's
history were lost to a `src/` edit in another window moving the prompt under jobs already running,
and every guard that watched the ACTION (building) missed an editor that simply saved a file.
Guarding the ARTEFACT needs one copy. Restored in a `finally`.

**It budgets by upstream, not by job.** Six of these models sit behind three gateways and one of
them (`mintcn`) 502s above three in flight; a single global limit either starves the fast ones or
melts the slow one. One semaphore per upstream, plus one for chromium, which is memory rather than
rate.

**It keeps partial runs.** A conversation cut off at turn six is six turns of evidence. The runs
that get discarded are the ones whose text says the process died, never the ones that ran short.
"""
import argparse, asyncio, json, os, pathlib, shutil, signal, subprocess, sys, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from cases import CASES, BY_ID
import drive, judge

REPO = pathlib.Path(__file__).resolve().parent.parent
ROOT = pathlib.Path(os.environ.get("UI4A_ROOT", pathlib.Path.home() / ".cache" / "ui4a-suite"))
MODELS = ["macaron-v1-venti", "macaron-v1-coding-venti", "glm-5.2", "gemini-3.7-flash", "grok-4.6",
          "gpt-5.6-terra", "kimi-k3", "minimax-m3", "glm-5.3-flash", "step-3.7-flash"]
# Which gateway a model queues behind, and how many it will take. Read off `~/litellm_config.yaml`
# on the gateway host rather than guessed: `mintcn` carries the whole macaron family AND glm-5.2,
# and the macaron arms 502 under sustained double-digit concurrency.
UPSTREAM = {"macaron-v1-venti": ("mintcn", 3), "macaron-v1-coding-venti": ("mintcn", 3), "glm-5.2": ("mintcn", 3),
            "glm-5.3-flash": ("novita", 4), "minimax-m3": ("novita", 4), "step-3.7-flash": ("novita", 4),
            "kimi-k3": ("pi-api", 2), "gpt-5.6-terra": ("copilot", 3), "grok-4.6": ("copilot", 3),
            "gemini-3.7-flash": ("copilot-b", 3)}
# How many conversations are in flight at once. The binding resource is MEMORY, not rate: each run
# holds a dsh (node), a chromium with two pages, and a python — about 400MB together. This machine
# was measured at 27.7 of 29.7GB of swap already in use by other work, so the cap is set by what can
# be added without making it thrash, not by what the gateways would accept.
RUNS = int(os.environ.get("UI4A_RUNS", 8))


def freeze(round_dir: pathlib.Path) -> pathlib.Path:
    """Copy what dsh loads into the round, so an edit to `src/` cannot move it mid-run."""
    frozen = round_dir / "plugin"
    if frozen.exists(): return frozen
    frozen.mkdir(parents=True)
    # Exactly what `package.json`'s `files` and `dsh.bundle.patch` name. Copying only lib/ and
    # types/ left out `cordis.patch.yml`, and dsh refuses to boot at all without the overlay a
    # plugin declares — `failed to read overlay …: ENOENT`, before a single run reaches a model.
    for name in ("package.json", "cordis.patch.yml", "lib", "types"):
        source = REPO / name
        if not source.exists(): sys.exit(f"wave: {source} is missing — run `bun run build` first")
        (shutil.copytree if source.is_dir() else shutil.copy2)(source, frozen / name)
    # Dependencies are SYMLINKED, not copied. `lib/index.js` imports `@deepseek-ai/schemastery` and
    # friends, which resolve out of the plugin's own node_modules — a frozen copy without them does
    # not load at all. They are also not what a wave is protecting itself from: the thing that moves
    # mid-run is `src/`, and `node_modules` is 700MB that would be copied per round for nothing.
    (frozen / "node_modules").symlink_to(REPO / "node_modules")
    return frozen


def repoint(models: list[str], target: pathlib.Path) -> dict[pathlib.Path, str]:
    """Point every eval home at `target`, returning what each link should be restored to.

    Restored to the REPO, not to whatever the link happened to say. A wave killed with SIGTERM
    never runs its `finally`, so the next wave reads a link still pointing at the previous round's
    frozen copy and faithfully puts it back on exit — leaving every home loading a snapshot the
    next round will delete. The canonical value is the checkout; a frozen path is debris.
    """
    was = {}
    for model in models:
        link = pathlib.Path.home() / f".dsh-ui4a-{model}" / "profiles" / "headless" / "node_modules" / "dsh-generative-ui"
        if not link.parent.is_dir(): sys.exit(f"wave: {link.parent} is missing — run `uv run eval/homes.py {model}`")
        current = os.readlink(link) if link.is_symlink() else ""
        was[link] = str(REPO) if current == "" or "/rounds/" in current else current
        if link.is_symlink(): link.unlink()
        elif link.exists(): sys.exit(f"wave: {link} is a real directory, not a link — refusing to replace it")
        link.symlink_to(target)
    return was


async def harnesses(light: int, dark: int) -> list[subprocess.Popen]:
    """The two surface servers, shared by every run: they hold no per-card state."""
    procs = []
    for port, theme in ((light, "light"), (dark, "dark")):
        log = open(ROOT / f"harness-{theme}.log", "ab")
        procs.append(subprocess.Popen(["bun", str(REPO / "scripts" / "surface-harness.ts"), str(port)],
                                      cwd=str(REPO), env={**os.environ, "THEME": theme}, stdout=log, stderr=log))
    import httpx
    async with httpx.AsyncClient(timeout=5) as client:
        for port in (light, dark):
            for _ in range(60):
                try:
                    if (await client.get(f"http://127.0.0.1:{port}/")).status_code == 200: break
                except Exception: pass
                await asyncio.sleep(0.5)
            else: sys.exit(f"wave: the surface harness never came up on {port}")
    return procs


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("round")
    ap.add_argument("--cases", default="", help="comma-separated ids; default all")
    ap.add_argument("--models", default="", help="comma-separated; default all ten")
    ap.add_argument("--timeout", type=float, default=1500, help="per multi-turn run; single-turn gets a fifth")
    ap.add_argument("--light", type=int, default=47801); ap.add_argument("--dark", type=int, default=47802)
    ap.add_argument("--no-judge", action="store_true")
    args = ap.parse_args()

    cases = [BY_ID[c] for c in args.cases.split(",")] if args.cases else CASES
    models = args.models.split(",") if args.models else MODELS
    round_dir = ROOT / "rounds" / args.round
    round_dir.mkdir(parents=True, exist_ok=True)
    ROOT.mkdir(parents=True, exist_ok=True)
    frozen = freeze(round_dir)
    (round_dir / "manifest.json").write_text(json.dumps(
        {"cases": [c["id"] for c in cases], "models": models, "user_agent": drive.USER_AGENT_MODEL,
         "judges": judge.JUDGES, "timeout": args.timeout, "started": time.time()}, indent=1))

    gates = {name: asyncio.Semaphore(size) for name, size in {u: n for u, n in UPSTREAM.values()}.items()}
    inflight = asyncio.Semaphore(RUNS)
    restore = repoint(models, frozen)
    # The same lock `scripts/build.ts` already honours, naming this process so a dead wave's lock
    # is detectably dead. A round here is protected by its own frozen copy and would survive a
    # rebuild, but a `bun run build` in another window still churns `lib/` under whatever runs
    # next, and the pre-push hook rebuilt it mid-round once already.
    lock = REPO / ".wave-running"
    lock.write_text(str(os.getpid()))
    # A `finally` does not run when the process is killed, and every wave in this repo has ended by
    # hand at least once. Turning the signal into an exception is what lets the homes be put back.
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    servers = await harnesses(args.light, args.dark)
    done, started = 0, time.time()
    total = len(cases) * len(models)

    async def one(case, model):
        nonlocal done
        out = round_dir / case["id"] / model
        if (out / "meta.json").exists():
            meta = json.loads((out / "meta.json").read_text())
            # A cached run is replayed only if it actually ran. `error`/`running` mean the process
            # died, and caching that reads exactly like the model producing nothing.
            if meta.get("status") in ("complete", "timeout"):
                done += 1
                return meta
        timeout = args.timeout if case["kind"] == "multi" else args.timeout / 5
        async with gates[UPSTREAM[model][0]], inflight:
            meta = await drive.run(case, model, out, (args.light, args.dark), timeout)
        done += 1
        turns, cards = len(meta["turns"]), sum(len(t["cards"]) for t in meta["turns"])
        print(f"[{done}/{total}] {meta['status']:9} {case['id']:12} {model:24} turns={turns} cards={cards} {meta['elapsed']}s", flush=True)
        return meta

    try:
        metas = await asyncio.gather(*[one(c, m) for c in cases for m in models], return_exceptions=True)
    finally:
        lock.unlink(missing_ok=True)
        for link, was in restore.items():
            if link.is_symlink(): link.unlink()
            if was: link.symlink_to(was)
        for proc in servers: proc.terminate()

    ok = [m for m in metas if isinstance(m, dict)]
    print(f"\nWAVE {args.round}: {len(ok)}/{total} ran, {sum(1 for m in ok if m['status'] == 'timeout')} cut short, "
          f"{sum(1 for m in metas if not isinstance(m, dict))} failed, {round(time.time() - started)}s")
    for m in metas:
        if not isinstance(m, dict): print("  FAILED:", repr(m)[:200])

    if args.no_judge: return
    print("\njudging…", flush=True)
    panel = asyncio.Semaphore(4)

    async def score(meta):
        out = round_dir / meta["case"] / meta["model"]
        async with panel:
            try: return {"case": meta["case"], "model": meta["model"], **(await judge.judge_run(out))}
            except Exception as error: return {"case": meta["case"], "model": meta["model"], "status": f"error: {error}"[:200]}

    verdicts = await asyncio.gather(*[score(m) for m in ok if m["turns"]])
    (round_dir / "verdicts.json").write_text(json.dumps(verdicts, ensure_ascii=False, indent=1))
    scored = [v for v in verdicts if v.get("status") == "ok"]
    print(f"scored {len(scored)}/{len(verdicts)}")
    if scored:
        keys = ["trigger", "clarify", "interaction", "hierarchy", "craft", "overall"]
        print("  " + "  ".join(f"{k}={sum(v['mean'][k] for v in scored) / len(scored):.2f}" for k in keys))


if __name__ == "__main__":
    asyncio.run(main())
