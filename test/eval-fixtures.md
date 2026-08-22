# Behaviour fixtures

Prompts whose outcome is measured and recorded in CLAUDE.md §4.5. Re-run when the resident
prompt changes — it is the only thing that catches a new rule eating its neighbours.

Count BOTH fences in the reply AND files under `.dsh/ui4a/canvases/`. Counting only fences
misses every canvas, which is the shape most likely on requests about a whole set of things.

## Must stay prose

| prompt | why |
| --- | --- |
| `什么是闭包？` | an explanation; the model judged it twice |
| `今天星期几` | one line |
| `HTTP 状态码 418 是什么意思` | a fact |
| `什么是尾递归优化` | mostly prose (~5/7); a card here is a stack-frame walk, which is legitimate |

## Must produce UI

| prompt | shape it tests |
| --- | --- |
| `帮我算下房贷` | numbers the user changes |
| `帮我看看 BMI 正常范围` | a threshold |
| `给我五个猫名` | asking for a few means asking for more |
| `这个 cron 到底几点跑？*/17 3-5 * * 2` | an expression in hand |
| `这个 glob 会匹配到啥 src/**/*.{ts,tsx}` | same |
| `chmod 755 到底是啥权限` | same |
| `这个目录下都有啥文件，我想快速看看每个文件里写了什么` | browsing — expect UI reading the workspace live; fence or canvas both pass, it tracks how big the directory is |
| `帮我把 .env 弄明白，有几个值我要改` | an unnamed value — expect a form that writes the file |
| `想开始跑步，怎么循序渐进` | a plan is followed over weeks — expect a CANVAS |
| `我想学吉他，从哪开始` | same; prose answer hid a week-1 table |
| `98 华氏度是多少摄氏度` | a conversion is never asked once — expect a pair of fields |
| `git reset --soft --mixed --hard 有啥区别` | a concept with nothing to compute; expect three boxes and a button |
| `二分查找的原理是什么` | 原理 / 什么是 is the same wish worded as a lookup |

## Correctness, not just presence

| prompt | truth |
| --- | --- |
| `帮我算下 30 年期 100 万贷款利率 4.2% 的月供` | 4890.17 |
| `5 公斤 3 两 是多少磅` | 11.35 |
| `这个 cron 一年跑多少次？0 3 * * 1` | 52 or 53, depending on the year |

Use `scripts/eval.sh '<prompt>' [seed-dir]`. It reports `crash` with a non-zero exit when the run
never reached a model, because a dead run and a refused rule both read as `fence=0` — that has been
mistaken for a finding three times.

Run these in a workspace with **real files in it**. An empty directory changes the answer, and not
always in the direction you would guess: the glob fixture scored 2/3 empty and 0/3 against a real
`src/` tree, because having something to look at made the model explain instead of show.

Measure a shape change over **at least 3 runs per prompt**. Single runs flap: `5 公斤 3 两`
read 1 once in seven while its true rate was 0, which nearly attributed a regression to a commit.

## Second turn

Ask for a pomodoro canvas, then `这个不对，休息应该是 10 分钟不是 5 分钟` — expect a one-line
`str_replace`, not a rewrite. Then `把它改成横着的，字太小了看不清` — expect the pronoun to
resolve and an `@container` breakpoint rather than an unconditional row.

## Not yet covered

Every resident rule has a fixture except one: **"Visualise this" / "show me a chart" is this block,
not a tool.** It guards against reaching for `run_code` or a plotting library, which a fence count
cannot see — the check has to read the tool calls, not the reply. Until it has one, that rule is
the only part of the resident layer being paid for on every request without evidence it changes
anything.

Suggested probe: `帮我把这几个数画成图 12 45 33 78` in a workspace with Python available, asserting
that no `run_code`-shaped call appears and a fence does.
