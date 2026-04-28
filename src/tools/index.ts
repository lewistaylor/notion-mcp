import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { register as registerSearchTools } from "./search.js";
import { register as registerPageTools } from "./pages.js";
import { register as registerDatabaseTools } from "./databases.js";
import { register as registerBlockTools } from "./blocks.js";
import { register as registerCommentTools } from "./comments.js";
import { register as registerUserTools } from "./users.js";
import { log } from "../logger.js";

type Registrar = (server: McpServer) => void;

const REGISTRARS: ReadonlyArray<readonly [string, Registrar]> = [
  ["search", registerSearchTools],
  ["pages", registerPageTools],
  ["databases", registerDatabaseTools],
  ["blocks", registerBlockTools],
  ["comments", registerCommentTools],
  ["users", registerUserTools],
];

/**
 * Registers all Notion MCP tools on the given server instance.
 *
 * Each registrar runs in isolation: a throw in one tool file (malformed
 * schema, duplicate name, etc.) is logged and skipped rather than
 * aborting the rest of the chain. This prevents the failure mode where
 * one bad schema silently drops every tool registered after it, leaving
 * the client with a partial toolset and no diagnostic.
 */
export function registerTools(server: McpServer) {
  for (const [name, fn] of REGISTRARS) {
    try {
      fn(server);
      log.debug("tool group registered", { group: name });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("tool group registration failed", {
        group: name,
        error: message,
        ...(err instanceof Error && err.stack ? { stack: err.stack } : {}),
      });
    }
  }

  const registered = Object.keys(
    (server as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools ?? {},
  );
  log.info("tool registration complete", {
    count: registered.length,
    tools: registered.sort(),
  });
}
