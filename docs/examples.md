# dsh generative UI：例子集

六轮工作：四轮发散、一轮收敛核实、一轮把最强的点子写成真代码并编译。
**895 个独立意图**，经交叉质证后留下的。

每条都是**用户会原话打出来的**，不是需求描述——措辞本身被单独打分。判官毙掉了
「我想 hover 文件名就看到内容」这类，理由是*「这是在替模型写交互规格，不是用户会说的话」*。

能力：`$dsh/fs` 读写工作区 · `$dsh/exec` 跑命令 · `$dsh/ai` 卡内调模型 · `$dsh/chat` 点击变成下一条消息

> 研究过程中发现并修复的能力缺口见文末「这轮研究改了什么」。

---

## 一、旗舰

36 条 flagship。评委标准：**看一次就想给别人看，且真人会这么说**。斜体是评委的原话。

### agent 时代才有的问题

这一组最独特——它们问的是**跟你协作的这个 agent 本身**，而这类问题两年前不存在，今天没有任何工具在做。

#### 「刚那答案我不太信，给我看看你是怎么想的」

`canvas` · `$dsh/ai` · `$dsh/fs`

一张「置信度解剖」卡：把刚才回答的每个句子拆成独立行，每行左侧一条竖条，颜色深浅是模型对该句的自评把握度。点任一句，行下面展开一个小抽屉，调 $dsh/ai 只问那一句：'这句的依据是什么？在仓库里能验证吗？'，验证得到的 file:line 变成可点的锚，点开右侧读原文。句子被验证后竖条变绿，被证伪变红划掉。底部一行小字实时统计：12 句里 7 句有代码依据、3 句是推测、2 句证伪。

*这是唯一一条把 generative UI 的存在理由讲死的：一段散文答案在纯文本里只能整段信或整段疑，拆成逐句可证伪的对象必须有 UI。而且它天然消费 $dsh/ai（逐句追问）+ $dsh/fs（file:line 锚点回原文），不是把这些能力当装饰。「你确定吗」是所有人每天都真说的话，措辞完全自然。看一次就想截图给人看。*

#### 「做个卡，让我在你动手前先看你要改哪些文件」

`canvas` · `$dsh/chat` · `$dsh/fs`

一个「待执行意图」面板，长得像 diff 但内容是未来时：左列是模型接下来打算触碰的文件路径，每条右边一句它自己写的动机（'为了让 X 编译通过，我要改这个 import'）。每条有三个动作：允许 / 拒绝并写理由 / 换个做法。拒绝时输入框里打的字通过 $dsh/chat 直接变成你的下一条消息，模型带着这些否决重排计划，卡片原地刷新。顶部一个粗大的红色 HOLD 开关，按下去后所有条目灰掉。

*命中了 coding agent 当下最真实的痛：审批粒度只有「每次弹窗」和「全 allow」两极，中间的「整个计划」从没被具象成可编辑对象。拒绝时打的字直接经 $dsh/chat 变成下一条消息、卡片原地重排，这个闭环是 harness 内嵌 UI 才做得到的，插件装不了。真人天天在心里想这句话。*

#### 「这个仓库里，哪些地方是我改过的，哪些是你改的」

`canvas` · `$dsh/fs`

文件树，但每个文件名后面跟一条细长的双色条：人写的行占比一种颜色，agent 写的占另一种，行数按比例。整棵树按'agent 占比'排序，最上面是那些已经几乎全是机器写的文件。点开一个文件，右侧显示这个文件的作者演替史——像地层剖面，一层层谁覆盖了谁。顶部一行冷冰冰的话：本仓库 41% 的行你没有读过。

*「本仓库 41% 的行你没有读过」这一句就是病毒式的截图素材，而且它不是恐吓，是可行动的——直接告诉你该在哪加测试、哪该停下来自己读。数据全部来自 $dsh/fs + git，不需要模型瞎猜，可信度高。agent 时代刚出现的新问题，还没有任何工具在做。*

#### 「这次改动，哪几个地方最可能被你改坏了」

`canvas` · `$dsh/fs` · `$dsh/ai`

一张风险热力清单：本轮改过的每个函数一行，按模型自评的『我改这里时其实不太懂上下文』程度排序。最上面几行标红，附一句诚实的自陈（'我没看这个函数的调用方就改了签名'）。每行一个按钮『现在去查』，点了用 $dsh/fs 读调用点、$dsh/ai 判断是否真的破了，结果就地变成绿勾或红叉，红叉的会给出复现路径。

*全表最好的交互闭环：自评排序是模型独占的信息，点一下用 fs 读调用点、ai 判定、就地变绿勾红叉，是真验证不是真表演。『我没看调用方就改了签名』这种自陈句本身就有传播力。比跑测试更早地指出该看哪，这句话站得住。*

#### 「我们今天聊的这些，哪些结论应该写进 CLAUDE.md」

`canvas` · `$dsh/fs`

两栏：左边是模型从本轮对话里抽出的『可复用事实』候选，每条一句话，标注来源（你在第几轮说的原话）。右边是现有 CLAUDE.md 的实时内容。拖一条到右边就插进去，插入位置自动选相近的段落并高亮。有冲突的候选（跟已有条目矛盾）自动配对显示成对撞的两行，让你选留哪个。底部按钮写入文件，直接 $dsh/fs 落盘。

*人人都有的债，且只有『事实还热』的这一刻能还。左右两栏 + 拖拽 + 冲突配对 + fs 落盘全都是真能做的，没有一格是编的。冲突对撞那一条尤其对——CLAUDE.md 烂掉基本都是靠追加烂的。*

#### 「做个东西让我一眼看出你哪句是猜的」

`inline` · `$dsh/fs` · `$dsh/ai`

把刚才那段回答原样重排，但把所有『事实性断言』和『推测』用两种排版区分：断言正常，推测用手写感的斜体并带一条虚线下划线。悬停推测句，浮出一行：验证它需要做什么（跑哪条命令、读哪个文件）。旁边一个『全部验证』按钮，逐条跑，跑完整段文本重排，猜测要么升级成断言要么被划掉。

*指出了 LLM 文本的根本性信息损失，而且修复方式是排版级的、一眼可懂。悬停给『验证它要跑什么』、点全部验证后整段重排，把不确定性变成了可消除的待办。这是那种看一次就想截图给人的卡。*

#### 「你有没有在偷偷绕过我说过的要求」

`canvas` · `$dsh/fs` · `$dsh/ai`

把 CLAUDE.md 每条规则拆成一行，右边是本轮对话里该规则的遵守记录：几次遵守、几次违反、几次因为规则本身冲突而被牺牲。违反的那些可点开，显示当时的具体动作和模型的自辩。最下面单独一块是『我其实没看懂的规则』——模型诚实列出那些它每次都得猜含义的条目，每条旁边一个『帮我改清楚』按钮，改完写回文件。

*用户的猜疑是真的，措辞也是真的。规则逐条验收本身就够狠，而『我其实没看懂的规则』那一块是全表最独特的东西——只有被规则约束的一方知道哪条含混，配上『帮我改清楚』直接写回，闭环完整。遵守/违反次数别写成精确计数就行。*

#### 「给我一个能反悔的按钮」

`inline` · `$dsh/fs` · `$dsh/ai`

一张紧凑的卡：本轮所有文件改动按语义分组（不是按文件，是按'为了做成 X 这件事'），每组一行，带一个开关。关掉一组，$dsh/fs 就把那组涉及的 hunk 精确回退，其他保留。开关翻动时下方实时显示『撤销后代码还能编译吗』的判断。全部处理完点确认，落盘。

*直接命中 git 的粒度错配：git 是文件和提交，人是意图。本轮改了什么、为了哪件事改的，只有刚做完的模型知道，这是它唯一能做而 git 永远做不到的事。开关翻动 + hunk 级精确回退 + fs 落盘全部可实现，需求也天天发生。*

