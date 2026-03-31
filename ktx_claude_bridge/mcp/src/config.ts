export const config = {
  bridgeUrl: process.env.FIVEM_BRIDGE_URL || 'http://localhost:30120/ktx_claude_bridge',
  token: process.env.FIVEM_BRIDGE_TOKEN || '',
  timeout: parseInt(process.env.FIVEM_BRIDGE_TIMEOUT || '15000', 10),
  logPath: process.env.FIVEM_LOG_PATH || '',
  cdpPort: parseInt(process.env.FIVEM_CDP_PORT || '13172', 10),
} as const;
