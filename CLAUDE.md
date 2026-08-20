# dsh-generative-ui

**这份 CLAUDE.md 就是本项目的设计文档。** 需求变更先改这里，再改代码 —— 代码与本文不一致时，以本文为准，并把偏差当 bug 修掉。

## 一句话

一个 DeepSeek Harness (dsh) 的 Web 插件：模型往工作区写 TSX，Web 端把它**流式编译、保状态渲染**成可交互 UI —— 聊天流里是内联卡片，侧边是 canvas 视图。

渲染栈是 `partial-tsx` + `partial-react` + `@esm.sh/tsx`，与 `../ui4a-playground` 同源。**那边是自建宿主，这边是寄生在别人的宿主里** —— 差别几乎全在第 2 节。

## 0. 工具链

**本包用 bun**（`bun install` / `bun run build`）。dsh 那边的 pnpm 只作用于 profile 目录 —— `dsh plugin --profile web add link:<path>` 是 dsh 自己转发给 pnpm 的，它不关心我们内部怎么装依赖，只要 `lib/*.js` 在。

`package.json` 的 `prepare: tsdown` 不能删：从 git 安装的人拿到的是源码、没有 `lib/`，插件会静默不加载。

## 1. 分层

| 层 | 位置 | 职责 |
| --- | --- | --- |
| Node 半边 | `src/index.ts` | 只做宿主能力：注册 wasm 资源路由、监听 fs、发 session event |
| 浏览器半边 | `src/client/` | slot 注册、conversation node、渲染 runtime |
| 渲染 runtime | `src/client/runtime/` | 自建 compiler + import-map + host-bridge |

一个 npm 包两个 export（`.` 和 `./client`），靠 `package.json` 的 `dsh` 字段声明。**不拆包** —— dsh 的模型就是单包双半边。

## 2. 宿主给的和不给的

这一节全部是**实测**结论，不是读文档得来的。改动前先看这里，能省一整轮重新查证。

### 2.1 平台共享模块表只有 10 项

`react` / `react/jsx-runtime` / `react-dom` / `react-dom/client` / `@deepseek-ai/cordis` / `dsh-client-ui-slots` / `dsh-client-web-react` / `dsh-client-ui-primitives` / `dsh-client-ui-attachment` / `dsh-client-schema-form`

写在 `tsdown.config.ts` 的 `PLATFORM_MODULES`，必须与宿主的 `packages/client/web/src/platform.ts` 保持一致。列进去 = 运行时走 `require()` 拿宿主单例；没列 = 打进我们自己的 bundle。

**表里没有 `scheduler`，也没有 `react-dom/server`。** 后者是 preflight 必需，只能 inline，且**必须钉 18** 以匹配桥过来的 React。

### 2.2 React 是 18.3.1，不是 19

宿主实测 `React 18.3.1`。生成代码通过 `host-bridge` 拿宿主的**同一个** React 实例 —— 第二份 React 会让 hooks 静默失效。

于是：

- 写本项目的组件时，**React 19 独有 API 一律不可用**（`use()` / `useActionState` / `useOptimistic` / `cache` / `useEffectEvent` / ref-as-prop）。`vercel-composition-patterns` 的 `react19-*` 规则整节跳过 —— 我们仍然需要 `forwardRef`。
- `partial-react@0.0.4` 的 peer 写 `^19.0.0` 但运行时只用 18 就有的 API（已实测，见 MindLab-Research/macaron-genui-demo#1715）。**唯一的类型不兼容**在 `runtime.ts:425`（`Promise<ReactNode>` 不能赋给 18 的 `ReactNode`），运行时无影响。

  注意 **`skipLibCheck` 对它无效** —— 那个选项只跳过 `.d.ts`，而这两个包 ship 的是 `.ts` 源码，值导入会真的去编译它们。

  **不要为此打 patch。** 这是上游的类型 bug（连同 `compiler.ts:13` 那个没声明的 `typeof Bun` 守卫，共 3 条），对我们运行时和构建都没有影响，只有 `tsc` 会报。打 patch 等于用长期维护成本换一行好看的输出，还会把问题藏在本地、削弱上游修它的动力。`scripts/typecheck.mjs` 的做法是把上游错误打印出来但不计入成败，只对 `src/` 判定 —— 上游修好后连这个脚本一起删掉。