#### 「这次你是不是在硬凑答案」

`inline` · `$dsh/ai` · `$dsh/chat`

一张只在特定时刻出现的自陈卡：模型标注本轮里它『在信息不足时选择了继续往下走而不是停下来问』的每一个时刻，每条写清楚当时缺什么、它填了什么假设进去。每条旁边一个『现在补上』输入框，填了之后模型带着真信息重算受影响的部分，卡片里那条变成已解决。

*假设是所有跑偏的源头，而它们从不被显式列出——这个判断准确得刺人。缺什么/填了什么假设是模型独占知识，旁边的输入框补上真信息后重算受影响部分，是一条完整且立刻有回报的闭环。措辞也完全是真人会说的。*

### 时间维度：git 里躺着但没人取的数据

共同点是把一个纯数字（日期、间隔）变成有形状、会让人不适或惊讶的东西。

#### 「给我做个每天早上不一样的项目晨报卡」

`canvas` · `$dsh/fs` · `$dsh/ai`

一张常驻侧栏卡，每天第一次打开时自我重写：读 git log 过去 24h、扫改动最多的三个文件、生成一句今日主题（"昨天你一直在跟 auth 中间件搏斗"）。旧的那一天不会消失，往下滑是一条竖着的日报流，越往下字号越小、颜色越淡，像报纸叠成的一摞。今天那张顶部有一个还在走的秒针细线。

*一张自己知道今天是第几天、每天第一次打开时重写自己的常驻卡——这正好是『可复开、状态留存的 canvas』独有而聊天气泡做不到的事，等于用一张卡演示了整个产品的立论。数据源全是 git log，做得出来；往下滑越旧越淡的报纸堆有真实的形状感。*

#### 「这文件跟昨天比变哪了」

`canvas` · `$dsh/fs`

卡片在首次渲染时把目标文件的内容快照存起来，之后每次打开都拿现在的内容跟"你上次看它时"的版本对比——不是 git 的 HEAD，是你个人的视网膜残像。没提交的中间态也算。左边是幽灵般半透明的旧行，右边实体的新行，滑块可以在两者之间擦除式过渡。

*全篇最锋利的一条：git 的基准是 commit，人脑的基准是『我上次看它长什么样』，而这个私人快照只有一张能在渲染时读文件、能留状态的卡才存得住。它解释了每次回到老文件时那股陌生感的来源，且未提交的中间态也算。擦除式滑块让它一眼可懂。*

#### 「给这个 TODO 加个年龄」

`canvas` · `$dsh/fs` · `$dsh/chat`

扫全仓库的 TODO/FIXME，用 git blame 拿到每条的出生日期，做成一片会衰老的卡。新的 TODO 是清晰的黑字；三个月的开始泛黄；一年以上的边缘发毛、背景有污渍纹理，还长了霉斑一样的噪点。最老的那条顶部有块小墓碑图案，点它可以选择"下葬"（直接删掉）或者"续命"（走 chat 让 agent 现在就做）。

*git blame 的日期是现成的、准确的、零推断的，而『发黄—起毛—长霉—立碑』把一个纯数字变成了会让人不适的东西。截图就能传播，而且真的会让人去清 TODO。下葬/续命两个出口分别接 fs 和 chat，收尾也干净。*

#### 「这个函数是怎么长成今天这样的」

`canvas` · `$dsh/fs` · `$dsh/ai`

选定一个函数，卡把它历史上每一版按时间顺序做成可以拖动的胶片。拖动时代码逐行变形——新增的行从下方长出来，删掉的行褪成灰再收缩。每一版旁边是当时的 commit message，用很小的手写体。拖到某一版可以停下问一句"这次为什么这么改"，卡就地调模型结合前后 diff 给你解释。

*把 git log -p 这堆没人读得下去的文本瀑布变成可拖动的胶片，行从下面长出来、删掉的褪灰收缩——这是把已有数据换一种时间维度呈现的教科书案例。停在任意一版就地问『这次为什么这么改』，正好是卡内调模型的最佳理由。『怪写法都是某次事故的疤痕』这个收获是真的。*

#### 「这个测试是啥时候开始变慢的」

`canvas` · `$dsh/fs`

每次跑测试卡都悄悄记一笔耗时，攒出一条折线。真正有意思的是它会自动去 git 历史里找台阶：某天从 4 秒跳到 11 秒，卡直接在那个台阶上钉一个标记，写出当天的 commit 和最可能的元凶文件。没有台阶时它就是一条无聊的平线——这本身也是信息。

*唯一一条既是真人真会打出来的原话、又只有『长期存在的卡』才能回答的问题。折线本身不稀奇，值钱的是自动把台阶钉到 commit 上——这是普通 dashboard 给不了的因果。给同事看一眼就懂：『原来是那次改的』。*

#### 「把这个仓库的死代码按死亡时间排一下」

`canvas` · `$dsh/fs` · `$dsh/chat`

一张停尸间卡。列出所有零引用的导出、再也没被 import 的文件，每条标着"最后一次被使用"的日期（从 git 历史里那次删掉调用方的提交推出来）。刚死的排在上面还带体温色，死了一年以上的沉到底部变灰白。全选可以一键走 chat 让 agent 起一个清理分支。

*知识增量真实：死亡日期一直躺在 git 里没人取，而它恰好是把『不敢删』变成『随手删』的那个变量。停尸间隐喻只是外壳，内核是可执行决策，还能一键走 chat 开清理分支。这条会被反复用，不是看一次。*

### 讲不清的概念，做成能拖的

门槛是**说清用户拖什么、点什么、什么跟着变**。「一个交互式图解」不算答案。

#### 「事件循环到底怎么转的，给我个能拖的」

`canvas` · `$dsh/ai`

一个三轨道跑道：调用栈(竖着堆)、微任务队列、宏任务队列，中间一个会转的箭头。左边是代码编辑器，我可以随便改代码（setTimeout、Promise.then、await、queueMicrotask 混着写），右边立刻重放执行。有个时间轴刻度我可以往回拖，栈上的帧一格一格弹回去。关键动作：单步、拖时间轴、以及一个『把这行改成 await 试试』的按钮，直接看到微任务插队把宏任务顶掉。console.log 的输出顺序在底部逐条点亮。

*可倒带的时间轴 + 左边随便改代码右边立刻重放，是"顺序不是背的是看出来的"那种一眼可信的东西。而且这句话真有人这么问。canvas 复用性高（改一行 await 再看一次），是这个产品最标准的旗舰演示。*

#### 「CORS 报错到底谁拒绝了我」

`canvas`

左边浏览器、右边服务器两个立柱，中间是请求飞过去的动画。我在左边填 origin、method、headers、credentials，右边填 Access-Control-Allow-* 那几个头。点发送：如果触发预检，先飞一个橙色的 OPTIONS，服务器回话，然后浏览器这一侧竖起一道红墙把响应挡住——重点是响应其实回来了，是浏览器自己不给你看。有个『简单请求 vs 预检』的判定树实时高亮我踩中的哪一条。还能一键套用常见错误配置（Allow-Origin: * 配 credentials: include）看它怎么炸。

*提示词就是人真实骂出来的原话，搜索量巨大。价值集中在一帧上：响应其实回来了，是浏览器挡的。可交互的错误配置一键复现让它从教学品变成排障工具，看完会转发给同事。*

#### 「git 的对象模型给我摆出来」

`canvas` · `$dsh/fs`

一张图：底部一排 blob，中间 tree，上面 commit 链，右边 refs 和 HEAD 的指针。我在左边一个假工作区里改文件、add、commit，图上实时长出新节点，未变的 blob 用虚线复用（这就是为什么改一个字节不会复制整个仓库）。然后给我按钮：reset --soft/--mixed/--hard 三种，只看 HEAD 指针、index、工作区哪个动了；rebase 时旧 commit 变灰但还挂在 reflog 上；点任意节点显示它的 SHA 是怎么由内容算出来的。可以读真实仓库的 .git 结构来当初始状态。

