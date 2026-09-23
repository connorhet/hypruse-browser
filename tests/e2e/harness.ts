import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import type { Response } from '../../src/shared/protocol';

export const FIXTURES = 'http://127.0.0.1:4321';
export const EXTENSION_ID = 'pcfjlemgcbbpppclachnobhnnnahpgoj';
export const HOST_NAME = 'dev.hypruse.browser';

export type Harness = {
  context: BrowserContext;
  worker: Worker;
  extensionId: string;
  // Sends one request through the extension's dispatcher, in the service worker.
  request(op: string, args?: Record<string, unknown>): Promise<Response>;
  // Like request, but fails the test unless the answer is ok, and returns the result.
  call<T = Record<string, unknown>>(op: string, args?: Record<string, unknown>): Promise<T>;
  tabIdOf(page: Page): Promise<number>;
  close(): Promise<void>;
};

let requestCounter = 0;

// Chromium looks for user level native messaging hosts in <user data dir>/NativeMessagingHosts
// on Linux, so a test host can be registered for a throwaway profile without touching the
// machine's real browser configuration.
async function registerTestHost(root: string, userDataDir: string): Promise<void> {
  const source = await readFile(resolve('tests/e2e/test-host.mjs'), 'utf8');
  const hostPath = join(root, 'test-host.mjs');
  await writeFile(hostPath, `#!${process.execPath}\n${source}`);
  await chmod(hostPath, 0o755);
  const manifests = join(userDataDir, 'NativeMessagingHosts');
  await mkdir(manifests, { recursive: true });
  await writeFile(
    join(manifests, `${HOST_NAME}.json`),
    JSON.stringify({
      name: HOST_NAME,
      description: 'hypruse-browser end to end test host',
      path: hostPath,
      type: 'stdio',
      allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
    }),
  );
}

export async function launch(options: { hostSocket?: string } = {}): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'hypruse-browser-e2e-'));
  const userDataDir = join(root, 'profile');
  await mkdir(userDataDir);
  if (options.hostSocket) await registerTestHost(root, userDataDir);
  const extensionPath = resolve('dist');
  // Playwright's own Chromium, never the machine's Chrome: branded Chrome ignores
  // --load-extension. channel 'chromium' runs the full browser in new headless mode, which
  // supports extensions; HEADED=1 shows the window.
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: process.env.HEADED !== '1',
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    env: { ...process.env, HYPRUSE_TEST_HOST_SOCKET: options.hostSocket ?? '' },
  });
  const worker =
    context.serviceWorkers().find((candidate) => candidate.url().includes(EXTENSION_ID)) ??
    (await context.waitForEvent('serviceworker', {
      predicate: (candidate) => candidate.url().includes(EXTENSION_ID),
    }));
  await worker.evaluate(async () => {
    while (!globalThis.__hypruseDispatch) await new Promise((done) => setTimeout(done, 50));
  });

  const request = async (op: string, args: Record<string, unknown> = {}): Promise<Response> => {
    requestCounter += 1;
    const message = { id: `t${requestCounter}`, op, args };
    const response = await worker.evaluate(
      (sent) => globalThis.__hypruseDispatch?.(sent) ?? Promise.resolve(null),
      message,
    );
    if (!response) throw new Error(`no response to ${op}`);
    return response;
  };

  const call = async <T>(op: string, args: Record<string, unknown> = {}): Promise<T> => {
    const response = await request(op, args);
    if (!response.ok) {
      throw new Error(`${op} failed: ${response.error.code}: ${response.error.message}`);
    }
    return response.result as T;
  };

  const tabIdOf = async (page: Page): Promise<number> => {
    const { tabs } = await call<{ tabs: { id: number; url: string }[] }>('tabs.list');
    const tab = tabs.find((candidate) => candidate.url === page.url());
    if (!tab) throw new Error(`no tab for ${page.url()}`);
    return tab.id;
  };

  return {
    context,
    worker,
    extensionId: new URL(worker.url()).host,
    request,
    call,
    tabIdOf,
    close: async () => {
      await context.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
