# Codex Trace Viewer

> 把 Codex 的每一次工作，从“聊天记录”升级成一条可以理解、定位和复盘的完整轨迹。

如果你每天使用 Codex，却只能在结束后凭感觉回忆“刚才到底做了什么”，这个项目就是为你准备的。Codex Trace Viewer 把本地 Codex rollout trace 组织成类似 Langfuse 的可观测工作台：先按日期找到活动，再进入具体 session，最后查看连贯的 Trace 树、时间线、关系图、对话和节点详情。

它不要求 Langfuse、Docker、数据库或云端账号。数据默认留在本机，界面直接做成适合长期使用的桌面工作台。你可以用它回答：

- 今天我主要用 Codex 做了什么？
- 哪些 session 最慢、最复杂或失败了？
- 哪些工具、Skill 和 MCP 使用最多？
- 某个模型调用是怎样触发工具和子任务的？
- 哪些能力已经很久没有使用，是否值得清理或重新整理？

这是一个独立社区项目，不隶属于 OpenAI、Codex 或 Langfuse，也不上传数据到 Langfuse。

## 为什么值得使用

Codex 很强，但原始运行过程通常分散在终端输出、会话文件、工具结果和模型请求中。这个项目把这些信息重新拼成一张可读的使用地图：

- **像产品一样浏览**：日期 -> session -> Trace，先总览，再逐层深入。
- **像 Langfuse 一样理解调用链**：树、瀑布时间线、从上到下的关系图和对话视图互相配合。
- **像调试器一样定位问题**：慢节点、失败节点、模型调用、工具调用、Token 和原始 Payload 都能追溯。
- **像个人分析师一样复盘**：每日统计使用习惯、常用场景、工具组合、Skill/MCP 活跃度和长期未使用项。
- **默认 local-first**：不需要注册账号，不需要部署服务，原始 trace 不会自动离开本机。

## 适合谁

### 不熟悉技术的用户

你只需要让 Codex 产生一次会话，然后打开桌面窗口。页面会按日期列出活动，点进日期看到 session，再点进 session 查看完整轨迹。大多数情况下不需要手动读 JSON，也不需要理解 trace 文件结构。

### 需要调试和分析的开发者

你可以查看 reduced state、原始 Payload 引用、模型与工具边界、子 Agent 关系、Token 使用、失败原因，并通过 `codex debug trace-reduce` 对 Raw bundle 进行可重复归约。

### 想了解长期使用习惯的人

每日复盘会把会话、模型、Provider、工具、Skill、MCP、项目、活跃时段、缓存和 Token 汇总起来。还可以在设置中启用 OpenAI 兼容 LLM，让模型从聚合数据中归纳规则分类之外的新场景和跨信号习惯。

## 30 秒开始使用

### 环境要求

- Node.js 22 或更高版本。
- 能写入 rollout trace 的 Codex CLI 或本地 Codex App runtime。
- Windows 用户可以使用 PowerShell 启动桌面窗口；服务本身也可以在其他平台运行。

### 第一步：给 Codex 指定 trace 目录

在启动 Codex 之前设置用户级环境变量。Windows PowerShell 示例：

```powershell
$traceRoot = "E:\interesting\codex\.codex-traces"
$dataRoot = "E:\interesting\codex\.codex-insights"

New-Item -ItemType Directory -Force $traceRoot, $dataRoot | Out-Null

[Environment]::SetEnvironmentVariable("CODEX_ROLLOUT_TRACE_ROOT", $traceRoot, "User")
[Environment]::SetEnvironmentVariable("CODEX_INSIGHTS_ROOT", $dataRoot, "User")
```

设置后重新打开终端和 Codex。也可以只对当前终端临时设置：

```powershell
$env:CODEX_ROLLOUT_TRACE_ROOT = "E:\codex-traces"
$env:CODEX_INSIGHTS_ROOT = "E:\codex-insights"
codex
```

### 第二步：打开桌面工作台

在项目目录双击：

```text
open-desktop.cmd
```

或者运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\open-desktop.ps1
```

它会复用已经运行的本地服务；如果 `4319` 端口没有服务，会自动启动一个。桌面窗口使用 Edge App 模式，没有地址栏和普通标签页。

如果不需要桌面窗口，也可以直接打开：

<http://127.0.0.1:4319/>

### 第三步：产生一条会话

运行一次 Codex，完成一个任务，然后回到工作台刷新。你会看到类似下面的目录：

```text
E:\interesting\codex\.codex-traces\
└─ trace-...\
   ├─ manifest.json
   ├─ trace.jsonl
   ├─ payloads\
   └─ state.json        # 归约完成后出现
```

Ready session 会直接打开。Raw session 第一次打开时会显示“需要归约”，点击归约即可，系统会调用本机 Codex CLI 完成处理。

## CLI、Desktop App 和云端 Codex

这个项目读取的是本地文件，不是通过网络拦截 Codex：

```text
Codex CLI / 本地 Desktop App
          |
          | CODEX_ROLLOUT_TRACE_ROOT
          v
