import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  sessions,
  reapStaleSessions,
  SESSION_TTL_MS,
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