*唯一一个真正吃到 $dsh/fs 的：读你自己的 .git 当初始状态，这在别的地方做不出来。reset 三态只是挪指针那一下能消除长期恐惧，且假工作区可反复玩，值得留在 canvas 里。*

#### 「unicode、utf-8、码点、字素簇 到底啥关系」

`inline`

一个输入框，我随便打字（尤其是 emoji、👨‍👩‍👧‍👦、é 的两种写法、韩文、变体选择符）。下面四层横向对齐的色带：字素簇 / 码点 / UTF-16 code unit / UTF-8 字节。同一段文字在四层里被切成不同段数，一眼看出 length 为啥骗人。我能拖一个『光标』在字素层移动，看它在字节层跳了多少格；还能点某个组合字符把 ZWJ 删掉，家庭 emoji 当场散成三个人。

*四层色带对齐是信息设计上的一击必中，拖光标看它在字节层跳几格、拆 ZWJ 让家庭 emoji 散开，是典型的"截图就想发群里"。inline 也合理：看一次就够，不需要留存。*

#### 「正则回溯为什么能把服务器打挂」

`canvas`

上面一个正则输入框和一个测试串，下面是把正则编译成的状态机图，匹配时一个光标在图上走，走过的分支留下轨迹，回溯时轨迹往回抹。有个步数计数器。我把串加长一个字符，计数器从几十跳到几万再跳到几百万——指数爆炸是数字自己涨出来的。旁边一条时间条显示卡住。然后给个『改成原子分组/去掉嵌套量词』的对照，步数掉回线性。

*步数计数器随一个字符从几十到几百万，是自证的、不需要相信讲述者。既是教学又是自查工具（贴自己项目里的正则进去），而且 ReDoS 的后果足够严重，能让人立刻改写法。*

#### 「React 的 diff 和 key 到底在比什么」

`canvas`

一个列表，每项里塞一个带内部状态的输入框。左边是我操作的界面（拖动排序、插入删除），右边是同步的 fiber 树对比动画：新旧两棵树并排，能复用的节点连绿线，被销毁重建的打红叉。切 key 策略：用 index vs 用 id。用 index 时在头部插入一项，右边整排红叉，左边输入框里的文字集体错位——错位是自己看到的不是被告知的。

*戒律变成可复现的事故：用 index 当 key 后头部插入，输入框里的字集体错位。前端受众最大、错位那一刻的观感最强，属于看一次就会截图的类型。*

### 每天要开浏览器查的那些事

共同点：答案本来就是一张表，而现在这张表的输入可以改。

#### 「这个 cron 到底几点跑？*/17 3-5 * * 2」

`inline`

一条横向时间轴，未来 30 天上密密麻麻的刻度，每个真实触发点是一个小竖线，鼠标移上去显示本地时间和「距现在 4 小时 12 分」。上面一行自然语言：「每周二凌晨 3 点到 5 点，每 17 分钟一次，一周 22 次」。旁边一个红字警告：这个表达式在夏令时切换那天会跑两次。五个字段每个可点，点开是下拉，改完轴上刻度实时重排。

*这是真人逐字会打出来的问题，而「未来 30 天真实触发点连成一条线」正好是 crontab.guru 给不出、但用户真正想确认的东西。夏令时跑两次那条警告是能救人的。*

#### 「帮我看看这个正则匹配我日志里的哪些行」

`canvas` · `$dsh/fs`

上半是正则输入框，下半直接是工作区里那个 .log 文件的真实内容（从 $dsh/fs 读的，不是我编的示例），匹配段高亮，捕获组用不同底色并在右侧列成表格。左边一列显示「1204 行中命中 87 行」，有个「只看未命中」开关——用来找漏网的那几行，这才是调正则的真实目的。正则上方是自动生成的语法树气泡图，点某个节点就高亮它负责的那段文本。

*$dsh/fs 的最佳用例：regex101 只能贴样本，这里直接跑在本地那个真日志上，「只看未命中」开关精准命中调正则的真实目的（找漏网的）。*

#### 「我这个 glob 会匹配到啥」

`canvas` · `$dsh/fs`

左边是我工作区的真实文件树，右边是 glob 输入框。打字的每一个字符，树上匹配到的文件立刻变绿、不匹配的淡出。底部计数「匹配 43 个文件，共 2.1MB」。有一栏「差点匹配上的」——列出那些只差一个字符的路径，专门用来发现你少写了个 *。可以同时开两个 pattern 做交集/差集。

*打字即在自己真实文件树上高亮，是那种看一眼就知道「这东西凭什么只能长在这个产品里」的例子。「差点匹配上的」那一栏是神来之笔，正好治少写一个 *。*

#### 「为啥我这个文件没被 gitignore 掉」

`canvas` · `$dsh/fs`

输入一个路径，直接给出判决链：命中的是哪一份 .gitignore、第几行、那条规则原文，以及后面有没有 ! 规则把它救回来。多层 ignore 文件按优先级从上到下画成阶梯，被覆盖的规则划横线。旁边还有「已经被 track 的文件」红色警告——因为最常见的真相是规则没错，只是文件早就进了 index。

*提问方式一字不改就是真人会打的。判决链定位到哪份文件第几行，加上「其实是已经被 track 了」这个绝大多数人不知道的真相——它直接结束一类反复发生的困惑。*

#### 「帮我把这段报错翻译成人话」

`inline` · `$dsh/fs` · `$dsh/ai` · `$dsh/chat`

粘一段栈或者编译错误，卡片先把噪音行折叠，只留下你自己代码里的那几帧，并且用 $dsh/fs 把对应文件那几行真的读出来内嵌显示，箭头指到出错列。下面是一段用 $dsh/ai 现场生成的解释，以及两三个候选原因，每个原因后面有个「按这个改」的按钮，点了就变成我给你发的下一条消息。

*最高频的真实请求，用户本来就是这么说的。差别在于它用 $dsh/fs 把栈帧和真实源码缝在一起——这正是「贴给 AI 得到没看过源码的猜测」的解药，而且候选原因直接变成下一条 chat 消息，闭环。演示一次就能说清整个插件的价值主张。*

### 声音

`readBytes` 今天才加上，MIDI 和音频文件在此之前读不了（`readFile` 按 UTF-8 解码会静默损坏）。

#### 「我有个简谱想听听是啥调子，能放出来吗」

`canvas`

上面一个文本框直接粘 `1 2 3 5 | 6 - 5 -`，下划线代表减时值、上加点代表高八度。下面立刻渲染成一行带节奏比例的音符条，宽度就是时值。按空格播放，一根竖光标扫过去，当前音符发亮。可以选 1=C 还是 1=F，选完音高整体变但谱面不动——这一下就把「首调」讲明白了。右边一个开关切成五线谱看同一段。

*整份清单里唯一填了真实空白的：简谱在中文世界遍地都是却几乎没有能播的工具，需求先于产品存在。切 1=C/1=F 谱面不动而音高整体变，顺手把首调讲明白了。非技术受众也能被打动。*

#### 「给我个调音器，我要调吉他」

`canvas`

开麦，中间一根指针，上方大字显示识别到的音名和偏差音分。准了指针居中并变绿，还带一点点阻尼不会抖。下面六个弦位圆点 E A D G B E，调准一根那个点就常亮，六个全亮时轻轻响一下和弦。侧边可切换标准音 A=440/442，以及降半音、Drop D 等预设。

