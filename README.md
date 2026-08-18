# dsh-mc-agent 🧱

> 让 AI 陪你玩 Minecraft：DeepSeek Harness 里的 AI 代理，能自主生存、探索、挖矿、聊天、看地图——顺便把启动器（版本下载 + 微软登录 + 游戏启动）也一起做了。
> **UNOFFICIAL** — 非官方项目，与 Mojang Studios / Microsoft 无任何关联。

[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![dsh-plugin](https://img.shields.io/badge/dsh-plugin-compatible-2ea44f)](https://github.com/topics/dsh-plugin)

## 📖 项目简介

`dsh-mc-agent` 是 DeepSeek Harness（DSH）的一个正式 bundle 插件，让「AI 玩 Minecraft」成为 DSH 的一等公民：

- **AI 代理**：通过 LAN 协议直连游戏，驱动真实的 Mineflayer 机器人——自主生存（采集/探索/岩浆水逃生）、挖矿砍树、游戏内聊天、实时地图；另有截图/识图/键鼠控制（视觉 + 控制闭环）。
- **AI 工具**：把游戏数据与能力暴露为 `mc_*` 工具，让 DSH 的 agent 能通过对话指挥机器人、分析崩溃、查询存档与模组。
- **内置启动器**：宿主进程负责版本清单、文件下载、Microsoft 登录与 Java 游戏进程的启动；游戏目录默认 `~/.minecraft`，与官方启动器完全兼容（已有版本、存档、资源直接复用）。
- **双界面模式**：默认作为 DSH 聊天界面里的一个 "Minecraft" 标签页（保留全部 AI 能力）；也可切换为全屏启动器。

## ✨ 功能特性

- ✅ 官方版本清单（release / snapshot / 远古版本），已安装自动标记
- ✅ 一键安装：client jar + libraries（natives 自动解压）+ assets，断点续传（已存在且大小匹配的文件跳过）
- ✅ 启动游戏：按版本 JSON 组装 Java 命令（自动展开 `${natives_directory}`、`${classpath}` 等占位符）
- ✅ Java 自动探测：优先使用官方启动器下载的 `~/.minecraft/runtime/**/bin/java`，其次 PATH 中的 `java`
- ✅ Microsoft 账号登录：**设备码流程（默认，可靠，推荐）**；浏览器授权码登录（PKCE）需额外配置回调地址，作为高级备选
- ✅ **中文界面 + 新手引导**：默认中文；首次使用弹出四步引导（配置 client id → 登录 → 选版本安装 → 开始游戏）
- ✅ **Agent 工具集**：`mc_list_versions` / `mc_install` / `mc_launch` / `mc_kill` / `mc_logs` / `mc_status`——AI 通过对话操作启动器
- ✅ **AI 崩溃分析**：`mc_analyze_crash` 读取崩溃报告与日志，交给 LLM 诊断并给修复建议
- ✅ **AI 游戏助手**：`mc_world_info`（存档时长/死亡）、`mc_mods`（模组清单）、`mc_version_advice`（版本建议）
- ✅ **AI 自主生存（框架）**：`mc_set_goals` / `mc_goals` / `mc_complete_goal`——AI 根据用户人设自动设立 ≥20 个目标并逐个推进、持久化到磁盘
- ✅ **视觉 + 控制（端到端）**：`mc_screenshot`（X11 截图游戏窗口）+ `mc_see`（DashScope Qwen-VL 视觉理解画面）+ `mc_control`（xdotool 模拟键鼠）——AI 能"看"画面、理解处境、"操作"游戏
- ✅ **Mineflayer 机器人（快速模式）**：`mc_bot_*` 工具通过 LAN 协议直连游戏，实时读内存数据（位置/背包/血量/周围方块）+ 精确控制（移动/挖掘/放置/转向），比截图快几个数量级
- ✅ **双界面**：标签页模式（与 AI 聊天共存，默认）或全屏启动器模式；可单独开关"会话中是否显示 Minecraft 标签"
- ✅ **主题自定义**：5 套预设（森林/石板/海洋/末地/熔岩）+ 自定义强调色，即时生效
- ✅ **版本选择框**：下拉分组选择（已安装/Release/Snapshot/Old），不再被超长列表占据版面
- ✅ **登录引导**：未登录时醒目标语横幅 + 点 PLAY 直接唤起登录
- ✅ 游戏日志实时显示、停止游戏、内存/分辨率/Java 路径等设置

## ⚖️ 法律合规（请先阅读）

本项目以 **Mojang EULA（[Minecraft 最终用户许可协议](https://www.minecraft.net/eula)）** 与 **微软服务协议** 为合规基线，设计要点：

| 事项 | 本项目做法 |
| --- | --- |
| **第三方工具许可** | EULA 明确允许开发工具/插件/启动器，前提是"看起来不是官方项目"——本项目在界面与文档中显著标注 **UNOFFICIAL**，不模仿官方启动器外观，不使用 Mojang 官方徽标 |
| **游戏文件分发** | 本项目**不包含、不分发**任何 Mojang 游戏内容；所有游戏文件均由启动器从 Mojang **官方服务器**（launchermeta.mojang.com、piston-meta.mojang.com、resources.download.minecraft.net）下载，符合"所有游戏下载和更新都来自我们授权的来源" |
| **账号要求（必须）** | **不提供离线模式**。游玩必须使用用户自己的微软账号登录（设备码流程）——EULA 规定使用游戏的前提是"您购买我们的游戏后"，绕过账号验证的启动方式（如离线模式）不在本项目范围内。首次使用会弹出 EULA 同意确认 |
| **商标** | "Minecraft" 仅作兼容性指称（nominative use）；界面文字为纯文本样式，不使用官方 logo/资产 |
| **Microsoft 登录** | 使用**你自己注册的 Azure 应用** client id（见下），不使用他人注册的 client id——这是微软应用条款的要求 |
| **隐私** | 无遥测、无第三方统计；账号 token 仅保存在本机 `~/.dsh-mc/account.json`（权限 600） |

> ⚠️ 本项目不用于规避付费、分发盗版或冒充官方。请尊重 Mojang 的知识产权与社区规则；未购买 Minecraft 请勿使用本启动器。

### 注册自己的 Azure client id（登录必需）

1. 打开 [Azure 门户](https://portal.azure.com) → **App registrations** → **New registration**
   - 名称随意；Supported account types 选 **"Accounts in any organizational directory and personal Microsoft accounts"**
2. 进入新应用 → **Authentication** → 勾选 **"Allow public client flows"** → Save
3. 复制 **Application (client) ID** → 填入启动器 **设置 → Microsoft client id**
4. 点 **Sign in**，按弹窗提示在浏览器打开链接并输入设备码即可

## 🚀 快速开始

**环境要求**：Node.js 18+（含全局 `dsh` CLI，v0.1.0-rc.6）、DSH 宿主环境、Java（启动游戏需要；可自动探测 `~/.minecraft/runtime`）。

### 方式 A：安装进已有 DSH profile（简单）

```bash
# 1. 克隆插件
git clone https://github.com/hellosky983/dsh-mc-agent.git
cd dsh-mc-agent

# 2. 编辑你的 profile 的 package.json（如 ~/.dsh/profiles/web/package.json）
#    "dependencies":  { "dsh-mc-agent": "link:/绝对路径/dsh-mc-agent" }
#    "dsh": { "profile": { "bundles": [ ..., "dsh-mc-agent" ] } }

# 3. 安装依赖并重启 DSH
cd <你的profile目录> && pnpm install
```

刷新页面后，整个界面即变为启动器（`root` slot 被插件占据，`priority: -1`）。

### 方式 B：作为独立 DSH 启动器实例（与现有 DSH 完全隔离）

```bash
git clone https://github.com/hellosky983/dsh-mc-agent.git
cd dsh-mc-agent

# 建独立 profile：<项目>/dsh-home/profiles/minecraft/package.json：
#   {
#     "name": "dsh-profile-minecraft",
#     "private": true,
#     "dependencies": { "dsh-mc-agent": "link:../../../dsh-mc-agent" },
#     "dsh": { "profile": { "bundles": [
#         "@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-mc-agent" ] } }
#   }

cd <项目>/dsh-home/profiles/minecraft && pnpm install
DSH_HOME=<项目>/dsh-home dsh --profile minecraft --port 39970
```

浏览器打开 `http://127.0.0.1:39970` 即为启动器页面。独立实例使用自己的 `DSH_HOME`，会话/设置/凭证与聊天实例互不影响。

### 卸载（Uninstall）

```bash
# 1. 从 profile 的 package.json 中删除两处：
#    - "dependencies" 里的 "dsh-mc-agent" 条目
#    - "dsh.profile.bundles" 数组里的 "dsh-mc-agent"
# 2. 重新安装依赖（移除符号链接与 node_modules 中的包）
cd <你的profile目录> && pnpm install
# 3. 重启 DSH：页面即恢复为默认界面
# 4.（可选）删除本地数据：~/.dsh-mc/（settings.json、account.json）
#    游戏目录 ~/.minecraft/ 不受影响，可保留
```

## 📦 兼容性（Compatibility）

| 项 | 说明 |
| --- | --- |
| DSH 版本 | `0.1.0-rc.6`（2026-08-14 在独立 profile + web profile 实测：版本列表 / 安装 1.21.11 / 启动至游戏世界均通过） |
| 运行环境 | Node.js 18+（DSH 宿主进程）、现代浏览器（启动器 UI） |
| Java | 启动游戏需要；自动探测 `~/.minecraft/runtime/**/bin/java` 或 PATH 中的 `java`。不同 MC 版本对 Java 版本有要求（如 1.21+ 需 Java 21+） |
| 系统工具 | natives 解压优先使用内置 `adm-zip`（npm 依赖），不可用时回退到系统 `unzip` 命令 |
| 平台 | Linux / macOS / Windows（代码跨平台；Windows 下 natives 路径分隔符已处理） |

> 兼容性结论可能随 DSH mainline 快速变化而失效，请以实测为准。

## 🔐 权限与数据访问（Permissions & data）

| 对象 | 访问内容 | 说明 |
| --- | --- | --- |
| 文件 `~/.minecraft/` | 读 + 写 | 版本文件、libraries、assets、存档（与官方启动器同结构）；`mc_world_info` 读 `saves/*/stats/*.json`，`mc_mods` 读 `mods/*.jar` 元数据，`mc_analyze_crash` 读 `crash-reports/` 与 `logs/latest.log` |
| 文件 `~/.dsh-mc/` | 写（权限 600） | `settings.json`（配置）、`account.json`（登录 token）、`goals.json`（自主模式目标）、`shots/`（游戏截图，供 `mc_see` 分析） |
| 网络：`dashscope.aliyuncs.com` | 只读 | `mc_see` 调用 DashScope Qwen-VL 视觉模型识别截图（需 `DASHSCOPE_API_KEY`） |
| 网络：`127.0.0.1:<LAN端口>` | 双向 | `mc_bot_*` 通过 Minecraft LAN 协议读写游戏数据（Mineflayer） |
| 进程：`xdotool` / `ffmpeg` | 执行 | `mc_control`（键鼠输入）、`mc_screenshot`（X11 截屏），仅作用于 Minecraft 窗口 |
| 网络：`launchermeta.mojang.com`、`piston-meta.mojang.com`、`resources.download.minecraft.net` | 只读 | 版本清单与游戏文件下载（Mojang 官方源） |
| 网络：`login.microsoftonline.com`、`user.auth.xboxlive.com`、`xsts.auth.xboxlive.com`、`api.minecraftservices.com` | 只读 | Microsoft 设备码登录链 |
| 进程 | 启动 Java 子进程 | 游戏本体；可被 Stop 按钮终止 |
| 遥测/统计 | 无 | 不收集任何使用数据 |

## 📖 使用说明

| 配置项 | 说明 | 默认值 |
| --- | --- | --- |
| `gameDir` | 游戏目录（与官方启动器同结构） | `~/.minecraft` |
| `javaPath` | Java 可执行文件路径，留空自动探测 | 自动 |
| `memoryMb` | JVM 堆内存 | `2048` |
| `clientId` | 你自己的 Azure 应用 ID（登录必需） | 空 |
| `width` / `height` | 游戏窗口分辨率 | 854×480 |
| `uiMode` | 界面模式：`tab`（标签页，推荐）/ `fullscreen`（全屏） | `tab` |
| `showTab` | tab 模式下是否在会话中显示 Minecraft 标签（关则纯工具模式） | `true` |
| `theme` | 主题：`{preset: default/light/ocean/end/lava, accent: "#hex"}` | 森林 + 默认绿 |

设置保存在 `~/.dsh-mc/settings.json`，账号保存在 `~/.dsh-mc/account.json`（权限 600）。

## 📁 项目结构

```
dsh-mc-agent/
├── package.json        # dsh.bundle.patch 声明 + dsh.client 注入
├── index.js            # Host 半：/api/mc/* 后端（清单/下载/登录/启动/日志）
├── lib/client.js       # Client 半：全屏启动器 UI（root slot，priority: -1）
├── cordis.patch.yml    # bundle 挂载补丁
├── README.md
└── LICENSE             # MIT + 商标/内容声明
```

## 🛠️ 架构

```
DSH 会话（AI 聊天，可调用 mc_* 工具）
   │  mc_list / mc_install / mc_launch / mc_analyze_crash / mc_world_info / mc_mods ...
   ▼
浏览器（Minecraft 标签页 或 全屏启动器 UI）
   │  fetch /api/mc/*（同源 HTTP）
   ▼
DSH 宿主进程（dsh-mc-agent Host 半）
   ├─ Mojang 官方 API（version manifest / version json / assets）
   ├─ Microsoft OAuth2 设备码登录链（XBL → XSTS → Minecraft services）
   ├─ 并发下载 + natives 解压（adm-zip / unzip）
   ├─ spawn Java 游戏进程，日志环形缓冲
   └─ 游戏数据只读分析（crash-reports / saves stats / mods 元数据）
```

## 🤖 AI 自主生存（视觉 + 控制）

让 AI 像人一样"看屏幕、操作游戏"：

```
agent 循环：
  mc_set_goals(人设) → 设定 ≥20 个目标
  mc_launch            → 启动游戏（窗口模式）
  ┌─ mc_screenshot     → 截取游戏窗口
  ├─ mc_see            → 视觉模型描述画面（环境/威胁/状态）
  ├─ 决策              → 下一步做什么
  ├─ mc_control        → 前进/跳跃/攻击/转向…
  └─ mc_complete_goal  → 达成后标记，继续下一个
```

**依赖**：
- 视觉：阿里百炼 DashScope 的 `qwen-vl-plus`（需在 `~/.bashrc` 配置 `export DASHSCOPE_API_KEY=sk-...`，或在 设置 → DashScope key 填入）
- 控制/截图：Linux X11 + `xdotool` + `ffmpeg`（Debian/Ubuntu：`sudo apt install xdotool ffmpeg`）
- 游戏建议**窗口模式**运行（更易定位与截屏）

> 注：`mc_control` 会激活并聚焦游戏窗口（模拟真实键盘鼠标），执行期间请勿同时操作电脑，以免干扰。

### ⚡ 快速模式：LAN 机器人（Mineflayer）

比截图/键鼠快几个数量级——AI 直接读写游戏内存数据、协议级控制：

```
agent 循环（快速）：
  1. 游戏内 Esc → 对局域网开放（Open to LAN）→ 记下端口
  2. mc_bot_connect       → 机器人连入世界（端口自动从日志探测）
  3. mc_bot_state         → 实时读位置/血量/饥饿/背包/周围方块（毫秒级）
  4. mc_bot_move/dig/place/look/equip → 精确控制
  5. mc_bot_chat("/...")  → 执行游戏命令
```

- `mc_bot_state` 返回精确坐标、血量、背包物品、手持物品、周围方块名——无需截图识别
- `mc_bot_move(x,y,z)` 自动寻路、`mc_bot_dig` 挖掘、`mc_bot_place` 放置、`mc_bot_equip` 切换物品
- 依赖 `mineflayer` + `mineflayer-pathfinder`（已在 dependencies 中）

## ❓ 常见问题

- **Q：Sign in 报 "no Azure client id configured"？** A：按上文"注册自己的 Azure client id"操作后填入设置。
- **Q：登录报 `AADSTS700016`？** A：说明该 client id 在你的微软目录中不存在——请使用自己注册的 client id。
- **Q：游戏打不开？** A：查看底部控制台日志；确认已登录（未登录会提示）、Java 版本满足所选版本要求（如 1.21+ 需要 Java 21+）。
- **Q：打开后是普通 DSH 聊天界面，启动器在哪？** A：默认是**标签页模式**——先开始一个会话，顶部会出现 "Minecraft" 标签，点击即打开启动器；你也可以在聊天里直接用 `mc_*` 工具操作。想全屏可在 设置 → Interface mode 切换为 Fullscreen（重启生效）。
- **Q：怎么让 AI 帮我装/启动游戏？** A：在聊天里直接说，例如"帮我安装 1.21.11 并启动"——agent 会调用 `mc_list_versions` / `mc_install` / `mc_launch` 等工具完成。崩溃了也可以说"游戏起不来了"，它会用 `mc_analyze_crash` 分析崩溃报告。
- **Q：可以离线/免账号玩吗？** A：**不可以**。本项目不提供离线模式——按 Mojang EULA，游玩必须以合法购买的账号登录。

## 🧪 开发与测试（Development）

```bash
git clone https://github.com/hellosky983/dsh-mc-agent.git
cd dsh-mc-agent && pnpm install        # 安装 dev 依赖（adm-zip 等）
node --check index.js                      # Host 半语法检查
node --check lib/client.js                 # Client 半语法检查
```

- 修改后重启 DSH 实例即可生效（bundle 插件随进程加载）
- 手动冒烟：启动实例 → 打开页面 → 版本列表/安装/登录/启动全流程（详见上方使用说明）
- 欢迎提交 Issue / PR；贡献前请阅读 [LICENSE](LICENSE) 与上文法律合规章节

## 🛡️ 安全报告（Security）

- 本项目无遥测、无第三方统计；账号 token 仅存本机（`~/.dsh-mc/account.json`，权限 600）
- 发现安全问题（如 token 泄露路径、注入、权限缺陷）请通过 [GitHub Issues](https://github.com/hellosky983/dsh-mc-agent/issues) 私密/公开报告，或直接提交修复 PR
- 请勿在 Issue 中粘贴真实 token 或账号信息

## 📄 许可证

MIT © dsh-mc-agent contributors。商标与内容声明见 [LICENSE](LICENSE)。

Minecraft © Mojang Studios。本项目与 Mojang Studios / Microsoft 无关联。
