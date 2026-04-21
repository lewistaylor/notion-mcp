import { getToken } from "./notion.js";
import { createApp } from "./transport.js";
import { log } from "./logger.js";

try {
  getToken();
} catch {
  log.error("NOTION_TOKEN is not set — server cannot start");
  process.exit(1);
}

const app = createApp();
const PORT = parseInt(process.env.PORT || "3000", 10);
app.listen(PORT, () => {
  log.info("server started", { port: PORT });
});

process.on("uncaughtException", (err) => {
  log.error("uncaught exception", {
    error: err.message,
    stack: err.stack,
  });
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  log.error("unhandled rejection", {
    error: message,
    ...(reason instanceof Error && reason.stack
      ? { stack: reason.stack }
      : {}),
  });
});