- `partial-tsx` / `partial-react` 用了 `toSorted` / `findLast` / `toReversed`，所以 `lib` 必须 ≥ `ES2023`。

### 2.3 非 JS 资源只能走自注册路由

`/plugins` 路由**硬编码只服务 `/client.js` 和 `/client.js.map`**，其它 404。而 `dsh-host-frontend-static` 对未命中的路径返回 **index.html + 200**（不是 404），所以把 wasm 丢进它的 dist 会"看起来能用"，直到 `instantiateStreaming` 报出莫名其妙的 magic word 错误。

正解是 Node 半边 `ctx.webServer.register({ kind: 'prefix', path: '/dsh-generative-ui/assets', ... })`，浏览器半边硬编码该 URL。已实测：`200 · application/wasm · 2,610,857 B`。

两个约束：路径**必须按包名命名空间**（重复的 `(kind, path)` 会抛，而 apply 期抛 = 整个插件静默不加载）；**Electron 形态没有 webServer 路由**，桌面版要另想办法（或退回 base64 inline，+3.3MB）。

CJS 产物里 `import.meta` 不存在，所以上游那种 `import.meta.resolve(...)` 的 bundler-agnostic 写法用不了 —— 必须硬编码 URL 常量。

### 2.4 能碰的槽和碰不得的槽

| 槽 | kind | 用途 |
| --- | --- | --- |
| `conversation.chat.node` | keyed | **内联卡片**。未注册的 kind 优雅降级成 JsonBlock |
| `conversation.view` | list | **canvas 视图 tab**，与「对话 / 轨迹」并列 |
| `shell.overlay` | list | 跨全 frame 的浮层，需要时再用 |

**`details`（右侧列）碰不得。** 它是 `kind: 'single'`，现由 ui-conversation 的 `DetailsPanel` 占着。而动态加载的包其 ctx facade 会覆写 priority（`allocatePriority: () => --this.nextPriority`），**我们必然赢过 shipped 的 0** —— 一注册就静默顶掉 DetailsPanel，连带它声明的 `conversation.details.tool` 一起消失，**全 App 的 tool call 检视功能坏掉**，且没有交接 API。

注册必须包在 `ctx.slots.inject(name, () => ...)` 里：这些槽由 ui-conversation 运行时声明，早注册会抛 `slot "..." is not declared`。

### 2.5 CSS 必须自己打标记

loader 的 `claimStyles(id)` 会执行 `document.querySelectorAll('style:not([data-plugin])')` 并把它们**全部认领**给当前正在 materialize 的插件。所以运行时 UnoCSS 注入的每个 `<style>` 都必须自带 `data-plugin="dsh-generative-ui"`，否则 HMR / 卸载时会互相扯掉样式。

宿主有自己的主题体系（`body[data-ds-dark-theme]` + `--dsw-alias-*`），所以作用域重写必须**提升主题祖先选择器**：`.dark .foo` → `.dark .genui-root .foo`。只加前缀不提升，主题一切换就失效。

### 2.6 打包配置的四个必修项

见 `scripts/build.ts`。这四条都会让插件**构建成功但运行时炸**，报错离原因很远，所以 `bun run smoke` 会在不开浏览器的前提下把它们全部拦下：

- **`external` 只列平台表，且注意 bun 会连子路径一起匹配。** 列了 `react-dom` 就会把 `react-dom/server` 也 external 掉 —— 而后者**不在**平台表里，materialize 时抛 `missed the module table`。用 plugin 把它 resolve 成绝对路径即可绕开 specifier 匹配。（bun 默认 `--packages bundle`，所以不像 tsdown 那样还需要一个反向的 `noExternal`。）
- **必须显式给 `browser` 解析条件。** `react-dom` 的 `exports["./server"]` 只在该条件下指向 `server.browser.js`，否则拿到 Node 版本，把 `require("stream"/"url"/"util")` 拖进浏览器包。
- **必须把 `partial-react/src/compiler.ts` 换成 `src/client/runtime/compiler-shim.ts`。** 它顶层有 `import.meta.resolve` —— 在 CJS factory 里是**语法级**错误，不管那个分支跑不跑都抛，表现为整个插件 `loaded without registering`。反正我们自建了 compiler，换掉顺带也消掉了它的 `Bun` 全局和 node:fs 读法。
- **`define` 掉 `import.meta.url`。** `@esm.sh/tsx` 的入口读它。我们总是显式传 wasm 路径，所以给个常量即可。

