import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readFile, stat } from 'node:fs/promises';
import { request } from './http.js';
import { config, activeServer, listServers, useServer } from './config.js';

function text(content: string) {
  return { content: [{ type: 'text' as const, text: content }] };
}

function jsonText(data: unknown) {
  return text(JSON.stringify(data, null, 2));
}

export function registerTools(server: McpServer) {
  // ── Server selection ─────────────────────────────────────

  server.registerTool(
    'list_servers',
    {
      description:
        'List the FiveM servers this bridge is configured for and show which one every other tool currently talks to. Worth a look before you trust an answer: two entries can point at the same URL, and then the name tells you nothing about which server replied.',
      inputSchema: z.object({}),
    },
    async () => {
      const alle = listServers();

      // Two names on one URL is the situation this tool exists for. Only one
      // FiveM server can hold a port, so the name says nothing about which one
      // answered — get_server_info's hostname does.
      const proUrl = new Map<string, string[]>();
      for (const s of alle) proUrl.set(s.url, [...(proUrl.get(s.url) ?? []), s.name]);
      const doppelt = [...proUrl.entries()].filter(([, n]) => n.length > 1);

      return jsonText({
        active: activeServer().name,
        servers: alle.map(s => ({
          name: s.name, url: s.url, transport: s.transport, active: s.active,
        })),
        ...(doppelt.length > 0 && {
          warning: doppelt.map(([url, namen]) =>
            `${namen.join(' and ')} share ${url}, so only one of them can be running. ` +
            'Check get_server_info for the hostname to see which one answered.'),
        }),
      });
    },
  );

  server.registerTool(
    'use_server',
    {
      description:
        'Point every following tool call at a different FiveM server. Names come from list_servers. The choice holds until it is changed again, so say which server you are on when reporting a result.',
      inputSchema: z.object({
        name: z.string().describe('Server name from list_servers'),
      }),
    },
    async ({ name }) => {
      try {
        const s = useServer(name);
        return jsonText({ success: true, active: s.name, url: s.url });
      } catch (err) {
        return jsonText({ success: false, error: String(err instanceof Error ? err.message : err) });
      }
    },
  );

  // ── GET tools ────────────────────────────────────────────

  server.registerTool(
    'get_players',
    {
      description:
        'Get detailed list of all connected players including server ID, name, identifiers, ping, position, and current vehicle.',
      inputSchema: z.object({}),
    },
    async () => jsonText(await request('GET', '/players')),
  );

  server.registerTool(
    'get_resources',
    {
      description:
        'List all FiveM resources with their current state (started, stopped, etc).',
      inputSchema: z.object({}),
    },
    async () => jsonText(await request('GET', '/resources')),
  );

  server.registerTool(
    'get_server_info',
    {
      description:
        'Get server info and health check. Returns: hostname, player count, OneSync status, max clients, locale, framework detection (qbx_core, ox_lib, oxmysql, ox_inventory), resource counts (started/stopped), uptime, and connected player IDs. Use this first to check if the bridge is alive.',
      inputSchema: z.object({}),
    },
    async () => jsonText(await request('GET', '/server/info')),
  );

  server.registerTool(
    'db_query',
    {
      description:
        'Execute a read-only SQL query via oxmysql. Only SELECT, SHOW, DESCRIBE, and EXPLAIN are allowed. Use parameterized queries with ? placeholders. Examples: "SELECT * FROM players LIMIT 5", "DESCRIBE player_vehicles".',
      inputSchema: z.object({
        query: z.string().describe('SQL query (SELECT/SHOW/DESCRIBE/EXPLAIN only)'),
        params: z.array(z.unknown()).optional().describe('Query parameters for ? placeholders'),
      }),
    },
    async ({ query, params }) =>
      jsonText(await request('POST', '/db/query', { query, params })),
  );

  server.registerTool(
    'get_player_data',
    {
      description:
        'Get Qbox player data (job, gang, money, charinfo, metadata). Works for online and offline players. Requires qbx_core. Prefer this over manually calling exports — the export name is exports.qbx_core:GetPlayer(src), NOT GetPlayerData.',
      inputSchema: z.object({
        playerId: z.coerce.number().optional().describe('Server ID of online player'),
        citizenid: z.string().optional().describe('CitizenID (works for offline players too)'),
      }),
    },
    async ({ playerId, citizenid }) => {
      const params = new URLSearchParams();
      if (playerId !== undefined) params.set('playerId', String(playerId));
      if (citizenid !== undefined) params.set('citizenid', citizenid);
      return jsonText(await request('GET', `/player/data?${params}`));
    },
  );

  server.registerTool(
    'get_resource_info',
    {
      description:
        'Get detailed info about a specific resource: version, author, description, dependencies, scripts, exports, and state.',
      inputSchema: z.object({
        name: z.string().describe('Resource name'),
      }),
    },
    async ({ name }) => jsonText(await request('GET', `/resource/info?name=${encodeURIComponent(name)}`)),
  );

  // ── Resource file tools ──────────────────────────────────

  server.registerTool(
    'read_resource_file',
    {
      description:
        'Read any file from any FiveM resource by name and path. Can read Lua source, configs, HTML, JSON — anything in the resource directory. Use list_resource_files first to discover available files.',
      inputSchema: z.object({
        resource: z.string().describe('Resource name (e.g. "ktx_garages", "ox_inventory")'),
        path: z.string().describe('File path relative to resource root (e.g. "fxmanifest.lua", "server/main.lua", "shared/config.lua")'),
      }),
    },
    async ({ resource, path }) =>
      jsonText(await request('POST', '/resource/file/read', { resource, path })),
  );

  server.registerTool(
    'write_resource_file',
    {
      description:
        'Write a file to a FiveM resource directory. Can create new files or overwrite existing ones. Use with restart_resource for hot-reload. WARNING: Cannot write .lua/.js files unless the server has add_filesystem_permission configured. Safe for .json, .cfg, .html, .css, and data files.',
      inputSchema: z.object({
        resource: z.string().describe('Resource name'),
        path: z.string().describe('File path relative to resource root'),
        content: z.string().describe('File content to write'),
      }),
    },
    async ({ resource, path, content }) =>
      jsonText(await request('POST', '/resource/file/write', { resource, path, content })),
  );

  server.registerTool(
    'list_resource_files',
    {
      description:
        'List all known files in a FiveM resource. Discovers files from the resource manifest (server_scripts, client_scripts, shared_scripts, files, ui_page). Also returns the resource\'s absolute filesystem path and manifest file name.',
      inputSchema: z.object({
        resource: z.string().describe('Resource name'),
      }),
    },
    async ({ resource }) =>
      jsonText(await request('POST', '/resource/files', { resource })),
  );

  server.registerTool(
    'get_registered_commands',
    {
      description:
        'List ALL registered FiveM commands across all resources. Returns command name, owning resource, and arity. Use this to discover what commands are available before using run_command or run_client_command.',
      inputSchema: z.object({}),
    },
    async () => jsonText(await request('GET', '/commands')),
  );

  server.registerTool(
    'get_entities',
    {
      description:
        'List all server-side entities (vehicles, peds, objects) with positions, models, health. Filter by type. Requires OneSync.',
      inputSchema: z.object({
        type: z
          .enum(['vehicle', 'ped', 'object'])
          .optional()
          .describe('Filter by entity type (default: all)'),
      }),
    },
    async ({ type }) => {
      const qs = type ? `?type=${type}` : '';
      return jsonText(await request('GET', `/entities${qs}`));
    },
  );

  server.registerTool(
    'get_server_console',
    {
      description:
        'Get recent server console output. Captured with RegisterConsoleListener, so it holds EVERYTHING the server console printed, script errors included, from every resource. Two limits: it is a 1000-line ring buffer, and it starts when ktx_bridge_helper starts, so anything older is gone — read_server_log has the full history from boot. Each line has a "resource" field (e.g. "script:ktx_garages", "citizen-server-impl") to filter on. Hitch warnings and server-list errors from "citizen-server-impl" are noise. This is the SERVER only: a resource that fails on the client leaves nothing here, see read_client_log.',
      inputSchema: z.object({
        count: z.coerce.number().optional().describe('Max lines to return'),
        since: z.coerce.number().optional().describe('Unix timestamp (seconds) — only return lines after this time. Use exec_server_lua with "return os.time()" to get the current server timestamp.'),
      }),
    },
    async ({ count, since }) => {
      const params = new URLSearchParams();
      if (count !== undefined) params.set('count', String(count));
      if (since !== undefined) params.set('since', String(since));
      const qs = params.toString();
      return jsonText(await request('GET', `/console/server${qs ? '?' + qs : ''}`));
    },
  );

  server.registerTool(
    'get_client_console',
    {
      description:
        'Get what THIS BRIDGE printed on a player\'s client. Narrow on purpose, and the limits decide whether it answers your question at all: the relay overrides print() inside the bridge\'s own Lua VM, and every resource in FiveM has its own VM. So it carries the output of code you ran through exec_client_lua, and nothing else. It does NOT carry other resources\' print() calls, SCRIPT ERRORs, resource download or mount lines, or NUI/CEF errors. A client-side failure is invisible here. For any of that use read_client_log, which reads the file the game client writes itself.',
      inputSchema: z.object({
        playerId: z.coerce.number().describe('Player server ID'),
        count: z.coerce.number().optional().describe('Max lines to return'),
        since: z.coerce.number().optional().describe('Unix timestamp'),
      }),
    },
    async ({ playerId, count, since }) => {
      const params = new URLSearchParams();
      params.set('playerId', String(playerId));
      if (count !== undefined) params.set('count', String(count));
      if (since !== undefined) params.set('since', String(since));
      return jsonText(await request('GET', `/console/client?${params}`));
    },
  );

  // ── Exec tools ───────────────────────────────────────────

  server.registerTool(
    'exec_server_lua',
    {
      description:
        'Execute Lua code on the FiveM server and return the result. Runs in the BRIDGE resource\'s server-side Lua VM — you have access to all server natives and can call other resources via exports (use COLON syntax: exports.resourceName:exportName(args)). You CANNOT access other resources\' local/global variables directly. Use "return" to get values back.\n\nCommon patterns:\n- Get player: exports.qbx_core:GetPlayer(serverId)\n- Statebags: Player(serverId).state.keyName or GetStateBagValue("player:"..id, "key")\n- DB query: exports.oxmysql:executeSync("SELECT ...", {})\n- Resource state: GetResourceState("name")\n\nIMPORTANT: ox_lib\'s "lib" global is NOT available here (it only exists inside resources that depend on ox_lib). To call lib.callback targets, trigger the underlying event or use the resource\'s exports instead.',
      inputSchema: z.object({
        code: z.string().describe('Lua code to execute'),
      }),
    },
    async ({ code }) => jsonText(await request('POST', '/exec/server', { code })),
  );

  server.registerTool(
    'exec_client_lua',
    {
      description:
        'Execute Lua code on a connected player\'s FiveM client. Runs in the BRIDGE resource\'s client-side Lua VM with access to client natives. If playerId is omitted, targets the first connected player.\n\nCommon patterns:\n- Player ped: PlayerPedId()\n- Position: GetEntityCoords(PlayerPedId())\n- Vehicle: GetVehiclePedIsIn(PlayerPedId(), false)\n- Teleport: SetEntityCoords(PlayerPedId(), x, y, z)\n- Run commands: ExecuteCommand("commandname") — opens NUI menus, triggers actions\n\nINPUT LAYER WARNING: FiveM has two separate input layers — the GAME layer (GTA controls like movement, aim, enter vehicle) and the NUI layer (HTML/JS UI overlays). When a NUI menu is open (focused), keyboard/mouse input goes to NUI FIRST, not the game. SetControlNormal/DisableControlAction only affect GAME controls — they CANNOT close or interact with NUI menus. To interact with NUI menus, use the nui_* CDP tools (nui_click_element, nui_exec_js, etc). To close a NUI menu, use nui_click_element on its close button, or nui_exec_js to call the resource\'s close function.\n\nIMPORTANT: This runs in the bridge\'s Lua VM. You can call other resources\' client exports with COLON syntax: exports.resourceName:exportName(args). You CANNOT access other resources\' globals/locals.',
      inputSchema: z.object({
        code: z.string().describe('Lua code to execute on the client'),
        playerId: z.coerce.number().optional().describe('Player server ID (default: first connected player)'),
      }),
    },
    async ({ code, playerId }) =>
      jsonText(await request('POST', '/exec/client', { code, playerId })),
  );

  // ── Scoped exec tools ─────────────────────────────────────

  server.registerTool(
    'exec_server_lua_scoped',
    {
      description:
        'Execute Lua code INSIDE another resource\'s server-side Lua VM. This gives you full access to that resource\'s globals, locals, lib, and internal state. Requires the target resource to have: shared_script \'@ktx_claude_bridge/exec_bridge.lua\' in its fxmanifest.lua. Use "return" to get values back.\n\nExample: exec_server_lua_scoped({resource: "ktx_garages", code: "return GarageDefinitions"})',
      inputSchema: z.object({
        code: z.string().describe('Lua code to execute inside the target resource\'s VM'),
        resource: z.string().describe('Target resource name (e.g. "ktx_garages", "ox_inventory")'),
      }),
    },
    async ({ code, resource }) =>
      jsonText(await request('POST', '/exec/server/scoped', { code, resource })),
  );

  server.registerTool(
    'exec_client_lua_scoped',
    {
      description:
        'Execute Lua code INSIDE another resource\'s client-side Lua VM on a player\'s machine. This gives you full access to that resource\'s client globals, state, and lib. Requires the target resource to have: shared_script \'@ktx_claude_bridge/exec_bridge.lua\' in its fxmanifest.lua. After adding exec_bridge.lua, run refresh + restart both ktx_claude_bridge and the target resource.',
      inputSchema: z.object({
        code: z.string().describe('Lua code to execute inside the target resource\'s client VM'),
        resource: z.string().describe('Target resource name'),
        playerId: z.coerce.number().optional().describe('Player server ID (default: first connected player)'),
      }),
    },
    async ({ code, resource, playerId }) =>
      jsonText(await request('POST', '/exec/client/scoped', { code, resource, playerId })),
  );

  // ── Event tools ──────────────────────────────────────────

  server.registerTool(
    'trigger_server_event',
    {
      description:
        'Trigger a server event with optional arguments. Use to simulate events that would normally come from client or other resources.',
      inputSchema: z.object({
        eventName: z.string().describe('Event name'),
        args: z.array(z.unknown()).optional().describe('Event arguments'),
      }),
    },
    async ({ eventName, args }) =>
      jsonText(await request('POST', '/event/server', { eventName, args })),
  );

  server.registerTool(
    'trigger_client_event',
    {
      description:
        'Trigger a client event on a specific player with optional arguments.',
      inputSchema: z.object({
        eventName: z.string().describe('Event name'),
        playerId: z.coerce.number().describe('Player server ID'),
        args: z.array(z.unknown()).optional().describe('Event arguments'),
      }),
    },
    async ({ eventName, playerId, args }) =>
      jsonText(await request('POST', '/event/client', { eventName, playerId, args })),
  );

  // ── Command/resource tools ───────────────────────────────

  server.registerTool(
    'run_command',
    {
      description:
        'Run a FiveM server console command. Examples: "status", "playerlist", "restart myresource".',
      inputSchema: z.object({
        command: z.string().describe('Console command to execute'),
      }),
    },
    async ({ command }) => jsonText(await request('POST', '/command', { command })),
  );

  server.registerTool(
    'run_client_command',
    {
      description:
        'Run a registered FiveM command on a player\'s client. Executes ExecuteCommand() client-side. Examples: "e menu", "emote wave", "garages". If playerId is omitted, targets the first connected player. Note: many commands open NUI menus — after running this, use nui_screenshot or take_screenshot to see the result, and nui_* tools to interact with any opened UI.',
      inputSchema: z.object({
        command: z.string().describe('Client-side command to execute'),
        playerId: z.coerce.number().optional().describe('Player server ID (default: first connected player)'),
      }),
    },
    async ({ command, playerId }) =>
      jsonText(await request('POST', '/command/client', { command, playerId })),
  );

  server.registerTool(
    'restart_resource',
    {
      description:
        'Restart a FiveM resource (runs "ensure <name>"). Restarts are fast — typically under 1 second. Use get_server_console afterwards to check for startup errors. IMPORTANT: If you modified the resource\'s fxmanifest.lua (e.g. added scripts), run run_command({command: "refresh"}) BEFORE restarting — FiveM caches manifests and won\'t pick up changes without refresh.',
      inputSchema: z.object({
        resourceName: z.string().describe('Resource name to restart'),
      }),
    },
    async ({ resourceName }) =>
      jsonText(await request('POST', '/resource/restart', { resourceName })),
  );

  // ── Screenshot tool ──────────────────────────────────────

  server.registerTool(
    'take_screenshot',
    {
      description:
        'Take a screenshot of a player\'s FULL game screen (game world + NUI overlay composited together). Use this to see what the player actually sees. For NUI-only screenshots (transparent background, just the UI elements), use nui_screenshot instead. Requires the "screencapture" resource.',
      inputSchema: z.object({
        playerId: z.coerce.number().optional().describe('Player server ID (default: first connected player)'),
      }),
    },
    async ({ playerId }) => {
      const res = await request('POST', '/screenshot', { playerId }) as { success?: boolean; error?: string; data?: string; encoding?: string };
      if (!res.success || !res.data) {
        return text(res.error || 'Screenshot failed');
      }
      // Extract MIME type from data URI prefix, then strip it
      const prefixMatch = res.data.match(/^data:([^;]+);base64,/);
      const mimeType = prefixMatch?.[1] ?? 'image/webp';
      const raw = prefixMatch ? res.data.slice(prefixMatch[0].length) : res.data;
      return {
        content: [{ type: 'image' as const, data: raw, mimeType }],
      };
    },
  );

  // ── NUI tools ────────────────────────────────────────────

  server.registerTool(
    'get_nui_state',
    {
      description:
        'Get the NUI (UI overlay) focus state on a player\'s client. Returns: focused (NUI is receiving input instead of the game), focusedKeepInput (NUI focused but game still receives input), cursorActive (mouse cursor visible). When focused=true, game controls like SetControlNormal will NOT work — input goes to NUI instead. Use nui_* tools to interact with the UI, or close the NUI menu first.',
      inputSchema: z.object({
        playerId: z.coerce.number().optional().describe('Player server ID (default: first connected player)'),
      }),
    },
    async ({ playerId }) =>
      jsonText(await request('POST', '/nui/state', { playerId })),
  );

  // ── Watch console (polling) ──────────────────────────────

  server.registerTool(
    'watch_console',
    {
      description:
        'Poll the server console for new output over a duration. Useful after restart_resource to watch for startup errors. Returns all new lines that appeared during the watch period. Stops early if no new lines for 5 seconds.',
      inputSchema: z.object({
        duration: z.coerce.number().optional().describe('How long to watch in seconds (default: 15)'),
        interval: z.coerce.number().optional().describe('Poll interval in seconds (default: 2)'),
      }),
    },
    async ({ duration = 15, interval = 2 }) => {
      const allLines: unknown[] = [];
      let since = Math.floor(Date.now() / 1000) - 1;
      const startTime = Date.now();
      const endTime = startTime + duration * 1000;
      let lastNewLineTime = Date.now();

      while (Date.now() < endTime) {
        const res = await request('GET', `/console/server?since=${since}`);
        const lines = (res as { lines?: { timestamp?: number }[] }).lines || [];

        if (lines.length > 0) {
          allLines.push(...lines);
          lastNewLineTime = Date.now();
          // Advance since to the latest timestamp to avoid re-fetching
          const lastTs = lines[lines.length - 1]?.timestamp;
          if (typeof lastTs === 'number') since = lastTs;
        }

        // Stop early if no new lines for 5s
        if (Date.now() - lastNewLineTime > 5000 && allLines.length > 0) {
          break;
        }

        await new Promise((r) => setTimeout(r, interval * 1000));
      }

      return jsonText({
        success: true,
        watchedSeconds: Math.round((Date.now() - startTime) / 1000),
        lines: allLines,
        total: allLines.length,
      });
    },
  );

  // ── Server log file (txAdmin) ───────────────────────────

  server.registerTool(
    'read_server_log',
    {
      description:
        'Read the full FiveM SERVER log file (fxserver.log, written by txAdmin). Everything the server console printed since boot, uncapped, so it holds the early startup lines that get_server_console\'s ring buffer has already dropped. Use "tail" for the last N lines or "search" to grep. Needs txAdmin: a server started without it writes no such file. Server side only, the client\'s own log is read_client_log.',
      inputSchema: z.object({
        tail: z.coerce.number().optional().describe('Return last N lines (default: 100)'),
        search: z.string().optional().describe('Filter lines containing this text (case-insensitive)'),
        logPath: z.string().optional().describe('Override log file path (auto-detected if not set)'),
      }),
    },
    async ({ tail = 100, search, logPath }) => {
      const candidates = [logPath, activeServer().logPath].filter(Boolean) as string[];

      // Auto-detect: walk up from MCP script dir looking for txData/*/logs/fxserver.log
      if (candidates.length === 0) {
        const path = await import('node:path');
        const fs = await import('node:fs');
        let dir = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1')));
        for (let i = 0; i < 15; i++) {
          const parent = path.dirname(dir);
          if (parent === dir) break;
          dir = parent;
          const txData = path.join(dir, 'txData');
          if (fs.existsSync(txData)) {
            for (const profile of fs.readdirSync(txData)) {
              candidates.push(path.join(txData, profile, 'logs', 'fxserver.log'));
            }
            break;
          }
        }
      }

      for (const p of candidates) {
        try {
          const s = await stat(p);
          if (!s.isFile()) continue;
          const content = await readFile(p, 'utf-8');
          let lines = content.split('\n').filter(l => l.trim() !== '');
          if (search) {
            const q = search.toLowerCase();
            lines = lines.filter(l => l.toLowerCase().includes(q));
          }
          if (lines.length > tail) lines = lines.slice(-tail);
          return jsonText({ success: true, path: p, totalLines: content.split('\n').length, returned: lines.length, lines });
        } catch { continue; }
      }

      return jsonText({ success: false, error: 'Could not find fxserver.log. Set FIVEM_LOG_PATH env var or pass logPath parameter.', triedPaths: candidates });
    },
  );

  server.registerTool(
    'read_client_log',
    {
      description:
        'Read the FiveM CLIENT log (CitizenFX_log_*.log) that the game client itself writes. This is NOT get_client_console: the console only carries what a script printed, while this file also holds load-time SCRIPT ERRORs, resource download and mount lines, NUI/CEF errors and crash context. A resource that fails on the client while the server log stays clean shows up here and nowhere else. Reads the newest log unless a path is given. Only works when the MCP server runs on the same machine as the game client.',
      inputSchema: z.object({
        tail: z.coerce.number().optional().describe('Return last N lines (default: 100)'),
        search: z.string().optional().describe('Filter lines containing this text (case-insensitive)'),
        errorsOnly: z.coerce.boolean().optional().describe('Only lines that report an error'),
        resource: z.string().optional().describe('Only lines mentioning this resource'),
        logPath: z.string().optional().describe('Override: a log file, or a directory holding CitizenFX_log_*.log'),
      }),
    },
    async ({ tail = 100, search, errorsOnly, resource, logPath }) => {
      const path = await import('node:path');
      const { readdir } = await import('node:fs/promises');

      const local = process.env.LOCALAPPDATA || '';
      const dirs = [
        logPath,
        activeServer().clientLogPath,
        local && path.join(local, 'FiveM', 'FiveM.app', 'logs'),
        // The Enhanced client keeps its own tree next to the legacy one.
        local && path.join(local, 'FiveM for GTAV Enhanced', 'FiveM.app', 'logs'),
      ].filter(Boolean) as string[];

      const tried: string[] = [];
      for (const entry of dirs) {
        tried.push(entry);
        try {
          const s = await stat(entry);
          let file = entry;
          if (s.isDirectory()) {
            const names = (await readdir(entry)).filter(n => /^CitizenFX_log_.*\.log$/.test(n));
            if (names.length === 0) continue;
            // Newest by write time, not by name: a session that runs past
            // midnight keeps the older name.
            const withTime = await Promise.all(names.map(async n => {
              const p = path.join(entry, n);
              return { p, t: (await stat(p)).mtimeMs };
            }));
            withTime.sort((a, b) => b.t - a.t);
            file = withTime[0].p;
          }

          const content = await readFile(file, 'utf-8');
          const total = content.split('\n').length;
          // The client writes colour codes into the file. They carry no
          // information once the line is read as text.
          let lines = content.split('\n')
            .map(l => l.replace(/\^[0-9]/g, '').trimEnd())
            .filter(l => l.trim() !== '');

          if (errorsOnly) {
            lines = lines.filter(l =>
              /SCRIPT ERROR|Error resuming|Uncaught|failed to|Failed to|exception/i.test(l));
          }
          if (resource) {
            const q = resource.toLowerCase();
            lines = lines.filter(l => l.toLowerCase().includes(q));
          }
          if (search) {
            const q = search.toLowerCase();
            lines = lines.filter(l => l.toLowerCase().includes(q));
          }
          if (lines.length > tail) lines = lines.slice(-tail);

          return jsonText({ success: true, path: file, totalLines: total, returned: lines.length, lines });
        } catch { continue; }
      }

      return jsonText({
        success: false,
        error: 'No CitizenFX client log found. Set FIVEM_CLIENT_LOG_PATH or pass logPath.',
        triedPaths: tried,
      });
    },
  );

  // ── Profiler tool ───────────────────────────────────────

  server.registerTool(
    'run_profiler',
    {
      description:
        'Record a SERVER-SIDE CPU profile for a number of frames. Returns Chrome DevTools trace format JSON showing per-resource CPU usage, event handler timing, and thread activity. Note: this profiles the server only — client-side profiling requires the player to use the "profiler" command in F8 console. For NUI/JS performance, use nui_exec_js with performance.now() or the Performance CDP domain.',
      inputSchema: z.object({
        frames: z.coerce.number().optional().describe('Number of frames to record (default: 500)'),
      }),
    },
    async ({ frames = 500 }) => {
      const filename = `__profiler_${Date.now()}.json`;

      // Record, wait, save to bridge resource dir via @ path
      await request('POST', '/command', { command: `profiler record ${frames}` });
      await new Promise((r) => setTimeout(r, Math.max(frames * 10, 2000)));
      await request('POST', '/command', { command: `profiler saveJSON @ktx_claude_bridge/${filename}` });
      await new Promise((r) => setTimeout(r, 1000));

      // Read via LoadResourceFile + always clean up
      const res = (await request('POST', '/exec/server', {
        code: `
          local name = GetCurrentResourceName()
          local content = LoadResourceFile(name, '${filename}')
          local path = GetResourcePath(name) .. '/${filename}'
          os.remove(path)
          return content
        `,
      })) as { success?: boolean; result?: string };

      if (res.success && res.result) {
        try {
          const profile = JSON.parse(res.result);
          return jsonText({ success: true, frames, profile });
        } catch {
          return text(res.result);
        }
      }

      // Clean up on failure too
      await request('POST', '/exec/server', {
        code: `os.remove(GetResourcePath(GetCurrentResourceName()) .. '/${filename}')`,
      }).catch(() => {});

      return jsonText({ success: false, error: 'Failed to capture profile. The profiler may not have finished recording.' });
    },
  );
}
