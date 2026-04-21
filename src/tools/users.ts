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
    "list_users",
    {
      description:
        "List all users in the Notion workspace. Returns people and bots that have been granted " +
        "access to the workspace. Useful for resolving names to user IDs for filters and @mentions. " +
        "Example: list_users({ page_size: 50 })",
      inputSchema: {
        start_cursor: z
          .string()
          .optional()
          .describe("Pagination cursor from a previous list_users response."),
        page_size: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Number of users to return (1–100, default 100)."),
      },
    },
    safeHandler(async ({ start_cursor, page_size }) => {
      const params: Record<string, string> = {};
      if (start_cursor) params.start_cursor = start_cursor;
      if (page_size !== undefined) params.page_size = String(page_size);

      const users = await notionRequest("/users", { params });
      return jsonContent(users);
    }),
  );

  server.registerTool(
    "get_user",
    {
      description:
        "Retrieve a specific Notion user by their user ID. Returns the user's name, avatar, type " +
        "(person or bot), and email (if available). " +
        "Example: get_user({ user_id: 'abc...' })",
      inputSchema: {
        user_id: z
          .string()
          .describe("The user ID (UUID with or without hyphens)."),
      },
    },
    safeHandler(async ({ user_id }) => {
      const id = assertId(user_id, "user_id");
      const user = await notionRequest(`/users/${id}`);
      return jsonContent(user);
    }),
  );

  server.registerTool(
    "get_me",
    {
      description:
        "Retrieve the bot user associated with the current NOTION_TOKEN integration. " +
        "Returns the bot's name, owner (workspace or user), and workspace details. " +
        "Useful for identifying the integration's identity and workspace. " +
        "Example: get_me({})",
      inputSchema: {},
    },
    safeHandler(async () => {
      const me = await notionRequest("/users/me");
      return jsonContent(me);
    }),
  );
}