### 2.7 类型系统的两个陷阱

- `SlotMap` 是各包 `declare module` 拼起来的。**少装一个包，官方自己的 d.ts 就编不过**（缺 `dsh-client-ui-layout` 时 `'conversation'` / `'details'` 会报 TS2344）。而且光装不够，必须有文件 `import type {} from ".../client"` 才触发合并。
- 必须开 `allowImportingTsExtensions`，因为源码里互相 import 带 `.ts` / `.tsx` 后缀。

## 3. ui4a 契约

沿用 `../ui4a-playground/src/fs/contract.ts`，**唯一区别是文件是真实的**（不是浏览器 VFS）：

```
<workspace>/ui4a/
├── canvases/<id>.ui4a.tsx   # → canvas 视图，一个 mini app
├── canvases/<id>/*.tsx      # → 该 mini app 的子层级
└── state/<id>/states.json   # → 持久化状态（devalue）
```

契约由 `src/contract.ts` 单点解析，**任何地方要判断"这是不是一个 canvas 文件"都必须调它**，不要各处写正则。

模型用 dsh 自带的 `str_replace_editor` / `write` 写这些文件 —— **不定义新工具**。诊断（写坏了告诉模型）走 `tools/post-execute` waterfall 拦截，是纯增量，第一版不做。

## 3.5 inline fence 怎么落地的

协议与 playground 一致：**四个反引号 + `ui4a/tsx`**，模块 `export default` 一个无 props 组件。四反引号不是讲究 —— 生成的 TSX 里经常出现三反引号字符串，三反引号围栏会被它提前关掉。

两件事各归各：

- **教模型**：分两层，切分点是「每轮都要付的钱」。
  - `src/prompt.ts` 经 `ctx.systemPrompt.section()` **常驻**注入：只放触发条件、fence 语法、canvas 路径、色板。
  - `src/skill.ts` 经 `ctx.skills.register()` **按需**加载：判据（要不要出 UI、inline 还是 canvas）、框架规则、布局约束。`dsh-base` 的 bundle 默认装了 `dsh-skill` + `dsh-tool-skill`，所以 runtime 注册的 skill 会进模型的 `<available_skills>` 目录，body 只在它调 `skill` 工具时才拉。
  - 注意目录里**只有 `name` 和 `description`**（`whenToUse` 和 body 都不进），所以 description 是唯一的路由信号，要写触发条件而不是内容摘要。
  - 注册成 `modelInvocable: true, userInvocable: false`：这是给模型看的规范，做成用户 `/` 命令只会把一大段指南打给用户。
  - PTC profile 下工具都得从 `run_code` 里调，所以 prompt 里别写 `` 调用 `skill({name})` `` 这种具体调用形式（模型会直调一次、报 `unknown tool` 再自愈），只说「先加载 X skill」。
- **渲染**：`src/client/runtime/inline-fence.ts` 在 DOM 里认领代码块。dsh **没有**按 markdown language 分发的扩展点（`CodeBlock` 的 `lang` 只是提示，未知语言退化成 plain），所以只能这么做。抓手是 `CodeBlock` 包装元素上那个硬编码的 `md-code-block` 类名，加上 banner 里逐字打印的 info string。

三个必须照做的细节：

- **匹配要接受被截断的 info string。** dsh 的 markdown 解析在第一个非标识符字符处截断，所以模型正确写出的 `ui4a/tsx` 在 DOM 里显示为 `ui4a`。只按全名匹配会静默认领不到任何东西 —— 这个 bug 看起来完全像"模型没照做"，实际日志里模型写得一字不差。`RENDERED_FENCE_LANGS` 同时接受两种形态。
- **隐藏原块，不要移除。** 那个节点属于宿主的 React 树，摘掉一个 React 仍持有的节点，下次 commit 就 `NotFoundError`。
- **MutationObserver 必须合到一帧。** 流式回复每秒触发几十次变更，一次变更一次 sweep 就是主线程烧穿的经典写法。

