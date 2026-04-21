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
import { register } from "./users.js";

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

describe("users tools", () => {
  let handlers: Record<string, (args: Record<string, unknown>) => unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const mock = createMockServer();
    handlers = mock.handlers;
    register(mock.server);
  });

  describe("list_users", () => {
    it("sends GET /users with no params by default", async () => {
      mockNotionRequest.mockResolvedValue({ results: [], has_more: false });

      await handlers["list_users"]({});

      expect(mockNotionRequest).toHaveBeenCalledWith("/users", { params: {} });
    });

    it("passes page_size and start_cursor as string params", async () => {
      mockNotionRequest.mockResolvedValue({ results: [] });

      await handlers["list_users"]({ page_size: 50, start_cursor: "cursor-1" });

      const callParams = mockNotionRequest.mock.calls[0][1].params;
      expect(callParams.page_size).toBe("50");
      expect(callParams.start_cursor).toBe("cursor-1");
    });
  });

  describe("get_user", () => {
    it("sends GET /users/{id} with stripped UUID", async () => {
      mockNotionRequest.mockResolvedValue({
        id: TEST_ID,
        type: "person",
        name: "Alice",
      });

      await handlers["get_user"]({ user_id: TEST_UUID });

      expect(mockNotionRequest).toHaveBeenCalledWith(`/users/${TEST_ID}`);
    });

    it("works with unhyphenated ID", async () => {
      mockNotionRequest.mockResolvedValue({ id: TEST_ID, name: "Bob" });

      await handlers["get_user"]({ user_id: TEST_ID });

      expect(mockNotionRequest).toHaveBeenCalledWith(`/users/${TEST_ID}`);
    });
  });

  describe("get_me", () => {
    it("sends GET /users/me with no args", async () => {
      mockNotionRequest.mockResolvedValue({
        id: TEST_ID,
        type: "bot",
        name: "My Bot",
      });

      await handlers["get_me"]({});

      expect(mockNotionRequest).toHaveBeenCalledWith("/users/me");
    });

    it("returns the bot user response via jsonContent", async () => {
      const botUser = { id: TEST_ID, type: "bot", name: "Notion Bot" };
      mockNotionRequest.mockResolvedValue(botUser);

      const result = await handlers["get_me"]({});

      expect(
        (result as { content: Array<{ text: string }> }).content[0].text,
      ).toBe(JSON.stringify(botUser));
    });
  });
});
