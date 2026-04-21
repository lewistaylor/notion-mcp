import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  notionRequest,
  safeHandler,
  jsonContent,
  assertId,
} from "../notion.js";

export function register(server: McpServer) {
  server.registerTool(
    "get_block",
    {
      description:
        "Retrieve a single Notion block by its ID. Returns the block type and its content. " +
        "Block IDs are the same as page IDs for the root block of a page. " +
        "Example: get_block({ block_id: 'abc...' })",
      inputSchema: {
        block_id: z
          .string()
          .describe("The block ID (UUID with or without hyphens)."),
      },
    },
    safeHandler(async ({ block_id }) => {
      const id = assertId(block_id, "block_id");
      const block = await notionRequest(`/blocks/${id}`);
      return jsonContent(block);
    }),
  );

  server.registerTool(
    "update_block",
    {
      description:
        "Update a Notion block's content or archive it. " +
        "The update body must match the block's type. For example, to update a paragraph: " +
        "update_block({ block_id: 'abc...', paragraph: { rich_text: [{ text: { content: 'New text' } }] } }). " +
        "To archive a block: update_block({ block_id: 'abc...', archived: true }). " +
        "Supported block types: paragraph, heading_1, heading_2, heading_3, bulleted_list_item, " +
        "numbered_list_item, to_do, toggle, code, quote, callout, embed, image, video, file, pdf, " +
        "bookmark, divider, table_of_contents.",
      inputSchema: {
        block_id: z
          .string()
          .describe("The block ID (UUID with or without hyphens)."),
        archived: z
          .boolean()
          .optional()
          .describe("Set true to archive (soft-delete) the block."),
        paragraph: z.record(z.unknown()).optional().describe("Paragraph block content."),
        heading_1: z.record(z.unknown()).optional().describe("Heading 1 block content."),
        heading_2: z.record(z.unknown()).optional().describe("Heading 2 block content."),
        heading_3: z.record(z.unknown()).optional().describe("Heading 3 block content."),
        bulleted_list_item: z.record(z.unknown()).optional().describe("Bulleted list item content."),
        numbered_list_item: z.record(z.unknown()).optional().describe("Numbered list item content."),
        to_do: z.record(z.unknown()).optional().describe("To-do block content (supports checked field)."),
        toggle: z.record(z.unknown()).optional().describe("Toggle block content."),
        code: z.record(z.unknown()).optional().describe("Code block content (supports language field)."),
        quote: z.record(z.unknown()).optional().describe("Quote block content."),
        callout: z.record(z.unknown()).optional().describe("Callout block content."),
        bookmark: z.record(z.unknown()).optional().describe("Bookmark block content."),
        embed: z.record(z.unknown()).optional().describe("Embed block content."),
      },
    },
    safeHandler(async ({ block_id, archived, ...blockContent }) => {
      const id = assertId(block_id, "block_id");
      const body: Record<string, unknown> = {};
      if (archived !== undefined) body.archived = archived;
      // Merge any block-type-specific fields into the body
      for (const [key, value] of Object.entries(blockContent)) {
        if (value !== undefined) body[key] = value;
      }

      const block = await notionRequest(`/blocks/${id}`, {
        method: "PATCH",
        body,
      });
      return jsonContent(block);
    }),
  );

  server.registerTool(
    "delete_block",
    {
      description:
        "Delete (archive) a Notion block by its ID. This is a soft delete — the block is archived " +
        "and no longer visible but can be recovered via the Notion UI. " +
        "Example: delete_block({ block_id: 'abc...' })",
      inputSchema: {
        block_id: z
          .string()
          .describe("The block ID (UUID with or without hyphens)."),
      },
    },
    safeHandler(async ({ block_id }) => {
      const id = assertId(block_id, "block_id");
      const result = await notionRequest(`/blocks/${id}`, {
        method: "DELETE",
      });
      return jsonContent(result ?? { deleted: true });
    }),
  );

  server.registerTool(
    "get_block_children",
    {
      description:
        "Retrieve the immediate children of a Notion block (or page). " +
        "For a full page body, pass the page ID as block_id. " +
        "Results are paginated — use next_cursor + start_cursor to fetch subsequent pages. " +
        "Example: get_block_children({ block_id: 'abc...', page_size: 50 })",
      inputSchema: {
        block_id: z
          .string()
          .describe(
            "The block or page ID whose children to retrieve (UUID with or without hyphens).",
          ),
        start_cursor: z
          .string()
          .optional()
          .describe("Pagination cursor from a previous get_block_children response."),
        page_size: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Number of children to return (1–100, default 100)."),
      },
    },
    safeHandler(async ({ block_id, start_cursor, page_size }) => {
      const id = assertId(block_id, "block_id");
      const params: Record<string, string> = {};
      if (start_cursor) params.start_cursor = start_cursor;
      if (page_size !== undefined) params.page_size = String(page_size);

      const children = await notionRequest(`/blocks/${id}/children`, {
        params,
      });
      return jsonContent(children);
    }),
  );

  server.registerTool(
    "append_block_children",
    {
      description:
        "Append new child blocks to an existing Notion block or page. " +
        "Children are appended after any existing content. " +
        "Each child must be a valid Notion block object with a type field. " +
        "Example: append_block_children({ block_id: 'abc...', children: [ " +
        '{ object: "block", type: "paragraph", paragraph: { rich_text: [{ text: { content: "Hello world" } }] } }, ' +
        '{ object: "block", type: "to_do", to_do: { rich_text: [{ text: { content: "Buy milk" } }], checked: false } } ' +
        "] })",
      inputSchema: {
        block_id: z
          .string()
          .describe(
            "The parent block or page ID to append children to (UUID with or without hyphens).",
          ),
        children: z
          .array(z.record(z.unknown()))
          .describe(
            "Array of block objects to append. Each must have a type field and corresponding " +
            "type-specific content (e.g. paragraph, heading_1, to_do, bulleted_list_item, etc.).",
          ),
        after: z
          .string()
          .optional()
          .describe(
            "Block ID after which to insert the children. If omitted, children are appended at the end.",
          ),
      },
    },
    safeHandler(async ({ block_id, children, after }) => {
      const id = assertId(block_id, "block_id");
      const body: Record<string, unknown> = { children };
      if (after) body.after = after;

      const result = await notionRequest(`/blocks/${id}/children`, {
        method: "PATCH",
        body,
      });
      return jsonContent(result);
    }),
  );
}
