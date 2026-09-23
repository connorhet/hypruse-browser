import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { FIXTURES, launch, type Harness } from './harness';

// The full native messaging round trip. A test host (tests/e2e/test-host.mjs) is registered
// for the throwaway Chromium profile under the real host name, dev.hypruse.browser, and
// allows only the pinned extension id. Chromium starts it when the extension connects; the
// host relays frames to a unix socket this test listens on, so the test plays the part of a
// hypruse client talking to the extension through Chrome.

type Message = Record<string, unknown>;

class HostEnd {
  private socket: net.Socket | null = null;
  private buffer = '';
  private readonly received: Message[] = [];
  private waiters: (() => void)[] = [];

  attach(socket: net.Socket): void {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      let at: number;
      while ((at = this.buffer.indexOf('\n')) !== -1) {
        this.received.push(JSON.parse(this.buffer.slice(0, at)) as Message);
        this.buffer = this.buffer.slice(at + 1);
        for (const wake of this.waiters.splice(0)) wake();
      }
    });
  }

  send(message: Message): void {
    this.socket?.write(`${JSON.stringify(message)}\n`);
  }

  // Resolves with the first message, received so far or later, that matches.
  async next(match: (message: Message) => boolean, timeoutMs = 60_000): Promise<Message> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const at = this.received.findIndex(match);
      if (at !== -1) return this.received.splice(at, 1)[0]!;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error('timed out waiting for a message from the extension');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }
}

let dir: string;
let server: net.Server;
let harness: Harness;
const host = new HostEnd();

test.beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hb-'));
  const socketPath = join(dir, 'host.sock');
  server = net.createServer((socket) => host.attach(socket));
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  harness = await launch({ hostSocket: socketPath });
});

test.afterAll(async () => {
  await harness.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(dir, { recursive: true, force: true });
});

test('connects to the native host, says hello, answers requests and sends events', async () => {
  const hello = await host.next((message) => 'hello' in message);
  expect(hello).toEqual({
    hello: {
      protocol: 1,
      extension: '0.1.0',
      browser: expect.stringMatching(/^[A-Za-z][\w ]*\/\d+\.\d+\.\d+\.\d+$/) as unknown,
    },
  });

  host.send({ id: 'n1', op: 'ping' });
  await expect(host.next((message) => message.id === 'n1')).resolves.toEqual({
    id: 'n1',
    ok: true,
    result: { extension: '0.1.0' },
  });

  host.send({ id: 'n2', op: 'tabs.fly' });
  await expect(host.next((message) => message.id === 'n2')).resolves.toMatchObject({
    id: 'n2',
    ok: false,
    error: { code: 'bad_request' },
  });

  const page = await harness.context.newPage();
  await page.goto(`${FIXTURES}/target.html`);
  const tabId = await harness.tabIdOf(page);
  await expect(
    host.next(
      (message) =>
        message.event === 'tabs.changed' && (message.data as { tab_id: number }).tab_id === tabId,
    ),
  ).resolves.toMatchObject({ event: 'tabs.changed', data: { tab_id: tabId } });

  host.send({ id: 'n3', op: 'page.snapshot', args: { tab_id: tabId } });
  const snapshot = await host.next((message) => message.id === 'n3');
  expect(snapshot).toMatchObject({
    id: 'n3',
    ok: true,
    result: { tab_id: tabId, title: 'Target fixture' },
  });

  host.send({ id: 'n4', op: 'tabs.close', args: { tab_id: tabId } });
  await expect(host.next((message) => message.id === 'n4')).resolves.toEqual({
    id: 'n4',
    ok: true,
    result: {},
  });
  await expect(
    host.next(
      (message) =>
        message.event === 'tabs.changed' &&
        (message.data as { reason: string; tab_id: number }).reason === 'removed',
    ),
  ).resolves.toMatchObject({ data: { tab_id: tabId } });
});
