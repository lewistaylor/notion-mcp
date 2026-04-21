import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { notionRequest, safeHandler, jsonContent } from "../notion.js";

export function register(server: McpServer) {
  server.registerTool(
    "search_notion",
    {
      description:
        "Search across all Notion content (pages and databases) that the integration has access to. " +
        "Returns matching pages and databases ranked by relevance. " +
        "Use filter_type to narrow results to only pages or only databases. " +
        "Example: search_notion({ query: 'project roadmap', filter_type: 'page', page_size: 20 })",
      inputSchema: {
        query: z
          .string()
          .describe(
            "The text to search for. Notion searches titles and content. Use an empty string to list all accessible content.",
          ),
        filter_type: z
          .enum(["page", "database"])
          .optional()
          .describe(
            'Restrict results to a single object type: "page" or "database". Omit to return both.',
          ),
        sort_direction: z
          .enum(["ascending", "descending"])
          .optional()
          .describe(
            'Sort direction for last_edited_time: "ascending" or "descending" (default "descending").',
          ),
        start_cursor: z
          .string()
          .optional()
          .describe(
            "Pagination cursor returned as next_cursor from a previous search response.",
          ),
        page_size: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Number of results to return (1–100, default 10)."),
      },
    },
    safeHandler(
      async ({ query, filter_type, sort_direction, start_cursor, page_size }) => {
        const body: Record<string, unknown> = { query };

        if (filter_type) {
          body.filter = { value: filter_type, property: "object" };
        }

        body.sort = {
          direction: sort_direction ?? "descending",
          timestamp: "last_edited_time",
        };

        if (start_cursor) body.start_cursor = start_cursor;
        if (page_size !== undefined) body.page_size = page_size;

        const results = await notionRequest("/search", {
          method: "POST",
          body,
        });
        return jsonContent(results);
      },
    ),
  );
}
