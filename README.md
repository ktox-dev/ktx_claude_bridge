# ktx_claude_bridge

HTTP bridge + MCP server that lets [Claude Code](https://claude.ai/code) interact with a running FiveM server in real-time.

## Features

- **Execute Lua** on server or any connected client
- **Full console capture** — `RegisterConsoleListener` captures ALL server output from every resource (1000 line buffer, persists across bridge restarts)
- **Read txAdmin logs** — direct file access to `fxserver.log` for complete boot-to-current logs
- **Inspect state** — players, resources, entities, Qbox player data, resource metadata
- **Database queries** — read-only SQL via oxmysql (SELECT/SHOW/DESCRIBE/EXPLAIN)
- **Restart resources** — including safe self-restart via helper resource
- **Take screenshots** via [screencapture](https://github.com/itschip/screencapture)
- **Trigger events** (server + client) and run console commands (server + client)
- **NUI interaction** — send messages to any resource's NUI, check focus state

## Repository Structure

```
ktx_claude_bridge/              <- repo root (category folder)
├── ktx_claude_bridge/          <- main FiveM resource
│   ├── fxmanifest.lua
│   ├── server/                 <- HTTP handler, routes, console, relay
│   ├── client/                 <- code exec relay, console capture
│   └── mcp/                   <- Node.js MCP server (stdio transport)
├── ktx_bridge_helper/          <- helper resource (DO NOT RESTART)
│   ├── fxmanifest.lua
│   └── server.lua              <- RegisterConsoleListener + restart export
├── CLAUDE.md
└── README.md
```

## Setup

### 1. FiveM Resources

Symlink or copy both resources into your server's `resources/` folder:

```bash
# Option A: symlink each resource individually
mklink /J "resources/[ktx]/ktx_claude_bridge" "path/to/repo/ktx_claude_bridge"
mklink /J "resources/[ktx]/ktx_bridge_helper" "path/to/repo/ktx_bridge_helper"
```

Add to `server.cfg`:

```cfg
# Required for command execution
add_ace resource.ktx_claude_bridge command allow
add_ace resource.ktx_bridge_helper command allow

# Start helper before bridge
ensure ktx_bridge_helper
ensure ktx_claude_bridge
```

### 2. MCP Server

```bash
cd ktx_claude_bridge/mcp
npm install
npm run build
```

### 3. Claude Code Configuration

Add to your Claude Code MCP settings:

```json
{
  "mcpServers": {
    "fivem": {
      "command": "node",
      "args": ["<path>/ktx_claude_bridge/ktx_claude_bridge/mcp/dist/index.js"],
      "env": {
        "FIVEM_BRIDGE_URL": "http://localhost:30120/ktx_claude_bridge",
        "FIVEM_LOG_PATH": "<path>/txData/default/logs/fxserver.log"
      }
    }
  }
}
```

## Configuration

Set convars in `server.cfg`:

```cfg
set ktx_bridge_enabled true          # disable to turn off the bridge
set ktx_bridge_token ""              # optional Bearer token for auth
set ktx_bridge_client_timeout 10000  # client exec timeout (ms)
set ktx_bridge_max_console 500       # max client console buffer lines
```

## Available Tools

| Tool | Description |
|------|-------------|
| **Status & Info** | |
| `get_server_status` | Server health check (players, resources, uptime) |
| `get_server_info` | Extended info (convars, frameworks, OneSync, max clients) |
| `get_players` | Detailed player list with positions and identifiers |
| `get_player_data` | Qbox player data (job, gang, money, charinfo) |
| `get_resources` | All resources with states |
| `get_resource_info` | Resource metadata (version, author, scripts, exports, deps) |
| `get_entities` | All server entities (vehicles, peds, objects) — requires OneSync |
| **Console & Logs** | |
| `get_server_console` | Live console output (all resources via RegisterConsoleListener) |
| `get_client_console` | Client-side console output for a specific player |
| `read_server_log` | Full txAdmin fxserver.log (complete from boot, search/tail) |
| `watch_console` | Poll console for new output over a duration |
| **Execution** | |
| `exec_server_lua` | Execute Lua on the server |
| `exec_client_lua` | Execute Lua on a player's client |
| `run_command` | Run a server console command |
| `run_client_command` | Run a registered command on a player's client |
| `db_query` | Read-only SQL query via oxmysql |
| **Events & NUI** | |
| `trigger_server_event` | Trigger a server event with arguments |
| `trigger_client_event` | Trigger a client event on a specific player |
| `send_nui_message` | Send NUI message to a resource on a player's client |
| `get_nui_state` | Get NUI focus/cursor state from a player's client |
| **Resources** | |
| `restart_resource` | Restart a resource (self-restart via helper) |
| `take_screenshot` | Screenshot via screencapture resource |

## Architecture

```
Claude Code --stdio--> MCP Server (Node.js)
                          | HTTP fetch()
                          v
             FiveM Server (port 30120)
             ├── ktx_bridge_helper (never restarts)
             │   ├── RegisterConsoleListener -> 1000 line ring buffer
             │   └── exports: getConsole, restartBridge
             └── ktx_claude_bridge (can self-restart)
                 ├── server/ — HTTP handler, routes, relay
                 └── client/ — code exec relay, console capture
```

## Security

This is a **development tool** — it can execute arbitrary Lua on your server and connected clients. Do not use in production. The HTTP endpoint is localhost-only by default (FiveM restriction). Set `ktx_bridge_token` for additional auth if you expose ports.

## License

MIT
