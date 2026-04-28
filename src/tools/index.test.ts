import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

vi.mock("../notion.js", () => ({
  notionRequest: vi.fn(),
  safeHandler: (fn: unknown) => fn,
  jsonContent: (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  }),
  assertId: (value: string) => value.replace(/-/g, ""),
  paginateGet: vi.fn(),
  paginatePost: vi.fn(),
}));

import { registerTools } from "./index.js";

interface FakeRegisteredTool {
  schema: unknown;
  handler: unknown;
}

function createMockServer() {
  const _registeredTools: Record<string, FakeRegisteredTool> = {};
  const server = {
    _registeredTools,
    registerTool(name: string, schema: unknown, handler: unknown) {
      if (_registeredTools[name]) {
        throw new Error(`Tool ${name} is already registered`);
      }
      _registeredTools[name] = { schema, handler };
    },
  };
  return { server: server as unknown as McpServer, registry: _registeredTools };
}

describe("registerTools", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("registers every Notion tool on a fresh server", () => {
    const { server, registry } = createMockServer();

    registerTools(server);

    const names = Object.keys(registry).sort();
    // Snapshot the full expected toolset so any accidental drop fails loud.
    expect(names).toEqual(
      [
        "append_block_children",
        "create_comment",
        "create_database",
        "create_page",
        "delete_block",
        "get_all_block_children",
        "get_block",
        "get_block_children",
        "get_comments",
        "get_database",
        "get_me",
        "get_page",
        "get_page_property",
        "get_user",
        "list_databases",
        "list_users",
        "query_database",
        "query_database_all",
        "search_notion",
        "update_block",
        "update_database",
        "update_page",
      ].sort(),
    );
  });

  it("continues registering remaining groups when one registrar throws", () => {
    const { server, registry } = createMockServer();

    // Pre-register a name that databases.ts will try to claim, forcing
    // its registrar to throw on the second call. The other five groups
    // must still register fully.
    server.registerTool("list_databases", {}, () => ({}));

    expect(() => registerTools(server)).not.toThrow();

    // search, pages, blocks, comments, users tools should all be present
    expect(registry.search_notion).toBeDefined();
    expect(registry.create_page).toBeDefined();
    expect(registry.append_block_children).toBeDefined();
    expect(registry.create_comment).toBeDefined();
    expect(registry.get_me).toBeDefined();
  });
});
