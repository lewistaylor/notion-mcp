import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { register as registerSearchTools } from "./search.js";
import { register as registerPageTools } from "./pages.js";
import { register as registerDatabaseTools } from "./databases.js";
import { register as registerBlockTools } from "./blocks.js";
import { register as registerCommentTools } from "./comments.js";
import { register as registerUserTools } from "./users.js";

/** Registers all Notion MCP tools on the given server instance. */
export function registerTools(server: McpServer) {
  registerSearchTools(server);
  registerPageTools(server);
  registerDatabaseTools(server);
  registerBlockTools(server);
  registerCommentTools(server);
  registerUserTools(server);
}
