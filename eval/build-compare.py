# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Build the live before/after page: pull the four paired cards out of two rounds, bake the themes.

Both halves have to happen here rather than in the page. The **pairs** are read from the rounds'
own `meta.json`, so the sources shown are byte-for-byte what the model wrote — quoting them into
the page by hand is how a comparison stops being evidence. The **tokens** are inlined because the
harness only ever writes ONE theme into its own `/` page, and this page carries both on a toggle;
they go onto `body` and `body[data-ds-dark-theme]`, the host's own selectors, so a card sees
exactly what it sees in dsh.

    uv run eval/build-compare.py
    HARNESS_PAGE=/tmp/ui4a-live.html HARNESS_DATA=/tmp/ui4a-pairs.json bun scripts/surface-harness.ts 47311
    open http://127.0.0.1:47311/page
"""
import json, os, pathlib

REPO = pathlib.Path(__file__).resolve().parent.parent
ROUNDS = pathlib.Path(os.environ.get("UI4A_ROUNDS", pathlib.Path.home() / ".cache/ui4a-suite/rounds"))
# (case, model, what the conversation is about). Each is a run where the two rounds differ on the
# one thing under test: the before card records the answer and loses it on reload, the after card
# keeps it. Verified pairs, not a sample — `eval/delta.py` is where the rate lives.
PAIRS = [("laptop-pick", "macaron-v1-venti", "选笔记本"), ("trip-plan", "grok-4.6", "安排旅行"),
         ("palette", "glm-5.2", "定配色"), ("db-choice", "grok-4.6", "挑数据库")]


def committed_card(round_name: str, case: str, model: str) -> dict | None:
    """The first turn of that run where a click actually sent something, with its card's source."""
    meta_path = ROUNDS / round_name / case / model / "meta.json"
    if not meta_path.exists():
        return None
    for turn in json.loads(meta_path.read_text())["turns"]:
        if not turn.get("reload") or not turn["cards"] or not any(click["sent"] for click in turn["clicks"]):
            continue
        source = meta_path.parent / f"turn-{turn['n']:02d}.{turn['cards'][0]['id']}.tsx"
        if not source.exists():
            continue
        return {"turn": turn["n"], "user": turn["user"], "code": source.read_text(errors="replace"),
                "recorded": turn["reload"].get("recorded"), "persisted": turn["reload"].get("persisted")}
    return None


def theme_block(selector: str, theme: str) -> str:
    tokens = json.loads((REPO / "test/fixtures" / f"dsw-tokens-{theme}.json").read_text())
    return selector + "{" + ";".join(f"{name}:{value}" for name, value in tokens.items()) + "}"


def main() -> None:
    pairs = []
    for case, model, title in PAIRS:
        before, after = committed_card("r001", case, model), committed_card("r002", case, model)
        if before is None or after is None:
            print(f"  skipped {case}/{model} — no committed turn in {'r001' if before is None else 'r002'}")
            continue
        pairs.append({"case": case, "model": model, "title": title, "before": before, "after": after})

    data = pathlib.Path("/tmp/ui4a-pairs.json")
    data.write_text(json.dumps(pairs, ensure_ascii=False))
    page = pathlib.Path("/tmp/ui4a-live.html")
    css = f"<style>{theme_block('body', 'light')}{theme_block('body[data-ds-dark-theme]', 'dark')}</style>"
    page.write_text((REPO / "eval/live-compare.html").read_text().replace("<!--TOKENS-->", css))
    print(f"{len(pairs)} pairs -> {data} ({data.stat().st_size:,} B), page -> {page} ({page.stat().st_size:,} B)")


if __name__ == "__main__":
    main()
