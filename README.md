# dsh-mc-launcher 🧱

> 把 DeepSeek Harness 改造成 Minecraft 启动器：全屏启动器界面 + 版本下载 + 游戏启动，全部跑在 DSH 宿主进程里。
> **UNOFFICIAL** — 非官方项目，与 Mojang Studios / Microsoft 无任何关联。

[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![dsh-plugin](https://img.shields.io/badge/dsh-plugin-compatible-2ea44f)](https://github.com/topics/dsh-plugin)

## 📖 项目简介

`dsh-mc-launcher` 是 DeepSeek Harness（DSH）的一个正式 bundle 插件：它以 `priority: -1` 占据浏览器界面的 `root` slot，
把整个 DSH 页面渲染成全屏 Minecraft 启动器；宿主进程负责版本清单、文件下载、Microsoft 登录与 Java 游戏进程的启动。
游戏目录默认 `~/.minecraft`，与官方启动器完全兼容——已有版本、存档、资源直接复用。

## ✨ 功能特性

- ✅ 官方版本清单（release / snapshot / 远古版本），已安装自动标记
- ✅ 一键安装：client jar + libraries（natives 自动解压）+ assets，断点续传（已存在且大小匹配的文件跳过）
- ✅ 启动游戏：按版本 JSON 组装 Java 命令（自动展开 `${natives_directory}`、`${classpath}` 等占位符）
- ✅ Java 自动探测：优先使用官方启动器下载的 `~/.minecraft/runtime/**/bin/java`，其次 PATH 中的 `java`
- ✅ Microsoft 账号登录（OAuth2 设备码流程：device code → XBL → XSTS → Minecraft services → 皮肤档）
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
git clone https://github.com/hellosky983/dsh-mc-launcher.git
cd dsh-mc-launcher

# 2. 编辑你的 profile 的 package.json（如 ~/.dsh/profiles/web/package.json）
#    "dependencies":  { "dsh-mc-launcher": "link:/绝对路径/dsh-mc-launcher" }
#    "dsh": { "profile": { "bundles": [ ..., "dsh-mc-launcher" ] } }

# 3. 安装依赖并重启 DSH
cd <你的profile目录> && pnpm install
```

刷新页面后，整个界面即变为启动器（`root` slot 被插件占据，`priority: -1`）。

### 方式 B：作为独立 DSH 启动器实例（与现有 DSH 完全隔离）

```bash
git clone https://github.com/hellosky983/dsh-mc-launcher.git
cd dsh-mc-launcher

# 建独立 profile：<项目>/dsh-home/profiles/minecraft/package.json：
#   {
#     "name": "dsh-profile-minecraft",
#     "private": true,
#     "dependencies": { "dsh-mc-launcher": "link:../../../dsh-mc-launcher" },
#     "dsh": { "profile": { "bundles": [
#         "@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-mc-launcher" ] } }
#   }

cd <项目>/dsh-home/profiles/minecraft && pnpm install
DSH_HOME=<项目>/dsh-home dsh --profile minecraft --port 39970
```

浏览器打开 `http://127.0.0.1:39970` 即为启动器页面。独立实例使用自己的 `DSH_HOME`，会话/设置/凭证与聊天实例互不影响。

### 卸载（Uninstall）

```bash
# 1. 从 profile 的 package.json 中删除两处：
#    - "dependencies" 里的 "dsh-mc-launcher" 条目
#    - "dsh.profile.bundles" 数组里的 "dsh-mc-launcher"
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
| 文件 `~/.minecraft/` | 读 + 写 | 版本文件、libraries、assets、存档（与官方启动器同结构） |
| 文件 `~/.dsh-mc/` | 写（权限 600） | `settings.json`（配置）、`account.json`（登录 token） |
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

设置保存在 `~/.dsh-mc/settings.json`，账号保存在 `~/.dsh-mc/account.json`（权限 600）。

## 📁 项目结构

```
dsh-mc-launcher/
├── package.json        # dsh.bundle.patch 声明 + dsh.client 注入
├── index.js            # Host 半：/api/mc/* 后端（清单/下载/登录/启动/日志）
├── lib/client.js       # Client 半：全屏启动器 UI（root slot，priority: -1）
├── cordis.patch.yml    # bundle 挂载补丁
├── README.md
└── LICENSE             # MIT + 商标/内容声明
```

## 🛠️ 架构

```
浏览器（启动器 UI，占据 root slot）
   │  fetch /api/mc/*（同源 HTTP）
   ▼
DSH 宿主进程（dsh-mc-launcher Host 半）
   ├─ Mojang 官方 API（version manifest / version json / assets）
   ├─ Microsoft OAuth2 设备码登录链（XBL → XSTS → Minecraft services）
   ├─ 并发下载 + natives 解压（adm-zip / unzip）
   └─ spawn Java 游戏进程，日志环形缓冲
```

## ❓ 常见问题

- **Q：Sign in 报 "no Azure client id configured"？** A：按上文"注册自己的 Azure client id"操作后填入设置。
- **Q：登录报 `AADSTS700016`？** A：说明该 client id 在你的微软目录中不存在——请使用自己注册的 client id。
- **Q：游戏打不开？** A：查看底部控制台日志；确认已登录（未登录会提示）、Java 版本满足所选版本要求（如 1.21+ 需要 Java 21+）。
- **Q：可以离线/免账号玩吗？** A：**不可以**。本项目不提供离线模式——按 Mojang EULA，游玩必须以合法购买的账号登录。

## 🧪 开发与测试（Development）

```bash
git clone https://github.com/hellosky983/dsh-mc-launcher.git
cd dsh-mc-launcher && pnpm install        # 安装 dev 依赖（adm-zip 等）
node --check index.js                      # Host 半语法检查
node --check lib/client.js                 # Client 半语法检查
```

- 修改后重启 DSH 实例即可生效（bundle 插件随进程加载）
- 手动冒烟：启动实例 → 打开页面 → 版本列表/安装/登录/启动全流程（详见上方使用说明）
- 欢迎提交 Issue / PR；贡献前请阅读 [LICENSE](LICENSE) 与上文法律合规章节

## 🛡️ 安全报告（Security）

- 本项目无遥测、无第三方统计；账号 token 仅存本机（`~/.dsh-mc/account.json`，权限 600）
- 发现安全问题（如 token 泄露路径、注入、权限缺陷）请通过 [GitHub Issues](https://github.com/hellosky983/dsh-mc-launcher/issues) 私密/公开报告，或直接提交修复 PR
- 请勿在 Issue 中粘贴真实 token 或账号信息

## 📄 许可证

MIT © dsh-mc-launcher contributors。商标与内容声明见 [LICENSE](LICENSE)。

Minecraft © Mojang Studios。本项目与 Mojang Studios / Microsoft 无关联。
