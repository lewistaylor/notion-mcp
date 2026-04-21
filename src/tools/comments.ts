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
    "create_comment",
    {
      description:
        "Create a comment on a Notion page or as a reply to an existing discussion. " +
        "To comment on a page top level, supply parent with page_id. " +
        "To reply to an existing discussion thread, supply discussion_id instead. " +
        "Example (new page comment): create_comment({ parent: { page_id: 'abc...' }, " +
        "rich_text: [{ text: { content: 'Great work!' } }] }). " +
        "Example (reply): create_comment({ discussion_id: 'def...', " +
        "rich_text: [{ text: { content: 'Agreed!' } }] })",
      inputSchema: {
        parent: z
          .object({ page_id: z.string() })
          .optional()
          .describe(
            "Parent page reference for a top-level comment. " +
            "Provide either parent or discussion_id, not both.",
          ),
        discussion_id: z
          .string()
          .optional()
          .describe(
            "ID of an existing discussion thread to reply to. " +
            "Provide either discussion_id or parent, not both.",
          ),
        rich_text: z
          .array(z.record(z.unknown()))
          .describe(
            'Comment body as a rich text array. E.g. [{ text: { content: "My comment" } }]. ' +
            "Supports bold, italic, inline code, links, and @mentions.",
          ),
      },
    },
    safeHandler(async ({ parent, discussion_id, rich_text }) => {
      const body: Record<string, unknown> = { rich_text };

      if (parent) {
        const pageId = assertId(parent.page_id, "parent.page_id");
        body.parent = { page_id: pageId };
      } else if (discussion_id) {
        body.discussion_id = assertId(discussion_id, "discussion_id");
      } else {
        throw new Error("Either parent.page_id or discussion_id is required.");
      }

      const comment = await notionRequest("/comments", {
        method: "POST",
        body,
      });
      return jsonContent(comment);
    }),
  );

  server.registerTool(
    "get_comments",
    {
      description:
        "Retrieve all comments on a Notion block or page. " +
        "Returns a paginated list of comment objects including author, timestamp, and rich_text body. " +
        "Example: get_comments({ block_id: 'abc...' }). " +
        "The Notion API does not support filtering by author or date — retrieve all and filter client-side.",
      inputSchema: {
        block_id: z
          .string()
          .describe(
            "The block or page ID to retrieve comments for (UUID with or without hyphens).",
          ),
        start_cursor: z
          .string()
          .optional()
          .describe("Pagination cursor from a previous get_comments response."),
        page_size: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Number of comments to return (1–100, default 100)."),
      },
    },
    safeHandler(async ({ block_id, start_cursor, page_size }) => {
      const id = assertId(block_id, "block_id");
      const params: Record<string, string> = { block_id: id };
      if (start_cursor) params.start_cursor = start_cursor;
      if (page_size !== undefined) params.page_size = String(page_size);

      const comments = await notionRequest("/comments", { params });
      return jsonContent(comments);
    }),
  );
}
