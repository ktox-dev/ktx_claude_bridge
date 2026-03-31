import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { cdp } from './cdp.js';

function text(content: string) {
  return { content: [{ type: 'text' as const, text: content }] };
}

function jsonText(data: unknown) {
  return text(JSON.stringify(data, null, 2));
}

export function registerCdpTools(server: McpServer) {
  // ── Frame discovery ──────────────────────────────────────

  server.registerTool(
    'nui_list_frames',
    {
      description:
        'List all loaded NUI resource frames in FiveM\'s CEF browser. Returns frame IDs, resource names, and URLs. Use this to discover which resources have active NUI pages before using other nui_ tools.',
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const frames = await cdp.getFrames();
        return jsonText({ success: true, frames, count: frames.length });
      } catch (err) {
        return jsonText({ success: false, error: (err as Error).message });
      }
    },
  );

  // ── JS execution ─────────────────────────────────────────

  server.registerTool(
    'nui_exec_js',
    {
      description:
        'Execute JavaScript in any resource\'s NUI frame via Chrome DevTools Protocol. Can target specific resources by name (e.g. "ox_inventory", "qbx_hud"). Code runs in an async context — use "return" for results. Supports await for Promises. Omit resourceName to run in the root NUI page.',
      inputSchema: z.object({
        code: z
          .string()
          .describe(
            'JavaScript code to execute. Runs inside async function — use "return" for results, "await" for promises.',
          ),
        resourceName: z
          .string()
          .optional()
          .describe('Target resource NUI frame (e.g. "ox_inventory"). Omit for root page.'),
        awaitPromise: z
          .boolean()
          .optional()
          .describe('Await if result is a Promise (default: true)'),
      }),
    },
    async ({ code, resourceName, awaitPromise }) => {
      try {
        const result = await cdp.evaluate(code, resourceName, awaitPromise ?? true);
        return jsonText({ success: true, result });
      } catch (err) {
        return jsonText({ success: false, error: (err as Error).message });
      }
    },
  );

  // ── DOM query ────────────────────────────────────────────

  server.registerTool(
    'nui_query_dom',
    {
      description:
        'Query DOM elements by CSS selector in any resource\'s NUI frame. Returns tag, id, classes, text content, bounding rect, visibility, and attributes for each match.',
      inputSchema: z.object({
        selector: z.string().describe('CSS selector (e.g. ".inventory-item", "#app", "button")'),
        resourceName: z
          .string()
          .optional()
          .describe('Target resource NUI frame'),
      }),
    },
    async ({ selector, resourceName }) => {
      try {
        const js = `
          const els = document.querySelectorAll(${JSON.stringify(selector)});
          return [...els].map(el => ({
            tag: el.tagName.toLowerCase(),
            id: el.id || undefined,
            classes: [...el.classList],
            text: el.textContent?.substring(0, 200)?.trim() || undefined,
            rect: el.getBoundingClientRect().toJSON(),
            visible: el.offsetParent !== null || el.tagName === 'BODY' || el.tagName === 'HTML',
            attrs: Object.fromEntries([...el.attributes].filter(a => a.name !== 'class' && a.name !== 'id').map(a => [a.name, a.value]))
          }));
        `;
        const result = await cdp.evaluate(js, resourceName);
        return jsonText({ success: true, elements: result });
      } catch (err) {
        return jsonText({ success: false, error: (err as Error).message });
      }
    },
  );

  // ── DOM tree ─────────────────────────────────────────────

  server.registerTool(
    'nui_get_dom_tree',
    {
      description:
        'Get a serialized DOM tree from any resource\'s NUI page. Returns nested structure of tags, ids, classes, and children. Useful for understanding a NUI page\'s structure.',
      inputSchema: z.object({
        selector: z
          .string()
          .optional()
          .describe('Root element CSS selector (default: "body")'),
        depth: z
          .coerce.number()
          .optional()
          .describe('Max depth to traverse (default: 4)'),
        resourceName: z
          .string()
          .optional()
          .describe('Target resource NUI frame'),
      }),
    },
    async ({ selector, depth, resourceName }) => {
      const sel = selector ?? 'body';
      const maxDepth = depth ?? 4;
      try {
        const js = `
          function walk(el, d, max) {
            if (!el || d > max) return null;
            const node = {
              tag: el.tagName?.toLowerCase(),
              id: el.id || undefined,
              classes: el.classList ? [...el.classList] : undefined,
            };
            if (el.children?.length === 0 && el.textContent?.trim()) {
              node.text = el.textContent.trim().substring(0, 100);
            }
            if (el.children?.length > 0 && d < max) {
              node.children = [...el.children].map(c => walk(c, d + 1, max)).filter(Boolean);
            }
            if (el.children?.length > 0 && d >= max) {
              node.childCount = el.children.length;
            }
            return node;
          }
          const root = document.querySelector(${JSON.stringify(sel)});
          if (!root) return { error: 'Element not found: ' + ${JSON.stringify(sel)} };
          return walk(root, 0, ${maxDepth});
        `;
        const result = await cdp.evaluate(js, resourceName);
        return jsonText({ success: true, tree: result });
      } catch (err) {
        return jsonText({ success: false, error: (err as Error).message });
      }
    },
  );

  // ── Click element ────────────────────────────────────────

  server.registerTool(
    'nui_click_element',
    {
      description:
        'Click a DOM element by CSS selector in any resource\'s NUI frame. This is the correct way to interact with NUI menus and buttons — do NOT use game controls (SetControlNormal) for NUI interaction. By default uses synthetic click (el.click()). Set synthetic=false to use CDP mouse events at the element\'s center coordinates.',
      inputSchema: z.object({
        selector: z.string().describe('CSS selector of element to click'),
        resourceName: z
          .string()
          .optional()
          .describe('Target resource NUI frame'),
        synthetic: z
          .boolean()
          .optional()
          .describe('Use synthetic el.click() (default: true). Set false for CDP mouse event.'),
      }),
    },
    async ({ selector, resourceName, synthetic }) => {
      try {
        if (synthetic !== false) {
          const js = `
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return { clicked: false, error: 'Element not found' };
            el.click();
            return { clicked: true, tag: el.tagName.toLowerCase(), id: el.id || undefined };
          `;
          const result = await cdp.evaluate(js, resourceName);
          return jsonText({ success: true, ...(result as object) });
        }

        // CDP mouse event approach — get element center coordinates
        const js = `
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, tag: el.tagName.toLowerCase() };
        `;
        const pos = (await cdp.evaluate(js, resourceName)) as {
          x: number;
          y: number;
          tag: string;
        } | null;
        if (!pos) {
          return jsonText({ success: false, error: 'Element not found' });
        }

        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: pos.x,
          y: pos.y,
          button: 'left',
          clickCount: 1,
        });
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: pos.x,
          y: pos.y,
          button: 'left',
          clickCount: 1,
        });

        return jsonText({ success: true, clicked: true, tag: pos.tag, x: pos.x, y: pos.y });
      } catch (err) {
        return jsonText({ success: false, error: (err as Error).message });
      }
    },
  );

  // ── Fill input ───────────────────────────────────────────

  server.registerTool(
    'nui_fill_input',
    {
      description:
        'Set the value of an input or textarea element in any resource\'s NUI frame and dispatch input/change events. Uses native property setter to work with React and other frameworks.',
      inputSchema: z.object({
        selector: z.string().describe('CSS selector of input/textarea element'),
        value: z.string().describe('Value to set'),
        resourceName: z
          .string()
          .optional()
          .describe('Target resource NUI frame'),
      }),
    },
    async ({ selector, value, resourceName }) => {
      try {
        const js = `
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return { filled: false, error: 'Element not found' };
          const nativeSetter =
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set ||
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
          if (nativeSetter) {
            nativeSetter.call(el, ${JSON.stringify(value)});
          } else {
            el.value = ${JSON.stringify(value)};
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { filled: true, tag: el.tagName.toLowerCase(), id: el.id || undefined };
        `;
        const result = await cdp.evaluate(js, resourceName);
        return jsonText({ success: true, ...(result as object) });
      } catch (err) {
        return jsonText({ success: false, error: (err as Error).message });
      }
    },
  );

  // ── Screenshot ───────────────────────────────────────────

  server.registerTool(
    'nui_screenshot',
    {
      description:
        'Take a screenshot of ONLY the NUI layer (transparent background, just UI elements like menus, HUD, notifications). Use this to inspect NUI menus after opening them with run_client_command or trigger_client_event. For full game view (world + UI composited), use take_screenshot instead.',
      inputSchema: z.object({
        format: z
          .enum(['png', 'jpeg'])
          .optional()
          .describe('Image format (default: png)'),
        quality: z
          .coerce.number()
          .optional()
          .describe('Compression quality 0-100 (jpeg only)'),
      }),
    },
    async ({ format, quality }) => {
      try {
        const fmt = format ?? 'png';
        const params: Record<string, unknown> = { format: fmt };
        if (quality !== undefined) params.quality = quality;

        const result = (await cdp.send('Page.captureScreenshot', params)) as {
          data: string;
        };
        const mimeMap = { png: 'image/png', jpeg: 'image/jpeg' } as const;
        return {
          content: [{ type: 'image' as const, data: result.data, mimeType: mimeMap[fmt] }],
        };
      } catch (err) {
        return jsonText({ success: false, error: (err as Error).message });
      }
    },
  );

  // ── Simulate click at coordinates ────────────────────────

  server.registerTool(
    'nui_simulate_click',
    {
      description:
        'Simulate a mouse click at absolute pixel coordinates in the NUI layer. Works on any visible NUI element from any resource. Use nui_screenshot to see NUI element positions, or take_screenshot to see the full game view. Prefer nui_click_element with a CSS selector when possible — use this only when you need coordinate-based clicking.',
      inputSchema: z.object({
        x: z.coerce.number().describe('X pixel coordinate'),
        y: z.coerce.number().describe('Y pixel coordinate'),
      }),
    },
    async ({ x, y }) => {
      try {
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x,
          y,
          button: 'left',
          clickCount: 1,
        });
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x,
          y,
          button: 'left',
          clickCount: 1,
        });
        return jsonText({ success: true, x, y });
      } catch (err) {
        return jsonText({ success: false, error: (err as Error).message });
      }
    },
  );
}