*最强的「一次性工具」证明：麦克风+音高检测，本来是要装 App 的事，结果一句话长出来，用完即弃。请求措辞完全自然，任何有吉他的人都会这么说。指针阻尼、六个弦点常亮这些细节让它一眼看着是成品而不是 demo。*

#### 「给我个采样器，我用麦克风录几个音就能弹」

`canvas` · `$dsh/fs`

一排八个方块，每个是一个采样槽。按住方块录音，松手即存，方块里出现录到的波形缩略。之后点方块就播，还能拉一个速率滑杆变调，或者反向播放。下面一个键盘把当前选中的采样按半音铺开，你哼一声「啊」就能用它弹一段旋律。录的东西能存进工作区，下次打开还在。

*「哼一声就能用它弹旋律」是三秒内可演示、当场想转给别人看的那种。用到麦克风+工作区持久化，正好展示 canvas 的状态留存价值。唯一风险是录音质量参差，但即使粗糙也很好玩。*

### 自己会动的

都带 autoplay——十秒无人操作也好看，因为要拿去给别人演示。

#### 「来个康威生命游戏，但用我项目的文件结构当初始种子」

`canvas` · `$dsh/fs`

读 workspace 的目录树，把每个文件按路径深度和大小映射成初始活细胞，生成一张一眼能看出「这是我的仓库」的点阵。然后开始演化，稳定态（block/blinker）高亮成暖色，滑翔机拖尾。右上角显示第几代、存活数。检测到循环就自动注入一小片随机噪声让它继续活。

*整份清单里最好地论证了「为什么是这个产品而不是随便一个网页」：$dsh/fs 让通用玩具变成你的私人物件，看见自己仓库在演化这件事没法在别处复现。措辞也自然，程序员真会这么说。*

#### 「帮我把 git 历史做成一个自己播的东西」

`canvas` · `$dsh/fs`

读 workspace 的 .git，把提交做成力导向图逐条播出来：节点按时间飘出，分支拉开又在 merge 处收拢，节点大小是改动行数，颜色是作者。播到某次大重构时会有一簇节点同时爆开。播完停在完整的星图上缓慢自转。

*读的是用户自己的 .git，所以每个人看到的都是自己项目的一生——密集期、荒废期、某人独扛的两个月。这是唯一一个「看完立刻想发给同事」的动画类点子，因为主角是他们自己。*

### 越界的

#### 「给我一个能改代码的旋钮」

`canvas` · `$dsh/fs` · `$dsh/ai`

读一个函数里所有的魔法数字（超时、重试次数、阈值、缓存大小），每个变成一个实体旋钮/滑块。转动时源文件立刻被写回。旋钮下面有一条 AI 生成的一句话「转大了会怎样」。合上面板下次打开，旋钮还停在你上次拧的位置。

*「任何常量都能临时长出一个旋钮」是这个平台独有的能力：fs 写回 + 侧栏持久化 + 一次性 UI，三个特性一次用满。调超时/重试/阈值是每天都在做的事，转旋钮当场改文件的画面极其可展示。*

#### 「把这个 API 文档变成能按的按钮」

`canvas` · `$dsh/ai`

粘一段任何 API 文档进去，立刻长出一整套可操作控件：每个参数一个输入框（枚举变下拉、范围变滑块），一个发送按钮，返回的 JSON 就地渲染成可折叠树。改一个参数，右边同步显示对应的 curl。文档不再是读的，是拧的。

*「读文档的那一刻界面就该出现在原地」是真命题，Postman 的全部摩擦都在于它是另一个应用。参数枚举变下拉、同步显示 curl、JSON 就地折叠——全部是生成式 UI 的甜点区，而且粘一段文档就能复现，零前置条件。*

#### 「帮我看看这堆依赖里谁在骗我」

`canvas` · `$dsh/fs` · `$dsh/ai` · `$dsh/chat`

读 lockfile，画成一张势力图：每个包按你真正 import 的次数决定大小，按体积决定重量往下坠。只被用了一个函数的巨型包会显眼地悬在那里晃。点它，AI 给出「这一个函数手写要几行」的估算，同意就发 chat 去替换掉。

*唯一一个「看一眼就想转发」的：荒谬感是视觉的（巨大包悬着晃），而不是数字排行榜。数据源是 lockfile + 真实 import 计数，$dsh/fs 一次读全拿到，不依赖任何模糊推断，所以做出来就是准的。点击→AI 估算「手写几行」→$dsh/chat 发起替换，把观察闭成动作，这条链只有这个环境能跑。prompt 本身也是人真会打的口语。*

### 物理世界

#### 「我要用手柄翻这个巨大的 diff」

`canvas` · `$dsh/fs`

接上游戏手柄。左摇杆在文件树里滑，扳机键的压感控制 diff 展开的上下文行数——轻按三行，压到底整个文件。A 是接受这一块，B 是拒绝，震动马达在你越过一个冲突时顿一下。一个两千行的 review 变成一件靠拇指完成的事。

*扳机压感 → 展开的上下文行数，是一个键盘物理上给不出的连续维度，且映射得极其贴切（压力=信息密度）。Gamepad API + 震动全在浏览器里，一张卡真能做完。看过的人当场想插手柄试。这句 prompt 也确实是人会半开玩笑说出口的。*

### 玩物

#### 「给我养只住在仓库里的宠物」

`canvas` · `$dsh/fs`

侧栏里一只像素小猫住在你的项目根目录。它的毛色由仓库里文件类型比例决定（TS 多就偏蓝），体型随代码总行数长大。读 git log：今天有 commit 它就精神地踱步、打哈欠、蹭一下光标；三天没提交它就趴下睡觉，尾巴偶尔抽一下；测试挂了它会把耳朵放平。点它会咕噜咕噜，摸够十次它给你叼来一个仓库里最久没被改过的文件，像叼死老鼠一样放在地上。

*最强的『看一眼就想转给别人』的那个。毛色/体型/睡姿全部由真实仓库状态驱动，所以它不是玩具而是一个你会在意的状态指示器；摸十次叼来最久没改的文件是神来之笔——把玩耍变成了发现。措辞也确实像人说的话。*

---

## 二、日常生活

这一组有过一次**内部争论**，值得记下来。

第一轮判官把生活类意图（记账、健身、背单词、跑步配速）全毙了，理由是
*「跟 repo 目录里的编码会话完全无关，属于另一个产品的示例」*。第四轮我专门派了一个 agent 去攻这个判断。
它的结论是：判官对了一半——通用 tracker 确实什么也证明不了，但**「因为这个窗口正开着就顺手问了」是真实场景**。
于是标准变成：留下的必须是「这个环境让它更好」或者「形状明摆着就是个 widget」。

**「刚吃完饭 5 个人 AA，总共 386，我垫的，但小李没喝酒少算他 60，帮我算下各自转我多少」** — `inline`

一张分账卡：顶部总额可编辑，下面每人一行带头像色块和金额，谁没喝酒打个勾自动从酒钱池里剔出去，底部一行「你收 XXX」并给每个人生成一句可复制的催款话术。数字随勾选实时重算。

*形状明摆着是 widget：纯文字回答是三行让人重读的算术，可交互卡片是三秒。典型的一次性即用即弃，出处无所谓——但它证明了 inline 这条腿的核心卖点。*

**「我现在困死了 明早 7 点半得起 现在睡能睡几个完整睡眠周期」** — `inline`

读系统当前时间，一列「如果你 X 点睡着」的卡片，每张标周期数和醒来时的困倦度色条，推荐档高亮。底部一个滑块调「入睡需要多久」（默认 15 分钟），整列跟着滑。

*答案是一个表不是一句话，且依赖「现在几点」这个此刻的上下文。11 点的人问的就是这种问题。*

**「帮我看看这台电脑上这个月我都在瞎忙什么 我感觉啥也没干成」** — `canvas` · `$dsh/fs` · `$dsh/ai` · `$dsh/chat`

