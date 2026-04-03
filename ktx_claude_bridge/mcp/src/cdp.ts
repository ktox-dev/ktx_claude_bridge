import WebSocket from 'ws';
import { config } from './config.js';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface ExecutionContext {
  frameId: string;
  origin: string;
  auxData?: { frameId?: string; isDefault?: boolean; type?: string };
}

interface FrameInfo {
  frameId: string;
  name: string;
  url: string;
  resourceName?: string;
}

interface CDPResponse {
  id?: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
  method?: string;
  params?: Record<string, unknown>;
}

export class CDPClient {
  private ws: WebSocket | null = null;
  private msgId = 0;
  private pending = new Map<number, PendingRequest>();
  private contexts = new Map<number, ExecutionContext>();
  private connectPromise: Promise<void> | null = null;
  private port: number;
  private timeout: number;

  constructor(port?: number, timeout?: number) {
    this.port = port ?? config.cdpPort;
    this.timeout = timeout ?? config.timeout;
  }

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    // Discover target
    const res = await fetch(`http://127.0.0.1:${this.port}/json`);
    const targets = (await res.json()) as Array<{
      id: string;
      type: string;
      webSocketDebuggerUrl?: string;
    }>;
    const page = targets.find((t) => t.type === 'page');
    if (!page?.webSocketDebuggerUrl) {
      throw new Error('No CDP page target found');
    }

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(page.webSocketDebuggerUrl!);
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('CDP WebSocket connection timeout'));
      }, 5000);

      ws.on('open', () => {
        clearTimeout(timeout);
        this.ws = ws;
        this.setupHandlers();
        resolve();
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    // Enable runtime and page events for frame/context tracking
    await this.send('Runtime.enable');
    await this.send('Page.enable');
  }

  private setupHandlers(): void {
    if (!this.ws) return;

    this.ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as CDPResponse;

      // Response to a command
      if (msg.id !== undefined) {
        const req = this.pending.get(msg.id);
        if (req) {
          this.pending.delete(msg.id);
          clearTimeout(req.timer);
          if (msg.error) {
            req.reject(new Error(`CDP error: ${msg.error.message}`));
          } else {
            req.resolve(msg.result);
          }
        }
        return;
      }

      // Event
      if (msg.method === 'Runtime.executionContextCreated') {
        const ctx = msg.params?.context as {
          id: number;
          origin: string;
          auxData?: { frameId?: string; isDefault?: boolean; type?: string };
        };
        if (ctx) {
          this.contexts.set(ctx.id, {
            frameId: ctx.auxData?.frameId ?? '',
            origin: ctx.origin,
            auxData: ctx.auxData,
          });
        }
      } else if (msg.method === 'Runtime.executionContextDestroyed') {
        const id = msg.params?.executionContextId as number;
        if (id !== undefined) this.contexts.delete(id);
      } else if (msg.method === 'Runtime.executionContextsCleared') {
        this.contexts.clear();
      }
    });

    this.ws.on('close', () => {
      this.ws = null;
      this.connectPromise = null;
      // Reject all pending requests
      for (const [id, req] of this.pending) {
        clearTimeout(req.timer);
        req.reject(new Error('CDP connection closed'));
        this.pending.delete(id);
      }
      this.contexts.clear();
    });
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connectPromise = null;
  }

  async ensureConnected(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    if (!this.connectPromise) {
      this.connectPromise = this.connect().finally(() => {
        this.connectPromise = null;
      });
    }
    await this.connectPromise;
  }

  async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    await this.ensureConnected();
    if (!this.ws) throw new Error('CDP not connected');

    const id = ++this.msgId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timeout: ${method}`));
      }, this.timeout);

      this.pending.set(id, { resolve, reject, timer });
      this.ws!.send(JSON.stringify({ id, method, params }));
    });
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  async getFrames(): Promise<FrameInfo[]> {
    const result = (await this.send('Page.getFrameTree')) as {
      frameTree: { frame: { id: string; name: string; url: string }; childFrames?: unknown[] };
    };

    const frames: FrameInfo[] = [];
    const walk = (node: {
      frame: { id: string; name: string; url: string };
      childFrames?: unknown[];
    }) => {
      const { frame } = node;
      // FiveM NUI URLs: nui://resourceName/... or https://cfx-nui-resourceName/...
      const nuiMatch =
        frame.url.match(/^nui:\/\/([^/]+)\//) ||
        frame.url.match(/^https?:\/\/cfx-nui-([^/]+)\//);
      frames.push({
        frameId: frame.id,
        name: frame.name || (nuiMatch ? nuiMatch[1] : ''),
        url: frame.url,
        resourceName: nuiMatch ? nuiMatch[1] : undefined,
      });
      if (node.childFrames) {
        for (const child of node.childFrames as typeof node[]) {
          walk(child);
        }
      }
    };
    walk(result.frameTree);
    return frames;
  }

  async getContextForResource(resourceName?: string): Promise<number | undefined> {
    // If no resource specified, find the root context (the default one without nui:// or with the root URL)
    if (!resourceName) {
      // Find the default context for the main frame
      for (const [id, ctx] of this.contexts) {
        if (ctx.auxData?.isDefault && !ctx.origin.startsWith('nui://')) {
          return id;
        }
      }
      // Fallback: find any default context
      for (const [id, ctx] of this.contexts) {
        if (ctx.auxData?.isDefault) return id;
      }
      return undefined;
    }

    // Find context matching the resource name
    // FiveM uses both nui://resourceName and https://cfx-nui-resourceName
    const prefixes = [`nui://${resourceName}`, `https://cfx-nui-${resourceName}`];
    for (const [id, ctx] of this.contexts) {
      if (ctx.auxData?.isDefault && prefixes.some((p) => ctx.origin.startsWith(p))) {
        return id;
      }
    }

    // Contexts might not be populated yet — get frames and try to match
    const frames = await this.getFrames();
    const frame = frames.find((f) => f.resourceName === resourceName);
    if (!frame) return undefined;

    // Look for context by frameId
    for (const [id, ctx] of this.contexts) {
      if (ctx.frameId === frame.frameId && ctx.auxData?.isDefault) {
        return id;
      }
    }

    return undefined;
  }

  async evaluate(
    code: string,
    resourceName?: string,
    awaitPromise = true,
  ): Promise<unknown> {
    const contextId = await this.getContextForResource(resourceName);

    if (resourceName && contextId === undefined) {
      throw new Error(
        `No execution context found for resource "${resourceName}". ` +
        `The resource may not have a NUI page, may not be started, or its frame hasn't loaded yet. ` +
        `Use nui_list_frames to see available NUI resources.`
      );
    }

    const params: Record<string, unknown> = {
      expression: `(async () => { ${code} })()`,
      returnByValue: true,
      awaitPromise,
    };
    if (contextId !== undefined) {
      params.contextId = contextId;
    }

    const result = (await this.send('Runtime.evaluate', params)) as {
      result?: { type: string; value?: unknown; description?: string; subtype?: string };
      exceptionDetails?: { exception?: { description?: string }; text?: string };
    };

    if (result.exceptionDetails) {
      const desc =
        result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text ||
        'Unknown JS error';
      throw new Error(desc);
    }

    return result.result?.value;
  }
}

export const cdp = new CDPClient();
