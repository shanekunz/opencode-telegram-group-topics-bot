# OpenCode Telegram Group Topics Bot

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

中文说明：[`README.zh-CN.md`](./README.zh-CN.md)

A Telegram bot for [OpenCode](https://opencode.ai) that turns one Telegram supergroup into a multi-session mobile workspace.

This project is a fork of the original single-chat bot: [grinev/opencode-telegram-bot](https://github.com/grinev/opencode-telegram-bot) by Ruslan Grinev.

- Use the upstream project if you want the simpler single-chat workflow.
- Use this fork if you want one **General** control topic plus dedicated forum topics for parallel OpenCode sessions.

No open ports, no exposed web UI. The bot talks only to your local OpenCode server and the Telegram Bot API.

You can run many session topics in parallel inside one group, and many groups in parallel across different projects.

Platforms: macOS, Windows, Linux

Languages: English (`en`), Deutsch (`de`), Espanol (`es`), Francais (`fr`), Russkiy (`ru`), Jian ti Zhong wen (`zh`)

Fork sync notes: [`FORK_SYNC.md`](./FORK_SYNC.md)

<p align="center">
  <img src="assets/screencast.gif" width="45%" alt="OpenCode Telegram Group Topics Bot screencast" />
</p>

## At a Glance

- One Telegram group usually maps to one repo / project workspace.
- The **General** topic is the control lane for `/projects`, `/sessions`, `/new`, and status checks.
- Each new OpenCode session gets its own forum topic.
- Each topic keeps its own session, model, agent, and pinned status state.
- Subagent child-session work is summarized back into the parent topic as live status cards.
- Multiple topics can run at the same time, and multiple groups can be active at the same time.
- DMs are for light control/status usage, not the main multi-session workflow.

## Quick Start

### 1. Prerequisites

- Install **Node.js 20+**
- Install **OpenCode** from [opencode.ai](https://opencode.ai) or [GitHub](https://github.com/sst/opencode)
- Create a Telegram bot with [@BotFather](https://t.me/BotFather)
- Get your Telegram numeric user ID from [@userinfobot](https://t.me/userinfobot)

### 2. Create and Prepare the Telegram Group

1. Create a new Telegram **supergroup** for one OpenCode project/repository.
2. Add your bot to that group.
3. Make the bot an admin with permission to **Manage Topics**.
4. Enable **Topics** in the group settings.
5. In [@BotFather](https://t.me/BotFather), run `/setprivacy` for the bot and choose **Disable**.
6. Keep the default **General** topic - that is the control lane.

### 3. Start OpenCode

Run OpenCode on the machine where the bot will live:

```bash
opencode serve
```

Default API URL: `http://localhost:4096`

### 4. Install the Bot

#### Option A: `npx`

```bash
npx opencode-telegram-group-topics-bot
```

#### Option B: Global install

```bash
npm install -g opencode-telegram-group-topics-bot
opencode-telegram-group-topics-bot config
opencode-telegram-group-topics-bot start
```

#### Option C: Run from source

```bash
git clone https://github.com/shanekunz/opencode-telegram-group-topics-bot.git
cd opencode-telegram-group-topics-bot
npm install
npm run build
node dist/cli.js config --mode sources
npm run dev
```

`dist/cli.js` is the compiled CLI entrypoint produced by `npm run build`.

### 5. Complete the Setup Wizard

The wizard asks for:

- interface language
- Telegram bot token
- allowed Telegram user ID
- OpenCode API URL
- optional OpenCode server username/password

### 6. First-Time Verification

1. Open a DM with your bot and run `/start`.
2. Confirm the bot replies.
3. Open your Telegram group and run `/start` in **General**.
4. Run `/status` and confirm the bot can reach OpenCode.
5. Run `/projects` in **General** and pick the repo for this group.
6. Run `/new` in **General** to create a session topic.
7. Open the new topic and send a prompt.

If that works, your group workspace is ready.

## Daily Workflow

1. Start OpenCode with `opencode serve`
2. Start the bot
3. Open the Telegram group and go to **General**
4. Use `/projects` to confirm the selected repo
5. Use `/new` to create a new session topic
6. Work inside the topic thread
7. Use `/sessions` in **General** to revisit older session lanes

## Parallel Workloads and Telegram Rate Limits

- This fork is designed for parallel work: many topic threads in one group, and many groups across projects.
- Telegram enforces message rate limits, especially when many topics are receiving updates at once.
- The bot handles those limits gracefully and slows or staggers Telegram updates when needed.
- Your OpenCode sessions continue running even if Telegram updates become less frequent.
- In heavy parallel usage, expect less real-time chatter per topic, but not lost OpenCode work.

## Commands

| Command           | Description                                             |
| ----------------- | ------------------------------------------------------- |
| `/status`         | Server health, current project, session, and model info |
| `/new`            | Create a new session topic                              |
| `/abort`          | Abort the current task                                  |
| `/sessions`       | Browse and switch between recent sessions               |
| `/projects`       | Switch between OpenCode projects                        |
| `/rename`         | Rename the current session                              |
| `/commands`       | Browse and run custom commands                          |
| `/task`           | Create a scheduled task for the current project         |
| `/tasklist`       | List and delete scheduled tasks for the current project |
| `/opencode_start` | Start the OpenCode server remotely                      |
| `/opencode_stop`  | Stop the OpenCode server remotely                       |
| `/help`           | Show available commands                                 |

Any normal text message in a session topic is treated as a prompt when no blocking interaction is active.

## How This Fork Differs From Upstream

| Topic          | Upstream                    | This fork                   |
| -------------- | --------------------------- | --------------------------- |
| Main UX        | One chat                    | One group with forum topics |
| Session layout | Switch sessions in one lane | One topic per session lane  |
| Best for       | Simplicity                  | Parallel mobile workflows   |
| Complexity     | Lower                       | Higher                      |

If you want the simpler path, use the upstream project.

## Configuration

### Config Location

- Source mode stores config in the repository root.
- Installed mode stores config in the platform app-data directory.
- `OPENCODE_TELEGRAM_HOME` overrides both and forces a custom config directory.

Installed-mode config paths:

- macOS: `~/Library/Application Support/opencode-telegram-group-topics-bot/.env`
- Windows: `%APPDATA%\opencode-telegram-group-topics-bot\.env`
- Linux: `~/.config/opencode-telegram-group-topics-bot/.env`

### Environment Variables

| Variable                           | Description                                                                          | Required | Default                  |
| ---------------------------------- | ------------------------------------------------------------------------------------ | :------: | ------------------------ |
| `TELEGRAM_BOT_TOKEN`               | Bot token from @BotFather                                                            |   Yes    | -                        |
| `TELEGRAM_ALLOWED_USER_ID`         | Your numeric Telegram user ID                                                        |   Yes    | -                        |
| `TELEGRAM_PROXY_URL`               | Proxy URL for Telegram API (SOCKS5/HTTP)                                             |    No    | -                        |
| `OPENCODE_API_URL`                 | OpenCode server URL                                                                  |    No    | `http://localhost:4096`  |
| `OPENCODE_SERVER_USERNAME`         | Server auth username                                                                 |    No    | `opencode`               |
| `OPENCODE_SERVER_PASSWORD`         | Server auth password                                                                 |    No    | -                        |
| `OPENCODE_MODEL_PROVIDER`          | Default model provider                                                               |   Yes    | `opencode`               |
| `OPENCODE_MODEL_ID`                | Default model ID                                                                     |   Yes    | `big-pickle`             |
| `BOT_LOCALE`                       | Bot UI language (`en`, `de`, `es`, `fr`, `ru`, `zh`)                                 |    No    | `en`                     |
| `SESSIONS_LIST_LIMIT`              | Sessions per page in `/sessions`                                                     |    No    | `10`                     |
| `PROJECTS_LIST_LIMIT`              | Projects per page in `/projects`                                                     |    No    | `10`                     |
| `COMMANDS_LIST_LIMIT`              | Commands per page in `/commands`                                                     |    No    | `10`                     |
| `SCHEDULED_TASK_POLL_INTERVAL_SEC` | Scheduled task poll interval in seconds                                              |    No    | `30`                     |
| `SERVICE_MESSAGES_INTERVAL_SEC`    | Service messages interval; keep `>=2` to avoid Telegram rate limits, `0` = immediate |    No    | `5`                      |
| `HIDE_THINKING_MESSAGES`           | Hide `Thinking...` service messages                                                  |    No    | `false`                  |
| `HIDE_TOOL_CALL_MESSAGES`          | Hide tool-call service messages                                                      |    No    | `false`                  |
| `MESSAGE_FORMAT_MODE`              | Assistant reply formatting mode: `markdown` or `raw`                                 |    No    | `markdown`               |
| `CODE_FILE_MAX_SIZE_KB`            | Max file size (KB) to send as a document                                             |    No    | `100`                    |
| `STT_API_URL`                      | Whisper-compatible API base URL                                                      |    No    | -                        |
| `STT_API_KEY`                      | API key for your STT provider                                                        |    No    | -                        |
| `STT_MODEL`                        | STT model name passed to `/audio/transcriptions`                                     |    No    | `whisper-large-v3-turbo` |
| `STT_LANGUAGE`                     | Optional language hint                                                               |    No    | -                        |
| `LOG_LEVEL`                        | Log level (`debug`, `info`, `warn`, `error`)                                         |    No    | `info`                   |

Keep your `.env` private. It contains your bot token.

### Optional: Voice and Audio Transcription

If `STT_API_URL` and `STT_API_KEY` are set, the bot can transcribe Telegram voice/audio messages before sending them to OpenCode.

Whisper-compatible examples:

- OpenAI: `https://api.openai.com/v1`
- Groq: `https://api.groq.com/openai/v1`
- Together: `https://api.together.xyz/v1`

### Model Picker Notes

- Favorites are shown before recent models
- The current model is marked with `✅`
- The default model from `OPENCODE_MODEL_PROVIDER` + `OPENCODE_MODEL_ID` is always included

To add favorites, open the OpenCode TUI and press `Cmd+F` / `Ctrl+F` on a model.

## Features

- Thread-scoped OpenCode sessions inside Telegram forum topics
- Scheduled tasks with a dedicated per-project scheduled topic in forum groups
- Pinned live status messages per topic
- Live assistant response streaming and streamed tool-call updates
- Model, agent, variant, and context controls from the keyboard
- Custom OpenCode command execution
- Interactive permission and question handling
- Voice/audio transcription support
- File attachments for images, PDFs, and text files
- Strict single-user access control

## Security

Only the Telegram user whose ID matches `TELEGRAM_ALLOWED_USER_ID` can use the bot.

Since the bot runs locally and connects to your local OpenCode server, there is no exposed public service beyond Telegram itself.

## Development

### Run from source

```bash
git clone https://github.com/shanekunz/opencode-telegram-group-topics-bot.git
cd opencode-telegram-group-topics-bot
npm install
npm run build
node dist/cli.js config --mode sources
npm run dev
```

### Scripts

| Script                          | Description             |
| ------------------------------- | ----------------------- |
| `npm run dev`                   | Build and start         |
| `npm run build`                 | Compile TypeScript      |
| `npm start`                     | Run compiled code       |
| `npm run release:notes:preview` | Preview release notes   |
| `npm run lint`                  | Run ESLint              |
| `npm run format`                | Run Prettier            |
| `npm test`                      | Run tests               |
| `npm run test:coverage`         | Run tests with coverage |

No watcher is used because the bot maintains persistent SSE and polling connections.

## Troubleshooting

**Bot does not respond**

- Confirm `TELEGRAM_ALLOWED_USER_ID` matches your real Telegram user ID
- Confirm the bot token is correct
- Make sure you disabled privacy mode in BotFather for group usage

**OpenCode server is unavailable**

- Make sure `opencode serve` is running
- Confirm `OPENCODE_API_URL` points to the correct address

**Cannot create new session topics**

- Confirm the group is a supergroup with Topics enabled
- Confirm the bot is an admin with **Manage Topics** permission
- Run `/new` from **General**, not inside an existing session topic

**No models appear in the picker**

- Add favorites in the OpenCode TUI
- Confirm `OPENCODE_MODEL_PROVIDER` and `OPENCODE_MODEL_ID` are valid for your setup

**Linux permission issues**

- Check the CLI binary is executable: `chmod +x $(which opencode-telegram-group-topics-bot)`
- Check the config directory is writable: `~/.config/opencode-telegram-group-topics-bot/`

## Contributing

Please follow [CONTRIBUTING.md](CONTRIBUTING.md).

## Community

Open issues in this repository for this fork. For upstream discussion, see [grinev/opencode-telegram-bot](https://github.com/grinev/opencode-telegram-bot).

## License

[MIT](LICENSE) © Ruslan Grinev
