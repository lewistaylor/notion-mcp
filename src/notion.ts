import { log } from "./logger.js";

export const BASE_URL = "https://api.notion.com/v1";
export const NOTION_VERSION = "2022-06-28";

/** Maximum consecutive 429 retries before giving up. */
export const MAX_RETRIES = 3;
/** Maximum pagination pages fetched by paginateGet/paginatePost helpers. */
export const MAX_PAGINATION_PAGES = 100;

/** Matches both hyphenated (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx) and unhyphenated (32 hex) UUIDs. */
const NOTION_UUID =
  /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/**
 * Validates that a value is a Notion UUID and returns the hyphen-stripped form
 * safe for URL interpolation. Prevents path-traversal via crafted IDs.
 */
export function assertId(value: string, name: string): string {
  if (!NOTION_UUID.test(value)) {
    throw new Error(
      `Invalid ${name}: expected a Notion UUID (32 hex chars, optionally hyphenated), got "${value}"`,
    );
  }
  return value.replace(/-/g, "");
}

export function getToken(): string {
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    throw new Error("NOTION_TOKEN environment variable is required");
  }
  return token;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  params?: Record<string, string>;
  body?: unknown;
}

/**
 * Builds a full Notion API URL from a path and optional query parameters.
 * Empty/null/undefined param values are skipped.
 */
export function buildUrl(path: string, params?: Record<string, string>): string {
  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, value);
      }
    }
  }
  return url.toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Makes an authenticated request to the Notion API.
 * Automatically retries up to MAX_RETRIES times on 429 responses,
 * honouring the Retry-After header (or using exponential backoff as fallback).
 */
export async function notionRequest(
  path: string,
  options: RequestOptions = {},
) {
  const { method = "GET", params, body } = options;
  const url = buildUrl(path, params);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${getToken()}`,
    "Notion-Version": NOTION_VERSION,
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  log.debug("notion api request", { method, path });

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("notion api network error", { method, path, error: message });
      throw err;
    }

    if (response.status === 429) {
      if (attempt === MAX_RETRIES) {
        const text = await response.text();
        log.error("notion api rate limit exhausted", {
          method,
          path,
          attempts: attempt + 1,
        });
        throw new Error(
          `Notion API rate limit exceeded after ${MAX_RETRIES} retries: ${text}`,
        );
      }
      const retryAfterHeader = response.headers.get("retry-after");
      const delayMs = retryAfterHeader
        ? Math.max(parseInt(retryAfterHeader, 10), 0) * 1000
        : 2 ** attempt * 1000; // 1 s, 2 s, 4 s
      log.warn("notion api rate limited, retrying", {
        attempt: attempt + 1,
        maxRetries: MAX_RETRIES,
        delayMs,
        path,
      });
      await sleep(delayMs);
      continue;
    }

    if (!response.ok) {
      const text = await response.text();
      log.error("notion api http error", {
        method,
        path,
        status: response.status,
        body: text.slice(0, 500),
      });
      throw new Error(`Notion API error ${response.status}: ${text}`);
    }

    if (response.status === 204) return null;

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) return response.json();
    return response.text();
  }

  /* istanbul ignore next */
  throw new Error("Unexpected end of retry loop");
}

/**
 * Fetches all pages from a GET endpoint that returns { results, has_more, next_cursor }.
 * Automatically paginates via start_cursor up to MAX_PAGINATION_PAGES pages.
 */
export async function paginateGet<T = unknown>(
  path: string,
  params: Record<string, string> = {},
): Promise<T[]> {
  const all: T[] = [];
  let startCursor: string | undefined;

  for (let page = 0; page < MAX_PAGINATION_PAGES; page++) {
    const p: Record<string, string> = { ...params, page_size: "100" };
    if (startCursor) p.start_cursor = startCursor;

    const resp = (await notionRequest(path, { params: p })) as {
      results: T[];
      has_more: boolean;
      next_cursor?: string | null;
    };

    all.push(...resp.results);
    if (!resp.has_more || !resp.next_cursor) break;
    startCursor = resp.next_cursor;
  }

  log.debug("paginateGet complete", { path, total: all.length });
  return all;
}

/**
 * Fetches all pages from a POST endpoint that returns { results, has_more, next_cursor }.
 * Automatically paginates via start_cursor in the request body up to MAX_PAGINATION_PAGES pages.
 */
export async function paginatePost<T = unknown>(
  path: string,
  body: Record<string, unknown> = {},
): Promise<T[]> {
  const all: T[] = [];
  let startCursor: string | undefined;

  for (let page = 0; page < MAX_PAGINATION_PAGES; page++) {
    const b: Record<string, unknown> = { ...body, page_size: 100 };
    if (startCursor) b.start_cursor = startCursor;

    const resp = (await notionRequest(path, { method: "POST", body: b })) as {
      results: T[];
      has_more: boolean;
      next_cursor?: string | null;
    };

    all.push(...resp.results);
    if (!resp.has_more || !resp.next_cursor) break;
    startCursor = resp.next_cursor;
  }

  log.debug("paginatePost complete", { path, total: all.length });
  return all;
}

/**
 * Wraps a tool handler so that thrown errors are returned as MCP error
 * content (`isError: true`) rather than crashing the transport.
 */
export function safeHandler<T extends Record<string, unknown>>(
  handler: (
    args: T,
  ) => Promise<{ content: Array<{ type: "text"; text: string }> }>,
) {
  return async (args: T) => {
    try {
      return await handler(args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("tool handler error", {
        error: message,
        ...(err instanceof Error && err.stack ? { stack: err.stack } : {}),
      });
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  };
}

/** Serialises `data` as pretty-printed JSON in MCP text content. */
export function jsonContent(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}