## 3.6 canvas 面板怎么落地的

**数据源是工具调用，不是新的 session event。** 模型用宿主自带的 `write` 写 `ui4a/canvases/<id>.ui4a.tsx`，客户端从 snapshot 的 `tool-call` 节点读 `root.call.argsRaw`。不用扩 `SessionEventMap`、不碰持久化契约、Node 半边零参与。

**但 canvas 在 web profile 的默认 PTC 模式下拿不到流式**（2026-08-20 实测，在 `calls()` 里插探针采样 5000+ 次）：PTC 下所有工具都从 `run_code` 里调，宿主要等 `run_code` **执行完**才把 `write` 作为 subCall 暴露出来，所以我们看到的第一帧 `write` 就已经是 `settled: true` + 完整的 14388 字符；外层 `run_code` 自己的 `argsRaw` 只有 165 字符（那段调用代码，不含文件内容）。面板因此是写完那一刻整体出现的 —— 真机采样 490 次、状态变化 **0** 次。`streaming: !call.settled` 那套代码本身是对的，非 PTC 下 `write` 是顶层调用时应当生效，只是默认路径走不到。inline 不受影响（下面 §3.5）。

`edit` 类工具是例外：参数是 patch 不是全文。这类调用只把 canvas 标记为 stale（附带一个递增的版本号当缓存 key），真值通过 Node 半边的 `/dsh-generative-ui/canvas` 路由从文件读回。文件是唯一在所有改法下都正确的来源，包括 agent 之外的手改。

三个坑：

- **`tool-call` 节点的 data 是 `{root: {...}}`**，不是 assistant 的 `blocks`。
- **工具参数里是绝对路径**，所以契约匹配找的是路径尾部的 `ui4a/canvases/`，不能锚定开头。
- **面板不能作为 flex 子项插进 AppFrame。** 宿主的列宽正好填满视口，插进去的列一律被排到视口外 —— DOM 里有、尺寸对、就是看不见。正解是 `position: fixed` 贴右边缘 + 给 frame 加等宽 `padding-right`。

## 3.7 配色：把 token 写进 prompt

生成的 UI 默认不知道宿主是深色的，会画出白底卡片糊在深色 App 上。解法不是运行时改写 CSS，而是**把 14 个 `--dsw-alias-*` 语义 token 列进 system prompt**，并明确「绝不写字面颜色」。实测生成代码里 106 处用 token、零处字面 hex。

数据可视化是唯一例外 —— 图表序列需要自己的色相才能区分，prompt 里单独放行了这一条。

## 4. 已知坑

