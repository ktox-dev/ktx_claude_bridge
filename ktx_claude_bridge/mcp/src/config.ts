/**
 * One MCP server, any number of FiveM servers.
 *
 * There used to be one MCP entry per server. That went wrong in the obvious
 * way: two of the three entries pointed at the same URL, so their names said
 * nothing about which server answered, and only whichever one was running
 * replied at all. Everything that differs per server now lives in a Server
 * record, and `use_server` picks one.
 */

/** Everything that belongs to one FiveM server. */
export interface Server {
  name: string;
  url: string;
  token: string;
  /** 'get' sends payloads as a query parameter, 'post' as a real body. */
  transport: 'get' | 'post';
  /** txAdmin's fxserver.log. Empty means auto-detect. */
  logPath: string;
  /** The game client's CitizenFX log, a file or the folder holding them. */
  clientLogPath: string;
  /** CEF DevTools port for the client connected to this server. */
  cdpPort: number;
}

/** Values that are the same whatever server is being talked to. */
export const config = {
  /** Timeout for a single HTTP round-trip. These are short: long work runs as
   *  a job and is polled, so no request stays open. */
  timeout: parseInt(process.env.FIVEM_BRIDGE_TIMEOUT || '15000', 10),
  /** How long we keep polling a job before giving up. */
  jobTimeout: parseInt(process.env.FIVEM_BRIDGE_JOB_TIMEOUT || '300000', 10),
  /** Payloads longer than this are uploaded in pieces to /chunk first.
   *  The payload travels in the URL (POST bodies do not arrive on b96),
   *  so it has to stay well below any URL length limit. */
  chunkThreshold: parseInt(process.env.FIVEM_BRIDGE_CHUNK_THRESHOLD || '1200', 10),
} as const;

function normalise(name: string, raw: Partial<Server> & { url?: string }): Server {
  return {
    name,
    url: raw.url || 'http://localhost:30120/ktx_claude_bridge',
    token: raw.token ?? '',
    transport: raw.transport === 'post' ? 'post' : 'get',
    logPath: raw.logPath ?? '',
    clientLogPath: raw.clientLogPath ?? '',
    cdpPort: raw.cdpPort ?? 13172,
  };
}

/**
 * FIVEM_SERVERS holds the whole list as JSON:
 *
 *   {"qbox": {"url": "http://localhost:30120/ktx_claude_bridge"},
 *    "test": {"url": "http://localhost:27007/ktx_claude_bridge"}}
 *
 * A bare string instead of an object is read as the url. Without the variable
 * the single-server environment variables still work, so an existing setup
 * keeps running untouched.
 */
function build(): Record<string, Server> {
  const raw = process.env.FIVEM_SERVERS;

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, string | Partial<Server>>;
      const out: Record<string, Server> = {};
      for (const [name, value] of Object.entries(parsed)) {
        out[name] = normalise(name, typeof value === 'string' ? { url: value } : value);
      }
      if (Object.keys(out).length > 0) return out;
    } catch (err) {
      // A broken list must not leave the tool with no server at all, so say so
      // and fall through to the single-server variables.
      console.error(`[ktx bridge] FIVEM_SERVERS is not valid JSON, ignoring it: ${String(err)}`);
    }
  }

  return {
    default: normalise('default', {
      url: process.env.FIVEM_BRIDGE_URL,
      token: process.env.FIVEM_BRIDGE_TOKEN,
      transport: (process.env.FIVEM_BRIDGE_TRANSPORT as 'get' | 'post') ?? 'get',
      logPath: process.env.FIVEM_LOG_PATH,
      clientLogPath: process.env.FIVEM_CLIENT_LOG_PATH,
      cdpPort: process.env.FIVEM_CDP_PORT ? parseInt(process.env.FIVEM_CDP_PORT, 10) : undefined,
    }),
  };
}

const servers = build();
let active = process.env.FIVEM_SERVER_DEFAULT && servers[process.env.FIVEM_SERVER_DEFAULT]
  ? process.env.FIVEM_SERVER_DEFAULT
  : Object.keys(servers)[0];

/** The server every call goes to until `useServer` says otherwise. */
export function activeServer(): Server {
  return servers[active];
}

export function serverNames(): string[] {
  return Object.keys(servers);
}

export function listServers(): Array<Server & { active: boolean }> {
  return Object.values(servers).map(s => ({ ...s, active: s.name === active }));
}

/** Switch targets. Throws on an unknown name rather than silently keeping the
 *  old one, which would send the next call somewhere the caller did not mean. */
export function useServer(name: string): Server {
  if (!servers[name]) {
    throw new Error(`Unknown server "${name}". Known: ${serverNames().join(', ')}`);
  }
  active = name;
  return servers[name];
}
