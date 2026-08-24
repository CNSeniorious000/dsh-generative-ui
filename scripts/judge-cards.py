# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx~=0.28"]
# ///
"""Grade a directory of cards on their SCREENSHOTS, with a panel of five vision models.

Every other check here reads the source or the DOM. None can see whether a card is any good to
look at — a board whose cells overlap by 91% passes all 30 screens, paints, and mounts. This is
the check that catches that, and it found exactly that on a reference card.

Each card is judged on six images (320 / 440 / 720 in both themes) plus its TSX, on four axes:
cognitive load, alignment and grid, colour and borders, and whether the layout responds at all.
Verdicts cache by md5(model + card + source), so a rerun costs nothing.

Usage, with the shots already taken by `scripts/shot-card.mjs`:

    LITELLM_KEY=... uv run scripts/judge-cards.py

    SHOTS_DIR   where <card>.<theme>.<width>.png live   (default /tmp/shots)
    CARDS_DIR   where <card>.tsx live                   (default /tmp/judgecards)

Refuses to grade a card whose images are missing or blank, and prints what it skipped: a verdict
about a dead harness reads exactly like a verdict about a bad card.
"""
import asyncio, base64, hashlib, json, os, pathlib, sys, httpx

KEY = os.environ["LITELLM_KEY"]  # never hardcode: this is the user's gateway key
# The clhh gateway carries all five of the models below and was probed reading text off a real
# screenshot on each — worth doing before a run rather than after, because a model without vision
# answers the rubric from the SOURCE alone and its verdict reads exactly like a real one.
BASE = os.environ.get("LITELLM_BASE", "http://34.177.103.253:4000")
MODELS = ["kimi-k3", "gemini-3.7-flash", "grok-4.6", "claude-opus-5", "gpt-5.6-sol"]
WIDTHS = [320, 440, 720]
SHOTS = pathlib.Path(os.environ.get("SHOTS_DIR", "/tmp/shots"))
CARDS = pathlib.Path(os.environ.get("CARDS_DIR", "/tmp/judgecards"))
CACHE = pathlib.Path("/tmp/judge-cache"); CACHE.mkdir(exist_ok=True)
OUT = pathlib.Path("/tmp/judge-results.jsonl")

# `shoot-wave.sh` strips the whole `.ui4a.tsx` suffix chain when it names shots, so a card looked
# up under its raw stem finds none of its own images and is skipped — which reads exactly like a
# card that rendered nothing. Wave 2 was reported as 27 unjudgeable cards for this reason alone.
def shot_stem(card: str) -> str:
    return card.removesuffix(".ui4a")


RUBRIC = """你在评审一个嵌在聊天流里的生成式 UI 卡片。它渲染在别人的应用里（不是整页），宽度由读者拖动，
所以下面给了三个断点 320 / 440 / 720，每个断点都有浅色和深色两版，最后是它的 TSX 源码。

只挑真正做得不够好的地方，按这四类给出具体、可执行的批评：

1. **认知负担**：信息是否一次性糊上来太多？有没有该折叠进二级菜单/详情/渐进展示的内容？层级是否清楚？
2. **对齐与排版**：有没有网格系统？该左对齐的是否居中了？间距是否成体系（4/8 的倍数）还是随手写的？
   行/列切分是否合理——尤其在 720 宽时是否还是单列、浪费了横向空间？
3. **配色与描边**：颜色是否太繁杂？**同时用底色和边框来区分同一个层级是反模式**——是否犯了？
   对比度够不够？选中态是否只靠颜色表达？深色版是否只是把浅色反过来、没有单独调过？
4. **响应式**：三个断点之间布局有变化吗？还是同一套死布局被拉宽？窄的时候有没有挤压/换行/溢出？

要求：
- 每条批评必须指向图上或源码里具体的元素，并给出改法。不要泛泛而谈。
- 如果某一类确实没问题，直接写「无」，不要硬凑。
- 最后单独一行 `SCORE: N/10`（10 = 可以直接上线）。
- 简体中文，总共不超过 500 字。"""


def b64(p): return base64.b64encode(p.read_bytes()).decode()


def content_for(card):
    parts = [{"type": "text", "text": RUBRIC + f"\n\n卡片：{card}"}]
    n = 0
    for w in WIDTHS:
        for theme in ("light", "dark"):
            f = SHOTS / f"{shot_stem(card)}.{theme}.{w}.png"
            if not f.exists(): continue
            parts.append({"type": "text", "text": f"\n{w}px {'浅色' if theme=='light' else '深色'}："})
            parts.append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64(f)}"}})
            n += 1
    src = (CARDS / f"{card}.tsx").read_text()
    parts.append({"type": "text", "text": f"\n源码：\n```tsx\n{src}\n```"})
    return parts, n, src


async def judge(c, model, card, parts, fp):
    key = hashlib.md5((model + card + fp).encode()).hexdigest()
    f = CACHE / f"{key}.json"
    if f.exists(): return json.loads(f.read_text())
    try:
        r = await c.post("/v1/chat/completions",
                         json={"model": model, "max_tokens": 3000, "messages": [{"role": "user", "content": parts}]})
        out = r.json()["choices"][0]["message"]["content"] if r.status_code == 200 else f"HTTP {r.status_code}: {r.text[:200]}"
    except Exception as e:
        out = f"ERR {type(e).__name__}: {e}"
    rec = {"model": model, "card": card, "verdict": out}
    f.write_text(json.dumps(rec, ensure_ascii=False))
    return rec


async def main():
    cards = sorted(p.stem for p in CARDS.glob("*.tsx"))
    sem = asyncio.Semaphore(6)
    results = []
    async with httpx.AsyncClient(base_url=BASE, timeout=600, headers={"Authorization": f"Bearer {KEY}"}) as c:
        async def one(card, model, parts, fp):
            async with sem:
                r = await judge(c, model, card, parts, fp)
                mark = "ok" if not r["verdict"].startswith(("HTTP", "ERR")) else "!!"
                print(f"{mark} {card:14} {model}", flush=True)
                return r
        tasks = []
        skipped = []
        for card in cards:
            parts, n, src = content_for(card)
            # A card judged on missing or blank images is a verdict about the harness. Refuse it
            # loudly rather than letting it quietly narrow the denominator — a dead harness port
            # and a card that renders nothing produce the same 40px image.
            if n < len(WIDTHS) * 2:
                skipped.append(f"{card} ({n}/{len(WIDTHS)*2} images)"); continue
            tiny = [w for w in WIDTHS
                    if (SHOTS / f"{shot_stem(card)}.light.{w}.png").stat().st_size < 5000]
            if tiny:
                skipped.append(f"{card} (blank at {tiny})"); continue
            fp = hashlib.md5((src + str(n)).encode()).hexdigest()
            print(f"# {card}: {n} images", flush=True)
            tasks += [one(card, m, parts, fp) for m in MODELS]
        if skipped:
            print("SKIPPED (not judged): " + "; ".join(skipped), flush=True)
        results = await asyncio.gather(*tasks)
    with OUT.open("w") as fh:
        for r in results: fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"JUDGEDONE {len(results)} verdicts -> {OUT}", flush=True)

asyncio.run(main())