- **流式的中间帧本来就会编译失败**，`No default export found` 是最常见的一个 —— partial-react 明确视其为 transient 并保留上一个好帧。这层语义不能泄漏给调用方，`GenUISurface` 负责在 streaming 期间过滤掉它们，否则模型每打一个字 UI 就闪一次红。
- **`GenUIRenderer.create` 是异步的**，所以 renderer 必须放 state 而不是 ref：放 ref 的话首次渲染 effect 看到 `null` 直接返回，而 `code` 不再变化就永远不会重跑，表现为一个挂上了但永远空白的 surface。
- **`preserveStateOnUpdate` 只适合流式增长**。它靠 hook signature 判断能否复用组件，所以一次「整份文件替换」如果 hook 没变，新内容会被静默丢弃。canvas 因此传 `preserveState={false}`，inline 保持默认。
- **判据要选真的会渲染出来的东西**。验证文件回读时我把标记写进了 TSX 注释，注释永远不出现在 UI 上，于是「功能坏了」的结论完全是假的，白查了很久。改成往 JSX 文本里写标记才测出真相。
- **`statePath`/`STATE_DIR` 是死代码。** 契约从 playground 抄过来了，但状态持久化没实现，全仓库零调用点。skill.ts 已经绕开它（教模型用 `localStorage`），所以不冲突 —— 留着是当未来工作的记号。
- **preflight 抢全局 `console.error`**：`partial-react/src/runtime.ts:215-224` 临时替换、finally 还原。多卡片并发时内层 finally 会还原成外层的收集器，**宿主的 console.error 永久丢失**。chat node 天生多卡片，必须加引用计数或串行化。
- **HMR 没有 react-refresh**：插件内 React state 每次 reload 全丢；增删插件必须重启 dsh。
- **wasm 实例泄漏，且上游没给释放口。** `@esm.sh/tsx` 的导出面只有 `transform`/`init`/`initSync`，没有 dispose/free，所以「显式释放」这条做不到 —— 只能丢掉 `initPromise` 引用等 GC。每轮 HMR 多留一个 ~2.5MB 实例，只影响开发。blob URL 那半边已经接上（`disposeRegistry` 挂在 `ctx.effect` 的 disposer 上）。
- **裸 specifier 必须补 fallback import map。** `registryImports()` 只有 react 那五个；模型一 `import { BarChart } from "recharts"` 就无法解析，而 ESM 的失败方式是整个模块 import 挂掉 —— 界面**一片空白，没有任何报错**（onError 也不触发）。`GenUISurface` 里按代码的 import 集合调 `mergeFallbackImports`（`partial-react/import-map`）探 esm.sh 补齐。它一次约 36ms，所以按 specifier 签名去重，不能每帧都算。
- **`inject` 里的每一项都是硬依赖。** cordis 的 `Inject` 类型没有 required/optional 之分（`registry.d.ts:13`），少一个服务就整个 fiber 不激活、`apply()` 一行都不跑。所以 `webServer` 和 `skills` 都写成 `ctx.inject([...], cb)` 嵌套 fiber：`dsh --profile headless` 没有 `webServer`，要是列在静态 `inject` 里，插件在那儿连教模型都做不成 —— 而那正是批量评测要用的 profile。只有真正缺了就毫无意义的服务（`systemPrompt`）才留在静态数组里。
- **publint 那条 `client.js` 警告不能修。** 它建议把 CJS 的 `lib/client.js` 改成 `.cjs`（因为 `"type": "module"` 让它被当 ESM 解析）。但 `dsh-client-modules` 构造的 URL 写死是 `/plugins/<id>/client.js?rev=...`，改扩展名等于插件加载不了。这是宿主形态的要求，不是我们的疏忽。
- **cordis 在「访问时」而不是「声明时」强制 inject。** 读一个没声明的服务（`ctx.sessions`）不会在 apply 时报错，而是在**请求处理中**抛 `cannot get property "sessions" without inject`，被 `dsh-host-webserver` 兜成一个**没有 body、日志里也没有的 400**。表现完全像路由没注册，实际是缺依赖。绕过类型系统（`as unknown as`）躲开客户端类型冲突并不能躲开运行时这一关 —— 服务该声明还得声明，只是要声明在 `ctx.inject([...])` 作用域里。
- **`/dsh-generative-ui/canvas` 必须校验 `cwd`。** 这条路由会应答用户开着的**任何**页面（简单 GET 不触发预检），所以不校验就是一个全盘的文件存在性预言机 —— 实测 `?cwd=/tmp/leak-probe` 能直接读出文件内容。白名单来源是 `ctx.sessions.list()` 里各 session 的 `header.cwd`；客户端本来就只发当前 session 的 cwd，所以不会误伤。
- **做不了设置面板**：`dsh-host-apiproxy` 只为编译进去的白名单暴露 settings，第三方 `ctx.settings.register` 拿到 `settings-not-exposed`。配置走 `cordis.patch.yml`。
- **dsh 是 developer preview**（写这段时 devDependencies 在 `0.1.0-rc.8`，以 package.json 为准），官方自陈有破坏性变更。升版本时平台表、槽名、事件签名都要重新核 —— rc.7→rc.8 就改了 `ChatNodeSeat` 的 props（`loadImage` → `renderMessageImages`），只是我们没用到。

## 4.5 提示词的实证依据（2026-08-20，40 条评测）

用 `dsh --profile headless "<prompt>"` 跑了 40 条（inline / canvas 各 20），从 `~/.dsh/sessions/<cwd-key>/session-*/session.jsonl.zstd`
里读 `tool/call` 和 `reasoning-chunks` 看**过程**而不只是产物。headless 是这类批测的正确通道：一条一进程、cwd 隔离 session、
`xargs -P` 控并发（`jobs -r` 在非交互 shell 里不上报，别用它当闸门）。

结论是一条几乎完美的相关：

