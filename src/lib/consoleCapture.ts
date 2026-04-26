// Lightweight global capture of recent console errors + last unhandled stack.
// Installed once from RootComponent — patches console.error/warn and
// listens for window error/unhandledrejection. Keeps a small ring buffer
// so shake-to-report can attach the latest signal without bloating storage.

export interface CapturedError {
  ts: number;
  level: "error" | "warn" | "unhandled" | "rejection";
  message: string;
}

const RING = 20;
const buffer: CapturedError[] = [];
let lastStack: string | null = null;
let installed = false;

function push(level: CapturedError["level"], message: string) {
  buffer.push({ ts: Date.now(), level, message: message.slice(0, 800) });
  if (buffer.length > RING) buffer.shift();
}

function fmt(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return a.message;
      if (typeof a === "string") return a;
      try { return JSON.stringify(a); } catch { return String(a); }
    })
    .join(" ");
}

export function installConsoleCapture(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const origError = console.error.bind(console);
  const origWarn = console.warn.bind(console);

  console.error = (...args: unknown[]) => {
    push("error", fmt(args));
    const err = args.find((a) => a instanceof Error) as Error | undefined;
    if (err?.stack) lastStack = err.stack;
    origError(...args);
  };
  console.warn = (...args: unknown[]) => {
    push("warn", fmt(args));
    origWarn(...args);
  };

  window.addEventListener("error", (e) => {
    push("unhandled", e.message || String(e.error));
    if (e.error instanceof Error && e.error.stack) lastStack = e.error.stack;
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason;
    const msg = reason instanceof Error ? reason.message : String(reason);
    push("rejection", msg);
    if (reason instanceof Error && reason.stack) lastStack = reason.stack;
  });
}

export function getRecentConsoleErrors(): CapturedError[] {
  return buffer.slice();
}

export function getLastStackTrace(): string | null {
  return lastStack ? lastStack.slice(0, 2000) : null;
}
