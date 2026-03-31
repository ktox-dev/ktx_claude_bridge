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

- **FiveM resource:** None (standalone, no ox_lib needed)
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
| GET | /players | Detailed player list |
| GET | /resources | All resources with states |
| GET | /console/server | Server console output |
| GET | /console/client | Client console output |
| POST | /exec/server | Execute Lua server-side |
| POST | /exec/client | Execute Lua client-side |
| POST | /event/server | Trigger server event |
| POST | /event/client | Trigger client event |
| POST | /command | Console command |
| POST | /resource/restart | Restart resource |
| POST | /screenshot | Take screenshot |

## Conventions

- Lua 5.4, `<const>` qualifier where appropriate
- No ox_lib — keep standalone
- Console capture wraps `print` — all output captured in ring buffer
- Dev-only tool — prints warning on startup
