# OpenCode Telegram Group Topics Bot

[English README](./README.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

一个面向 [OpenCode](https://opencode.ai) 的 Telegram 机器人，可以把一个 Telegram 超级群组变成多会话的移动工作区。

本项目是原始单聊天版本 [grinev/opencode-telegram-bot](https://github.com/grinev/opencode-telegram-bot) 的 fork。

- 如果你想要更简单的单聊天工作流，请使用上游项目。
- 如果你想要一个 **General** 控制话题，再配合多个 forum topic 并行运行 OpenCode 会话，请使用这个 fork。

无需开放公网端口，也不需要暴露 Web UI。机器人只会连接你本地的 OpenCode 服务和 Telegram Bot API。

你可以在一个群里并行跑多个 session topic，也可以在多个群里分别对应不同项目并行使用。

支持平台：macOS、Windows、Linux

机器人界面语言：English (`en`)、Deutsch (`de`)、Espanol (`es`)、Francais (`fr`)、Russkiy (`ru`)、简体中文 (`zh`)

Fork 同步说明：[`FORK_SYNC.md`](./FORK_SYNC.md)

> 说明：英文版 [`README.md`](./README.md) 仍是当前权威文档。如中英文内容有差异，请以英文版为准。

<p align="center">
  <img src="assets/screencast.gif" width="45%" alt="OpenCode Telegram Group Topics Bot screencast" />
</p>

## 快速了解

- 一个 Telegram 群通常对应一个仓库 / 项目工作区。
- **General** 话题是控制通道，用于 `/projects`、`/sessions`、`/new` 和状态检查。
- 每个新建的 OpenCode 会话都会对应一个独立的 forum topic。
- 每个 topic 都维护自己的 session、model、agent 和 pinned status 状态。
- 多个 topic 可以同时运行，多个群组也可以同时对应不同项目。
- 私聊更适合轻量控制和状态查看，不是主要的多会话工作流入口。

## 这个 fork 和上游有什么区别

上游项目主要面向单聊天工作流，而这个 fork 主要面向 Telegram forum topics 场景。核心差异是：这里把 **General** 作为控制通道，把每个独立话题作为一个 OpenCode 会话通道，更适合移动端并行处理多个任务。

如果你只想在一个聊天窗口里切换会话，上游会更简单；如果你想在一个群里同时管理多个会话线程，这个 fork 更合适。

## Quick Start

### 1. 准备条件

- 安装 **Node.js 20+**
- 从 [opencode.ai](https://opencode.ai) 或 [GitHub](https://github.com/sst/opencode) 安装 **OpenCode**
- 通过 [@BotFather](https://t.me/BotFather) 创建一个 Telegram bot
- 通过 [@userinfobot](https://t.me/userinfobot) 获取你的 Telegram 数字用户 ID

### 2. 创建并准备 Telegram 群组

1. 为一个 OpenCode 项目 / 仓库创建一个新的 Telegram **supergroup**。
2. 把 bot 拉进这个群。
3. 给 bot 管理员权限，并允许 **Manage Topics**。
4. 在群设置中启用 **Topics**。
5. 在 [@BotFather](https://t.me/BotFather) 中执行 `/setprivacy`，并选择 **Disable**。
6. 保留默认的 **General** 话题，它就是控制通道。

### 3. 启动 OpenCode

在机器人所在的那台机器上运行 OpenCode：

```bash
opencode serve
```

默认 API 地址：`http://localhost:4096`

### 4. 安装机器人

#### 方式 A：`npx`

```bash
npx opencode-telegram-group-topics-bot
```

#### 方式 B：全局安装

```bash
npm install -g opencode-telegram-group-topics-bot
opencode-telegram-group-topics-bot config
opencode-telegram-group-topics-bot start
```

#### 方式 C：从源码运行

```bash
git clone https://github.com/shanekunz/opencode-telegram-group-topics-bot.git
cd opencode-telegram-group-topics-bot
npm install
npm run build
node dist/cli.js config --mode sources
npm run dev
```

`dist/cli.js` 是由 `npm run build` 生成的 CLI 入口。

### 5. 完成配置向导

向导会询问：

- 界面语言
- Telegram bot token
- 允许访问的 Telegram user ID
- OpenCode API URL
- 可选的 OpenCode server 用户名 / 密码

### 6. 首次验证

1. 在私聊里打开你的 bot，并执行 `/start`。
2. 确认 bot 有回复。
3. 打开你的 Telegram 群，在 **General** 中执行 `/start`。
4. 执行 `/status`，确认 bot 能连接 OpenCode。
5. 在 **General** 中执行 `/projects`，为当前群选择项目。
6. 在 **General** 中执行 `/new`，创建新的 session topic。
7. 打开新 topic，发送一个 prompt。

如果这些都正常，说明你的群组工作区已经可以使用。

## 日常使用流程

1. 用 `opencode serve` 启动 OpenCode
2. 启动 bot
3. 打开 Telegram 群并进入 **General**
4. 用 `/projects` 确认当前群对应的项目
5. 用 `/new` 创建新的 session topic
6. 在对应 topic 里工作
7. 需要回到历史会话时，在 **General** 使用 `/sessions`

## 并行工作与 Telegram 限流

- 这个 fork 就是为并行工作设计的：一个群里多个 topic，同时多个群对应多个项目。
- Telegram 在高频更新时会有消息速率限制，尤其是多个 topic 同时刷新的时候。
- 机器人会尽量平滑处理这些限制，必要时放慢或错开更新。
- 即使 Telegram 更新变慢，OpenCode 里的任务仍会继续执行。
- 在高并发场景下，你看到的 topic 内实时输出可能会变少，但不会丢失 OpenCode 的实际工作结果。

## 常用命令

| Command           | 说明                                       |
| ----------------- | ------------------------------------------ |
| `/status`         | 查看服务健康状态、当前项目、会话和模型信息 |
| `/new`            | 创建新的 session topic                     |
| `/abort`          | 中止当前任务                               |
| `/sessions`       | 浏览并切换最近会话                         |
| `/projects`       | 切换 OpenCode 项目                         |
| `/rename`         | 重命名当前会话                             |
| `/commands`       | 浏览并执行自定义命令                       |
| `/task`           | 为当前项目创建定时任务                     |
| `/tasklist`       | 查看和删除当前项目的定时任务               |
| `/opencode_start` | 远程启动 OpenCode 服务                     |
| `/opencode_stop`  | 远程停止 OpenCode 服务                     |
| `/help`           | 显示可用命令                               |

当没有阻塞性的交互流程时，session topic 中的普通文本消息会被当作 prompt 发送给 OpenCode。

## 配置

### 配置文件位置

- source mode 会把配置存放在仓库根目录。
- installed mode 会把配置存放在系统应用数据目录。
- `OPENCODE_TELEGRAM_HOME` 可以覆盖前两者，强制指定自定义配置目录。

installed mode 下的配置路径：

- macOS：`~/Library/Application Support/opencode-telegram-group-topics-bot/.env`
- Windows：`%APPDATA%\opencode-telegram-group-topics-bot\.env`
- Linux：`~/.config/opencode-telegram-group-topics-bot/.env`

### 常用环境变量

| 环境变量                   | 说明                                                 | 必须 | 默认值                 |
| -------------------------- | ---------------------------------------------------- | :------: | ----------------------- |
| `TELEGRAM_BOT_TOKEN`       | 来自 @BotFather 的 bot token                         |   Yes    | -                       |
| `TELEGRAM_ALLOWED_USER_ID` | 你的 Telegram 数字用户 ID                            |   Yes    | -                       |
| `OPENCODE_API_URL`         | OpenCode 服务地址                                    |    No    | `http://localhost:4096` |
| `OPENCODE_SERVER_USERNAME` | 服务认证用户名                                       |    No    | `opencode`              |
| `OPENCODE_SERVER_PASSWORD` | 服务认证密码                                         |    No    | -                       |
| `OPENCODE_MODEL_PROVIDER`  | 默认模型提供方                                       |   Yes    | `opencode`              |
| `OPENCODE_MODEL_ID`        | 默认模型 ID                                          |   Yes    | `big-pickle`            |
| `BOT_LOCALE`               | 机器人界面语言（`en`、`de`、`es`、`fr`、`ru`、`zh`） |    No    | `en`                    |
| `LOG_LEVEL`                | 日志级别（`debug`、`info`、`warn`、`error`）         |    No    | `info`                  |

请务必妥善保管 `.env`，其中包含你的 bot token。

如果你需要更完整的环境变量说明，请参考英文版 [`README.md`](./README.md) 的 Configuration 章节。

## Troubleshooting

**Bot 没有响应**

- 确认 `TELEGRAM_ALLOWED_USER_ID` 是你真实的 Telegram 用户 ID
- 确认 bot token 正确
- 确认你已经在 BotFather 中关闭了 privacy mode，便于群组内使用

**OpenCode 服务不可用**

- 确认 `opencode serve` 已经运行
- 确认 `OPENCODE_API_URL` 指向正确地址

**无法创建新的 session topic**

- 确认当前群是启用了 Topics 的 supergroup
- 确认 bot 具有管理员权限，且允许 **Manage Topics**
- 确认你是在 **General** 中执行 `/new`，而不是在已有 session topic 中执行

**模型选择器里没有模型**

- 在 OpenCode TUI 中先添加 favorites
- 确认 `OPENCODE_MODEL_PROVIDER` 和 `OPENCODE_MODEL_ID` 对当前环境有效

**Linux 权限问题**

- 检查 CLI 是否可执行：`chmod +x $(which opencode-telegram-group-topics-bot)`
- 检查配置目录是否可写：`~/.config/opencode-telegram-group-topics-bot/`

## 安全说明

只有 `TELEGRAM_ALLOWED_USER_ID` 对应的 Telegram 用户可以使用这个 bot。

由于 bot 运行在本地，并连接本地 OpenCode 服务，所以除 Telegram 本身外，不需要额外暴露公网服务。

## 更多文档

- 英文主文档：[`README.md`](./README.md)
- Fork 同步说明：[`FORK_SYNC.md`](./FORK_SYNC.md)
- 产品范围与状态：[`PRODUCT.md`](./PRODUCT.md)
- 贡献说明：[`CONTRIBUTING.md`](./CONTRIBUTING.md)

## License

[MIT](LICENSE) © Ruslan Grinev
