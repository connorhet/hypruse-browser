import type { Hello } from '../shared/protocol';

// The part of chrome.runtime.Port the connection uses.
export type NativePort = {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
};

export type Reply = (message: unknown) => void;

export type ConnectionDeps = {
  connect: () => NativePort;
  hello: () => Promise<Hello>;
  onMessage: (message: unknown, reply: Reply) => void;
  // Reads chrome.runtime.lastError, which Chrome sets when the host is missing or exits.
  lastError?: () => string | undefined;
  log?: (message: string) => void;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
  now?: () => number;
};

// Delays between reconnect attempts; the last one repeats.
export const BACKOFF_MS = [1_000, 2_000, 5_000, 15_000, 30_000];
// A connection that lived this long counts as healthy, so the next failure starts the
// backoff from the beginning again.
export const HEALTHY_MS = 10_000;

// Keeps one native messaging port to the host open. A missing host is normal (hypruse may not
// be installed yet), so nothing here throws; failures only schedule the next attempt.
export class NativeConnection {
  private port: NativePort | null = null;
  private ready: Promise<void> = Promise.resolve();
  private attempt = 0;
  private retryTimer: unknown = null;
  private openedAt = 0;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;
  private readonly now: () => number;

  constructor(private readonly deps: ConnectionDeps) {
    this.setTimer = deps.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer =
      deps.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
    this.now = deps.now ?? (() => Date.now());
  }

  get connected(): boolean {
    return this.port !== null;
  }

  // Connects now unless a port is already open. Safe to call as often as you like.
  ensure(): void {
    if (this.port) return;
    if (this.retryTimer !== null) {
      this.clearTimer(this.retryTimer);
      this.retryTimer = null;
    }
    this.open();
  }

  // Sends to the current port, after its hello. Dropped when nothing is connected.
  send(message: unknown): void {
    const port = this.port;
    if (port) this.post(port, message);
  }

  private post(port: NativePort, message: unknown): void {
    void this.ready.then(() => {
      if (this.port !== port) return;
      try {
        port.postMessage(message);
      } catch (error) {
        this.deps.log?.(`could not send to the host: ${String(error)}`);
      }
    });
  }

  private open(): void {
    let port: NativePort;
    try {
      port = this.deps.connect();
    } catch (error) {
      this.deps.log?.(`could not connect to the host: ${String(error)}`);
      this.scheduleRetry();
      return;
    }
    this.port = port;
    this.openedAt = this.now();
    this.ready = this.deps.hello().then(
      (hello) => {
        if (this.port !== port) return;
        try {
          port.postMessage(hello);
        } catch (error) {
          this.deps.log?.(`could not send the hello: ${String(error)}`);
        }
      },
      (error: unknown) => this.deps.log?.(`could not build the hello: ${String(error)}`),
    );
    port.onMessage.addListener((message) => {
      if (this.port !== port) return;
      this.attempt = 0;
      this.deps.onMessage(message, (reply) => this.post(port, reply));
    });
    port.onDisconnect.addListener(() => {
      const reason = this.deps.lastError?.();
      if (this.port !== port) return;
      this.port = null;
      this.deps.log?.(`host disconnected${reason ? `: ${reason}` : ''}`);
      if (this.now() - this.openedAt >= HEALTHY_MS) this.attempt = 0;
      this.scheduleRetry();
    });
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null) return;
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)] ?? 30_000;
    this.attempt += 1;
    this.retryTimer = this.setTimer(() => {
      this.retryTimer = null;
      this.ensure();
    }, delay);
  }
}
