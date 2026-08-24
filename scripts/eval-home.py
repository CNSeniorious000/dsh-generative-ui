# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Create (or refresh) one eval home for a model: `uv run scripts/eval-home.py gemini-3.7-flash`

Each home is a sibling of `~/.dsh` with its own `settings.yaml` naming ONE model, so a wave can
measure several models at once without any of them editing the others' state. Everything else —
credentials, the anonymous id, the headless profile — is shared by symlink, because a copied
credential goes stale and fails as an auth error that looks exactly like a refused rule.

`settings.yaml` must be a REAL FILE here, never a symlink back to the shared home: with a symlink,
setting one home's model silently sets every home's, and the wave then measures one model three
times while reporting three.

Every eval home gets `reasoningEffort: low`, and that is not a global change — only these homes
carry it. A wave measures whether the PROMPT changed what the model writes, and thinking budget is
orthogonal to that: at the default effort a reasoning model can spend thousands of tokens before
its first content character (glm-5.2 measured at 7432), which buys the measurement nothing and
costs wall-clock on every one of 72 runs. `EVAL_EFFORT=…` overrides.
"""
import os, pathlib, shutil, sys

model = sys.argv[1]
effort = os.environ.get("EVAL_EFFORT", "low")
shared = pathlib.Path.home() / ".dsh"
home = pathlib.Path.home() / f".dsh-eval-{model}"
(home / "profiles").mkdir(parents=True, exist_ok=True)
if not (home / "profiles" / "headless").exists():
    shutil.copytree(shared / "profiles" / "headless", home / "profiles" / "headless", symlinks=True)
for name in (".credentials.yaml", ".anonymous-user-id"):
    link = home / name
    if (shared / name).exists():
        if link.is_symlink() or link.exists(): link.unlink()
        link.symlink_to(shared / name)

# Rewrite only the `agent-default-model` stanza; everything else (providers, keys) rides along.
lines = (shared / "settings.yaml").read_text().split("\n")
start = lines.index("agent-default-model:")
end = next((i for i in range(start + 1, len(lines)) if lines[i] and not lines[i][0].isspace()), len(lines))
stanza = [l for l in lines[start + 1:end] if not l.strip().startswith(("model:", "reasoningEffort:"))]
stanza += [f"  model: {model}", f"  reasoningEffort: {effort}"]
(home / "settings.yaml").write_text("\n".join(lines[:start + 1] + stanza + lines[end:]))

# Read back rather than trust the write: an earlier sed version put both keys on ONE line, which
# yaml accepts as a single scalar and which only a read-back catches.
written = (home / "settings.yaml").read_text().split("\n")
s2 = written.index("agent-default-model:")
e2 = next((i for i in range(s2 + 1, len(written)) if written[i] and not written[i][0].isspace()), len(written))
got = {k.strip(): v.strip() for k, _, v in (l.partition(":") for l in written[s2 + 1:e2]) if k.strip()}
if got.get("model") != model: sys.exit(f"eval-home: wrote model={got.get('model')!r}, wanted {model!r}")
if got.get("reasoningEffort") != effort: sys.exit(f"eval-home: wrote reasoningEffort={got.get('reasoningEffort')!r}, wanted {effort!r}")
print(f"{home}  model={model}  effort={effort}")
