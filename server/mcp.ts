import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TOOLS, type ToolOut } from './tools';

/** Anything that can run a tool: the local board, or a proxy to a bridge that is already running. */
export interface Hub { call(name: string, args: unknown): Promise<ToolOut> }

export function buildMcp(hub: Hub): McpServer {
  const server = new McpServer({ name: 'axsquiggle', version: '0.1.0' }, {
    instructions:
      'axSquiggle is a wireframe/storyboard tool shared with a person. Workflow: draft_board with outline text (first draft). The person edits it and writes review notes in the app; ' +
      'they will tell you in chat when to look. Call get_review to fetch their notes and what they changed, action them with edit_frame / edit_element, then resolve_notes with a short reply per note. ' +
      'If they drop a photo of a sketch or a screenshot onto a frame, get_review returns it as an image: look at it and build the wireframe with the tools.',
  });
  for (const t of TOOLS) {
    server.registerTool(t.name, { description: t.description, inputSchema: t.shape }, async (args: Record<string, unknown>) => {
      try {
        const r = await hub.call(t.name, args);
        return { content: [
          { type: 'text' as const, text: r.text },
          ...r.images.flatMap((im) => [{ type: 'text' as const, text: im.label }, { type: 'image' as const, data: im.data, mimeType: im.mediaType }]),
        ] };
      }
      catch (e) { return { content: [{ type: 'text' as const, text: (e as Error).message }], isError: true }; }
    });
  }
  return server;
}