| inline 20 条 | 条数 | 产出界面 |
|---|---|---|
| 载入了 skill | 10 | **9** |
| 没载入 skill | 10 | **0** |

（统计围栏时要认 3 个及以上反引号 —— `segments.ts` 就是这么解析的。只数四个会漏掉模型写 3/5/6/8 个的那些。）

canvas 20 条：**20/20 全部载入 skill**，19 条写对 `ui4a/canvases/<id>.ui4a.tsx` 且 `height:100%`，
剩 1 条（「聊天界面 demo」）判成 inline —— reasoning 里直接引用了 skill 的原话「would the user want this
again in ten turns?」，判对了。

**没载入 skill 的，一个界面都没做出来。** 而漏掉的里面有房贷试算、单位换算、BMI、三方对比 —— 全都该出交互界面。
它们的 reasoning 里根本没出现过 UI 的念头，不是权衡后放弃。所以问题在**常驻层的触发信号**，不在 skill 的内容：
skill 写得再好，模型不去读就等于不存在。据此给常驻 prompt 加了「问题不必说『做一个』才需要界面」那条，按请求形态
（可变的数字、多项对比、有步骤）列举，并点名 `算一下…/看看…/对比一下…` 这些弱措辞。

另外三条实证修正：

- **半数 canvas 没有持久化**（首轮 8/19 用了 localStorage），刷新即丢。canvas 的定义就是「用户会回来的地方」，这是致命的。已在 skill 里要求走
  `localStorage`。注意：**不要写 `usePersistedState`** —— 那是 playground 的 `$ui4a/state`，本插件没有实现，让模型 import
  一个不存在的东西会直接编译失败，比丢状态严重得多。改 prompt 前先 `rg` 一遍自己承诺的 API 到底存不存在。
- **模型会为了「避开库的坑」手写实现**（放弃 recharts 改手搓 SVG、放弃 markdown 渲染器改纯 textarea）。原来那句
  「never hold back because it isn't available」没对症 —— 它顾虑的不是装不上，是库有坑。已补一句点名常用库。
- **中文 canvas id 曾被静默拒绝。** `背单词.ui4a.tsx` 不匹配 `/^[\w-]+$/`（JS 的 `\w` 不含中文），侧栏永不打开而模型仍说
  「做好了」。40 条里命中 1 条。正则的目的是防目录逃逸，不是限 ASCII，已改成排除式 `/^[^/\\.\s]+$/`。

### 先在失败子集上验证（11 条，含 2 条对照）

拿第一轮失败的原话重跑，全部翻转，且两条对照组守住没被推过头：

