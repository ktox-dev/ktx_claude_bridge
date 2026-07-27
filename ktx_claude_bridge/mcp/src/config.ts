export const config = {
  bridgeUrl: process.env.FIVEM_BRIDGE_URL || 'http://localhost:30120/ktx_claude_bridge',
  token: process.env.FIVEM_BRIDGE_TOKEN || '',
  /** Timeout for a single HTTP round-trip. These are short now — long work
   *  runs as a job and is polled, so no request stays open. */
  timeout: parseInt(process.env.FIVEM_BRIDGE_TIMEOUT || '15000', 10),
  /** How long we keep polling a job before giving up. */
  jobTimeout: parseInt(process.env.FIVEM_BRIDGE_JOB_TIMEOUT || '300000', 10),
  /** Payloads longer than this are uploaded in pieces to /chunk first.
   *  The payload travels in the URL (POST bodies do not arrive on b96),
   *  so it has to stay well below any URL length limit. */
  chunkThreshold: parseInt(process.env.FIVEM_BRIDGE_CHUNK_THRESHOLD || '1200', 10),
  logPath: process.env.FIVEM_LOG_PATH || '',
  cdpPort: parseInt(process.env.FIVEM_CDP_PORT || '13172', 10),
} as const;
