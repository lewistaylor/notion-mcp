import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  assertId,
  buildUrl,
  safeHandler,
  jsonContent,
  notionRequest,
  BASE_URL,
  NOTION_VERSION,
  MAX_RETRIES,
  MAX_PAGINATION_PAGES,
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
// notionRequest — retry logic
// ---------------------------------------------------------------------------

function makeResponse(
  status: number,
  body: unknown,
  headers: Record<string, string | null> = {},
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (k: string) => headers[k] ?? null,
    },
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    json: async () => body,
  };
}

describe("notionRequest retry logic", () => {
  beforeEach(() => {
    process.env.NOTION_TOKEN = "secret_test_token";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.NOTION_TOKEN;
  });

  it("returns JSON data on a successful response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        makeResponse(200, { id: "page-1" }, { "content-type": "application/json" }),
      ),
    );
    const result = await notionRequest("/pages/abc");
    expect(result).toEqual({ id: "page-1" });
  });

  it("retries on 429 and succeeds on the next attempt", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        makeResponse(429, "Too Many Requests", { "retry-after": "0" }),
      )
      .mockResolvedValueOnce(
        makeResponse(200, { id: "page-1" }, { "content-type": "application/json" }),
      );
    vi.stubGlobal("fetch", mockFetch);

    const result = await notionRequest("/pages/abc");
    expect(result).toEqual({ id: "page-1" });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("retries multiple times before succeeding", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(429, "rl", { "retry-after": "0" }))
      .mockResolvedValueOnce(makeResponse(429, "rl", { "retry-after": "0" }))
      .mockResolvedValueOnce(
        makeResponse(200, { ok: true }, { "content-type": "application/json" }),
      );
    vi.stubGlobal("fetch", mockFetch);

    const result = await notionRequest("/pages/abc");
    expect((result as { ok: boolean }).ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it(`throws after ${MAX_RETRIES} consecutive 429s`, async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        makeResponse(429, "rate limited", { "retry-after": "0" }),
      ),
    );
    await expect(notionRequest("/pages/abc")).rejects.toThrow(
      /rate limit exceeded/i,
    );
  });

  it("throws immediately on non-429 HTTP errors without retrying", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(makeResponse(404, "Not found"));
    vi.stubGlobal("fetch", mockFetch);

    await expect(notionRequest("/pages/missing")).rejects.toThrow(
      /Notion API error 404/,
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns null for 204 No Content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 204, headers: { get: () => null } }),
    );
    const result = await notionRequest("/blocks/abc", { method: "DELETE" });
    expect(result).toBeNull();
  });

  it("uses exponential backoff when retry-after header is absent", async () => {
    // retry-after absent → delays 1s, 2s, 4s (but we use 0 via header in other tests)
    // Just verify the call count — actual timing not tested
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(429, "rl", {})) // no retry-after
      .mockResolvedValueOnce(
        makeResponse(200, { id: "x" }, { "content-type": "application/json" }),
      );
    vi.stubGlobal("fetch", mockFetch);

    // Use fake timers to make setTimeout instant
    vi.useFakeTimers();
    const promise = notionRequest("/test");
    await vi.runAllTimersAsync();
    const result = await promise;
    vi.useRealTimers();

    expect(result).toEqual({ id: "x" });
    expect(mockFetch).toHaveBeenCalledTimes(2);
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

  it("MAX_RETRIES is 3", () => {
    expect(MAX_RETRIES).toBe(3);
  });

  it("MAX_PAGINATION_PAGES is 100", () => {
    expect(MAX_PAGINATION_PAGES).toBe(100);
  });
});
