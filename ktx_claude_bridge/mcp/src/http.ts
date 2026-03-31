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

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(config.timeout),
  });

  const text = await res.text();

  let data: BridgeResponse;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Bridge returned non-JSON (status ${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok && !data.error) {
    data.error = `HTTP ${res.status}`;
  }

  return data;
}
