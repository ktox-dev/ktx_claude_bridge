# CLAUDE.md

## Project Overview

ktx_claude_bridge is a FiveM development tool that lets Claude Code interact with a running FiveM server in real-time. Three parts:

1. **`ktx_claude_bridge/`** — FiveM Lua resource exposing HTTP endpoints via `SetHttpHandler` on `http://localhost:30120/ktx_claude_bridge/`
2. **`ktx_claude_bridge/mcp/`** — Node.js MCP server (stdio transport) that wraps those endpoints + CDP connection as tools
3. **`ktx_bridge_helper/`** — Sibling resource for persistent console capture and safe self-restart

## Architecture

```
Claude Code ──stdio──> MCP Server (Node.js, mcp/)
                           ├── HTTP fetch() ──> FiveM Server (port 30120)
                           │                    └─ ktx_claude_bridge (Lua resource)
                           │                        ├─ server/ — HTTP handler, routes, console, relay
                           │                        └─ client/ — code exec relay, console capture
                           │
                           └── WebSocket ──> CEF DevTools Protocol (port 13172)
                                             └─ CitizenFX root UI (nui://game/ui/root.html)
                                                └─ iframes for each resource's NUI page
```

**Two communication channels:**
- **HTTP → FiveM Lua** — for Lua execution, events, console, DB, resource management
- **WebSocket → CEF CDP** — for NUI/JS execution, DOM inspection, NUI interaction across all resources

**Client relay pattern:** HTTP → server stores callback by requestId → TriggerClientEvent → client executes → TriggerServerEvent → server resolves HTTP response.

