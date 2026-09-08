# CLAUDE.md

Notes for working on this repo, and notes worth copying into the CLAUDE.md of
any project you point the bridge at. Setup, configuration and the tool list live
in the README.

## Parts

1. `ktx_claude_bridge/` is a FiveM Lua resource. It hangs HTTP routes off
   `SetHttpHandler` under `http://<server>:30120/ktx_claude_bridge/`.
2. `ktx_claude_bridge/mcp/` is a Node MCP server over stdio. It wraps those
   routes and a CDP WebSocket as tools.
3. `ktx_bridge_helper/` is a second resource. It holds the console listener and
   restarts the bridge from outside. It must never restart itself, because the
   ring buffer lives in its Lua state and destroying the bridge's own VM from
   inside that VM ends in a SIGSEGV.

Build the MCP server with `cd ktx_claude_bridge/mcp && pnpm install && pnpm run build`.

## Notes for agents using the bridge

These are the mistakes that cost the most time.

- **Exports take a colon.** `exports.qbx_core:GetPlayer(1)`, never a dot. With a
  dot, FiveM passes a hidden first argument and the call misbehaves quietly.
- **`lib` does not exist in the bridge's VM.** ox_lib only defines it inside
  resources that depend on it. Use a scoped exec or call the export.
- **Qbox has `GetPlayer`, not `GetPlayerData`.**
- **Refresh before restart.** After editing an fxmanifest, run
  `run_command({command: "refresh"})` before `restart_resource`. FiveM caches
  manifests.
- **Statebag keys are not enumerable.** Read them by name with
  `Player(id).state.key` or `GetStateBagValue("player:"..id, "key")`.
- **`get_server_console` is noisy.** Hitch warnings and server list errors come
  from `citizen-server-impl`. Filter on the `resource` field.
- **A client side failure leaves nothing in `get_client_console`.** That buffer
  only holds what code run through `exec_client_lua` printed. Reach for
  `read_client_log` whenever a client symptom has no server side trace.
- **Two screenshots, two meanings.** `take_screenshot` is the game plus the UI.
  `nui_screenshot` is the UI alone on a transparent background.
- **NUI frames** carry URLs of the form `nui://<resource>/` or
  `https://cfx-nui-<resource>/`. `nui_list_frames` resolves the names.

## Routes

Two of the GET routes are plumbing rather than API. `/chunk` takes one piece of
a long payload, `/job` collects the result of an asynchronous call. See
Transport in the README for why both exist.

| Method | Path |
|---|---|
| GET | `/status`, `/server/info`, `/players`, `/player/data`, `/resources`, `/resource/info`, `/entities`, `/commands`, `/console/server`, `/console/client` |
| GET | `/chunk`, `/job` |
| POST | `/exec/server`, `/exec/client`, `/exec/server/scoped`, `/exec/client/scoped` |
| POST | `/event/server`, `/event/client`, `/command`, `/command/client` |
| POST | `/db/query`, `/nui/state`, `/screenshot` |
| POST | `/resource/restart`, `/resource/file/read`, `/resource/file/write`, `/resource/files` |

Every POST route also answers a GET carrying `?body=<url encoded json>`, which
is what the MCP client uses by default.

## Patterns

**Client relay.** HTTP arrives, the server stores a callback under a request id,
`TriggerClientEvent` goes out, the client runs the code, `TriggerServerEvent`
comes back, the HTTP response resolves. The result handler checks that the
answer came from the player the request went to.

**Scoped exec.** HTTP arrives, the server fires a local `TriggerEvent`,
`exec_bridge.lua` inside the target resource's VM runs the code with full access
to that resource's globals, and the result comes back the same way. Server side
this is a local event and never a `RegisterNetEvent`, so a client cannot reach
it.

**Jobs.** FiveM cuts a held open HTTP response after a few seconds. Long calls
therefore answer with a job id at once and the real result is polled from
`/job`. The handler runs in its own thread, so a blocking handler does not delay
the response that carries the id.

## Conventions

- Lua 5.4, `<const>` where it applies.
- The bridge itself is standalone. No ox_lib, no framework.
- Everything outside a language file is English.
- Comments say why, not what.
- The startup print says DEV ONLY, and it means it.
