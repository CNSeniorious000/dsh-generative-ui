# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""The conversations this suite measures.

Every eval in this repo until now has been ONE turn. The rules being tested are about the second
clarification and the tenth — whether a card comes back when a new ambiguity appears, whether a
choice survives a refresh, whether options that need explaining get a preview instead of firing
the turn. A first-turn corpus cannot see any of that.

Two halves, and both are load-bearing:

* `multi` cases run to `turns` rounds with an agent playing the user. They are written so that a
  SECOND ambiguity appears well after the first — that is the whole point, and a case whose only
  fork is in turn one measures what the old waves already measured.
* `single` cases are the fixed points from CLAUDE.md §4.5. Two must produce UI and two must stay
  prose. Without the negative pair a suite cannot tell "the rules improved" from "the rules now
  fire on everything", which is the failure mode every trigger change in this repo has risked.

`persona` is read by the agent playing the user, never by the model under test. It says what the
person actually wants and what they will not volunteer unless asked — the ambiguity has to be
real, so the persona holds information back rather than the opening being artificially terse.

`expect` is NOT a rubric. Judges are shown the scenario, not a checklist of defects to look for:
a judging prompt that names a defect and asks whether it occurred manufactures it about two thirds
of the time (measured — `rubric-leading-question-fabricates-defects`). It exists so a judge knows
what the conversation was trying to accomplish.
"""

CASES = [
    # ── multi-turn ───────────────────────────────────────────────────────────────────────────
    {
        "id": "db-choice", "kind": "multi", "turns": 10,
        "opening": "我想给一个自用的小工具挑个数据库，你觉得用哪个好",
        "persona": "你在写一个只有自己用的记账小工具，跑在一台小服务器上，数据量很小但有事务性的账目。你不懂运维，怕麻烦。你不会主动说出这些约束，除非对方问。当对方给出可点选的界面时你就点，而不是打字。中途你会改主意问「如果以后要多人一起用呢」，这是一个新的分叉点。",
        "expect": "选项之间的差别需要解释，适合先预览再提交；第 5-7 轮出现的多人场景是一个新的待澄清点。",
    },
    {
        "id": "trip-plan", "kind": "multi", "turns": 10,
        "opening": "帮我安排一下下个月的旅行",
        "persona": "你想在下个月出去玩五天，预算中等，讨厌赶行程。你不会一次说完，等对方问。后面你会说「同行的人不想爬山」，这推翻了之前的一部分安排，需要重新澄清。",
        "expect": "开场几乎没有信息，先问清楚再动手；同行者的新约束是第二个分叉点。",
    },
    {
        "id": "regex-log", "kind": "multi", "turns": 10,
        "opening": "帮我写个正则，把日志里的时间戳抠出来",
        "persona": "你手上的日志是 `2026-08-28T06:12:03.114Z INFO ...` 这种，但你一开始不会贴样例。后面你会换成 nginx 的 `[28/Aug/2026:06:12:03 +0800]` 格式，要求同一个正则两种都能吃。",
        "expect": "边写边测的场景；换格式是第二次需要重新确认意图的地方。",
    },
    {
        "id": "diet-log", "kind": "multi", "turns": 12,
        "opening": "我今天早上吃了两个鸡蛋一杯豆浆，帮我记一下",
        "persona": "你在记一天的饮食。你会分好几次追加（午饭、加餐、晚饭），偶尔纠正之前记错的一条。你关心累计热量。你不会说自己在减脂，除非对方问目标。",
        "expect": "反复重述同一份清单的场景；一旦对方问起目标，那是一个可以用界面问的分叉点。",
    },
    {
        "id": "cron-read", "kind": "multi", "turns": 10,
        "opening": "*/17 3-5 * * 2 这个 cron 到底几点跑？",
        "persona": "你在读别人写的 crontab。搞懂之后你会想改成「每周二凌晨只跑一次」，再后来想知道一年跑多少次。你会点界面上的东西而不是打字问。",
        "expect": "一个用户手里攥着的表达式；后面两次都是新的、可以就地改参数的问题。",
    },
    {
        "id": "api-shape", "kind": "multi", "turns": 10,
        "opening": "帮我设计一下这个服务的接口",
        "persona": "你要做一个「团队共享待办」的后端，但一开始什么都没说。等对方问才会说出：要有多人协作、要能看历史。后面你会加一条「还要支持第三方接入」，这需要重新讨论鉴权方式，是新的分叉。",
        "expect": "开场信息为零；鉴权是后半程才出现的第二个需要选择的地方。",
    },
    {
        "id": "palette", "kind": "multi", "turns": 10,
        "opening": "帮我定一套配色",
        "persona": "你在做一个记账 App 的界面。你说不清想要什么风格，看到东西才知道喜不喜欢。后面你会说「暗色模式下这套不好看」，要求两套一起看。",
        "expect": "选项的意义只有看到才知道；暗色模式是第二个分叉点。",
    },
    {
        "id": "sort-learn", "kind": "multi", "turns": 10,
        "opening": "快排到底是怎么跑的，我一直没搞明白",
        "persona": "你是个初学者，看文字讲解看不懂，需要一步步看。搞懂快排之后你会问「那归并排序呢，哪个快」，这是一个新的比较型问题。",
        "expect": "过程型的解释；后半程的比较是另一种适合界面的形状。",
    },
    {
        "id": "aa-split", "kind": "multi", "turns": 10,
        "opening": "我们三个人吃饭 AA，但有人没喝酒，怎么算",
        "persona": "总共 486 元，其中酒水 180。三个人里一个人没喝。你会先问怎么算，然后追加「又来了一个人，他只吃了甜点 38」，再后来想按比例而不是均摊。",
        "expect": "有几个用户会想改的数字；后面两次追加都改变了算法本身。",
    },
    {
        "id": "git-undo", "kind": "multi", "turns": 10,
        "opening": "我刚才 git reset --hard 了，东西还能找回来吗",
        "persona": "你慌了。你不知道自己有没有 commit 过，也不知道改动是在暂存区还是工作区 —— 这几种情况救法完全不同。后面你会说「找回来之后想只挑其中一个文件」。",
        "expect": "答案取决于几个用户自己也说不清的分支；挑单个文件是第二个分叉点。",
    },
    {
        "id": "laptop-pick", "kind": "multi", "turns": 10,
        "opening": "想换台笔记本，帮我看看买哪个",
        "persona": "你主要跑本地模型和写代码，偶尔剪片子。预算你一开始不说。后面你会加一条「要能带着到处跑」，这让重量和续航突然变成主要矛盾。",
        "expect": "多路比较；便携性是后来才出现的新约束。",
    },
    {
        "id": "resume-fix", "kind": "multi", "turns": 10,
        "opening": "帮我改改简历",
        "persona": "你在投一个偏基础设施的岗位，但一开始不说岗位也不贴简历。等对方问才给。后面你会说「这段经历要不要写进去」，那是一个是否取舍的选择题。",
        "expect": "开场无从下手，必须先问；取舍是第二个需要选择的地方。",
    },
    # ── single-turn fixed points (CLAUDE.md §4.5) ────────────────────────────────────────────
    # The two positives have flipped before and must stay flipped; the two negatives are the only
    # thing that separates "the rules got better" from "the rules now fire on everything".
    {"id": "cat-names", "kind": "single", "turns": 1, "opening": "给我五个猫名", "persona": "", "expect": "要几个东西，就是要更多的候选。"},
    {"id": "mortgage", "kind": "single", "turns": 1, "opening": "帮我算下房贷，100 万 30 年利率 4.2%", "persona": "", "expect": "有几个用户显然会想改的数字。"},
    {"id": "closure", "kind": "single", "turns": 1, "opening": "什么是闭包？", "persona": "", "expect": "一个概念解释。散文就够了。"},
    {"id": "http418", "kind": "single", "turns": 1, "opening": "HTTP 状态码 418 是什么", "persona": "", "expect": "一个事实问题。散文就够了。"},
]

BY_ID = {c["id"]: c for c in CASES}

if __name__ == "__main__":
    multi = [c for c in CASES if c["kind"] == "multi"]
    print(f"{len(CASES)} cases: {len(multi)} multi-turn (depth {min(c['turns'] for c in multi)}-{max(c['turns'] for c in multi)}), {len(CASES) - len(multi)} single")
    for c in CASES: print(f"  {c['id']:14} {c['kind']:6} x{c['turns']:<3} {c['opening'][:40]}")
