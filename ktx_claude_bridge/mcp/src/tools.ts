import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readFile, stat } from 'node:fs/promises';
import { request } from './http.js';
import { config } from './config.js';

function text(content: string) {
  return { content: [{ type: 'text' as const, text: content }] };
}

function jsonText(data: unknown) {
  return text(JSON.stringify(data, null, 2));
}

export function registerTools(server: McpServer) {
  // ── GET tools ────────────────────────────────────────────

  server.registerTool(
    'get_server_status',
    {
      description:
        'Get FiveM server status: player count, resource count, uptime, server name. Use this first to check if the bridge is alive.',
      inputSchema: z.object({}),
    },
    async () => jsonText(await request('GET', '/status')),
  );

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
        'Get extended server info: hostname, OneSync status, max clients, locale, framework detection (qbx_core, ox_lib, oxmysql, ox_inventory), resource counts, and connected player IDs.',
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
        'Get Qbox player data (job, gang, money, charinfo, metadata). Works for online and offline players. Requires qbx_core.',
      inputSchema: z.object({
        playerId: z.number().optional().describe('Server ID of online player'),
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
        'Get recent server console output (print statements, resource start/stop events, exec errors). Use after restarting a resource to check for errors.',
      inputSchema: z.object({
        count: z.number().optional().describe('Max lines to return'),
        since: z.number().optional().describe('Unix timestamp — only return lines after this time'),
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
        'Get recent client-side console output for a specific player (print statements, exec results/errors).',
      inputSchema: z.object({
        playerId: z.number().describe('Player server ID'),
        count: z.number().optional().describe('Max lines to return'),
        since: z.number().optional().describe('Unix timestamp'),
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
        'Execute Lua code on the FiveM server and return the result. Runs in server context with access to all server-side natives and globals. Use "return" to get values back. Examples: "return GetNumPlayerIndices()", "return GetResourceState(\'myresource\')".',
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
        'Execute Lua code on a connected player\'s FiveM client. Runs in client context with access to client-side natives (PlayerPedId, GetEntityCoords, etc). If playerId is omitted, targets the first connected player. Returns the result asynchronously.',
      inputSchema: z.object({
        code: z.string().describe('Lua code to execute on the client'),
        playerId: z.number().optional().describe('Player server ID (default: first connected player)'),
      }),
    },
    async ({ code, playerId }) =>
      jsonText(await request('POST', '/exec/client', { code, playerId })),
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
        playerId: z.number().describe('Player server ID'),
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
        'Run a registered FiveM command on a player\'s client. Executes ExecuteCommand() client-side. Examples: "e menu", "emote wave". If playerId is omitted, targets the first connected player.',
      inputSchema: z.object({
        command: z.string().describe('Client-side command to execute'),
        playerId: z.number().optional().describe('Player server ID (default: first connected player)'),
      }),
    },
    async ({ command, playerId }) =>
      jsonText(await request('POST', '/command/client', { command, playerId })),
  );

  server.registerTool(
    'restart_resource',
    {
      description:
        'Restart a FiveM resource (runs "ensure <name>"). Use get_server_console afterwards to check for startup errors.',
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
        'Take a screenshot of a player\'s screen. Requires the "screencapture" resource (github.com/itschip/screencapture). Returns base64 webp image data.',
      inputSchema: z.object({
        playerId: z.number().optional().describe('Player server ID (default: first connected player)'),
      }),
    },
    async ({ playerId }) =>
      jsonText(await request('POST', '/screenshot', { playerId })),
  );

  // ── NUI convenience tool ─────────────────────────────────

  server.registerTool(
    'send_nui_message',
    {
      description:
        'Send a NUI message to a resource on a player\'s client. Internally uses TriggerEvent to dispatch to the target resource\'s NUI frame. The target resource must handle the __cfx_nui event.',
      inputSchema: z.object({
        playerId: z.number().optional().describe('Player server ID (default: first connected player)'),
        resourceName: z.string().describe('Target resource name'),
        message: z.record(z.unknown()).describe('NUI message object (e.g. {action: "open", data: {}})'),
      }),
    },
    async ({ playerId, resourceName, message }) => {
      const msgJson = JSON.stringify(message).replace(/'/g, "\\'");
      const code = `TriggerEvent('__cfx_nui:${resourceName}', '${msgJson}')  return 'sent'`;
      return jsonText(await request('POST', '/exec/client', { code, playerId }));
    },
  );

  // ── NUI tools ────────────────────────────────────────────

  server.registerTool(
    'get_nui_state',
    {
      description:
        'Get the NUI (UI overlay) state on a player\'s client: whether NUI is focused, if cursor is active, etc.',
      inputSchema: z.object({
        playerId: z.number().optional().describe('Player server ID (default: first connected player)'),
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
        duration: z.number().optional().describe('How long to watch in seconds (default: 15)'),
        interval: z.number().optional().describe('Poll interval in seconds (default: 2)'),
      }),
    },
    async ({ duration = 15, interval = 2 }) => {
      const allLines: unknown[] = [];
      const since = Math.floor(Date.now() / 1000) - 1;
      const endTime = Date.now() + duration * 1000;
      let lastNewLineTime = Date.now();

      while (Date.now() < endTime) {
        const res = await request('GET', `/console/server?since=${since}`);
        const lines = (res as { lines?: unknown[] }).lines || [];

        if (lines.length > allLines.length) {
          const newLines = lines.slice(allLines.length);
          allLines.push(...newLines);
          lastNewLineTime = Date.now();
        }

        // Stop early if no new lines for 5s
        if (Date.now() - lastNewLineTime > 5000 && allLines.length > 0) {
          break;
        }

        await new Promise((r) => setTimeout(r, interval * 1000));
      }

      return jsonText({
        success: true,
        watchedSeconds: Math.round((Date.now() - (since * 1000 + 1000)) / 1000),
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
        'Read the full FiveM server log file (fxserver.log from txAdmin). Contains ALL console output since server start including early boot messages. Use "tail" param to get last N lines, or "search" to grep for a pattern. Much more complete than get_server_console.',
      inputSchema: z.object({
        tail: z.number().optional().describe('Return last N lines (default: 100)'),
        search: z.string().optional().describe('Filter lines containing this text (case-insensitive)'),
        logPath: z.string().optional().describe('Override log file path (auto-detected if not set)'),
      }),
    },
    async ({ tail = 100, search, logPath }) => {
      const candidates = [logPath, config.logPath].filter(Boolean) as string[];

      // Auto-detect: walk up from MCP script dir looking for txData/*/logs/fxserver.log
      if (candidates.length === 0) {
        const path = await import('node:path');
        const fs = await import('node:fs');
        let dir = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')));
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
}
