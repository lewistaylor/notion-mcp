import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  sessions,
  reapStaleSessions,
  SESSION_TTL_MS,
  JSONRPC_SESSION_TERMINATED,
  isInitializeRequest,
  extractJsonRpcId,
  buildSessionTerminatedBody,
  type SessionEntry,
} from "./transport.js";

function makeFakeSession(lastAccess: number): SessionEntry {
  return {
    transport: { close: vi.fn().mockResolvedValue(undefined) } as any,
    lastAccess,
  };
}

describe("reapStaleSessions", () => {
  beforeEach(() => {
    sessions.clear();
  });

  afterEach(() => {
    sessions.clear();
  });

  it("removes sessions older than SESSION_TTL_MS", () => {
    const stale = makeFakeSession(Date.now() - SESSION_TTL_MS - 1000);
    const fresh = makeFakeSession(Date.now());
    sessions.set("stale-id", stale);
    sessions.set("fresh-id", fresh);

    reapStaleSessions();

    expect(sessions.has("stale-id")).toBe(false);
    expect(sessions.has("fresh-id")).toBe(true);
    expect(stale.transport.close).toHaveBeenCalled();
    expect(fresh.transport.close).not.toHaveBeenCalled();
  });

  it("does nothing when all sessions are fresh", () => {
    const fresh = makeFakeSession(Date.now());
    sessions.set("fresh-id", fresh);

    reapStaleSessions();

    expect(sessions.size).toBe(1);
    expect(fresh.transport.close).not.toHaveBeenCalled();
  });

  it("removes all sessions when all are stale", () => {
    sessions.set("s1", makeFakeSession(Date.now() - SESSION_TTL_MS - 5000));
    sessions.set("s2", makeFakeSession(Date.now() - SESSION_TTL_MS - 10000));

    reapStaleSessions();

    expect(sessions.size).toBe(0);
  });

  it("handles empty session map gracefully", () => {
    expect(() => reapStaleSessions()).not.toThrow();
  });
});

describe("isInitializeRequest", () => {
  it("recognises a single initialize request", () => {
    expect(
      isInitializeRequest({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    ).toBe(true);
  });

  it("rejects non-initialize single messages", () => {
    expect(
      isInitializeRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    ).toBe(false);
  });

  it("detects initialize inside a batch request", () => {
    expect(
      isInitializeRequest([
        { jsonrpc: "2.0", id: 1, method: "initialize" },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
      ]),
    ).toBe(true);
  });

  it("returns false for a batch without initialize", () => {
    expect(
      isInitializeRequest([
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        { jsonrpc: "2.0", id: 2, method: "tools/call" },
      ]),
    ).toBe(false);
  });

  it("tolerates null / non-object / empty bodies", () => {
    expect(isInitializeRequest(null)).toBe(false);
    expect(isInitializeRequest(undefined)).toBe(false);
    expect(isInitializeRequest("initialize")).toBe(false);
    expect(isInitializeRequest(42)).toBe(false);
    expect(isInitializeRequest([])).toBe(false);
  });
});

describe("extractJsonRpcId", () => {
  it("extracts a numeric id from a single message", () => {
    expect(extractJsonRpcId({ jsonrpc: "2.0", id: 7, method: "x" })).toBe(7);
  });

  it("extracts a string id from a single message", () => {
    expect(extractJsonRpcId({ jsonrpc: "2.0", id: "abc", method: "x" })).toBe(
      "abc",
    );
  });

  it("returns null for notifications (no id)", () => {
    expect(extractJsonRpcId({ jsonrpc: "2.0", method: "x" })).toBe(null);
  });

  it("returns the first id it finds in a batch", () => {
    expect(
      extractJsonRpcId([
        { jsonrpc: "2.0", method: "x" },
        { jsonrpc: "2.0", id: 2, method: "y" },
      ]),
    ).toBe(2);
  });

  it("returns null for non-object / null bodies", () => {
    expect(extractJsonRpcId(null)).toBe(null);
    expect(extractJsonRpcId(undefined)).toBe(null);
    expect(extractJsonRpcId("nope")).toBe(null);
    expect(extractJsonRpcId(42)).toBe(null);
  });

  it("ignores non-string / non-number id values", () => {
    expect(extractJsonRpcId({ id: { nested: true }, method: "x" })).toBe(null);
  });
});

describe("buildSessionTerminatedBody", () => {
  it("emits a well-formed JSON-RPC error with code -32002", () => {
    const body = buildSessionTerminatedBody(42);
    expect(body).toEqual({
      jsonrpc: "2.0",
      id: 42,
      error: { code: -32002, message: "Session terminated" },
    });
  });

  it("echoes string ids back verbatim", () => {
    expect(buildSessionTerminatedBody("req-a")).toMatchObject({
      id: "req-a",
    });
  });

  it("uses null when no id was supplied", () => {
    expect(buildSessionTerminatedBody(null)).toMatchObject({ id: null });
  });

  it("exposes the session-terminated code as a stable constant", () => {
    expect(JSONRPC_SESSION_TERMINATED).toBe(-32002);
  });
});
