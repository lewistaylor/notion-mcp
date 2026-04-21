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
import { register } from "./comments.js";

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

describe("comments tools", () => {
  let handlers: Record<string, (args: Record<string, unknown>) => unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const mock = createMockServer();
    handlers = mock.handlers;
    register(mock.server);
  });

  describe("create_comment", () => {
    it("sends POST /comments with parent page_id", async () => {
      mockNotionRequest.mockResolvedValue({ id: "comment-1", object: "comment" });

      const rich_text = [{ text: { content: "Great work!" } }];

      await handlers["create_comment"]({
        parent: { page_id: TEST_UUID },
        rich_text,
      });

      expect(mockNotionRequest).toHaveBeenCalledWith("/comments", {
        method: "POST",
        body: {
          parent: { page_id: TEST_ID },
          rich_text,
        },
      });
    });

    it("sends POST /comments with discussion_id for replies", async () => {
      mockNotionRequest.mockResolvedValue({ id: "comment-2" });

      const rich_text = [{ text: { content: "Agreed!" } }];

      await handlers["create_comment"]({
        discussion_id: TEST_UUID,
        rich_text,
      });

      expect(mockNotionRequest).toHaveBeenCalledWith("/comments", {
        method: "POST",
        body: {
          discussion_id: TEST_ID,
          rich_text,
        },
      });
    });

    it("throws when neither parent nor discussion_id is provided", async () => {
      await expect(
        handlers["create_comment"]({
          rich_text: [{ text: { content: "Oops" } }],
        }),
      ).rejects.toThrow("Either parent.page_id or discussion_id is required.");
    });
  });

  describe("get_comments", () => {
    it("sends GET /comments with block_id param", async () => {
      mockNotionRequest.mockResolvedValue({ results: [], has_more: false });

      await handlers["get_comments"]({ block_id: TEST_UUID });

      expect(mockNotionRequest).toHaveBeenCalledWith("/comments", {
        params: { block_id: TEST_ID },
      });
    });

    it("passes page_size and start_cursor when provided", async () => {
      mockNotionRequest.mockResolvedValue({ results: [] });

      await handlers["get_comments"]({
        block_id: TEST_UUID,
        page_size: 25,
        start_cursor: "cursor-xyz",
      });

      const callParams = mockNotionRequest.mock.calls[0][1].params;
      expect(callParams.page_size).toBe("25");
      expect(callParams.start_cursor).toBe("cursor-xyz");
      expect(callParams.block_id).toBe(TEST_ID);
    });
  });
});