**Scoped exec pattern:** HTTP → server TriggerEvent (local) → exec_bridge.lua (in target resource's VM) → executes code with full globals access → TriggerEvent result back → HTTP response.

## Dependencies

- **FiveM resource:** `ktx_bridge_helper` (sibling resource for safe self-restart)
- **MCP server:** `@modelcontextprotocol/sdk`, `zod`, `ws`
- **Optional:** `screencapture` resource for game screenshots (github.com/itschip/screencapture)

## Build

```bash
cd ktx_claude_bridge/mcp && pnpm install && pnpm run build
```

## Configuration

Convars (set in server.cfg):
- `set ktx_bridge_enabled true` — enable/disable the bridge
- `set ktx_bridge_token ""` — optional auth token (empty = no auth)
- `set ktx_bridge_client_timeout 10000` — client exec timeout in ms
- `set ktx_bridge_max_console 500` — max console ring buffer lines

Environment variables for MCP server:
- `FIVEM_BRIDGE_URL` — FiveM bridge URL (default: `http://localhost:30120/ktx_claude_bridge`)
- `FIVEM_BRIDGE_TOKEN` — Optional auth token
- `FIVEM_BRIDGE_TIMEOUT` — HTTP request timeout in ms (default: `15000`)
- `FIVEM_LOG_PATH` — Path to fxserver.log (auto-detected if empty)
- `FIVEM_CDP_PORT` — CEF DevTools Protocol port (default: `13172`)

MCP config for Claude Code settings:
```json
{
  "mcpServers": {
    "fivem": {
      "command": "node",
      "args": ["<path>/ktx_claude_bridge/ktx_claude_bridge/mcp/dist/index.js"],
      "env": { "FIVEM_BRIDGE_URL": "http://localhost:30120/ktx_claude_bridge" }
    }
  }
}
```

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | /status | Server health check |
| GET | /server/info | Extended server info (convars, frameworks, OneSync) |
| GET | /players | Detailed player list |
| GET | /player/data | Qbox player data (job, gang, money, charinfo) |
| GET | /resources | All resources with states |
| GET | /resource/info | Resource metadata (version, author, scripts, exports, deps) |
| GET | /entities | All entities (vehicles, peds, objects) — requires OneSync |
| GET | /console/server | Server console (all resources via RegisterConsoleListener) |
| GET | /console/client | Client console output |
| POST | /exec/server | Execute Lua server-side (bridge's VM) |
| POST | /exec/client | Execute Lua client-side (bridge's VM) |
| POST | /exec/server/scoped | Execute Lua in another resource's server VM |
| POST | /exec/client/scoped | Execute Lua in another resource's client VM |
| POST | /event/server | Trigger server event |
| POST | /event/client | Trigger client event |
| POST | /command | Server console command |
| POST | /command/client | Client-side command |
| POST | /db/query | Read-only SQL query (SELECT/SHOW/DESCRIBE/EXPLAIN) |
| POST | /nui/state | Get NUI focus/cursor state from player's client |
| POST | /resource/restart | Restart resource (cannot self-restart) |
| POST | /screenshot | Take screenshot |

## MCP Tools (32 total)

### Lua Execution
| Tool | Description |
|------|-------------|
| `exec_server_lua` | Execute Lua in bridge's server VM. Call exports via COLON syntax: `exports.resource:export(args)` |
| `exec_client_lua` | Execute Lua in bridge's client VM on a player |
| `exec_server_lua_scoped` | Execute Lua inside another resource's server VM (requires exec_bridge.lua) |
| `exec_client_lua_scoped` | Execute Lua inside another resource's client VM (requires exec_bridge.lua) |

### NUI/CEF Tools (via Chrome DevTools Protocol, port 13172)
| Tool | Description |
|------|-------------|
| `nui_list_frames` | List all loaded NUI resource frames (28+ typically) |
| `nui_exec_js` | Execute JS in any resource's NUI frame by name |
| `nui_query_dom` | Query DOM elements by CSS selector in any resource's NUI |
| `nui_get_dom_tree` | Get serialized DOM tree of any resource's NUI page |
| `nui_click_element` | Click a DOM element by selector (synthetic or CDP mouse) |
| `nui_fill_input` | Fill input elements (React-compatible native setter) |
| `nui_screenshot` | CDP screenshot of NUI layer only (no game world) |
| `nui_simulate_click` | Click at pixel coordinates in NUI layer |

### Server & Player Info
| Tool | Description |
|------|-------------|
| `get_server_status` | Server health check (players, resources, uptime) |
| `get_server_info` | Extended info (hostname, OneSync, frameworks, resource counts) |
| `get_players` | All connected players with positions and identifiers |
| `get_player_data` | Qbox player data. Export is `GetPlayer`, NOT `GetPlayerData` |
| `get_resources` | All resources with states |
| `get_resource_info` | Resource metadata (version, author, scripts, exports, deps) |
| `get_entities` | All server entities (requires OneSync) |

### Console & Logs
| Tool | Description |
|------|-------------|
| `get_server_console` | Live console output. Each line has `resource` field for filtering. Noisy with hitch warnings. |
| `get_client_console` | Client console for a specific player |
| `read_server_log` | Full txAdmin fxserver.log (search/tail) |
| `watch_console` | Poll console for new output over a duration |

### Events, Commands & Resources
| Tool | Description |
|------|-------------|
| `trigger_server_event` | Trigger server event with arguments |
| `trigger_client_event` | Trigger client event on a specific player |
| `run_command` | Server console command |
| `run_client_command` | Client-side command |
| `restart_resource` | Restart resource. Run `refresh` first if fxmanifest was modified |
| `db_query` | Read-only SQL via oxmysql |
| `send_nui_message` | Send JSON to a resource's NUI JS frame (NOT Lua callbacks) |
| `get_nui_state` | Get NUI focus/cursor state |
| `take_screenshot` | Game screenshot via screencapture resource (returns MCP image) |

## Scoped Execution

`exec_server_lua` / `exec_client_lua` run in the bridge's own Lua VM. You can call exports but CANNOT access other resources' globals/locals.

For full access to a resource's internals (globals, `lib`, state), use scoped tools:

1. Add to the target resource's `fxmanifest.lua`:
   ```lua
   shared_script '@ktx_claude_bridge/exec_bridge.lua'
   ```
2. Run `refresh` then `ensure <resource>` to reload
3. Use `exec_server_lua_scoped` / `exec_client_lua_scoped` with the resource name

This injects a tiny event handler into the target's VM that can execute arbitrary code with full access to that resource's globals, `lib`, etc. Server-side uses local events only (NOT RegisterNetEvent) to prevent client spoofing.

## Important Notes for AI Agents

- **Export syntax:** Always use COLON syntax: `exports.qbx_core:GetPlayer(1)`, NOT dot syntax
- **ox_lib's `lib` global** is NOT available in the bridge's VM — use scoped exec or call exports directly
- **Console noise:** `get_server_console` output contains hitch warnings from `citizen-server-impl` — filter by `resource` field
- **Qbox exports:** The correct export is `exports.qbx_core:GetPlayer(src)`, NOT `GetPlayerData`
- **fxmanifest changes:** Run `run_command({command: "refresh"})` BEFORE `restart_resource`
- **Statebags:** Use `Player(id).state.key` or `GetStateBagValue("player:"..id, "key")` — keys are NOT enumerable
- **Screenshots:** `take_screenshot` = game + NUI (MCP image). `nui_screenshot` = NUI layer only via CDP
- **NUI frames:** FiveM uses `nui://` and `https://cfx-nui-resourceName/` URL patterns for NUI iframes

## Conventions

- Lua 5.4, `<const>` qualifier where appropriate
- Standalone — no ox_lib dependency in the bridge itself
- Server console uses `RegisterConsoleListener` — captures ALL output from every resource and engine
- Console persists in `ktx_bridge_helper` (1000 line ring buffer, survives bridge restarts)
- Self-restart delegated to `ktx_bridge_helper` (avoids SIGSEGV from destroying own Lua VM)
- Client console wraps `print` — captures client-side output in ring buffer
- FiveM exports pass hidden first arg with dot syntax — always use colon syntax or wrap in closure
- Dev-only tool — prints warning on startup

## Setup (server.cfg)

```cfg
# Required for command execution (ensure/stop/start/restart/refresh)
add_ace resource.ktx_claude_bridge command allow
add_ace resource.ktx_bridge_helper command allow

# Start the helper before the bridge
ensure ktx_bridge_helper
ensure ktx_claude_bridge
```
