import { describe, it, expect, vi } from "vitest";
import {
  assertId,
  buildUrl,
  safeHandler,
  jsonContent,
  BASE_URL,
  NOTION_VERSION,
} from "./notion.js";

// ---------------------------------------------------------------------------
// assertId
// ---------------------------------------------------------------------------

describe("assertId", () => {
  it("accepts a hyphenated UUID and returns it without hyphens", () => {
    const result = assertId(
      "12345678-1234-1234-1234-123456789abc",
      "pageId",
    );
    expect(result).toBe("12345678123412341234123456789abc");
  });

  it("accepts an unhyphenated 32-char hex UUID", () => {
    const result = assertId("12345678123412341234123456789abc", "pageId");
    expect(result).toBe("12345678123412341234123456789abc");
  });

  it("accepts uppercase hex UUID and strips hyphens (preserves case)", () => {
    const result = assertId(
      "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
      "blockId",
    );
    expect(result).toBe("AAAAAAAABBBBCCCCDDDDEEEEEEEEEEEE");
  });

  it("rejects path traversal attempts", () => {
    expect(() => assertId("../../../etc/passwd", "pageId")).toThrow(
      /Invalid pageId/,
    );
  });

  it("rejects short alphanumeric IDs (Clockify style)", () => {
    expect(() => assertId("abc123", "pageId")).toThrow(/Invalid pageId/);
  });

  it("rejects empty strings", () => {
    expect(() => assertId("", "pageId")).toThrow(/Invalid pageId/);
  });

  it("rejects IDs with invalid characters", () => {
    expect(() =>
      assertId("12345678-1234-1234-1234-12345678GGGG", "pageId"),
    ).toThrow(/Invalid pageId/);
  });

  it("rejects IDs that are too long", () => {
    expect(() =>
      assertId("12345678-1234-1234-1234-123456789abcXXX", "pageId"),
    ).toThrow(/Invalid pageId/);
  });
});

// ---------------------------------------------------------------------------
// buildUrl
// ---------------------------------------------------------------------------

describe("buildUrl", () => {
  it("builds a URL with no params", () => {
    const result = buildUrl("/pages/abc123");
    expect(result).toBe(`${BASE_URL}/pages/abc123`);
  });

  it("builds a URL with query params", () => {
    const result = buildUrl("/users", { page_size: "50", start_cursor: "cur1" });
    const url = new URL(result);
    expect(url.pathname).toBe("/v1/users");
    expect(url.searchParams.get("page_size")).toBe("50");
    expect(url.searchParams.get("start_cursor")).toBe("cur1");
  });

  it("skips empty param values", () => {
    const result = buildUrl("/search", { filled: "yes", empty: "" });
    const url = new URL(result);
    expect(url.searchParams.get("filled")).toBe("yes");
    expect(url.searchParams.has("empty")).toBe(false);
  });

  it("uses the correct Notion API base URL", () => {
    const result = buildUrl("/databases/abc/query");
    expect(result).toContain("api.notion.com/v1");
  });
});

// ---------------------------------------------------------------------------
// jsonContent
// ---------------------------------------------------------------------------

describe("jsonContent", () => {
  it("serialises data as pretty-printed JSON in MCP text content", () => {
    const result = jsonContent({ id: "abc", title: "Test" });
    expect(result).toEqual({
      content: [
        { type: "text", text: '{\n  "id": "abc",\n  "title": "Test"\n}' },
      ],
    });
  });

  it("handles arrays", () => {
    const result = jsonContent([1, 2, 3]);
    expect(result.content[0].text).toBe("[\n  1,\n  2,\n  3\n]");
  });

  it("handles null", () => {
    const result = jsonContent(null);
    expect(result.content[0].text).toBe("null");
  });
});

// ---------------------------------------------------------------------------
// safeHandler
// ---------------------------------------------------------------------------

describe("safeHandler", () => {
  it("passes through successful results unchanged", async () => {
    const handler = safeHandler(async () => ({
      content: [{ type: "text" as const, text: "ok" }],
    }));
    const result = await handler({});
    expect(result).toEqual({ content: [{ type: "text", text: "ok" }] });
    expect((result as Record<string, unknown>).isError).toBeUndefined();
  });

  it("catches thrown Error instances and returns isError content", async () => {
    const handler = safeHandler(async () => {
      throw new Error("notion broke");
    });
    const result = await handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Error: notion broke");
  });

  it("catches non-Error throws and stringifies them", async () => {
    const handler = safeHandler(async () => {
      throw "string error";
    });
    const result = await handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Error: string error");
  });

  it("forwards arguments to the inner handler", async () => {
    const spy = vi.fn(async (args: Record<string, unknown>) =>
      jsonContent(args),
    );
    const handler = safeHandler(spy);
    await handler({ page_id: "abc" });
    expect(spy).toHaveBeenCalledWith({ page_id: "abc" });
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("constants", () => {
  it("BASE_URL points to the Notion v1 API", () => {
    expect(BASE_URL).toBe("https://api.notion.com/v1");
  });

  it("NOTION_VERSION is 2022-06-28", () => {
    expect(NOTION_VERSION).toBe("2022-06-28");
  });
});