本地 trace bundle -> Codex reducer -> Codex Trace Viewer
```

### Codex CLI

CLI 是最直接、最稳定的使用方式。只要启动 CLI 的进程继承了 `CODEX_ROLLOUT_TRACE_ROOT`，每个独立 rollout 会产生一个 `trace-*` 目录。

### Codex Desktop App

桌面 App 是独立进程，不能只依赖某个临时 PowerShell 窗口中的 `$env:` 变量。推荐使用上面的 `User` 级环境变量，然后完全退出桌面 App（包括托盘进程）再重新打开。只要 App 使用的本地 Codex runtime 支持 rollout trace，它就会写入同一个目录。

`codex app` 命令本身主要负责打开桌面 App；真正是否产生 trace，取决于桌面 App 内部使用的 runtime。云端 Codex、ChatGPT 网页版 Codex 和远程 session 不会写入本机 trace，因此不在当前工具的采集范围内。

## 你能看到什么

### Trace 工作区

- 日期浏览：活跃天数、session 数、完成数、Raw 数量和总耗时。
- Session 列表：首条用户指令、状态、耗时、模型、项目、工具数和 Token。
- Trace 树：从根 session 到 runtime turn、model generation、tool、MCP 和子任务的层级结构。
- 时间线：按时间查看模型调用、工具调用、慢节点和失败节点。
- 关系图：从上到下展示调用关系，支持鼠标拖动和滚轮缩放。
- 对话视图：把用户、助手和工具消息恢复成更容易阅读的对话。
- 节点详情：概览、Input、Output、Metadata 和 Raw JSON，Payload 按需加载。
- 搜索与筛选：按指令、Rollout ID、项目、模型、状态和节点类型定位内容。

### 每日复盘

每日复盘不是单纯的会话计数，而是一个本地使用分析报告：

- 会话完成率、运行时回合、活跃时间和活跃时段。
- 模型、Provider、项目、输入/输出/推理/缓存 Token。
- 工具、Skill、MCP 的使用次数和最后使用时间。
- 规则统计出的常见使用习惯和场景。
- 长期没有使用过的工具、Skill 和 MCP 建议。
- 可选的 OpenAI 兼容 LLM 分析，用于动态归纳场景、习惯和改进建议。

清理项只是建议，系统不会自动删除 Skill、MCP、日报或 trace bundle。

## 可选的 LLM 智能分析

默认情况下，日报完全使用本地规则统计，不调用外部模型。你可以在“设置 -> LLM 智能分析”中启用 OpenAI 兼容的 Chat Completions 接口：

- API 基础地址，例如 `https://api.openai.com/v1`。
- 模型名称，例如 `gpt-5-mini` 或本地兼容模型。
- 可选 API Key；不需要授权的本地服务可以留空。
- 5 到 300 秒的请求超时。
- 保存前可以点击“测试连接”。

手动复盘和定时复盘使用同一条链路。LLM 超时、HTTP 错误或返回无效 JSON 时，规则日报仍然会保存，界面会明确显示“失败，已降级”。

发送给 LLM 的内容是有上限的聚合指标、Top 使用项、清理信号和经过裁剪/脱敏的提示预览，不包含原始 Payload、源码或完整命令输出。API Key 只保存在本机设置文件中，设置接口不会返回明文 Key。

## Windows 开机启动

如果希望服务在登录后自动启动：

```powershell
powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
```

安装脚本会创建当前用户的 `CodexDailyInsights` 登录任务，并保存 trace 与日报目录。移除任务：

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall-windows.ps1
```

这项任务负责启动本地 Node 服务。桌面窗口仍然可以通过 `open-desktop.cmd` 打开。

## 命令行参数和目录

| 参数 | 默认值 | 作用 |
| --- | --- | --- |
| `--trace-root <path>` | `CODEX_ROLLOUT_TRACE_ROOT` 或 `./traces` | rollout trace bundle 目录 |
| `--data-root <path>` | `CODEX_INSIGHTS_ROOT` 或 `./.codex-insights` | 日报、设置和归约相关数据目录 |
| `--codex <executable>` | `codex` | Raw bundle 归约时调用的 Codex CLI |
| `--codex-home <path>` | `CODEX_HOME` 或用户目录下的 `.codex` | Skill 与 MCP inventory 来源 |
| `--host <address>` | `127.0.0.1` | HTTP 绑定地址 |
| `--port <number>` | `4319` | HTTP 端口 |

常见启动命令：

```powershell
node server.mjs `
  --trace-root E:\interesting\codex\.codex-traces `
  --data-root E:\interesting\codex\.codex-insights `
  --codex-home C:\Users\26891\.codex `
  --port 4319