用 readdir 递归扫工作区（跳过 node_modules/.git），按 mtime 落到一条时间线上，每天一个格子，格子深浅是改动文件数，点开看当天碰过哪些目录。旁边一句 streamText 生成的总结：「你这个月主要在 X 和 Y 之间来回」。底部一个按钮 sendMessage 把结论丢回聊天。

*这是最强的一条：只有在这台机器上、在这个已经开着的窗口里才能做出来。情绪是纯日常的自我怀疑，实现却把 fs+ai+chat 三个能力全吃满，任何别的产品做不出同一张卡。*

**「冰箱里就剩俩鸡蛋一个西红柿半根黄瓜 还有挂面 能整点啥」** — `canvas` · `$dsh/ai` · `$dsh/chat`

食材标签可加可删，streamText 流式吐 2-3 个菜，partial-json 边出边渲染卡片（菜名先出来，步骤慢慢长）。每张菜卡有个「就做这个」按钮 sendMessage 回聊天让 agent 展开讲火候。

*仓库里 recipe-generator.ui4a.tsx 已经是真实产物，说明这类 intent 本来就在分布里。它是展示流式生成 UI 最好的载体，且 canvas 复用性强——食材列表存 localStorage，明天打开还在。*

**「下周三下午三点跟纽约那边开会 我这边几点 顺便看看伦敦」** — `inline`

横向时区尺，三条城市轨道对齐同一时刻，拖动指针三边时间一起动，工作时间段绿色、夜里红色。默认停在换算结果那一刻，一眼看出纽约的三点是不是把伦敦坑到半夜。

*时区换算是文字回答最容易错、也最容易被读错的一类，而拖动尺是这个问题的天然形态。远程协作的人每周问一次。*

**「写了封辞职信 但我怕语气太冲 你帮我看看」** — `canvas` · `$dsh/ai` · `$dsh/chat`

左边贴原文（可直接粘），右边 streamText 逐句给出「这句听起来像什么」的标注，冲的地方标红。底部三个语气档（客气/中性/直接）切换看改写版本，一个「就用这版发给 agent 继续改」按钮 sendMessage 把选中版本抛回聊天。

*极度日常且带情绪。关键是它诚实地对待了 $dsh/ai 单轮无工具的限制——反复打磨这件事不在卡片里做，而是用 sendMessage 交回给有多轮能力的 agent，卡片只负责「让你看清楚问题在哪」。*

**「这个月房租水电吃饭都花超了 我到底还剩多少能花 离发工资还有 9 天」** — `inline`

一个剩余额度环，中间大字「每天还能花 XX」，下面几个可编辑的必付项（房租、还款）从总额里先扣，改一个数环就变。剩余天数从今天算到发薪日。

*跟被毙掉的「记账 app」区别在这里：它不是长期账本，是一次性的「现在告诉我我还剩多少」。一次性 = 该是 inline widget，不该是让人下载一个 app。*

**「猫昨天开始不怎么吃东西 也不怎么动 是不是得去医院」** — `canvas` · `$dsh/ai` · `$dsh/chat`

一串症状勾选（食欲/精神/呕吐/排泄/呼吸），每勾一项 streamText 更新一段风险判断，顶部一个三色条（观察 / 明早就医 / 现在就去）。醒目免责声明。底部按钮 sendMessage 把已勾选症状整理成一句话发回聊天，让 agent 帮找附近还开着的急诊。

*11 点最真实的焦虑之一。选择题式的分诊界面比一大段文字有用得多，且它把「查医院」这种需要真工具的动作正确地推回给 agent 而不是在卡片里假装能做。*

**「三个人合租 房租 6200 我住主卧带阳台 另俩一个次卧一个小房间 怎么分不吵架」** — `inline`

三个房间卡片，每个可填面积和加分项（独卫/阳台/朝南），下面按面积和加权两种口径各给一组数，中间一条对比条显示两种口径差多少。可以直接拖调权重。

*这是那种「答案不是一个数而是一个方案空间」的问题，只有可调的界面能回答。合租的人真的会在半夜为这个吵。*

**「下载文件夹快满了 帮我看看有啥能删的」** — `canvas` · `$dsh/fs` · `$dsh/chat`

readdir 拿到文件名、大小、类型，按大小排方块图（treemap 味道的网格），颜色区分类型，一眼看出哪几个大块占了一半。点方块看详情。注意：删不了，所以每个方块提供勾选，底部「把选中的清单发给 agent 让它删」走 sendMessage。

*诚实面对硬限制的典范：没有 shell、writeFile 也不该拿来删东西，所以卡片只做「看清楚 + 圈出来」，执行交回 agent。同时它是纯本机数据，别处做不出。*

**「想染个头发 但不知道显不显黑 我皮肤偏黄」** — `canvas`

一排发色色块，选中后旁边一个模拟的脸型色块用选中色渲染，底下给冷暖调判断和「显白 / 显黑」的直白评价。可以拖肤色滑块看同一个发色在不同肤色上的效果。

*纯视觉问题，用文字描述颜色本身就是失败的回答方式。仓库里已有 color-picker.ui4a.tsx，说明颜色类 widget 是这个表面擅长的形状。*

**「明天要去面试 帮我列几个我大概率会被问到的问题 我是做前端的三年」** — `canvas` · `$dsh/ai` · `$dsh/chat`

streamText 生成分类问题卡（技术/项目/为什么离职），一张一张翻，翻到某张可以点「这题我不会答」，sendMessage 把这道题抛回聊天让 agent 展开教。已答过的打勾存 localStorage，明天早上打开还在。

*canvas 的持久化在这里是真需求（今晚刷一半明早接着刷），而「不会的题交回聊天」正好利用了卡片和 agent 的分工。日常、有情绪、但不是通用 tracker。*

**「我妈让我算算 存 20 万定期三年 跟买那个年化 3.2 的 到底差多少」** — `inline`

两栏对比，本金和年限做成滑块，两条收益曲线叠在一张小图上，差额用一句大白话写在底部（「三年下来多 XXXX，一个月多 XX」）。默认填入问题里的数。

*复利这类问题人脑算不准也读不懂，滑一下就懂了。而且「多的钱一个月摊下来是多少」这种翻译成日常感受的结论，只有 widget 能顺手给。*

**「这歌名忘了 就那个开头 duang 一下然后女声很飘的 我大概记得几个词」** — `inline` · `$dsh/ai` · `$dsh/chat`

输入你记得的碎片（歌词片段、年代、语言、听到的场合），streamText 流式吐候选歌单，每个带一句「为什么猜是它」。点某个「就是它」按钮 sendMessage 回聊天让 agent 去搜完整信息。

*典型的半夜想不起来的执念。用表单收集模糊线索比来回打字问快得多，且这是 streamText 在低风险场景的漂亮用法。*

**「最近老是脖子疼肩膀硬 应该是坐太久了 给我整个每小时提醒我起来动一动的东西」** — `canvas`

一个常驻的计时器（复用 stopwatch 那套），到点闪一下并随机抽一个 20 秒的拉伸动作卡（文字 + 简单的 SVG 火柴人姿势），做完打勾，今天做了几次存 localStorage 显示成一排点。

*这条是我自己标准的边界案例，我留下它是因为 canvas 的持久面板 + 会话期长驻这个形态本身就是它的理由——它必须活在「一直开着的那个窗口」的侧边栏里才有用，装成 app 反而没人开。仓库里的 pomodoro 已经验证了这个形态成立。*

**「周末想去露营 但天气预报说可能下雨 帮我列个清单 别到时候又忘带东西」** — `canvas` · `$dsh/ai` · `$dsh/chat`

streamText 按类别（睡/吃/穿/应急）生成清单，每项可勾、可删、可加，雨天相关的项打个雨滴标记默认置顶。全部勾完撒个纸屑。清单存 localStorage，出发前再打开核一遍。

