import { log } from "./logger.js";

export const BASE_URL = "https://api.notion.com/v1";
export const NOTION_VERSION = "2022-06-28";

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

/**
 * Makes an authenticated request to the Notion API.
 * Attaches Bearer token and Notion-Version header on every request.
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

  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
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
