import {
  createPageRunner,
  injectionError,
  isRestrictedUrl,
  type ScriptRunner,
} from '../../src/background/inject';
import { createPageHandlers, snapshotIds } from '../../src/background/page';
import type { ResolvedTab } from '../../src/background/tabs';
import { ProtocolError, type PageRequest } from '../../src/shared/protocol';
import { FakeBrowser } from '../helpers/fake-browser';

async function codeOf(work: Promise<unknown>): Promise<string> {
  const error: unknown = await work.then(
    () => null,
    (reason: unknown) => reason,
  );
  if (!(error instanceof ProtocolError))
    throw new Error(`expected a ProtocolError, got ${String(error)}`);
  return error.code;
}

const tab = (url: string): ResolvedTab => ({ id: 7, url }) as ResolvedTab;

// A tab whose document gains an agent only once content.js is injected.
function fakeRunner(answer: (request: PageRequest) => unknown = () => ({ ok: true, result: {} })) {
  let installed = false;
  const runner = {
    inject: vi.fn(async () => {
      installed = true;
    }),
    call: vi.fn(async (_tabId: number, request: PageRequest, version: string) =>
      installed && version === '0.1.0' ? answer(request) : null,
    ),
  } satisfies ScriptRunner;
  return runner;
}

describe('createPageRunner', () => {
  it('installs content.js on first use and calls the agent', async () => {
    const runner = fakeRunner(() => ({ ok: true, result: { scroll_y: 10 } }));
    const run = createPageRunner(runner, '0.1.0');
    const request: PageRequest = { op: 'scroll', args: { direction: 'down' } };
    await expect(run(tab('https://example.com/'), request)).resolves.toEqual({ scroll_y: 10 });
    expect(runner.inject).toHaveBeenCalledOnce();
    await run(tab('https://example.com/'), request);
    expect(runner.inject).toHaveBeenCalledOnce();
    expect(runner.call).toHaveBeenCalledTimes(3);
  });

  it('turns an error from the page into a protocol error with its code', async () => {
    const run = createPageRunner(
      fakeRunner(() => ({ ok: false, error: { code: 'stale_snapshot', message: 'old' } })),
      '0.1.0',
    );
    await expect(
      codeOf(
        run(tab('https://example.com/'), {
          op: 'click',
          args: { snapshot_id: 's1', element_id: 'e1' },
        }),
      ),
    ).resolves.toBe('stale_snapshot');
  });

  it('maps an unknown code from the page to internal', async () => {
    const run = createPageRunner(
      fakeRunner(() => ({ ok: false, error: { code: 'weird', message: 'x' } })),
      '0.1.0',
    );
    await expect(
      codeOf(run(tab('https://example.com/'), { op: 'scroll', args: { direction: 'up' } })),
    ).resolves.toBe('internal');
  });

  it('answers internal when the page gives no answer', async () => {
    const run = createPageRunner(
      fakeRunner(() => undefined),
      '0.1.0',
    );
    await expect(
      codeOf(run(tab('https://example.com/'), { op: 'scroll', args: { direction: 'up' } })),
    ).resolves.toBe('internal');
  });

  it('refuses restricted pages without trying to inject', async () => {
    const runner = fakeRunner();
    const run = createPageRunner(runner, '0.1.0');
    for (const url of [
      'chrome://settings/',
      'chrome-extension://abc/page.html',
      'https://chromewebstore.google.com/detail/x',
      'about:version',
    ]) {
      await expect(
        codeOf(run(tab(url), { op: 'scroll', args: { direction: 'up' } })),
      ).resolves.toBe('restricted_page');
    }
    expect(runner.call).not.toHaveBeenCalled();
  });

  it('maps a Chrome refusal to restricted_page', async () => {
    const runner: ScriptRunner = {
      inject: async () => undefined,
      call: () =>
        Promise.reject(
          new Error(
            'Cannot access contents of url "file:///home/me/a.html". Extension manifest must request permission to access this host.',
          ),
        ),
    };
    const run = createPageRunner(runner, '0.1.0');
    await expect(
      codeOf(run(tab('file:///home/me/a.html'), { op: 'scroll', args: { direction: 'up' } })),
    ).resolves.toBe('restricted_page');
  });
});

describe('injectionError', () => {
  it('reads Chrome messages', () => {
    expect(injectionError(new Error('No tab with id: 5.')).code).toBe('not_found');
    expect(injectionError(new Error('The extensions gallery cannot be scripted.')).code).toBe(
      'restricted_page',
    );
    expect(injectionError(new Error('Frame with ID 0 is showing error page')).code).toBe(
      'restricted_page',
    );
    expect(injectionError(new Error('Cannot access a chrome:// URL')).code).toBe('restricted_page');
    expect(injectionError(new Error('Something else broke')).code).toBe('internal');
  });

  it('allows about:blank', () => {
    expect(isRestrictedUrl('about:blank')).toBe(false);
    expect(isRestrictedUrl('https://www.youtube.com/')).toBe(false);
  });
});

