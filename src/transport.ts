import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { Request, Response } from "express";
import { registerTools } from "./tools/index.js";
import { log } from "./logger.js";

const SERVER_INFO = {
  name: "notion",
  version: "1.0.0",
  icons: [
    {
      src: "https://www.notion.so/images/logo-ios.png",
      mimeType: "image/png",
      sizes: ["512x512"],
    },
  ],
};

/** How long a session can be idle before the reaper removes it. */
export const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
/** How often the reaper checks for stale sessions. */
export const REAP_INTERVAL_MS = 60 * 1000; // every minute

export interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  lastAccess: number;
}

export const sessions = new Map<string, SessionEntry>();

function touchSession(sessionId: string) {
  const entry = sessions.get(sessionId);
  if (entry) entry.lastAccess = Date.now();
}

/**
 * Closes and removes sessions that have been idle longer than SESSION_TTL_MS.
 * Exported for testing.
 */
export function reapStaleSessions() {
  const now = Date.now();
  for (const [id, entry] of sessions) {
    if (now - entry.lastAccess > SESSION_TTL_MS) {
      log.info("reaping stale session", {
        sessionId: id,
        idleMs: now - entry.lastAccess,
      });
      entry.transport.close().catch(() => {});
      sessions.delete(id);
    }
  }
}

let reapTimer: ReturnType<typeof setInterval> | undefined;

/** Start the periodic session reaper. Safe to call multiple times. */
export function startReaper() {
  if (!reapTimer) {
    reapTimer = setInterval(reapStaleSessions, REAP_INTERVAL_MS);
    reapTimer.unref();
  }
}

/** Stop the periodic session reaper (for graceful shutdown). */
export function stopReaper() {
  if (reapTimer) {
    clearInterval(reapTimer);
    reapTimer = undefined;
  }
}

/**
 * Creates and configures the Express app with MCP Streamable HTTP
 * transport and session management.
 */
export function createApp() {
  const app = express();
  app.use(express.json());

  app.post("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
      touchSession(sessionId);
      const { transport } = sessions.get(sessionId)!;
      await transport.handleRequest(req, res, req.body);
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (id) => {
        log.info("session created", { sessionId: id });
        sessions.set(id, { transport, lastAccess: Date.now() });
      },
    });

    transport.onclose = () => {
      const id = [...sessions.entries()].find(
        ([, e]) => e.transport === transport,
      )?.[0];
      if (id) {
        log.info("session closed", { sessionId: id });
        sessions.delete(id);
      }
    };

    const sessionServer = new McpServer(SERVER_INFO);
    registerTools(sessionServer);
    await sessionServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.get("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !sessions.has(sessionId)) {
      res.status(400).json({ error: "Invalid or missing session ID" });
      return;
    }
    touchSession(sessionId);
    await sessions.get(sessionId)!.transport.handleRequest(req, res);
  });

  app.delete("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (sessionId && sessions.has(sessionId)) {
      const { transport } = sessions.get(sessionId)!;
      await transport.close();
      sessions.delete(sessionId);
    }
    res.status(200).end();
  });

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  app.use(
    (
      err: unknown,
      _req: Request,
      res: Response,
      _next: express.NextFunction,
    ) => {
      const message = err instanceof Error ? err.message : String(err);
      log.error("unhandled request error", {
        error: message,
        ...(err instanceof Error && err.stack ? { stack: err.stack } : {}),
      });
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  startReaper();

  return app;
}
