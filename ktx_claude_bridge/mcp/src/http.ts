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

/** How often a dropped connection is retried before we give up. */
const TRANSPORT_ATTEMPTS = Math.max(1, Number(process.env.FIVEM_BRIDGE_ATTEMPTS ?? 4));

/**
 * Did the connection die underneath us, or did the request genuinely fail?
 *
 * Only the first kind is worth repeating. A timeout we asked for ourselves and
 * a real HTTP status are answers, not accidents — repeating those would hide
 * problems instead of surviving them.
 */
function isTransportDrop(err: unknown): boolean {
  const e = err as { name?: string; message?: string; cause?: { code?: string } };

  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return false;

  const code = e?.cause?.code ?? '';
  if (code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'UND_ERR_SOCKET' || code === 'EPIPE') {
    return true;
  }

  return (e?.message ?? '').includes('fetch failed');
}

/**
 * One HTTP round-trip, repeating a dropped connection.
 *
 * FXServer on Enhanced throws fresh TCP connections away. Measured on b118 with
 * the server up for 13 hours: ten calls back to back land five times, ten calls
 * two seconds apart land ZERO times, ten calls over one kept-alive connection
 * land eight times. The same rate hits `/info.json`, which no resource owns —
 * so this is the platform, not this bridge.
 *
 * The counter-intuitive part is that spacing calls out makes it worse, not
 * better. Waiting is therefore exactly the wrong reflex; the fix is to try
 * again straight away. Four attempts turn a coin flip into a near-certainty.
 */
async function raw(method: 'GET' | 'POST', url: string, body?: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (config.token) {
    headers['Authorization'] = `Bearer ${config.token}`;
  }

  let last: unknown;

  for (let attempt = 1; attempt <= TRANSPORT_ATTEMPTS; attempt++) {
    try {
      return await fetch(url, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(config.timeout),
      });
    } catch (err) {
      last = err;

      if (!isTransportDrop(err) || attempt === TRANSPORT_ATTEMPTS) break;

      // KEINE Pause. Gemessen im degradierten Zustand, je sechs Durchgaenge:
      // ohne Pause 4/6, mit 20 ms 0/6, mit 50 ms 0/6, mit 400 ms 0/6. Warten
      // ist hier nicht die vorsichtige Variante, sondern die kaputte.
    }
  }

  throw last;
}

function parseOrThrow(text: string, what: string, status: number): BridgeResponse {
  try {
    return JSON.parse(text) as BridgeResponse;
  } catch {
    throw new Error(`Bridge returned non-JSON (${what}, status ${status}): ${text.slice(0, 200)}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function describe(err: unknown, method: string, path: string): Error {
  const msg = err instanceof Error ? err.message : String(err);

  if (msg.includes('abort') || msg.includes('timeout')) {
    return new Error(`Bridge request timed out after ${config.timeout}ms: ${method} ${path}`);
  }

  return new Error(
    `Bridge unreachable (${method} ${path}) after ${TRANSPORT_ATTEMPTS} attempts: ${msg}. ` +
      `The connection was dropped every time. Check whether the FiveM server runs with ` +
      `ktx_claude_bridge started — but verify before believing it: curl the endpoint directly, ` +
      `since the platform drops fresh connections on its own.`,
  );
}

/**
 * Upload a long payload in pieces.
 *
 * The payload rides in the URL, so a long Lua snippet blows past URL length
 * limits. We cut it into pieces, push them to /chunk, and let the real call
 * reference the upload by id.
 */
async function uploadChunks(payload: string): Promise<string> {
  const id = `up_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const size = config.chunkThreshold;
  const pieces: string[] = [];

  for (let i = 0; i < payload.length; i += size) {
    pieces.push(payload.slice(i, i + size));
  }

  for (let i = 0; i < pieces.length; i++) {
    const url =
      `${config.bridgeUrl}/chunk?id=${encodeURIComponent(id)}` +
      `&i=${i + 1}&n=${pieces.length}&d=${encodeURIComponent(pieces[i])}`;

    const res = await raw('GET', url);
    const data = parseOrThrow(await res.text(), `/chunk ${i + 1}/${pieces.length}`, res.status);

    if (data.error) {
      throw new Error(`Chunk upload failed at piece ${i + 1}/${pieces.length}: ${data.error}`);
    }
  }

  return id;
}

/**
 * Wait for a job to finish.
 *
 * FiveM closes a held-open HTTP response after a few seconds, which used to
 * kill every call that ran longer than that — the Lua kept running, only the
 * answer never arrived. Long work now returns a job id immediately and we poll
 * for the result, so runtime is decoupled from connection lifetime.
 */
async function awaitJob(jobId: string, path: string): Promise<BridgeResponse> {
  const deadline = Date.now() + config.jobTimeout;
  let delay = 120;

  while (Date.now() < deadline) {
    await sleep(delay);
    delay = Math.min(delay * 1.3, 1000);

    const res = await raw('GET', `${config.bridgeUrl}/job?id=${encodeURIComponent(jobId)}`);
    const text = await res.text();

    if (res.status === 404) {
      throw new Error(`Job ${jobId} vanished before it could be read (${path})`);
    }

    const data = parseOrThrow(text, `/job ${path}`, res.status);

    if (data.done === false) continue;

    return data;
  }

  throw new Error(
    `Job ${jobId} (${path}) did not finish within ${config.jobTimeout}ms. ` +
      `The client code may be blocking. Raise FIVEM_BRIDGE_JOB_TIMEOUT if this is expected.`,
  );
}

export async function request(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
): Promise<BridgeResponse> {
  const payload = body ? JSON.stringify(body) : undefined;

  // Plain GET routes, or real POST if the upstream bug is fixed: one round-trip.
  if (method === 'GET' || !USE_GET_FALLBACK) {
    let res: Response;

    try {
      res = await raw(method, `${config.bridgeUrl}${path}`, USE_GET_FALLBACK ? undefined : payload);
    } catch (err) {
      throw describe(err, method, path);
    }

    const data = parseOrThrow(await res.text(), `${method} ${path}`, res.status);

    if (!res.ok && !data.error) data.error = `HTTP ${res.status}: ${method} ${path}`;

    return data;
  }

  // POST route over the GET detour, run as a job.
  const encoded = encodeURIComponent(payload ?? '{}');
  let url: string;

  try {
    if (encoded.length > config.chunkThreshold) {
      const uploadId = await uploadChunks(payload ?? '{}');
      url = `${config.bridgeUrl}${path}?async=1&chunked=${encodeURIComponent(uploadId)}`;
    } else {
      url = `${config.bridgeUrl}${path}?async=1&body=${encoded}`;
    }
  } catch (err) {
    throw describe(err, method, path);
  }

  let started: BridgeResponse;

  try {
    const res = await raw('GET', url);
    started = parseOrThrow(await res.text(), `${method} ${path}`, res.status);
  } catch (err) {
    throw describe(err, method, path);
  }

  if (started.error) return started;

  const jobId = started.job as string | undefined;

  // Older bridge without job support: the answer is already here.
  if (!jobId) return started;

  return awaitJob(jobId, path);
}
