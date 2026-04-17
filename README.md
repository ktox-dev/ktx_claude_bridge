# ktx_claude_bridge

HTTP bridge + MCP server that lets [Claude Code](https://claude.ai/code) interact with a running FiveM server in real-time. Drive Lua execution, inspect state, poke at NUI, and read console output — all from the model.

> **Development tool only.** This exposes arbitrary Lua and JavaScript execution against your server and connected clients. Do not run it on a production or public-facing FiveM server. See [Security](#security) below.

## Features

- **Execute Lua** on server or any connected client — in the bridge's VM or scoped into any resource's VM (full access to that resource's globals/locals/`lib`)
- **NUI/CEF control** via Chrome DevTools Protocol — execute JS, query DOM, click elements, fill inputs, inject persistent scripts, monitor network requests across any resource's NUI frame
- **Full console capture** — `RegisterConsoleListener` captures ALL server output into a 1000-line ring buffer that survives bridge restarts (held by the sibling `ktx_bridge_helper` resource)
- **Read txAdmin logs** — direct file access to `fxserver.log` for complete boot-to-current logs with tail/search
- **Inspect state** — players, resources, entities, Qbox player data (online + offline), resource metadata, registered commands
- **Resource file I/O** — read and write any file in any resource's directory (via `LoadResourceFile` / `SaveResourceFile`)
- **Database queries** — read-only SQL via oxmysql (SELECT/SHOW/DESCRIBE/EXPLAIN only)
- **Restart resources** — including safe self-restart delegated through the helper
- **Screenshots** — full game view via [screencapture](https://github.com/itschip/screencapture), or NUI-only via CDP
- **Events & commands** — trigger server/client events, run console commands (server + client)
- **Profiler** — capture server-side CPU profiles in Chrome DevTools trace format

## Repository Structure

```
ktx_claude_bridge/              <- repo root
├── ktx_claude_bridge/          <- main FiveM resource
│   ├── fxmanifest.lua
│   ├── exec_bridge.lua         <- injectable shared_script for scoped exec
│   ├── server/                 <- HTTP handler, routes, console, relay
│   ├── client/                 <- code exec relay, console capture
│   └── mcp/                    <- Node.js MCP server (stdio transport)
│       └── src/
│           ├── index.ts        <- MCP server entrypoint
│           ├── config.ts       <- environment config
│           ├── http.ts         <- HTTP wrapper for the FiveM bridge
│           ├── tools.ts        <- Lua/HTTP-based MCP tools (27)
│           ├── cdp.ts          <- Chrome DevTools Protocol WebSocket client
│           └── cdp-tools.ts    <- CDP-based NUI MCP tools (10)
├── ktx_bridge_helper/          <- helper resource (DO NOT RESTART)
│   ├── fxmanifest.lua
│   └── server.lua              <- RegisterConsoleListener + restart export
├── CLAUDE.md
└── README.md
```

## Requirements

- FiveM server (cerulean+, Lua 5.4)
- Node.js 22+ for the MCP server
- pnpm (the repo uses a pnpm lockfile)
- Optional: [`oxmysql`](https://github.com/overextended/oxmysql) (for `db_query`), [`qbx_core`](https://github.com/Qbox-project/qbx_core) (for `get_player_data`), [`screencapture`](https://github.com/itschip/screencapture) (for `take_screenshot`)

## Setup

### 1. FiveM Resources

Place or symlink both resources into your server's `resources/` folder.

Windows:
```cmd
mklink /J "resources\[ktx]\ktx_claude_bridge" "path\to\repo\ktx_claude_bridge"
mklink /J "resources\[ktx]\ktx_bridge_helper" "path\to\repo\ktx_bridge_helper"
```

Linux / macOS:
```bash
ln -s /path/to/repo/ktx_claude_bridge resources/[ktx]/ktx_claude_bridge
ln -s /path/to/repo/ktx_bridge_helper resources/[ktx]/ktx_bridge_helper
```

Add to `server.cfg`:

```cfg
# Required for ensure/stop/start/restart/refresh to work from the bridge
add_ace resource.ktx_claude_bridge command allow
add_ace resource.ktx_bridge_helper command allow

# Helper must start before the bridge
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
      "args": ["<absolute-path>/ktx_claude_bridge/ktx_claude_bridge/mcp/dist/index.js"],
      "env": {
        "FIVEM_BRIDGE_URL": "http://localhost:30120/ktx_claude_bridge",
        "FIVEM_LOG_PATH": "<absolute-path>/txData/default/logs/fxserver.log"
      }
    }
  }
}
```

`FIVEM_LOG_PATH` is optional — the MCP server auto-detects txData under the script directory.

### 4. Scoped Execution (Optional)

`exec_server_lua` / `exec_client_lua` run inside the bridge's own VM. To reach another resource's globals, locals, or `lib`, that resource must opt-in:

```lua
-- in the target resource's fxmanifest.lua
shared_script '@ktx_claude_bridge/exec_bridge.lua'
```

Then run `refresh` followed by `ensure <resource>` (or a restart). This enables `exec_server_lua_scoped` and `exec_client_lua_scoped` for that resource. The server-side handler uses local events only (not `RegisterNetEvent`), so clients cannot invoke it.

## Configuration

Convars in `server.cfg`:

```cfg
set ktx_bridge_enabled true          # toggle the bridge off at runtime
set ktx_bridge_token ""              # optional Bearer token for auth
set ktx_bridge_client_timeout 10000  # client exec timeout (ms)
set ktx_bridge_max_console 500       # client console buffer size
```

Environment variables for the MCP server:

| Variable | Default | Description |
|----------|---------|-------------|
| `FIVEM_BRIDGE_URL` | `http://localhost:30120/ktx_claude_bridge` | FiveM bridge URL |
| `FIVEM_BRIDGE_TOKEN` | (empty) | Optional auth token |
| `FIVEM_BRIDGE_TIMEOUT` | `15000` | HTTP request timeout (ms) |
| `FIVEM_LOG_PATH` | (auto-detect) | Path to `fxserver.log` |
| `FIVEM_CDP_PORT` | `13172` | CEF DevTools Protocol port |

## Available Tools (37)

### Lua Execution
| Tool | Description |
|------|-------------|
| `exec_server_lua` | Execute Lua in the bridge's server VM |
| `exec_client_lua` | Execute Lua in the bridge's client VM on a player |
| `exec_server_lua_scoped` | Execute Lua inside another resource's server VM |
| `exec_client_lua_scoped` | Execute Lua inside another resource's client VM |

### NUI / CEF (Chrome DevTools Protocol)
| Tool | Description |
|------|-------------|
| `nui_list_frames` | List all loaded NUI resource frames |
| `nui_exec_js` | Execute JS in any resource's NUI frame |
| `nui_query_dom` | Query DOM elements by CSS selector |
| `nui_get_dom_tree` | Get a serialized DOM tree |
| `nui_click_element` | Click a DOM element by selector |
| `nui_fill_input` | Fill input/textarea (React-compatible native setter) |
| `nui_screenshot` | Screenshot the NUI layer only (transparent) |
| `nui_simulate_click` | Click at absolute pixel coordinates |
| `nui_inject_script` | Inject JS that runs on every NUI frame load |
| `nui_network_monitor` | Start/flush/stop capture of NUI fetch/XHR traffic |

### Server & Player Info
| Tool | Description |
|------|-------------|
| `get_server_info` | Health check + hostname, OneSync, frameworks, resource counts, uptime |
| `get_players` | All connected players with positions, ping, identifiers |
| `get_player_data` | Qbox player data (job, gang, money, charinfo) — online or offline |
| `get_resources` | All resources with their current state |
| `get_resource_info` | Resource metadata (version, scripts, exports, dependencies) |
| `get_entities` | All server entities (vehicles, peds, objects) — requires OneSync |
| `get_registered_commands` | All registered commands across every resource |

### Resource Files
| Tool | Description |
|------|-------------|
| `read_resource_file` | Read any file from any resource via `LoadResourceFile` |
| `write_resource_file` | Write a file into a resource directory via `SaveResourceFile` |
| `list_resource_files` | List files declared in a resource's manifest |

### Console & Logs
| Tool | Description |
|------|-------------|
| `get_server_console` | Recent server console output with per-line `resource` attribution |
| `get_client_console` | Client-side console for a specific player |
| `read_server_log` | Full txAdmin `fxserver.log` with tail/search |
| `watch_console` | Poll the server console for new output over a duration |

### Events, Commands & Resources
| Tool | Description |
|------|-------------|
| `trigger_server_event` | Trigger a server event with arguments |
| `trigger_client_event` | Trigger a client event on a specific player |
| `run_command` | Run a server console command |
| `run_client_command` | Run a registered command on a player's client |
| `restart_resource` | Restart a resource (self-restart routed through the helper) |
| `db_query` | Read-only SQL query via oxmysql |
| `get_nui_state` | Get NUI focus/cursor state for a player |
| `take_screenshot` | Full game screenshot (world + NUI) via `screencapture` |
| `run_profiler` | Record a server-side CPU profile (Chrome trace JSON) |

## Architecture

```
Claude Code ──stdio──> MCP Server (Node.js)
                          ├── HTTP fetch() ──> FiveM Server (port 30120)
                          │                    ├── ktx_bridge_helper (never restarts)
                          │                    │   ├── RegisterConsoleListener → 1000-line ring buffer
                          │                    │   └── exports: getConsole, addConsole, restartBridge, ...
                          │                    └── ktx_claude_bridge (can self-restart via helper)
                          │                        ├── server/ — HTTP handler, routes, relay
                          │                        └── client/ — code exec relay, console capture
                          │
                          └── WebSocket ──> CEF DevTools (port 13172)
                                            └── CitizenFX root UI
                                                ├── iframe: ox_inventory NUI
                                                ├── iframe: qbx_hud NUI
                                                └── ... (all resource NUI frames)
```

Two channels:

- **HTTP → FiveM Lua** — Lua execution, events, console, DB, resource management, file I/O
- **WebSocket → CEF CDP** — NUI/JS execution, DOM inspection, NUI interaction across all resources

Client-targeting calls follow a relay pattern: HTTP → server stores a callback by requestId → `TriggerClientEvent` → client executes → `TriggerServerEvent` back → HTTP response resolves.

## Security

- HTTP endpoint is localhost-only by default (FiveM's `SetHttpHandler` binds to the server's HTTP listener)
- Set `ktx_bridge_token` for a Bearer token check if you expose the port
- Scoped server-side events use local events (no `RegisterNetEvent`), so clients cannot trigger scoped exec
- CDP connection is localhost only (port 13172)
- This tool lets the model run arbitrary Lua and JavaScript — do not enable on production

## License

MIT