| | 改前 | 改后 |
|---|---|---|
| `帮我算房贷…` | 无界面，走 bash 算数 | **出界面**，bash 消失 |
| `帮我看看 BMI 正常范围` | 无界面（纯文字） | **出界面**（且没载 skill 就出了 —— 常驻层那条独立生效） |
| `算一下 128GB…换算` | 无界面 | **出界面** |
| `帮我可视化…电动车` | 出界面，但先读了无关的 package.json | **出界面**，冗余 read 消失 |
| `帮我写个正则…边写边测` | 写成 ` ```tsx `，完全丢失 | **正确的 ui4a 围栏** |
| `帮我做个背单词的应用` | 1013 行手搓 | **452 行**，用上 `motion/react` + `lucide-react` |
| canvas 持久化 | 8/19 | **10/11**，`useState` 只留给瞬时 UI 态 |
| 对照 `什么是闭包？` | 无界面 | **仍然无界面** ✓ |
| 对照 `今天星期几` | 无界面 | **仍然无界面** ✓ |

`v-bmi` 的 reasoning 逐字引用了新加的那句（"anything with a number the user might want to change is a
candidate for a block"）然后翻转了原本「简单事实问题、直接回答」的判断 —— 干预有效的直接证据。

### 时序：skill 要在「探查之前」，不是「建造之前」

`帮我比较三款云服务器的性价比` 这种**欠明确**的请求，第一版里模型搜了 10 轮 + 2 次 bash 才去载 skill —— 而 skill 给
这类请求的答案是「先用界面反问」，那句「Do it before you explore」却写在「反问」小节内部，读到时已经搜完了。
把时序规则提到常驻层（标题从「Before you build one」改成「Load the skill **before you explore**」）之后：

- `帮我比较三款云服务器` — 工具调用 **13 次 → 4 次**，skill 从最后一个变成第一个
- `帮我做个网站` — 首个动作就是 skill，零探查，直接出选项卡片反问
- `做个工具给我用` — 改前 0/1 出界面；补了「太模糊的请求最需要它，不是最不需要」那句后 **3/3 全部先载 skill 且出反问卡片**
- `把这些数据可视化一下` — 仍然先探查工作区。这个**是对的**：它得先知道有什么数据，不是冗余。

真机复验：中文 canvas（`ui4a/canvases/单位换算.ui4a.tsx`）侧栏正常打开、面板铺满、功能完整，回复里还说明了状态
存进 `localStorage`（键名 `canvas:单位换算`）—— 正则放宽和持久化两条改动都在浏览器里确认过。

反引号数量实测 3/5/6/8 个都有，**没有一条写对四个** —— 但 `segments.ts` 接受 3 个以上且闭合按开启长度匹配，所以全部正常渲染。
这条容错当初做对了。真正丢失的是把语言写成 `tsx` 的那一条（意图正确、落笔滑落）。

### 改完之后的全量复测（同样 40 条）

在失败子集上验证过之后，拿**完整 40 条**原样重跑，这才是能对照的数字：

| | 首轮 | 复测 |
|---|---|---|
| inline 出界面 | 9/20 | **13/20** |
| inline 载 skill | 10/20 | **13/20** |
| inline 工具调用总数 | 34 | **29** |
| canvas 载 skill | 20/20 | 20/20 |
| canvas 用持久化 | 8/19 | **17/19** |
| canvas 三方 import 总数 | 27 | **42** |
| canvas 平均行数 | 603 | 586 |

canvas 组工具调用 49 → 59，但涨的这 10 次里有 **17 次集中在单独一条**（「团队周报汇总页面」，12 次 edit + 4 次 read
反复自检 JSX 成员表达式合不合法），其余 19 条几乎没变。单条离群，与改动无关。

**更多界面、更少步骤** —— 出界面涨了 4 条的同时工具调用反而降了 5 次，说明不是靠多做工作换来的。
`帮我比较三款云服务器` 一条就从 13 次工具调用降到 4 次。

逐条看，改后仍不出界面的都判对了：内存模型对比→表格、CAP 定理→解释、闭包→解释、JSON 格式化→直接给结果、
今天星期几→一句话。`做个番茄工作法的计时器` 从 inline 变成 canvas，也是判对了（用户会回来的东西）。

**剩下一个稳定的失败模式**：把围栏语言写成 \`tsx\` 而不是 \`ui4a/tsx\`。两轮各命中 1/20（首轮是「正则边写边测」，
复测是「快排每一步」），约 5%。意图链条完全正确 —— reasoning 里明说「build an inline ui4a/tsx block」——
纯粹是落笔那一下滑回了手熟的语言名，界面因此整个丢失、只剩一段源码列表。已在常驻层加了一条专门点名它的规则
（放在「四个反引号」紧后面，离落笔最近的位置）。拿这两条各失败过一次的 prompt 各跑 3 次复验：**6/6 全部写对**。

顺带记两条统计口径的坑，都让我一度得出错误结论：围栏要认 3 个及以上反引号（只数四个会漏掉模型写 3/5/6/8 个的），
统计 canvas 产物要 `find` 整个 runs 目录（我最初用 `runs/*/ui4a/canvases/*.tsx` 这个 glob，漏了文件、把「首轮
8/19 用了持久化」错读成「0/10 全是 useState」）。改 prompt 前先确认基线数字是真的。

### 渲染层实测：编译 32/33，唯一失败是 JSX 下标（2026-08-20）

拿复测产出的 33 份（19 canvas + 14 inline）过一遍插件同款的 `@esm.sh/tsx`：

- **编译通过 32/33。** 唯一失败的是 `<STATUS_META[r.status].icon />` —— JSX 允许成员表达式 `<a.b />`，**不允许下标 `<a[k] />`**。
  模型在 reasoning 里还专门自问自答说服自己「member expressions are allowed」，漏了下标不算。
- 剩下的在真实 dsh web 里跑：recharts + lucide-react + motion/react 三库同用的仪表板正常渲染，1064px、12 个 svg。

**但真机截图抓到了两个 prompt 写错导致的配色 bug**，是静态编译查不出来的：

1. **`--dsw-alias-brand-primary` 不是强调色，是前景色。** 实测它两个主题下都等于 `label-primary`（暗色近白 / 亮色近黑）。
   我原来在色板表里写它是「the one accent」，模型照做 —— 图标块填它、图标本身用白色，得到一个白底白线的方块。
   真正的强调色是 `--dsw-alias-state-business-primary`（DeepSeek 蓝 `rgb(103,158,254)` / `rgb(65,118,230)`）。已改表并加了反例说明。
2. **亮色主题下 `bg-base`/`layer-1`/`layer-2` 全是纯白**，层级只能靠边框。而 skill 里「a border or a background, never both」
   会让模型选了背景就丢边框 —— 亮色下三层全白、毫无层次。已把那条规则改成「背景要真的和底色不同才算数」，
   并在常驻层点明这个主题特性。

改完双主题实拍复验：四个蓝色图标块在亮暗下都清晰，卡片在亮色下靠边框分层。

教训同前：**prompt 里写的每个变量名和它的语义都要实测**，编不出错、渲染不报错，照样能让模型产出用户一眼看出是坏的东西。

### 流式与中途帧 smoke（2026-08-20）

**中途帧压力测试**：把 33 份真实产物切成每 ~40 字符一帧的递增前缀，逐帧走 `normalizeGeneratedTsx` + `transform`
（即 GenUISurface 的 partial 路径）：**11092 帧，硬错误只出现在那份本来就编译不过的文件上**，其余 32 份零错误。
瞬时错误 0 —— 不是被过滤了，是 `normalizeGeneratedTsx` 真的把半截属性 / 未闭合 JSX / 缺花括号都补全了（单独探针验过）。

**inline 确实是流式的**：真机每 250ms 采样，28.5s 首帧、46s 定型，中间横跨 17.5 秒、**47 次**状态变化
（h 0→28→58→78→419→…→1339，节点 0→4→…→390）。60ms 高频采样 23 次变化：**零错误帧、零闪空帧**。
节点数中途会回落（196→174、390→375），那是 `preserveState` 的状态保持重渲染，不是丢内容。

**canvas 在默认 PTC 模式下不流式** —— 见 §3.6 的实测记录。

**多卡片同页**（三个 inline 块一条回复）无冲突，但这一轮抓到一个新的致命错误：

- **默认导出不能和 import 同名。** `import { Pie } from "recharts"` 配 `export default function Pie()` —— 编译器把
  `Pie` 从 import 列表里**整个删掉**（本地声明遮蔽），`<Pie>` 于是指向组件自身，无限递归到 React error #185
  "Maximum update depth exceeded"。**编译期完全不报错**，表现是一张有高度、零子节点的白卡。已在常驻层加规则，复验通过
  （饼图从 `h=84/n=0` 变成 `h=329/n=83/svg=5`）。

顺带一条检测方法：**判断卡片坏没坏，用「有高度但零子节点」，别用 innerText 匹配错误文案** —— #185 那次错误文本不在
容器里，靠文案匹配整个漏掉了。

## 5. 参考实现

抄之前先确认抄的是哪一份 —— 这几个仓库解决的是不同的问题：

| 要素 | 抄谁 |
| --- | --- |
| React 单例桥、import-map、自建 compiler、路径契约 | `../ui4a-playground/src/{runtime,fs}/` |
| wasm 预热、esm.sh fallback 防双 React | `../genui-canvas/src/{genui-runtime,components/genui}/` |
| CSS 作用域 + 主题祖先提升 | `Ori-Replication/obsidian-ui4a-renderer` 的 `src/styling.ts` |
| dsh 插件骨架、tsdown 双 config | `liuup/dsh-latex-tools` |
| 大型 client 插件的组织方式 | `omdsh-dev/DSH-better-sidebar` |

**不要抄** `../macaron-claude-code/web` 的零隔离方案（全局 UnoCSS runtime + 全局 reset）—— 它 vendoring 时把 `useGenUIStyleScope` stub 成了 no-op，在有自己设计系统的宿主里会污染 shell。
