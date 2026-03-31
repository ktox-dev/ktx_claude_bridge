# CLAUDE.md

## Project Overview

ktx_claude_bridge is a FiveM development tool that lets Claude Code interact with a running FiveM server in real-time. Two parts:

1. **`resource/`** — FiveM Lua resource exposing HTTP endpoints via `SetHttpHandler` on `http://localhost:30120/ktx_claude_bridge/`
2. **`mcp/`** — Node.js MCP server (stdio transport) that wraps those endpoints as tools

## Architecture

```
Claude Code ──stdio──> MCP Server (Node.js, mcp/)
                           │ HTTP fetch()
                           v
              FiveM Server (port 30120)
              └─ ktx_claude_bridge (resource/)
                  ├─ server/ — HTTP handler, routes, console capture, relay
                  └─ client/ — code exec relay, console capture
```

**Client relay pattern:** HTTP → server stores callback by requestId → TriggerClientEvent → client executes → TriggerServerEvent → server resolves HTTP response.

## Dependencies

- **FiveM resource:** `ktx_bridge_helper` (sibling resource for safe self-restart)
- **MCP server:** `@modelcontextprotocol/sdk`, `zod`
- **Optional:** `screencapture` resource for screenshots (github.com/itschip/screencapture)

## Build

```bash
cd mcp && npm install && npm run build
```

## Configuration

Convars (set in server.cfg):
- `set ktx_bridge_enabled true` — enable/disable the bridge
- `set ktx_bridge_token ""` — optional auth token (empty = no auth)
- `set ktx_bridge_client_timeout 10000` — client exec timeout in ms
- `set ktx_bridge_max_console 500` — max console ring buffer lines

MCP config for Claude Code settings:
```json
{
  "mcpServers": {
    "fivem": {
      "command": "node",
      "args": ["<path>/ktx_claude_bridge/mcp/dist/index.js"],
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
| POST | /exec/server | Execute Lua server-side |
| POST | /exec/client | Execute Lua client-side |
| POST | /event/server | Trigger server event |
| POST | /event/client | Trigger client event |
| POST | /command | Server console command |
| POST | /command/client | Client-side command |
| POST | /db/query | Read-only SQL query (SELECT/SHOW/DESCRIBE/EXPLAIN) |
| POST | /nui/state | Get NUI focus/cursor state from player's client |
| POST | /resource/restart | Restart resource (cannot self-restart) |
| POST | /screenshot | Take screenshot |

## Conventions

- Lua 5.4, `<const>` qualifier where appropriate
- No ox_lib — keep standalone
- Server console uses `RegisterConsoleListener` — captures ALL output from every resource and engine, persists in `_G.__ktx_server_console` (1000 line ring buffer, survives bridge restarts)
- Self-restart delegated to `ktx_bridge_helper` (avoids SIGSEGV from destroying own Lua VM)
- Client console wraps `print` — captures client-side output in ring buffer
- Dev-only tool — prints warning on startup

## Setup (server.cfg)

```cfg
# Required for command execution (ensure/stop/start/restart/refresh)
add_ace resource.ktx_claude_bridge command allow

# Start the helper before the bridge
ensure ktx_bridge_helper
ensure ktx_claude_bridge
```
