import { config } from './config.js';

interface BridgeResponse {
  success?: boolean;
  error?: string;
  [key: string]: unknown;
}

/**
 * On FiveM for GTAV Enhanced (b96) the callback given to `req.setDataHandler`
 * never fires, so every POST hangs and the connection is closed without a
 * response (reported as citizenfx/rfc#279). While that is broken we send the
 * payload as a query parameter on a GET instead — the Lua side accepts both.
 *
 * Set FIVEM_BRIDGE_TRANSPORT=post to go back to real POST requests once the
 * upstream bug is fixed. Nothing else needs to change.
 */
const USE_GET_FALLBACK = (process.env.FIVEM_BRIDGE_TRANSPORT ?? 'get') !== 'post';

export async function request(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
): Promise<BridgeResponse> {
  let effectiveMethod = method;
  let url = `${config.bridgeUrl}${path}`;
  let payload: string | undefined = body ? JSON.stringify(body) : undefined;

  if (method === 'POST' && USE_GET_FALLBACK) {
    effectiveMethod = 'GET';
    const separator = path.includes('?') ? '&' : '?';
    url = `${config.bridgeUrl}${path}${separator}body=${encodeURIComponent(payload ?? '{}')}`;
    payload = undefined;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (config.token) {
    headers['Authorization'] = `Bearer ${config.token}`;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: effectiveMethod,
      headers,
      body: payload,
      signal: AbortSignal.timeout(config.timeout),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('abort') || msg.includes('timeout')) {
      throw new Error(`Bridge request timed out after ${config.timeout}ms: ${method} ${path}`);
    }
    throw new Error(`Bridge unreachable (${method} ${path}): ${msg}. Is the FiveM server running with ktx_claude_bridge started?`);
  }

  const responseText = await res.text();

  let data: BridgeResponse;
  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error(`Bridge returned non-JSON (${method} ${path}, status ${res.status}): ${responseText.slice(0, 200)}`);
  }

  if (!res.ok && !data.error) {
    data.error = `HTTP ${res.status}: ${method} ${path}`;
  }

  return data;
}
