export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function threshold(): LogLevel {
  const env = (process.env.LOG_LEVEL || "info").toLowerCase();
  return env in LEVEL_ORDER ? (env as LogLevel) : "info";
}

function emit(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>,
) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[threshold()]) return;

  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...context,
  };

  const line = JSON.stringify(entry);
  if (level === "error" || level === "warn") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

export const log = {
  debug: (msg: string, ctx?: Record<string, unknown>) =>
    emit("debug", msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) =>
    emit("info", msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) =>
    emit("warn", msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) =>
    emit("error", msg, ctx),
};
