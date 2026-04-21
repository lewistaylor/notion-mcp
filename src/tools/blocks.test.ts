import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

vi.mock("../notion.js", () => ({
  notionRequest: vi.fn(),
  paginateGet: vi.fn(),
  safeHandler: (fn: (args: Record<string, unknown>) => unknown) => fn,
  jsonContent: (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  }),
  assertId: (value: string, _name: string) => value.replace(/-/g, ""),
}));

import { notionRequest, paginateGet } from "../notion.js";

const mockPaginateGet = paginateGet as ReturnType<typeof vi.fn>;
import { register } from "./blocks.js";

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

describe("blocks tools", () => {
  let handlers: Record<string, (args: Record<string, unknown>) => unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const mock = createMockServer();
    handlers = mock.handlers;
    register(mock.server);
  });

  describe("get_block", () => {
    it("sends GET /blocks/{id}", async () => {
      mockNotionRequest.mockResolvedValue({ id: TEST_ID, type: "paragraph" });

      await handlers["get_block"]({ block_id: TEST_UUID });

      expect(mockNotionRequest).toHaveBeenCalledWith(`/blocks/${TEST_ID}`);
    });
  });

  describe("update_block", () => {
    it("sends PATCH /blocks/{id} with paragraph content", async () => {
      mockNotionRequest.mockResolvedValue({ id: TEST_ID });

      const paragraph = { rich_text: [{ text: { content: "Updated text" } }] };
      await handlers["update_block"]({ block_id: TEST_UUID, paragraph });

      expect(mockNotionRequest).toHaveBeenCalledWith(`/blocks/${TEST_ID}`, {
        method: "PATCH",
        body: { paragraph },
      });
    });

    it("sends archived: true to archive the block", async () => {
      mockNotionRequest.mockResolvedValue({ id: TEST_ID, archived: true });

      await handlers["update_block"]({ block_id: TEST_UUID, archived: true });

      const callBody = mockNotionRequest.mock.calls[0][1].body;
      expect(callBody.archived).toBe(true);
    });

    it("includes multiple block-type fields when provided", async () => {
      mockNotionRequest.mockResolvedValue({ id: TEST_ID });

      await handlers["update_block"]({
        block_id: TEST_UUID,
        to_do: { rich_text: [{ text: { content: "Buy milk" } }], checked: true },
      });

      const callBody = mockNotionRequest.mock.calls[0][1].body;
      expect(callBody.to_do).toEqual({
        rich_text: [{ text: { content: "Buy milk" } }],
        checked: true,
      });
    });
  });

  describe("delete_block", () => {
    it("sends DELETE /blocks/{id}", async () => {
      mockNotionRequest.mockResolvedValue(null);

      await handlers["delete_block"]({ block_id: TEST_UUID });

      expect(mockNotionRequest).toHaveBeenCalledWith(`/blocks/${TEST_ID}`, {
        method: "DELETE",
      });
    });

    it("returns { deleted: true } when API returns null (204)", async () => {
      mockNotionRequest.mockResolvedValue(null);

      const result = await handlers["delete_block"]({ block_id: TEST_UUID });

      expect(
        (result as { content: Array<{ text: string }> }).content[0].text,
      ).toBe(JSON.stringify({ deleted: true }));
    });
  });

  describe("get_block_children", () => {
    it("sends GET /blocks/{id}/children with no params by default", async () => {
      mockNotionRequest.mockResolvedValue({ results: [], has_more: false });

      await handlers["get_block_children"]({ block_id: TEST_UUID });

      expect(mockNotionRequest).toHaveBeenCalledWith(
        `/blocks/${TEST_ID}/children`,
        { params: {} },
      );
    });

    it("passes page_size and start_cursor as string params", async () => {
      mockNotionRequest.mockResolvedValue({ results: [] });

      await handlers["get_block_children"]({
        block_id: TEST_UUID,
        page_size: 50,
        start_cursor: "cur123",
      });

      const callParams = mockNotionRequest.mock.calls[0][1].params;
      expect(callParams.page_size).toBe("50");
      expect(callParams.start_cursor).toBe("cur123");
    });
  });

  describe("append_block_children", () => {
    it("sends PATCH /blocks/{id}/children with children array", async () => {
      mockNotionRequest.mockResolvedValue({ results: [] });

      const children = [
        {
          object: "block",
          type: "paragraph",
          paragraph: { rich_text: [{ text: { content: "Hello" } }] },
        },
      ];

      await handlers["append_block_children"]({
        block_id: TEST_UUID,
        children,
      });

      expect(mockNotionRequest).toHaveBeenCalledWith(
        `/blocks/${TEST_ID}/children`,
        { method: "PATCH", body: { children } },
      );
    });

    it("includes after when provided", async () => {
      mockNotionRequest.mockResolvedValue({ results: [] });

      const children = [{ object: "block", type: "divider", divider: {} }];
      const AFTER_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

      await handlers["append_block_children"]({
        block_id: TEST_UUID,
        children,
        after: AFTER_UUID,
      });

      const callBody = mockNotionRequest.mock.calls[0][1].body;
      expect(callBody.after).toBe(AFTER_UUID);
    });
  });

  describe("update_block — extended block types", () => {
    it("sends image block content", async () => {
      mockNotionRequest.mockResolvedValue({ id: TEST_ID });

      const image = { type: "external", external: { url: "https://example.com/img.png" } };
      await handlers["update_block"]({ block_id: TEST_UUID, image });

      const callBody = mockNotionRequest.mock.calls[0][1].body;
      expect(callBody.image).toEqual(image);
    });

    it("sends equation block content", async () => {
      mockNotionRequest.mockResolvedValue({ id: TEST_ID });

      const equation = { expression: "E = mc^2" };
      await handlers["update_block"]({ block_id: TEST_UUID, equation });

      const callBody = mockNotionRequest.mock.calls[0][1].body;
      expect(callBody.equation).toEqual(equation);
    });

    it("sends divider block with empty object", async () => {
      mockNotionRequest.mockResolvedValue({ id: TEST_ID });

      await handlers["update_block"]({ block_id: TEST_UUID, divider: {} });

      const callBody = mockNotionRequest.mock.calls[0][1].body;
      expect(callBody.divider).toEqual({});
    });

    it("sends table_row block content", async () => {
      mockNotionRequest.mockResolvedValue({ id: TEST_ID });

      const table_row = { cells: [[{ text: { content: "Cell 1" } }]] };
      await handlers["update_block"]({ block_id: TEST_UUID, table_row });

      const callBody = mockNotionRequest.mock.calls[0][1].body;
      expect(callBody.table_row).toEqual(table_row);
    });
  });

  describe("get_all_block_children", () => {
    it("calls paginateGet with the correct path", async () => {
      mockPaginateGet.mockResolvedValue([
        { id: "block-1", type: "paragraph" },
        { id: "block-2", type: "heading_1" },
      ]);

      const result = await handlers["get_all_block_children"]({
        block_id: TEST_UUID,
      });

      expect(mockPaginateGet).toHaveBeenCalledWith(`/blocks/${TEST_ID}/children`);
      const parsed = JSON.parse(
        (result as { content: Array<{ text: string }> }).content[0].text,
      );
      expect(parsed.total).toBe(2);
      expect(parsed.results).toHaveLength(2);
    });

    it("returns total count alongside results", async () => {
      mockPaginateGet.mockResolvedValue(Array.from({ length: 5 }, (_, i) => ({ id: `b${i}` })));

      const result = await handlers["get_all_block_children"]({
        block_id: TEST_UUID,
      });

      const parsed = JSON.parse(
        (result as { content: Array<{ text: string }> }).content[0].text,
      );
      expect(parsed.total).toBe(5);
    });
  });
});