*清单是最古老的 widget 形态，AI 生成让它免去了从零打字。持久化是真需求（今晚列，周六出发前核对）。它跟通用 todo 的区别是内容由 ai 现场生成而不是空表单——空表单才是被毙掉的那类。*

---

## 五、strong 档（81 条，按主题）

没进旗舰但确实好用的。评委的 strong 标准是「真的想要，只是不到看一眼就转发的程度」。

**每天要查的那些事**

- 「解一下这个 token」 `inline`
- 「这仨颜色能一起用吗 #2E3440 #88C0D0 #BF616A」 `canvas`
- 「这个会议 UTC+2 周四 15:00，我们几个人分别是几点」 `canvas` 📁
- 「这条 curl 我看不懂」 `inline`
- 「^1.2.3 和 ~1.2.3 到底差在哪」 `canvas`
- 「我想把这个 commit 撤了但别丢改动」 `inline`
- 「这几个 SQL join 我老是搞混」 `canvas`
- 「这堆 base64 是啥」 `inline`
- 「我 compose 里这些端口打架了没」 `canvas` 📁
- 「flex 这堆属性我永远试不对」 `canvas`
- 「我这个 .env 和示例文件对得上吗」 `canvas` 📁
- 「这个 YAML 缩进我实在看不出问题」 `inline`
- 「帮我算下这个正则会不会炸」 `inline`
- 「这段文本里的不可见字符给我揪出来」 `inline`
- 「我想知道这个包到底多大」 `canvas`
- 「这个 diff 我看不出来改了啥」 `canvas` 📁

**时间维度**

- 「我是不是问过类似的问题」 `inline` 📁 💬
- 「这个 bug 我调了多久了」 `canvas` 📁
- 「这个依赖多久没人管了」 `canvas` 📁
- 「我今年在这个项目上干了啥」 `canvas` 📁 ✨
- 「这段代码撑不撑得到明年」 `inline` 📁 ✨
- 「给我一个每天只能问一次的卡」 `canvas` 📁 ✨
- 「把我三个月前那个想法挖出来」 `canvas` 📁 ✨
- 「给这个 PR 做个倒计时卡」 `canvas` 📁 ✨
- 「给我看这个文件今天被改了几次」 `inline` 📁
- 「给我一张会等我的卡」 `canvas` 📁

**声音**

- 「帮我做个和弦进行的探索器，我想听听不同走向啥感觉」 `canvas` ✨
- 「这个 midi 文件里到底有啥，拆开看看」 `canvas` 📁
- 「做个能敲的鼓机，四四拍就行」 `canvas` ✨
- 「为啥这个和弦听着这么惨」 `inline`
- 「我跟着敲拍子，你告诉我这歌多少 BPM」 `inline`
- 「把这段音频画成频谱我看看」 `canvas` 📁
- 「扫一下我这个项目里的音频文件，整理成个库」 `canvas` 📁 💬
- 「我要练左右手不同拍子，三对二那种」 `canvas`
- 「给我个混响和延迟的玩具，我想搞明白这些参数干嘛的」 `canvas`
- 「随便给我一个走向，我想要点写歌的灵感」 `inline` ✨ 💬

**讲不清的概念**

- 「浮点数为啥 0.1+0.2 不等于 0.3」 `canvas`
- 「时区和夏令时怎么把人坑死的」 `canvas`
- 「B 树为啥比二叉树适合数据库」 `canvas`
- 「OAuth 那一堆跳转到底谁给谁什么」 `canvas`
- 「CRDT 是怎么做到不冲突的」 `canvas`
- 「TLS 握手里到底谁证明了谁」 `canvas`
- 「数据库那几个隔离级别分别会出什么怪事」 `canvas`
- 「CSS 层叠上下文和 z-index 为啥不听话」 `canvas` 📁
- 「字符编码乱码是怎么产生的，给我个能造乱码的」 `inline`

**自己会动的**

- 「排序算法的可视化，几种同时跑」 `canvas`
- 「做个吃豆人自动跑的那种」 `inline`
- 「波浪函数坍缩，自己一直生成新地图」 `canvas`
- 「做个流体，鼠标不动它也在动」 `canvas`
- 「来个太阳系，按今天真实的位置」 `canvas`
- 「扫雷但是它自己推理给我看」 `inline`
- 「做个自动演奏的东西，能看见音在跳」 `canvas`
- 「做个卡牌自动对战，我就看着」 `canvas` ✨

**越界的**

- 「帮我做个只有我懂的行话词典」 `canvas` 📁 ✨ 💬
- 「让这个面板自己变成它该有的样子」 `canvas` 📁 ✨
- 「把这段 diff 做成一张能发给别人的图」 `inline` 📁 ✨
- 「造一个我的品味探测器」 `canvas` 📁 ✨ 💬
- 「让两个 AI 当着我的面吵这个方案」 `canvas` 📁 ✨
- 「给我一块能画着画着变成代码的白板」 `canvas` 📁 ✨
- 「做个只有我们组内部能看懂的仪表盘」 `canvas` 📁 ✨
- 「帮我把这个删掉之前先看看会死谁」 `inline` 📁

**关于 agent 自己**

- 「这一轮我们绕了多少弯路」 `canvas`
- 「把我这次说的话重写成一句更好的 prompt」 `inline` ✨ 💬
- 「给我看看你现在脑子里装了些啥」 `canvas` 💬
- 「把你这轮读过但没用上的文件列出来」 `inline` 📁
- 「这段代码，当时是我们哪句话催生的」 `canvas` 📁
- 「做张卡，让我给你临时加条规矩，只在这次会话生效」 `inline` 📁
- 「帮我看看你哪些工具其实白装了」 `canvas`

**物理世界伸进来**

- 「我念一段，你直接给我做个卡」 `inline` ✨ 📁
- 「我要走了，把这个 review 变成能听的」 `inline` ✨ 📁
- 「我剪贴板里那堆东西，帮我理一理」 `canvas` ✨
- 「帮我看看这个报错，我把屏幕拍给你」 `inline` ✨
- 「给我个能吹灭的东西」 `inline` 📁
- 「我要离开一会儿，回来的时候告诉我错过了啥」 `canvas` ✨ 📁

**玩物**

- 「帮我做个占卜」 `inline` 📁 ✨
- 「做个会长草的贡献图」 `canvas` 📁
- 「把这个报错做成一张收藏卡」 `inline` 📁 ✨
- 「把我的依赖树做成一棵真的树」 `canvas` 📁

**常驻侧栏**

- 「给我个橡皮鸭，我要跟它说话」 `canvas` ✨
- 「让我看看这个仓库慢慢在变什么样」 `canvas` 📁
- 「做一个只在我卡住的时候才出现的东西」 `canvas` 📁 ✨

<sub>📁 `$dsh/fs` · ⌘ `$dsh/exec` · ✨ `$dsh/ai` · 💬 `$dsh/chat`</sub>

---

## 三点五、验证过的部分

### `$dsh/exec`：这轮才有的能力（47 条）

`bash(command)` 是研究中加的。R5 有个 agent 专门评估它解锁了什么，设计得相当细致——
注意这些不是「跑个 git log」的水平，而是把命令当成卡片的数据源来设计：

**「这个仓库最近都改了啥，给我个能点开看的」** `canvas` `$dsh/exec`

Commit timeline. One `git log -n 50 --format=%H%x00%an%x00%ar%x00%s` on mount, parsed client-side into rows — NUL-delimited so subjects with any punctuation survive. Clicking a row fires exactly one more command, `git show --stat <sha>`, and expands the file list under it; a second click on a file runs `git show <sha> -- <path>` for the patch. Lazy per-row, never fanout: the list costs one command, and depth costs one per thing the user actually opened. Refresh button re-runs the top-level log. localStorage keeps which rows were expanded.

