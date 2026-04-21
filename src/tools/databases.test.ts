import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

vi.mock("../notion.js", () => ({
  notionRequest: vi.fn(),
  paginatePost: vi.fn(),
  safeHandler: (fn: (args: Record<string, unknown>) => unknown) => fn,
  jsonContent: (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  }),
  assertId: (value: string, _name: string) => value.replace(/-/g, ""),
}));

import { notionRequest, paginatePost } from "../notion.js";
import { register } from "./databases.js";

const mockPaginatePost = paginatePost as ReturnType<typeof vi.fn>;

const mockNotionRequest = notionRequest as ReturnType<typeof vi.fn>;

const TEST_UUID = "12345678-1234-1234-1234-123456789abc";
const TEST_ID = "12345678123412341234123456789abc";

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

describe("databases tools", () => {
  let handlers: Record<string, (args: Record<string, unknown>) => unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const mock = createMockServer();
    handlers = mock.handlers;
    register(mock.server);
  });

  describe("list_databases", () => {
    it("sends POST /search with database filter", async () => {
      mockNotionRequest.mockResolvedValue({ results: [], has_more: false });

      await handlers["list_databases"]({});

      expect(mockNotionRequest).toHaveBeenCalledWith("/search", {
        method: "POST",
        body: {
          filter: { value: "database", property: "object" },
          sort: { direction: "descending", timestamp: "last_edited_time" },
        },
      });
    });

    it("passes pagination params when provided", async () => {
      mockNotionRequest.mockResolvedValue({ results: [], has_more: false });

      await handlers["list_databases"]({
        page_size: 20,
        start_cursor: "cursor-abc",
      });

      const callBody = mockNotionRequest.mock.calls[0][1].body;
      expect(callBody.page_size).toBe(20);
      expect(callBody.start_cursor).toBe("cursor-abc");
    });
  });

  describe("get_database", () => {
    it("sends GET /databases/{id}", async () => {
      mockNotionRequest.mockResolvedValue({ id: TEST_ID, object: "database" });

      await handlers["get_database"]({ database_id: TEST_UUID });

      expect(mockNotionRequest).toHaveBeenCalledWith(`/databases/${TEST_ID}`);
    });
  });

  describe("query_database", () => {
    it("sends POST /databases/{id}/query with no optional fields", async () => {
      mockNotionRequest.mockResolvedValue({ results: [], has_more: false });

      await handlers["query_database"]({ database_id: TEST_UUID });

      expect(mockNotionRequest).toHaveBeenCalledWith(
        `/databases/${TEST_ID}/query`,
        { method: "POST", body: {} },
      );
    });

    it("includes filter and sorts in the body", async () => {
      mockNotionRequest.mockResolvedValue({ results: [] });

      const filter = { property: "Status", select: { equals: "In progress" } };
      const sorts = [{ property: "Due", direction: "ascending" }];

      await handlers["query_database"]({ database_id: TEST_UUID, filter, sorts });

      const callBody = mockNotionRequest.mock.calls[0][1].body;
      expect(callBody.filter).toEqual(filter);
      expect(callBody.sorts).toEqual(sorts);
    });

    it("includes page_size and start_cursor", async () => {
      mockNotionRequest.mockResolvedValue({ results: [] });

      await handlers["query_database"]({
        database_id: TEST_UUID,
        page_size: 50,
        start_cursor: "next-cursor",
      });

      const callBody = mockNotionRequest.mock.calls[0][1].body;
      expect(callBody.page_size).toBe(50);
      expect(callBody.start_cursor).toBe("next-cursor");
    });

    it("passes compound and-filter correctly", async () => {
      mockNotionRequest.mockResolvedValue({ results: [] });

      const filter = {
        and: [
          { property: "Assignee", people: { contains: "user-id" } },
          { property: "Due", date: { before: "2025-12-31" } },
        ],
      };

      await handlers["query_database"]({ database_id: TEST_UUID, filter });

      const callBody = mockNotionRequest.mock.calls[0][1].body;
      expect(callBody.filter).toEqual(filter);
    });
  });

  describe("create_database", () => {
    it("sends POST /databases with parent, title, and properties", async () => {
      mockNotionRequest.mockResolvedValue({ id: TEST_ID, object: "database" });

      const parent = { page_id: TEST_ID };
      const title = [{ text: { content: "My Tasks" } }];
      const properties = {
        Name: { title: {} },
        Status: { select: { options: [{ name: "Todo" }] } },
      };

      await handlers["create_database"]({ parent, title, properties });

      expect(mockNotionRequest).toHaveBeenCalledWith("/databases", {
        method: "POST",
        body: { parent, title, properties },
      });
    });

    it("includes icon when provided", async () => {
      mockNotionRequest.mockResolvedValue({ id: TEST_ID });

      await handlers["create_database"]({
        parent: { page_id: TEST_ID },
        title: [{ text: { content: "DB" } }],
        properties: { Name: { title: {} } },
        icon: { type: "emoji", emoji: "📋" },
      });

      const callBody = mockNotionRequest.mock.calls[0][1].body;
      expect(callBody.icon).toEqual({ type: "emoji", emoji: "📋" });
    });
  });

  describe("update_database", () => {
    it("sends PATCH /databases/{id} with only supplied fields", async () => {
      mockNotionRequest.mockResolvedValue({ id: TEST_ID });

      await handlers["update_database"]({
        database_id: TEST_UUID,
        title: [{ text: { content: "Renamed DB" } }],
      });

      expect(mockNotionRequest).toHaveBeenCalledWith(`/databases/${TEST_ID}`, {
        method: "PATCH",
        body: { title: [{ text: { content: "Renamed DB" } }] },
      });
    });

    it("includes properties schema changes", async () => {
      mockNotionRequest.mockResolvedValue({ id: TEST_ID });

      const properties = {
        Priority: {
          select: {
            options: [
              { name: "High", color: "red" },
              { name: "Low", color: "blue" },
            ],
          },
        },
      };

      await handlers["update_database"]({ database_id: TEST_UUID, properties });

      const callBody = mockNotionRequest.mock.calls[0][1].body;
      expect(callBody.properties).toEqual(properties);
    });
  });

  describe("query_database_all", () => {
    it("calls paginatePost with the correct path and empty body when no filter/sorts", async () => {
      mockPaginatePost.mockResolvedValue([{ id: "row-1" }, { id: "row-2" }]);

      const result = await handlers["query_database_all"]({
        database_id: TEST_UUID,
      });

      expect(mockPaginatePost).toHaveBeenCalledWith(
        `/databases/${TEST_ID}/query`,
        {},
      );
      const text = (result as { content: Array<{ text: string }> }).content[0].text;
      expect(JSON.parse(text).total).toBe(2);
    });

    it("includes filter in the body passed to paginatePost", async () => {
      mockPaginatePost.mockResolvedValue([]);

      const filter = { property: "Status", select: { equals: "Done" } };
      await handlers["query_database_all"]({ database_id: TEST_UUID, filter });

      expect(mockPaginatePost).toHaveBeenCalledWith(
        `/databases/${TEST_ID}/query`,
        { filter },
      );
    });

    it("includes sorts in the body passed to paginatePost", async () => {
      mockPaginatePost.mockResolvedValue([{ id: "r1" }]);

      const sorts = [{ property: "Due", direction: "ascending" }];
      await handlers["query_database_all"]({ database_id: TEST_UUID, sorts });

      const [, body] = mockPaginatePost.mock.calls[0];
      expect(body.sorts).toEqual(sorts);
    });

    it("returns total count alongside results", async () => {
      mockPaginatePost.mockResolvedValue([{ id: "a" }, { id: "b" }, { id: "c" }]);

      const result = await handlers["query_database_all"]({
        database_id: TEST_UUID,
      });

      const parsed = JSON.parse(
        (result as { content: Array<{ text: string }> }).content[0].text,
      );
      expect(parsed.total).toBe(3);
      expect(parsed.results).toHaveLength(3);
    });
  });
});