describe('snapshotIds', () => {
  it('counts up with a tag for this worker life', () => {
    const next = snapshotIds(() => 0.5);
    expect([next(), next()]).toEqual(['s1-i000', 's2-i000']);
  });

  it('gives different ids after a restart', () => {
    const before = snapshotIds(() => 0.1)();
    const after = snapshotIds(() => 0.2)();
    expect(before).not.toBe(after);
  });
});

describe('createPageHandlers', () => {
  function setup() {
    const browser = new FakeBrowser();
    const win = browser.addWindow({ focused: true });
    const first = browser.addTab(win, 'https://www.youtube.com/', { active: true });
    const second = browser.addTab(win, 'https://open.spotify.com/');
    const run = vi.fn(async (target: ResolvedTab, request: PageRequest) =>
      request.op === 'snapshot'
        ? {
            snapshot_id: request.args.snapshot_id,
            url: target.url,
            title: 'Page',
            headings: '',
            viewport: { width: 1, height: 1, dpr: 1, scroll_y: 0, scroll_height: 1 },
            elements: [],
          }
        : { tab: target.id },
    );
    let n = 0;
    const handlers = createPageHandlers({
      api: browser.api(),
      run,
      nextSnapshotId: () => `s${++n}-test`,
    });
    return { browser, handlers, run, first, second };
  }

  it('snapshots the active tab by default and adds its id', async () => {
    const { handlers, first } = setup();
    await expect(handlers['page.snapshot']({ max: 120, settle_ms: 0 })).resolves.toEqual({
      snapshot_id: 's1-test',
      tab_id: first,
      url: 'https://www.youtube.com/',
      title: 'Page',
      headings: '',
      viewport: { width: 1, height: 1, dpr: 1, scroll_y: 0, scroll_height: 1 },
      elements: [],
    });
  });

  it('sends a click to the tab its snapshot came from', async () => {
    const { handlers, run, second } = setup();
    await handlers['page.snapshot']({ tab_id: second, max: 120, settle_ms: 0 });
    await expect(
      handlers['page.click']({ snapshot_id: 's1-test', element_id: 'e2' }),
    ).resolves.toEqual({ tab: second });
    expect(run).toHaveBeenLastCalledWith(expect.objectContaining({ id: second }), {
      op: 'click',
      args: { snapshot_id: 's1-test', element_id: 'e2' },
    });
  });

  it('passes typing through with its text and submit flag', async () => {
    const { handlers, run } = setup();
    await handlers['page.snapshot']({ max: 120, settle_ms: 0 });
    await handlers['page.type']({
      snapshot_id: 's1-test',
      element_id: 'e1',
      text: 'lofi',
      submit: true,
    });
    expect(run).toHaveBeenLastCalledWith(expect.anything(), {
      op: 'type',
      args: { snapshot_id: 's1-test', element_id: 'e1', text: 'lofi', submit: true },
    });
  });

  it('answers stale_snapshot for an unknown snapshot or a closed tab', async () => {
    const { browser, handlers, first } = setup();
    await expect(
      codeOf(handlers['page.click']({ snapshot_id: 's9-old', element_id: 'e1' })),
    ).resolves.toBe('stale_snapshot');
    await handlers['page.snapshot']({ tab_id: first, max: 120, settle_ms: 0 });
    browser.tabs = browser.tabs.filter((candidate) => candidate.id !== first);
    await expect(
      codeOf(handlers['page.click']({ snapshot_id: 's1-test', element_id: 'e1' })),
    ).resolves.toBe('stale_snapshot');
  });

  it('does not remember a snapshot that failed', async () => {
    const { handlers, run } = setup();
    run.mockRejectedValueOnce(new ProtocolError('restricted_page', 'no'));
    await expect(codeOf(handlers['page.snapshot']({ max: 120, settle_ms: 0 }))).resolves.toBe(
      'restricted_page',
    );
    await expect(
      codeOf(handlers['page.click']({ snapshot_id: 's1-test', element_id: 'e1' })),
    ).resolves.toBe('stale_snapshot');
  });

  it('forgets the oldest snapshots after a while', async () => {
    const { handlers } = setup();
    for (let i = 0; i < 70; i += 1) await handlers['page.snapshot']({ max: 1, settle_ms: 0 });
    await expect(
      codeOf(handlers['page.click']({ snapshot_id: 's1-test', element_id: 'e1' })),
    ).resolves.toBe('stale_snapshot');
    await expect(
      handlers['page.click']({ snapshot_id: 's70-test', element_id: 'e1' }),
    ).resolves.toBeDefined();
  });

  it('scrolls the named tab or the active one', async () => {
    const { handlers, run, first, second } = setup();
    await handlers['page.scroll']({ direction: 'down' });
    expect(run).toHaveBeenLastCalledWith(expect.objectContaining({ id: first }), {
      op: 'scroll',
      args: { direction: 'down' },
    });
    await handlers['page.scroll']({ tab_id: second, direction: 'top' });
    expect(run).toHaveBeenLastCalledWith(expect.objectContaining({ id: second }), {
      op: 'scroll',
      args: { direction: 'top' },
    });
    await expect(codeOf(handlers['page.scroll']({ tab_id: 999, direction: 'up' }))).resolves.toBe(
      'not_found',
    );
  });
});