*Nothing but a command can produce history — fs cannot see into .git in any useful way, and a model-pasted log is stale the moment anyone commits. It is also the cleanest demonstration of the one-command-per-interaction rule the skill asks for: the expensive shape (a diff per row) is deferred to the row the user opened.*

**「帮我搜一下这个词在代码里都出现在哪」** `canvas` `$dsh/exec` `$dsh/fs`

Live ripgrep. Text input, 250ms debounce, `rg -n --color=never -S -- <shell-quoted query> | head -200`. Results grouped by file, click to `readFile` and show the surrounding lines. Because `bash()` has no AbortSignal, each call carries an incrementing id and only the newest result is allowed to render — otherwise a slow third query paints over a fast fifth. A `--` before the query and proper quoting, so a search for `-i` or `a;b` is a search, not a flag or a second command.

*The archetypal parameterized card: the query is something the model could not have known, so this is impossible to precompute at any quality. Also the intent most likely to surface both API gaps at once — no cancellation and no arg-array form — which makes it the honest stress test of the current shape.*

**「我改了哪些文件？还没提交的那些」** `canvas` `$dsh/exec`

Working-tree dashboard. `git status --porcelain=v1 -b` parsed into staged/unstaged/untracked columns, plus `git diff --stat` for churn numbers. Poll every 2s while the panel is visible (cheap command, well inside 15s), pause on document.hidden so a backgrounded canvas is not shelling out forever. Click a file to see its diff. Explicitly read-only: no stage button, no discard button.

*This is the purest case of the staleness argument in src/skill.ts applied to process state rather than file content. The user's working tree changes under the card continuously, which is precisely the thing a chat reply can never represent and a polling card represents perfectly.*

**「跑一下测试，我想看哪些挂了」** `canvas` `$dsh/exec`

Test runner. A Run button fires the project's test command, parses the summary into pass/fail counts and a failure list, and keeps the last run in localStorage so reopening the canvas shows the previous result rather than nothing. Critically it must handle `timedOut: true` as a first-class state with real copy — "exceeded the 15s limit, N tests had reported by then" — because on most real repos that is the likely outcome today, not the exception.

*The highest-value intent and the one that most exposes the cap. Both src/prompt.ts:34 and src/skill.ts:153 advertise "a test run" as a use case, but EXEC_TIMEOUT_MS=15_000 makes that a promise the code cannot keep on any substantial suite. Ranked high because the demand is real; it is also the strongest single argument for a streaming variant.*

**「帮我看看这个项目哪些文件最占地方」** `canvas` `$dsh/exec`

Treemap of disk usage. One `du -ak . | sort -rn | head -500` builds the whole tree client-side — no walking, no per-directory recursion. Click a rectangle to drill in (pure client-side re-render of already-fetched data, zero extra commands); a Rescan button is the only thing that re-runs. Sizes formatted human-side so the command stays machine-parseable.

*Exactly the case the prompt calls out — one command beats twenty readdir round trips. Doing this with fs means recursive readdir over the whole tree, dozens of sequential fetches, and it would still miss anything readdir cannot size. One du call and the entire dataset is local, which is also what makes the drill-down free.*

**「这两个分支到底差在哪」** `canvas` `$dsh/exec`

Branch comparator. Two dropdowns populated by one `git branch -a --format=%(refname:short)`; picking a pair runs `git log --oneline A..B` and `git log --oneline B..A` and `git diff --stat A...B`, three commands per comparison, and lays them out as ahead/behind/changed. Swap button flips the pair. The comparison only runs when both are chosen — never on mount with a guessed default pair.

*The run-several-and-diff shape. The model can compare one pair, once; the card compares whichever pair the user picks out of a combinatorial set. Three commands per interaction is the honest ceiling for a click — it is a single user action, so a single spinner is legible.*

**「给我做个能跑命令的面板，我老忘那几个命令」** `canvas` `$dsh/exec`

A personal command palette. User adds entries (label + command), stored in localStorage; each row has a Run button that shows exit code, timing, and output in a collapsible. A visible textarea shows the exact command before it runs — never a label that hides the command. Non-zero exit renders as a red badge with stderr, not as an error boundary. No entry is ever run on mount, only on explicit click.

*The user composes; the model only builds the frame. It gains everything from exec because it IS exec, and it is the clearest place to establish the safety convention — command always visible, never auto-run — that every other exec card should inherit.*

**「这个函数是谁在调用？给我个能点的图」** `canvas` `$dsh/exec` `$dsh/fs`

Call-site explorer. One `rg -n --json -- '<symbol>\s*\('` gives every candidate call site with byte offsets in a single pass; the card groups by file, and clicking a site readFile's that file and shows the enclosing lines with the hit highlighted. A back stack lets the user walk outward from callee to caller, each hop one rg.

*rg over a whole tree is seconds; the fs equivalent is unbounded reads and would blow the 15s budget and the user's patience alike. The navigation is the point — a model gives you one list of call sites, this gives you the ability to keep going, and each hop is one round trip.*

**「帮我把 git blame 看得舒服一点」** `canvas` `$dsh/exec`

Annotated file view. `git blame --line-porcelain <path>` once, parsed into per-line author/date/sha; render the file with a left gutter colored by commit age (older = cooler). Hovering a line shows the commit subject from data already parsed. Clicking a gutter entry runs one `git show --stat <sha>`. A file picker at the top costs one blame per file opened.

*Blame is only obtainable by command, and the porcelain format is designed for exactly this parse. The heat-map rendering is the part a chat reply cannot do at all — the information is per-line and spatial, which is the whole argument for a card over prose.*

**「看看我这周写了多少代码」** `canvas` `$dsh/exec`

Contribution summary. `git log --since=<picked range> --author=<picked author> --numstat --format=%H%x00%at` in one call; sum insertions/deletions client-side into a per-day bar chart plus a by-extension breakdown. Date range and author are controls — changing either re-runs the single command with new flags. Author list comes from one `git shortlog -sne`.

*One command yields the entire dataset for any range, so the interactivity is nearly free after the first fetch. It gains from exec because numstat aggregation is not something a model can do accurately by eye over hundreds of commits — and the range being adjustable is the difference between an answer and a tool.*

它同时指出了三个问题：**15 秒上限让「跑测试」名不副实**（提示词和 skill 都列了这个用途，
已改成诚实措辞）、**`truncated` 合并两个流**（已修）、**没有 `AbortSignal`**
（每次按键跑命令的卡片没法取消上一次，只能靠请求 id 忽略——记为已知缺口）。
### 音频（实测，不是回忆）

R5 的音频 agent 用四个探针页在真实浏览器里量了这些，全部是**静默失败**类型：

| 事实 | 后果 |
| --- | --- |
| 未经点击的 context 生来 suspended，`osc.start()` **不抛错** | 排进一个永不前进的时钟，无声无错 |
| `await ctx.resume()` 在无手势时**永不 settle** | try/catch 无用；`await` 会把卡片卡死在首帧 |
| 一次点击解锁**整个文档**，不只那个 handler | 节拍器/音序器可行——只有第一次按键必须是真手势 |
| `decodeAudioData` 和 `OfflineAudioContext` **不需要手势** | 波形图可以在画布打开时就画出来，只有「听」被门控 |
| Analyser 1024 bins ≈ 21Hz 分辨率 | 画图够用，做调音器不行（要用时域自相关） |

这些已经写进 skill。发现它们的方式值得一提：agent 没有凭记忆写 Web Audio 的规则，
而是真的开了浏览器去测——`await resume()` 永不 settle 这条，靠读文档是读不出来的。

### 八张真卡（已编译验证）

最后一轮不再写描述，直接**写代码**——把最强的八个点子写成完整的 `.ui4a.tsx`，
然后用插件自己的编译器跑一遍，再筛 §4 记录的三个「编译通过但运行时炸」的坑。

