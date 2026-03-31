export const config = {
  bridgeUrl: process.env.FIVEM_BRIDGE_URL || 'http://localhost:30120/ktx_claude_bridge',
  token: process.env.FIVEM_BRIDGE_TOKEN || '',
  timeout: parseInt(process.env.FIVEM_BRIDGE_TIMEOUT || '15000', 10),
} as const;
