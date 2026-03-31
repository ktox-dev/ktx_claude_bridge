import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools.js';
import { registerCdpTools } from './cdp-tools.js';

const server = new McpServer({
  name: 'ktx-claude-bridge',
  version: '0.1.0',
});

registerTools(server);
registerCdpTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