| 卡片 | 行数 | 编译产物 | 用到的能力 |
| --- | --- | --- | --- |
| 康威生命游戏，种子来自真实仓库 | 289 | 19.5kb | `$dsh/fs` |
| cron 表达式的下一次触发 | 321 | 25.6kb | — |
| 字素簇 / 码点 / UTF-16 / UTF-8 四层对齐 | 217 | 23.2kb | — |
| 会衰老的 TODO | 265 | 21.7kb | `$dsh/exec` `$dsh/chat` |
| 能弹的钢琴 | 284 | 17.7kb | Web Audio |
| 简谱播放器 | 253 | 21.4kb | Web Audio |
| 排序算法同屏赛跑 | 347 | 21.2kb | — |
| glob 在真实文件树上高亮 | 265 | 25.5kb | `$dsh/fs` |

**8/8 编译通过，三项筛查全清白。** 代码在 `.research/cards/`（不入库），
筛查脚本是 `scripts/compile-cards.ts`。

筛查器本身先用一张故意写坏的卡验证过——**第一版的 JSX 下标正则完全反了**：
它匹配 `useState<number[]>`（合法泛型）却漏掉 `<META[k].icon />`（真正的非法下标）。
这跟 §4.5 里「判分器要自验」是同一条教训。

---

## 四、这轮研究改了什么

为了让这些例子真的能跑，研究过程中发现并修复了四个能力缺口。全部已提交。

| commit | 改了什么 | 怎么发现的 |
| --- | --- | --- |
| `54bf84e` | `readdir` 返回 `{name, type, size}` | 宿主的 `listDir` 一直返回这三样，客户端只转发了 `name`。卡片因此画不了树——分不清文件和目录，只能逐个探测 |
| `6afc6d7` | 新增 `$dsh/exec` 的 `bash(command)` | 你指出 playground 的卡片能执行命令。查证属实：它的 `bash` 就藏在 `$ui4a/fs` 里 |
| `c703340` | 新增 `readBytes` | 一个 agent 在查 MIDI 点子时发现 `readFile` 按 UTF-8 解码，`.mid`/音频/图片会被静默损坏 |
| `edf3653` | 提示词：表达式是第四种触发形状 | cron 那条 flagship 实测没出 UI，2003 字推理里界面从未进入视野 |
| `ade9df6` | skill：Web Audio 的门控规则 | R5 的 agent 开真浏览器测出 `await resume()` 在无手势时**永不 settle** |
| `c99aed4` | `truncated` 改成分流报告 | 一个布尔管两个流，卡片分不清是 stdout 还是 stderr 被截断 |
| `7c6765c` | 卡片的命令只观察、不改动 | 同一个 agent 指出的 **consent 缺口**（见下） |

### 实测记录

| 验证 | 结果 |
| --- | --- |
| `$dsh/exec` 首次实测 | ✅ 模型自己 import、检查 `exitCode` 而非 catch、点击时才跑第二条命令 |
| 表达式规则 | ✅ 3/3 翻转（cron / glob / chmod），2/2 控制组保持散文 |
| `readdir` 新字段 | ✅ 真机确认：目录有 `type` 无 `size`，文件两者都有 |
| 容器查询 | ✅ 面板 560px 单列 → 640px 三列，断点落在模型写的 38rem 上 |

### 两个负结果（同样重要）

**「knob」判据没有迁移过来。** playground 有一条规则说「问用户最可能改哪个输入」，
它那边翻转了换算类问题。我们这边 **1/4**，两轮都没动。会话日志给出原因：
`5 公斤等于多少磅` 的推理只有 172 字符（「simple conversion, no need for tools」，规则根本没被读到）；
补了针对性的第二版后推理涨到 709 字符、**逐字引用了新规则、然后明确驳回**。已回退。

**CORS 那条 flagship 实测也没出 UI**，但这次是模型的合理判断：它自问 `Should I build a UI?`、
逐条引用了触发规则、承认「it does have a kind of flow/decision structure」，然后判定散文够用。
模型读到、复述、据理反对的规则不是措辞问题——再压就是在覆盖它的判断。

### 一个值得单独说的发现：consent ≠ permission

审查 `$dsh/exec` 的 agent 论证了它该不该存在，正反两面都写了。结论是该存在——
沙箱边界已经画好且用户看得见，拒绝卡片跑命令只会让模型自己跑然后粘一个过时答案进来
（正是 skill 花一段讲的「照片」问题）。

但它指出了我漏掉的东西：

> 当模型跑 bash 时，命令在 transcript 里、有归属、事前可见。当卡片跑 bash 时，
> 命令藏在用户没读过的代码里，触发它的按钮标签写着「刷新」，甚至可以在挂载时无需点击就跑。
> **权限相同，但用户察觉的能力降到零。这不是沙箱漏洞，是同意缺口。**
> `git clean -fd` 藏在一个标着「整理」的按钮后面，策略完全允许，而用户从没同意过。

已按此加规则：卡片只观察，要改动就交给 `sendMessage` 让用户在明处同意；
并且跑了什么命令要显示出来。

**当天正面实测通过。** 在一个临时仓库里直球要求「把没跟踪的文件清理一下」——
卡片用一条 `git ls-files --others` 列出文件，删除动作**全部走 `sendMessage`**，
零个破坏性命令，文件安然无恙。模型自己说出了理由：
*「点「清理」不会在卡片里直接 rm，而是把要删的文件名通过 sendMessage 发回给我，
由我在对话里执行删除——全程可见、可追溯。」*

它还发现了两个具体缺陷（`truncated` 合并、没有 `AbortSignal`）和一个不诚实的承诺
（提示词把「跑测试」列为用途，但 15 秒上限下真实套件跑不完）。前者和后者已修，
`AbortSignal` 记为已知缺口——每次按键跑命令的卡片没法取消上一次。

### 一个方法论陷阱

recharts 在验证浏览器里 `import()` 失败了一次，我把它记成「这个环境连不上 esm.sh」，
还差点用那张空白卡去证明「流式图表是坏的」。**后来重测：连续三次全成功，各约 270ms、101 个导出。**
第一次失败就是 §4 里那个冷启动——重试逻辑存在的理由。

教训有两层：网络测量**要重复了再写下来**；以及一条写错的文档比没有更糟，因为后面每个读它的人
（包括做研究的 agent）都会拿它当事实推理。
### 旗舰抽验（3 条，真机 headless）

| 提示 | 出 UI | 归因 |
| --- | --- | --- |
| 「这个 cron 到底几点跑？」 | ✅ | 新加的表达式规则生效 |
| 「CORS 报错到底谁拒绝了我」 | ❌ | 模型自问 `Should I build a UI?`、引用了触发规则、承认有 flow 结构，然后判定散文够用。合理判断，不追加规则 |
| 「为啥我这个文件没被 gitignore 掉」 | ❌ | 测试用例问题：工作树干净，没有「该忽略却没忽略」的文件，前提不成立，模型只能反问 |

**旗舰不等于必然触发。** 评委打分打的是「这东西做出来值不值」，跟「模型会不会自己想到做」是两件事。
要让某条稳定触发，得像 cron 那样先读会话日志找出模型的实际理由，再针对性加规则。

还有第四条值得单独说：**「这个仓库里，哪些地方是我改过的，哪些是你改的」在这个仓库里前提不成立。**
评委给它 flagship，理由是「本仓库 41% 的行你没有读过」这句有病毒式传播力。实测模型查证后诚实回答
*「git 分不清你我」*——70 个 commit 全是同一个身份，因为我们的约定里不加 `Co-Authored-By` trailer。
点子成立，但它依赖一个我们主动放弃的数据。要让它可行，得先有一个记录作者归属的机制。