```

服务提供的主要本地 API：

| API | 用途 |
| --- | --- |
| `GET /api/config` | 查看路径、Codex CLI 和采集状态 |
| `GET /api/traces` | 获取 session 列表 |
| `GET /api/traces/:id` | 获取归约后的 Trace state |
| `GET /api/traces/:id/payloads/:payloadId` | 按需读取 Payload |
| `GET /api/reviews` | 获取历史日报 |
| `POST /api/reviews/run` | 生成一次日报 |
| `GET/PUT /api/settings` | 读取或保存设置 |
| `POST /api/settings/test-llm` | 测试 OpenAI 兼容接口 |

## 技术架构

项目分成四层：

1. **Codex runtime**：在本地写入有序 raw event 和 Payload 引用。
2. **Reducer**：调用 `codex debug trace-reduce <bundle-directory>`，将 raw bundle 还原成语义化 Trace graph。
3. **Node.js viewer service**：发现 bundle、读取 state、提供本地 API、执行每日复盘和定时任务。
4. **桌面工作台 UI**：纯 HTML/CSS/JavaScript，运行在 Edge App/PWA 窗口中，不需要前端构建工具。

原始数据和归约数据的区别很重要：Raw bundle 是证据，`state.json` 是可浏览的语义图。Ready session 会直接读取 `state.json`，不会重复归约；Raw session 只有在用户明确请求时才会归约。

主要文件：

```text
server.mjs                本地 HTTP API、bundle 发现、归约和调度器
insights.mjs              每日复盘聚合、设置、日报持久化
llm-review.mjs            OpenAI 兼容 LLM 分析链路
public/index.html         工作台页面结构
public/app.js             路由、状态、交互和日报渲染
public/trace-detail.js    Trace 树和节点详情归一化
public/styles.css         深色、响应式桌面工作台样式
open-desktop.ps1          Windows 桌面窗口启动器
open-desktop.cmd          可双击的 Windows 启动入口
fixtures/                 小型确定性测试 bundle
```

## 常见问题

### 页面显示没有 session

确认 Codex 是在设置 `CODEX_ROLLOUT_TRACE_ROOT` 之后重新启动的，并检查 trace 目录下是否出现新的 `trace-*` 文件夹。当前工具只读取本地 rollout trace，不会从普通聊天记录推测 session。

### 打开 Raw session 时出现 409

这是预期状态，不代表服务器坏了。说明 bundle 有 `manifest.json` 和 raw event，但还没有 `state.json`。在界面中点击归约，或手动运行：

```powershell
codex debug trace-reduce E:\path\to\trace-bundle
```

### 出现 500

先查看界面中的具体错误。常见原因是 trace 正在写入、bundle 文件不完整、Codex CLI 路径不可用或 Payload 文件损坏。刷新后重试；如果是 Raw bundle，优先确认 `codex debug trace-reduce` 可以独立运行。

### Desktop App 没有产生新 trace

完全退出 App 后重新打开，确认使用的是用户级环境变量，而不是只在某个 PowerShell 窗口中设置的临时变量。如果仍然没有新的 `trace-*` 目录，当前 App runtime 可能没有启用 rollout trace；监测工具本身不能给一个不产生 trace 的闭源远程 App 强行补上事件。

### Skill 或 MCP 没有出现在日报中

使用 `--codex-home` 指向真正的 Codex home。Skill 通常从 `skills` 和插件缓存目录读取，MCP 则从对应的 `config.toml` 中识别。inventory 只用于本地统计，不会自动修改配置。

## 隐私与安全

Trace 可能包含提示词、模型响应、工具参数、命令输出、本地路径和源码。请把它当作敏感数据处理：

- 默认只绑定 `127.0.0.1`，不要直接暴露到不可信网络。
- 不要把真实 API Key、业务密钥或敏感 Payload 提交到 Git。
- 启用 LLM 分析前，先确认所填服务的存储和日志策略。
- 本项目不会自动上传 Langfuse，也不依赖 Langfuse、Docker 或数据库。
- 清理建议不会自动执行删除操作。

## 开发与测试

项目运行时不需要额外依赖，使用 Node.js 内置模块和浏览器 API。运行测试：

```powershell
npm test
node --check server.mjs
node --check public/app.js
node --check public/trace-detail.js
git diff --check
```

服务启动：

```powershell
npm start -- --trace-root E:\codex-traces --data-root E:\codex-insights
```

仓库只包含独立 viewer、日报逻辑、Windows 启动脚本、fixtures 和测试，不包含 Codex 源码，也不包含任何本地 trace 或日报数据。

## 项目关系与许可证

本项目借鉴了 Langfuse 在 Trace 树、时间线和关系图方面的交互思路，但没有复制 Langfuse 运行时、没有调用 Langfuse 服务，也不要求安装 Langfuse。

项目采用 [MIT License](LICENSE)。Copyright 2026 Jin Zhangzheng。

项目地址：<https://github.com/Jane-o-O-o-O/Make-Codex-Your-Own>
