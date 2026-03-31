import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { request } from './http.js';

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
}
