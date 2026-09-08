# ktx_claude_bridge

An HTTP bridge and an MCP server that connect [Claude Code](https://claude.ai/code)
to a FiveM server while it runs. Claude can execute Lua on the server or on a
connected client, read the console and both log files, query the database, drive
any resource's NUI through the Chrome DevTools Protocol, and write files back
into a resource.

Built and used by [KTOX](https://store.ktox.dev) for the KTX resources.

> **Development tool only.** This runs arbitrary Lua and JavaScript against your
> server and against the machine of every player connected to it. Do not put it
> on a production or public server. See [Security](#security).

## Purpose

Debugging a FiveM resource means alt-tabbing. Change a line, run `refresh` and
`ensure`, switch into the game, type the command, watch, switch back, read the
console, guess. A model sees none of it, so you become its eyes and describe a
menu instead of showing it.

With the bridge Claude runs the command on your client, takes the screenshot,
reads the client log and looks at the row in the database. Then it edits the
file.

Two of the tools are hard to replace with anything else. `exec_server_lua_scoped`
runs code inside another resource's Lua VM, so you can read its real locals and
its `lib` instead of whatever its exports are willing to hand out. And a FiveM
NUI is a Chrome frame that nobody ever attaches a debugger to. The `nui_*` tools
attach one, then query the DOM, click a button or record the network traffic of
any resource's interface.

## A session

A garage menu opens, but its Store button does nothing.

```
get_server_info                          the bridge answers, qbx_core is up
run_client_command "garages"             the menu opens on your screen
nui_list_frames                          ktx_garages has a frame, so the UI loaded
nui_query_dom ".btn-store"               the button is there, carrying class "disabled"
exec_server_lua_scoped ktx_garages
  "return Config.Storage"                nil, because the key is spelled Config.storage
read_client_log errorsOnly=true          one SCRIPT ERROR on that line
```

Six calls and no alt-tab. Claude writes the corrected key with
`write_resource_file`, runs `refresh` and `restart_resource`, and
`watch_console` says whether the restart came up clean.

## Requirements

- FiveM server, `fx_version 'cerulean'`, Lua 5.4
- Node.js 22 or newer for the MCP server
- pnpm, the repo carries a pnpm lockfile
- Optional: [`oxmysql`](https://github.com/overextended/oxmysql) for `db_query`,
  [`qbx_core`](https://github.com/Qbox-project/qbx_core) for `get_player_data`,
  [`screencapture`](https://github.com/itschip/screencapture) for `take_screenshot`

Everything else works without a framework.

## Setup

### 1. FiveM resources

Place or link both resources into your server's `resources/` folder.

Windows:
```cmd
mklink /J "resources\[ktx]\ktx_claude_bridge" "path\to\repo\ktx_claude_bridge"
mklink /J "resources\[ktx]\ktx_bridge_helper" "path\to\repo\ktx_bridge_helper"
```

Linux and macOS:
```bash
ln -s /path/to/repo/ktx_claude_bridge resources/[ktx]/ktx_claude_bridge
ln -s /path/to/repo/ktx_bridge_helper resources/[ktx]/ktx_bridge_helper
```

Add to `server.cfg`:

```cfg
# Needed before ensure, stop, start, restart and refresh work from the bridge
add_ace resource.ktx_claude_bridge command allow
add_ace resource.ktx_bridge_helper command allow

# The helper starts first. It holds the console buffer and restarts the bridge.
ensure ktx_bridge_helper
ensure ktx_claude_bridge
```

### 2. MCP server

```bash
cd ktx_claude_bridge/mcp
pnpm install
pnpm run build
```

### 3. Claude Code

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

`FIVEM_LOG_PATH` is optional. Without it the MCP server walks up from its own
directory, at most fifteen levels, looking for a `txData` folder and reads
`<profile>/logs/fxserver.log` from it. A server started without txAdmin writes
no such file, and `read_server_log` then says so.

Check it with `get_server_info`. That call is the health check.

### 4. Scoped execution, optional

`exec_server_lua` and `exec_client_lua` run inside the bridge's own VM. To reach
another resource's globals, locals or `lib`, that resource has to opt in:

```lua
-- in the target resource's fxmanifest.lua
shared_script '@ktx_claude_bridge/exec_bridge.lua'
```

Then run `refresh`, followed by `ensure <resource>`. That enables
`exec_server_lua_scoped` and `exec_client_lua_scoped` for it. The server side of
this handler listens on a local event, not a net event, so a client cannot reach
it.

Take the line back out before the resource goes anywhere near a live server.

## Configuration

Convars in `server.cfg`:

```cfg
set ktx_bridge_enabled true              # false disables every route
set ktx_bridge_token ""                  # Bearer token, see Security
set ktx_bridge_client_timeout 300000     # client exec gives up after this (ms)
set ktx_bridge_screenshot_timeout 60000  # screenshot gives up after this (ms)
set ktx_bridge_max_console 500           # client console ring buffer, lines
```

All five are read once when the resource starts. Changing one at runtime needs a
`restart ktx_claude_bridge` to take effect.

Environment variables for the MCP server:

| Variable | Default | Meaning |
|---|---|---|
| `FIVEM_BRIDGE_URL` | `http://localhost:30120/ktx_claude_bridge` | Where the bridge answers |
| `FIVEM_BRIDGE_TOKEN` | empty | Must match `ktx_bridge_token` |
| `FIVEM_BRIDGE_TIMEOUT` | `15000` | One HTTP round trip, ms |
| `FIVEM_BRIDGE_JOB_TIMEOUT` | `330000` | How long a running job is polled, ms |
| `FIVEM_BRIDGE_ATTEMPTS` | `4` | Retries after a dropped connection |
| `FIVEM_BRIDGE_CHUNK_THRESHOLD` | `1200` | Payloads above this go up in pieces |
| `FIVEM_BRIDGE_TRANSPORT` | `get` | `get` or `post`, see Transport |
| `FIVEM_LOG_PATH` | auto | `fxserver.log` |
| `FIVEM_CLIENT_LOG_PATH` | auto | The client's log file, or the folder holding them |
| `FIVEM_CDP_PORT` | `13172` | CEF DevTools port |
| `FIVEM_SERVERS` | unset | Several servers as JSON. Replaces the seven above |
| `FIVEM_SERVER_DEFAULT` | first entry | Which one is active at startup |

`FIVEM_BRIDGE_JOB_TIMEOUT` should stay above `ktx_bridge_client_timeout`.
Whichever side gives up first writes the error you read, and the Lua side knows
things the Node side does not, such as whether the player is still connected.

### More than one server

One MCP entry can hold every server you develop against. `FIVEM_SERVERS` is a
JSON object of name to settings, and each entry takes the same values as the
single server variables:

```json
{
  "mcpServers": {
    "fivem": {
      "command": "node",
      "args": ["<path>/ktx_claude_bridge/ktx_claude_bridge/mcp/dist/index.js"],
      "env": {
        "FIVEM_SERVERS": "{\"qbox\":{\"url\":\"http://localhost:30120/ktx_claude_bridge\"},\"test\":{\"url\":\"http://localhost:27007/ktx_claude_bridge\",\"cdpPort\":13173}}",
        "FIVEM_SERVER_DEFAULT": "qbox"
      }
    }
  }
}
```

`list_servers` shows them, `use_server` switches, and the choice holds until it
is changed again. Two entries may name the same URL, for servers that take turns
on one port. `list_servers` warns when that happens, because then the name does
not tell you which one answered and only `get_server_info`'s hostname does.

One MCP entry per server also works and needs none of this. It just means
several MCP servers, and nothing stops two of them pointing at the same place.

## Tools

Forty of them. Two deserve their own note before the list.

### Which console answers which question

|  | Server | Client |
|---|---|---|
| Complete, from disk | `read_server_log` | `read_client_log` |
| Recent, from memory | `get_server_console` | `get_client_console` |

The client pair is not the mirror of the server pair. `get_server_console` uses
`RegisterConsoleListener` and holds everything the console printed, errors
included. `get_client_console` overrides `print` inside the bridge's own Lua
state, and every resource in FiveM has its own state. So it holds the output of
code this bridge ran on the client and nothing else. No other resource's prints,
no SCRIPT ERRORs, no resource load or mount lines, no CEF errors.

A resource that fails on the client leaves nothing in it. That is what
`read_client_log` is for.

<details>
<summary>All forty tools</summary>

#### Servers
| Tool | Description |
|---|---|
| `list_servers` | The configured servers and which one is active |
| `use_server` | Point every following call at another server |

#### Lua execution
| Tool | Description |
|---|---|
| `exec_server_lua` | Lua in the bridge's server VM |
| `exec_client_lua` | Lua in the bridge's client VM on a player |
| `exec_server_lua_scoped` | Lua inside another resource's server VM |
| `exec_client_lua_scoped` | Lua inside another resource's client VM |

#### NUI over the Chrome DevTools Protocol
| Tool | Description |
|---|---|
| `nui_list_frames` | The loaded NUI resource frames |
| `nui_exec_js` | JavaScript in any resource's NUI frame |
| `nui_query_dom` | DOM elements by CSS selector |
| `nui_get_dom_tree` | A serialized DOM tree |
| `nui_click_element` | Click a DOM element by selector |
| `nui_fill_input` | Fill an input or textarea, React compatible setter |
| `nui_screenshot` | The NUI layer alone, transparent background |
| `nui_simulate_click` | Click at absolute pixel coordinates |
| `nui_inject_script` | JavaScript that runs on every NUI frame load |
| `nui_network_monitor` | Start, flush or stop capture of NUI fetch and XHR traffic |

#### Server and player state
| Tool | Description |
|---|---|
| `get_server_info` | Health check plus hostname, OneSync, frameworks, resource counts, uptime |
| `get_players` | Connected players with position, ping, identifiers |
| `get_player_data` | Qbox player data, online or offline |
| `get_resources` | Every resource with its state |
| `get_resource_info` | Version, author, scripts, exports, dependencies |
| `get_entities` | Server entities, vehicles, peds, objects. Needs OneSync |
| `get_registered_commands` | Every registered command across every resource |

#### Resource files
| Tool | Description |
|---|---|
| `read_resource_file` | Read a file through `LoadResourceFile` |
| `write_resource_file` | Write a file through `SaveResourceFile` |
| `list_resource_files` | The files a resource declares in its manifest |

#### Console and logs
| Tool | Description |
|---|---|
| `get_server_console` | Recent server output with per line `resource` attribution, 1000 line ring |
| `get_client_console` | Only what ran through `exec_client_lua` printed |
| `read_server_log` | The whole `fxserver.log`, with tail and search |
| `read_client_log` | The client's own `CitizenFX_log_*.log` |
| `watch_console` | Poll the server console for new output over a duration |

#### Events, commands, the rest
| Tool | Description |
|---|---|
| `trigger_server_event` | Trigger a server event with arguments |
| `trigger_client_event` | Trigger a client event on a player |
| `run_command` | A server console command |
| `run_client_command` | A registered command on a player's client |
| `restart_resource` | Restart a resource, self restart goes through the helper |
| `db_query` | Read only SQL through oxmysql |
| `get_nui_state` | NUI focus and cursor state for a player |
| `take_screenshot` | The full game view through `screencapture` |
| `run_profiler` | A server side CPU profile in Chrome trace format |

</details>

## Architecture

```
Claude Code ──stdio──> MCP server (Node.js)
                          ├── HTTP fetch() ──> FiveM server, port 30120
                          │                    ├── ktx_bridge_helper, never restarts
                          │                    │   ├── RegisterConsoleListener, 1000 line ring
                          │                    │   └── exports getConsole, addConsole, restartBridge
                          │                    └── ktx_claude_bridge
                          │                        ├── server/, HTTP handler, routes, relay
                          │                        └── client/, code exec relay, console capture
                          │
                          └── WebSocket ──> CEF DevTools, port 13172
                                            └── CitizenFX root UI
                                                ├── iframe: ox_inventory NUI
                                                ├── iframe: qbx_hud NUI
                                                └── every other resource's NUI frame
```

Two channels. HTTP carries Lua, events, console, database, resource management
and file access. A WebSocket carries everything to do with NUI.

Anything aimed at a client takes a detour. HTTP arrives, the server stores a
callback under a request id, `TriggerClientEvent` goes out, the client runs the
code, `TriggerServerEvent` comes back, and the HTTP response resolves.

```
ktx_claude_bridge/              repo root
├── ktx_claude_bridge/          the main resource
│   ├── fxmanifest.lua
│   ├── exec_bridge.lua         the shared_script other resources opt into
│   ├── server/
│   ├── client/
│   └── mcp/                    the Node MCP server, stdio transport
├── ktx_bridge_helper/          console capture and restart, do not restart it
├── CLAUDE.md
├── LICENSE
└── README.md
```

## Transport

On FiveM for GTAV Enhanced up to build b96 the callback given to
`req.setDataHandler` never fires, so a POST body never arrives and the server
drops the connection after a few seconds. Reported as
[citizenfx/rfc#279](https://github.com/citizenfx/rfc/discussions/279), fixed in
the August 11 patch, server b118.

Because of that the client sends the payload as `?body=<url encoded json>` on a
GET by default, and the Lua side accepts either form. **Your Lua therefore ends
up in the request URL.** On localhost that is nowhere. Behind a reverse proxy it
is in an access log. If your server is new enough, set
`FIVEM_BRIDGE_TRANSPORT=post` and real POST bodies come back. Nothing on the Lua
side has to change.

If you test a route by hand, encode spaces as `%20` and not as `+`. The bridge
decodes percent escapes only, because `encodeURIComponent` turns a literal `+`
into `%2B`, and treating `+` as a space would corrupt any Lua containing one.
`curl -G --data-urlencode` sends `+` and will hand your snippet to Lua with the
spaces still in it.

Two more limits shape this. A held open response is cut after a few seconds, so
calls run as jobs: the request returns a job id at once and the result is
collected from `/job?id=...` afterwards. And a URL has a length limit, so a
payload above `FIVEM_BRIDGE_CHUNK_THRESHOLD` goes up to `/chunk` in pieces and
the call references it with `?chunked=<id>`. Both happen underneath. A caller
sees an ordinary request and an ordinary answer.

## Security

**The HTTP endpoint is not localhost only.** `SetHttpHandler` hangs off the
server's own HTTP listener, so these routes answer wherever the server answers,
the internet included. Behind them sit `/exec/server`, `/db/query` and
`/resource/file/write`. An earlier version of this file claimed otherwise, and
an empty `ktx_bridge_token` let every request through. Anyone who knew the
address had the server and its database.

- **No token set.** Only requests from the machine the server runs on are
  answered. Everything else gets a 401. This is the default and needs no setup.
- **`ktx_bridge_token` set.** Every request needs
  `Authorization: Bearer <token>`, and the bridge can then be reached from
  another machine. Give the MCP server the same value as `FIVEM_BRIDGE_TOKEN`.

If your server runs in a container, in a VM or on another host, "the machine the
server runs on" is not your machine. The request arrives from a gateway address,
you get a 401, and nothing about it looks like an auth problem. Set a token.

The rest:

- Scoped server side execution listens on a local event, never a net event, so a
  client cannot trigger it.
- The CDP connection only goes to 127.0.0.1.
- `db_query` accepts SELECT, SHOW, DESCRIBE and EXPLAIN, nothing else.
- The model gets to run arbitrary Lua and JavaScript. That is the point of the
  tool, and the reason it does not belong on a public server.

## Removal

Before a resource you developed with this goes anywhere live:

1. Delete `shared_script '@ktx_claude_bridge/exec_bridge.lua'` from every
   fxmanifest that opted in. Grep for it, that line is easy to forget.
2. Remove the two `ensure` lines and the two `add_ace` lines from `server.cfg`.
3. Delete both resource folders.

`set ktx_bridge_enabled false` turns every route off without removing anything,
which is enough for a break but not for shipping.

## License

MIT
