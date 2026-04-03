import { config } from './config.js';

interface BridgeResponse {
  success?: boolean;
  error?: string;
  [key: string]: unknown;
}

export async function request(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
): Promise<BridgeResponse> {
  const url = `${config.bridgeUrl}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (config.token) {
    headers['Authorization'] = `Bearer ${config.token}`;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
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
