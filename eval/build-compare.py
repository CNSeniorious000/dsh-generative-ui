# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Bake the two theme token sets into `live-compare.html` and serve it through the surface harness.

The tokens have to be inlined rather than fetched: the harness only inlines ONE theme, into its own
`/` page, and this page shows both on a toggle. They are written onto `body` and
`body[data-ds-dark-theme]` — the host's own selectors — so a card sees exactly what it sees in dsh.

    uv run eval/build-compare.py            # writes /tmp/ui4a-live.html
"""
import json, pathlib

REPO = pathlib.Path(__file__).resolve().parent.parent


def block(selector: str, theme: str) -> str:
    tokens = json.loads((REPO / "test/fixtures" / f"dsw-tokens-{theme}.json").read_text())
    return selector + "{" + ";".join(f"{k}:{v}" for k, v in tokens.items()) + "}"


def main() -> None:
    page = (REPO / "eval/live-compare.html").read_text()
    css = f"<style>{block('body', 'light')}{block('body[data-ds-dark-theme]', 'dark')}</style>"
    out = pathlib.Path("/tmp/ui4a-live.html")
    out.write_text(page.replace("<!--TOKENS-->", css))
    print(f"{out} — {len(out.read_text()):,} bytes")


if __name__ == "__main__":
    main()
