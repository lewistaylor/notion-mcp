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
import { register } from "./pages.js";

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

describe("pages tools", () => {
  let handlers: Record<string, (args: Record<string, unknown>) => unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const mock = createMockServer();
    handlers = mock.handlers;
    register(mock.server);
  });

  describe("get_page", () => {
    it("sends GET /pages/{id} with stripped UUID", async () => {
      mockNotionRequest.mockResolvedValue({ id: TEST_ID, object: "page" });

      await handlers["get_page"]({ page_id: TEST_UUID });

      expect(mockNotionRequest).toHaveBeenCalledWith(`/pages/${TEST_ID}`);
    });

    it("also works with an unhyphenated ID", async () => {
      mockNotionRequest.mockResolvedValue({ id: TEST_ID });

      await handlers["get_page"]({ page_id: TEST_ID });

      expect(mockNotionRequest).toHaveBeenCalledWith(`/pages/${TEST_ID}`);
    });
  });

  describe("create_page", () => {
    it("sends POST /pages with parent and properties", async () => {
      mockNotionRequest.mockResolvedValue({ id: TEST_ID, object: "page" });

      const parent = { database_id: TEST_ID };
      const properties = {
        Name: { title: [{ text: { content: "My task" } }] },
      };

      await handlers["create_page"]({ parent, properties });

      expect(mockNotionRequest).toHaveBeenCalledWith("/pages", {
        method: "POST",
        body: { parent, properties },
      });
    });

    it("includes children, icon, and cover when provided", async () => {
      mockNotionRequest.mockResolvedValue({ id: TEST_ID });

      const parent = { page_id: TEST_ID };
      const properties = { title: [{ text: { content: "Notes" } }] };
      const children = [{ object: "block", type: "paragraph", paragraph: { rich_text: [] } }];
      const icon = { type: "emoji", emoji: "📝" };
      const cover = { type: "external", external: { url: "https://example.com/img.png" } };

      await handlers["create_page"]({ parent, properties, children, icon, cover });

      const callBody = mockNotionRequest.mock.calls[0][1].body;
      expect(callBody.children).toEqual(children);
      expect(callBody.icon).toEqual(icon);
      expect(callBody.cover).toEqual(cover);
    });
  });

  describe("update_page", () => {
    it("sends PATCH /pages/{id} with supplied fields only", async () => {
      mockNotionRequest.mockResolvedValue({ id: TEST_ID });

      await handlers["update_page"]({
        page_id: TEST_UUID,
        properties: { Status: { select: { name: "Done" } } },
      });

      expect(mockNotionRequest).toHaveBeenCalledWith(`/pages/${TEST_ID}`, {
        method: "PATCH",
        body: { properties: { Status: { select: { name: "Done" } } } },
      });
    });

    it("archives a page when archived: true", async () => {
      mockNotionRequest.mockResolvedValue({ id: TEST_ID, archived: true });

      await handlers["update_page"]({ page_id: TEST_UUID, archived: true });

      const callBody = mockNotionRequest.mock.calls[0][1].body;
      expect(callBody.archived).toBe(true);
    });

    it("includes icon and cover when provided", async () => {
      mockNotionRequest.mockResolvedValue({ id: TEST_ID });

      await handlers["update_page"]({
        page_id: TEST_UUID,
        icon: { type: "emoji", emoji: "✅" },
        cover: { type: "external", external: { url: "https://example.com/cover.png" } },
      });

      const callBody = mockNotionRequest.mock.calls[0][1].body;
      expect(callBody.icon).toEqual({ type: "emoji", emoji: "✅" });
      expect(callBody.cover).toBeDefined();
    });
  });

  describe("get_page_property", () => {
    it("sends GET /pages/{id}/properties/{propertyId}", async () => {
      mockNotionRequest.mockResolvedValue({ id: "title", type: "title" });

      await handlers["get_page_property"]({
        page_id: TEST_UUID,
        property_id: "title",
      });

      expect(mockNotionRequest).toHaveBeenCalledWith(
        `/pages/${TEST_ID}/properties/title`,
        { params: {} },
      );
    });

    it("passes page_size as a string param", async () => {
      mockNotionRequest.mockResolvedValue({ results: [] });

      await handlers["get_page_property"]({
        page_id: TEST_UUID,
        property_id: "Tags",
        page_size: 20,
      });

      const callParams = mockNotionRequest.mock.calls[0][1].params;
      expect(callParams.page_size).toBe("20");
    });
  });
});
