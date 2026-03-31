# ktx_claude_bridge

HTTP bridge + MCP server that lets [Claude Code](https://claude.ai/code) interact with a running FiveM server in real-time.

## Features

- **Execute Lua** on server or any connected client
- **Read console output** (server + per-player client)
- **Inspect state** — players, resources, positions, vehicles
- **Restart resources** and watch console for errors
- **Take screenshots** via [screencapture](https://github.com/itschip/screencapture)
- **Trigger events** (server + client) and run console commands
- **Send NUI messages** to any resource

## Setup

### 1. FiveM Resource

Copy/symlink the `resource/` folder as `ktx_claude_bridge` in your resources, or ensure from the repo path:

```cfg
# server.cfg
ensure ktx_claude_bridge
```

### 2. MCP Server

```bash
cd mcp
npm install
npm run build
```

### 3. Claude Code Configuration

Add to your Claude Code MCP settings (`.claude/settings.json` or project settings):

```json
{
  "mcpServers": {
    "fivem": {
      "command": "node",
      "args": ["C:/path/to/ktx_claude_bridge/mcp/dist/index.js"],
      "env": {
        "FIVEM_BRIDGE_URL": "http://localhost:30120/ktx_claude_bridge"
      }
    }
  }
}
```

## Configuration

Set convars in `server.cfg`:

```cfg
set ktx_bridge_enabled true      # disable to turn off the bridge
set ktx_bridge_token ""          # optional Bearer token for auth
set ktx_bridge_client_timeout 10000  # client exec timeout (ms)
set ktx_bridge_max_console 500   # max console buffer lines
```

## Available Tools

| Tool | Description |
|------|-------------|
| `get_server_status` | Server health check (players, resources, uptime) |
| `get_players` | Detailed player list with positions |
| `get_resources` | All resources with states |
| `get_server_console` | Recent server console output |
| `get_client_console` | Recent client console output |
| `exec_server_lua` | Execute Lua on the server |
| `exec_client_lua` | Execute Lua on a player's client |
| `trigger_server_event` | Trigger a server event |
| `trigger_client_event` | Trigger a client event |
| `run_command` | Run a server console command |
| `restart_resource` | Restart a resource (ensure) |
| `take_screenshot` | Screenshot via screencapture |
| `send_nui_message` | Send NUI message to a resource |
| `watch_console` | Poll console for new output |

## Example Workflow

A typical development session with Claude Code:

```
1. get_server_status              → verify server is running
2. exec_server_lua "return 1+1"   → verify bridge works
3. (edit garage code in editor)
4. restart_resource ktx_garages   → apply changes
5. watch_console                  → check for startup errors
6. get_players                    → find your player ID
7. exec_client_lua "return GetEntityCoords(PlayerPedId())"  → check position
8. take_screenshot                → see what the player sees
9. get_server_console             → review recent output
```

## Security

This is a **development tool** — it can execute arbitrary Lua on your server and connected clients. Do not use in production. The HTTP endpoint is localhost-only by default (FiveM restriction). Set `ktx_bridge_token` for additional auth if you expose ports.

## License

MIT
