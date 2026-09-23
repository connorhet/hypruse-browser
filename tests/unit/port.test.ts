import {
  BACKOFF_MS,
  HEALTHY_MS,
  NativeConnection,
  type NativePort,
} from '../../src/background/port';
import type { Hello } from '../../src/shared/protocol';

const HELLO: Hello = { hello: { protocol: 1, extension: '0.1.0', browser: 'Chrome/151.0.1.2' } };

class FakePort implements NativePort {
  sent: unknown[] = [];
  private messageListeners: ((message: unknown) => void)[] = [];
  private disconnectListeners: (() => void)[] = [];
  postMessage(message: unknown): void {
    this.sent.push(message);
  }
  disconnect(): void {
    this.drop();
  }
  onMessage = {
    addListener: (listener: (message: unknown) => void) => this.messageListeners.push(listener),
  };
  onDisconnect = { addListener: (listener: () => void) => this.disconnectListeners.push(listener) };
  receive(message: unknown): void {
    for (const listener of this.messageListeners) listener(message);
  }
  drop(): void {
    for (const listener of this.disconnectListeners) listener();
  }
}

// A manual clock: timers run only when the test advances time.
class Clock {
  time = 0;
  private timers: { at: number; callback: () => void; id: number }[] = [];
  private nextId = 1;
  setTimer = (callback: () => void, ms: number): unknown => {
    const id = this.nextId++;
    this.timers.push({ at: this.time + ms, callback, id });
    return id;
  };
  clearTimer = (id: unknown): void => {
    this.timers = this.timers.filter((timer) => timer.id !== id);
  };
  now = (): number => this.time;
  get pendingDelays(): number[] {
    return this.timers.map((timer) => timer.at - this.time);
  }
  advance(ms: number): void {
    const until = this.time + ms;
    for (;;) {
      const due = this.timers.filter((timer) => timer.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers = this.timers.filter((timer) => timer !== due);
      this.time = due.at;
      due.callback();
    }
    this.time = until;
  }
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function setup(options: { failConnect?: boolean } = {}) {
  const clock = new Clock();
  const ports: FakePort[] = [];
  const onMessage = vi.fn();
  const connection = new NativeConnection({
    connect: () => {
      if (options.failConnect) throw new Error('native messaging is not available');
      const port = new FakePort();
      ports.push(port);
      return port;
    },
    hello: async () => HELLO,
    onMessage,
    lastError: () => 'Specified native messaging host not found.',
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    now: clock.now,
  });
  return { clock, ports, onMessage, connection };
}

describe('NativeConnection', () => {
  it('sends the hello first on every new port', async () => {
    const { connection, ports } = setup();
    connection.ensure();
    connection.send({ event: 'tabs.changed', data: { reason: 'created', tab_id: 1 } });
    await flush();
    expect(ports[0]!.sent[0]).toEqual(HELLO);
    expect(ports[0]!.sent[1]).toMatchObject({ event: 'tabs.changed' });
  });

  it('does not open a second port while one is connected', () => {
    const { connection, ports } = setup();
    connection.ensure();
    connection.ensure();
    expect(ports).toHaveLength(1);
    expect(connection.connected).toBe(true);
  });

  it('replies on the port the request came from', async () => {
    const { connection, ports, onMessage } = setup();
    onMessage.mockImplementation((message: { id: string }, reply: (m: unknown) => void) =>
      reply({ id: message.id, ok: true, result: {} }),
    );
    connection.ensure();
    ports[0]!.receive({ id: 'h1', op: 'ping' });
    await flush();
    expect(ports[0]!.sent).toEqual([HELLO, { id: 'h1', ok: true, result: {} }]);
  });

  it('drops a reply when its port has gone', async () => {
    const { connection, ports, onMessage, clock } = setup();
    let later: (m: unknown) => void = () => undefined;
    onMessage.mockImplementation((_message: unknown, reply: (m: unknown) => void) => {
      later = reply;
    });
    connection.ensure();
    ports[0]!.receive({ id: 'h1', op: 'ping' });
    ports[0]!.drop();
    clock.advance(BACKOFF_MS[0]!);
    later({ id: 'h1', ok: true, result: {} });
    await flush();
    expect(ports[1]!.sent).toEqual([HELLO]);
  });

  it('retries with backoff while the host is missing', () => {
    const { connection, ports, clock } = setup();
    connection.ensure();
    const delays: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      ports.at(-1)!.drop();
      expect(connection.connected).toBe(false);
      delays.push(clock.pendingDelays[0]!);
      clock.advance(clock.pendingDelays[0]!);
    }
    expect(delays).toEqual([1_000, 2_000, 5_000, 15_000, 30_000, 30_000, 30_000]);
    expect(ports).toHaveLength(8);
  });

  it('starts the backoff again after a healthy connection', () => {
    const { connection, ports, clock } = setup();
    connection.ensure();
    ports[0]!.drop();
    clock.advance(1_000);
    ports[1]!.drop();
    expect(clock.pendingDelays).toEqual([2_000]);
    clock.advance(2_000);
    clock.advance(HEALTHY_MS);
    ports[2]!.drop();
    expect(clock.pendingDelays).toEqual([1_000]);
  });

  it('starts the backoff again once the host talks', () => {
    const { connection, ports, clock } = setup();
    connection.ensure();
    ports[0]!.drop();
    clock.advance(1_000);
    ports[1]!.receive({ id: 'h1', op: 'ping' });
    ports[1]!.drop();
    expect(clock.pendingDelays).toEqual([1_000]);
  });

  it('reconnects at once when asked while a retry is pending', () => {
    const { connection, ports, clock } = setup();
    connection.ensure();
    ports[0]!.drop();
    expect(clock.pendingDelays).toEqual([1_000]);
    connection.ensure();
    expect(ports).toHaveLength(2);
    expect(clock.pendingDelays).toEqual([]);
  });

  it('never throws when connecting itself fails', () => {
    const { connection, clock } = setup({ failConnect: true });
    expect(() => connection.ensure()).not.toThrow();
    expect(connection.connected).toBe(false);
    expect(clock.pendingDelays).toEqual([1_000]);
    expect(() => clock.advance(60_000)).not.toThrow();
  });

  it('drops events while disconnected', async () => {
    const { connection, ports } = setup();
    connection.send({ event: 'tabs.changed' });
    connection.ensure();
    await flush();
    expect(ports[0]!.sent).toEqual([HELLO]);
  });
});
