# ktx_claude_bridge

HTTP bridge + MCP server that lets [Claude Code](https://claude.ai/code) interact with a running FiveM server in real-time.

## Features

- **Execute Lua** on server or any connected client (bridge VM or scoped into any resource's VM)
- **NUI/CEF control** via Chrome DevTools Protocol — execute JS, query DOM, click elements in any resource's NUI frame
- **Full console capture** — `RegisterConsoleListener` captures ALL server output (1000 line buffer, persists across bridge restarts)
- **Read txAdmin logs** — direct file access to `fxserver.log` for complete boot-to-current logs
- **Inspect state** — players, resources, entities, Qbox player data, resource metadata, statebags
- **Database queries** — read-only SQL via oxmysql (SELECT/SHOW/DESCRIBE/EXPLAIN)
- **Restart resources** — including safe self-restart via helper resource
- **Take screenshots** — game screenshots via [screencapture](https://github.com/itschip/screencapture), NUI-only screenshots via CDP
- **Trigger events** (server + client) and run console commands (server + client)
- **NUI messaging** — send JSON messages to any resource's NUI JavaScript frame

## Repository Structure

```
ktx_claude_bridge/              <- repo root (category folder)
├── ktx_claude_bridge/          <- main FiveM resource
│   ├── fxmanifest.lua
│   ├── exec_bridge.lua         <- injectable shared_script for scoped exec
│   ├── server/                 <- HTTP handler, routes, console, relay
│   ├── client/                 <- code exec relay, console capture
│   └── mcp/                    <- Node.js MCP server (stdio transport)
│       └── src/
│           ├── index.ts        <- MCP server entrypoint
│           ├── config.ts       <- environment config
│           ├── http.ts         <- HTTP request wrapper for FiveM bridge
│           ├── tools.ts        <- Lua/HTTP-based MCP tools (24 tools)
│           ├── cdp.ts          <- Chrome DevTools Protocol WebSocket client
│           └── cdp-tools.ts    <- CDP-based NUI MCP tools (8 tools)
├── ktx_bridge_helper/          <- helper resource (DO NOT RESTART)
│   ├── fxmanifest.lua
│   └── server.lua              <- RegisterConsoleListener + restart export
├── CLAUDE.md
└── README.md
```

## Setup

### 1. FiveM Resources

Place or symlink both resources into your server's `resources/` folder:

```bash
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
pnpm install
pnpm run build
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

### 4. Scoped Execution (Optional)

To access a resource's internal globals, add this to the target resource's `fxmanifest.lua`:

```lua
shared_script '@ktx_claude_bridge/exec_bridge.lua'
```

Then run `refresh` and `ensure <resource>` to reload. This enables `exec_server_lua_scoped` and `exec_client_lua_scoped` for that resource.

## Configuration

Set convars in `server.cfg`:

```cfg
set ktx_bridge_enabled true          # disable to turn off the bridge
set ktx_bridge_token ""              # optional Bearer token for auth
set ktx_bridge_client_timeout 10000  # client exec timeout (ms)
set ktx_bridge_max_console 500       # max client console buffer lines
```

Environment variables for MCP server:

| Variable | Default | Description |
|----------|---------|-------------|
| `FIVEM_BRIDGE_URL` | `http://localhost:30120/ktx_claude_bridge` | FiveM bridge URL |
| `FIVEM_BRIDGE_TOKEN` | (empty) | Optional auth token |
| `FIVEM_BRIDGE_TIMEOUT` | `15000` | HTTP request timeout (ms) |
| `FIVEM_LOG_PATH` | (auto-detect) | Path to fxserver.log |
| `FIVEM_CDP_PORT` | `13172` | CEF DevTools Protocol port |

## Available Tools (32)

### Lua Execution
| Tool | Description |
|------|-------------|
| `exec_server_lua` | Execute Lua in bridge's server VM |
| `exec_client_lua` | Execute Lua in bridge's client VM on a player |
| `exec_server_lua_scoped` | Execute Lua inside another resource's server VM |
| `exec_client_lua_scoped` | Execute Lua inside another resource's client VM |

### NUI/CEF (Chrome DevTools Protocol)
| Tool | Description |
|------|-------------|
| `nui_list_frames` | List all loaded NUI resource frames |
| `nui_exec_js` | Execute JS in any resource's NUI frame |
| `nui_query_dom` | Query DOM elements by CSS selector |
| `nui_get_dom_tree` | Get serialized DOM tree |
| `nui_click_element` | Click a DOM element by selector |
| `nui_fill_input` | Fill input elements (React-compatible) |
| `nui_screenshot` | Screenshot NUI layer only (no game world) |
| `nui_simulate_click` | Click at pixel coordinates |

### Server & Player Info
| Tool | Description |
|------|-------------|
| `get_server_status` | Server health check (players, resources, uptime) |
| `get_server_info` | Extended info (convars, frameworks, OneSync) |
| `get_players` | All connected players with positions |
| `get_player_data` | Qbox player data (job, gang, money, charinfo) |
| `get_resources` | All resources with states |
| `get_resource_info` | Resource metadata (version, scripts, exports, deps) |
| `get_entities` | All server entities (requires OneSync) |

### Console & Logs
| Tool | Description |
|------|-------------|
| `get_server_console` | Live console output with resource-level attribution |
| `get_client_console` | Client console for a specific player |
| `read_server_log` | Full txAdmin fxserver.log (search/tail) |
| `watch_console` | Poll console for new output over a duration |

### Events, Commands & Resources
| Tool | Description |
|------|-------------|
| `trigger_server_event` | Trigger a server event with arguments |
| `trigger_client_event` | Trigger a client event on a specific player |
| `run_command` | Run a server console command |
| `run_client_command` | Run a client-side command |
| `restart_resource` | Restart a resource (self-restart via helper) |
| `db_query` | Read-only SQL query via oxmysql |
| `send_nui_message` | Send JSON to a resource's NUI JS frame |
| `get_nui_state` | Get NUI focus/cursor state |
| `take_screenshot` | Game screenshot via screencapture resource |

## Architecture

```
Claude Code ──stdio──> MCP Server (Node.js)
                          ├── HTTP fetch() ──> FiveM Server (port 30120)
                          │                    ├── ktx_bridge_helper (never restarts)
                          │                    │   ├── RegisterConsoleListener -> 1000 line ring buffer
                          │                    │   └── exports: getConsole, restartBridge
                          │                    └── ktx_claude_bridge (can self-restart)
                          │                        ├── server/ — HTTP handler, routes, relay
                          │                        └── client/ — code exec relay, console capture
                          │
                          └── WebSocket ──> CEF DevTools (port 13172)
                                            └── CitizenFX root UI
                                                ├── iframe: ox_inventory NUI
                                                ├── iframe: qbx_hud NUI
                                                └── ... (all resource NUI frames)
```

## Security

This is a **development tool** — it can execute arbitrary Lua and JavaScript. Do not use in production.

- HTTP endpoint is localhost-only by default (FiveM restriction)
- Set `ktx_bridge_token` for additional auth if you expose ports
- Scoped exec server-side events use local events only (NOT RegisterNetEvent) to prevent client spoofing
- CDP connection is to localhost only (port 13172)

## License

MIT
