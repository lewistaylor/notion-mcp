import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

vi.mock("../notion.js", () => ({
  notionRequest: vi.fn(),
  safeHandler: (fn: (args: Record<string, unknown>) => unknown) => fn,
  jsonContent: (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  }),
  assertId: (value: string, _name: string) => value.replace(/-/g, ""),
}));

import { notionRequest } from "../notion.js";
import { register } from "./search.js";

const mockNotionRequest = notionRequest as ReturnType<typeof vi.fn>;

function createMockServer() {
  const handlers: Record<string, (args: Record<string, unknown>) => unknown> =
    {};
  const server = {
    registerTool: (
      name: string,
      _schema: unknown,
      handler: (args: Record<string, unknown>) => unknown,
    ) => {
      handlers[name] = handler;
    },
  };
  return { server: server as unknown as McpServer, handlers };
}

describe("search tools", () => {
  let handlers: Record<string, (args: Record<string, unknown>) => unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const mock = createMockServer();
    handlers = mock.handlers;
    register(mock.server);
  });

  describe("search_notion", () => {
    it("sends POST /search with query and default sort", async () => {
      mockNotionRequest.mockResolvedValue({ results: [], has_more: false });

      await handlers["search_notion"]({ query: "my project" });

      expect(mockNotionRequest).toHaveBeenCalledWith("/search", {
        method: "POST",
        body: {
          query: "my project",
          sort: { direction: "descending", timestamp: "last_edited_time" },
        },
      });
    });

    it("applies filter_type when provided", async () => {
      mockNotionRequest.mockResolvedValue({ results: [], has_more: false });

      await handlers["search_notion"]({ query: "tasks", filter_type: "database" });

      const callBody = mockNotionRequest.mock.calls[0][1].body;
      expect(callBody.filter).toEqual({ value: "database", property: "object" });
    });

    it("applies page filter type", async () => {
      mockNotionRequest.mockResolvedValue({ results: [], has_more: false });

      await handlers["search_notion"]({ query: "notes", filter_type: "page" });

      const callBody = mockNotionRequest.mock.calls[0][1].body;
      expect(callBody.filter).toEqual({ value: "page", property: "object" });
    });

    it("passes page_size and start_cursor when provided", async () => {
      mockNotionRequest.mockResolvedValue({ results: [], has_more: false, next_cursor: null });

      await handlers["search_notion"]({
        query: "test",
        page_size: 25,
        start_cursor: "cursor-xyz",
      });

      const callBody = mockNotionRequest.mock.calls[0][1].body;
      expect(callBody.page_size).toBe(25);
      expect(callBody.start_cursor).toBe("cursor-xyz");
    });

    it("uses sort_direction when provided", async () => {
      mockNotionRequest.mockResolvedValue({ results: [], has_more: false });

      await handlers["search_notion"]({
        query: "old docs",
        sort_direction: "ascending",
      });

      const callBody = mockNotionRequest.mock.calls[0][1].body;
      expect(callBody.sort).toEqual({
        direction: "ascending",
        timestamp: "last_edited_time",
      });
    });

    it("returns the API response via jsonContent", async () => {
      const fakeResponse = { results: [{ id: "page1" }], has_more: false };
      mockNotionRequest.mockResolvedValue(fakeResponse);

      const result = await handlers["search_notion"]({ query: "hello" });

      expect((result as { content: Array<{ text: string }> }).content[0].text).toBe(
        JSON.stringify(fakeResponse),
      );
    });
  });
});
