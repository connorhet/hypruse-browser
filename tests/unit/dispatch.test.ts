import { createDispatcher, toProtocolError, type Handlers } from '../../src/background/dispatch';
import { ProtocolError } from '../../src/shared/protocol';

function handlers(overrides: Partial<Handlers> = {}): Handlers {
  const unused = () => Promise.reject(new Error('not used in this test'));
  return {
    ping: async () => ({ extension: '0.1.0' }),
    'tabs.list': unused,
    'tabs.activate': unused,
    'tabs.open': unused,
    'tabs.close': unused,
    'tabs.history': unused,
    'page.snapshot': unused,
    'page.click': unused,
    'page.type': unused,
    'page.scroll': unused,
    'sites.top': unused,
    ...overrides,
  };
}

describe('createDispatcher', () => {
  it('answers a request with its result', async () => {
    const dispatch = createDispatcher(handlers());
    await expect(dispatch({ id: 'h1', op: 'ping' })).resolves.toEqual({
      id: 'h1',
      ok: true,
      result: { extension: '0.1.0' },
    });
  });

  it('passes validated args with defaults to the handler', async () => {
    const snapshot = vi.fn(async () => ({ elements: [] }));
    const dispatch = createDispatcher(handlers({ 'page.snapshot': snapshot }));
    await dispatch({ id: 'h2', op: 'page.snapshot', args: { tab_id: 4 } });
    expect(snapshot).toHaveBeenCalledWith({ tab_id: 4, max: 120, settle_ms: 0 });
  });

  it('maps an unknown op to bad_request', async () => {
    const dispatch = createDispatcher(handlers());
    await expect(dispatch({ id: 'h3', op: 'tabs.fly' })).resolves.toEqual({
      id: 'h3',
      ok: false,
      error: { code: 'bad_request', message: 'unknown op: tabs.fly' },
    });
  });

  it('maps bad args to bad_request without calling the handler', async () => {
    const activate = vi.fn(async () => ({}));
    const dispatch = createDispatcher(handlers({ 'tabs.activate': activate }));
    const response = await dispatch({ id: 'h4', op: 'tabs.activate', args: { tab_id: 'x' } });
    expect(response).toMatchObject({ id: 'h4', ok: false, error: { code: 'bad_request' } });
    expect(activate).not.toHaveBeenCalled();
  });

  it('keeps the code of a protocol error', async () => {
    const dispatch = createDispatcher(
      handlers({
        'tabs.close': async () => {
          throw new ProtocolError('not_found', 'no tab with id 9');
        },
      }),
    );
    await expect(dispatch({ id: 'h5', op: 'tabs.close', args: { tab_id: 9 } })).resolves.toEqual({
      id: 'h5',
      ok: false,
      error: { code: 'not_found', message: 'no tab with id 9' },
    });
  });

  it('maps any other exception to internal with its message', async () => {
    const dispatch = createDispatcher(
      handlers({
        'sites.top': async () => {
          throw new TypeError('topSites is undefined');
        },
      }),
    );
    await expect(dispatch({ id: 'h6', op: 'sites.top' })).resolves.toEqual({
      id: 'h6',
      ok: false,
      error: { code: 'internal', message: 'topSites is undefined' },
    });
  });

  it('maps a synchronous throw and a thrown non-error to internal', async () => {
    const dispatch = createDispatcher(
      handlers({
        'tabs.list': () => {
          throw new Error('sync failure');
        },
        ping: async () => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw 'a string';
        },
      }),
    );
    await expect(dispatch({ id: 'a', op: 'tabs.list' })).resolves.toMatchObject({
      error: { code: 'internal', message: 'sync failure' },
    });
    await expect(dispatch({ id: 'b', op: 'ping' })).resolves.toMatchObject({
      error: { code: 'internal', message: 'a string' },
    });
  });

  it('answers timeout when a handler never finishes', async () => {
    vi.useFakeTimers();
    try {
      const dispatch = createDispatcher(
        handlers({ 'tabs.list': () => new Promise(() => undefined) }),
        {
          timeoutMs: () => 1000,
        },
      );
      const pending = dispatch({ id: 'h7', op: 'tabs.list' });
      await vi.advanceTimersByTimeAsync(1000);
      await expect(pending).resolves.toMatchObject({
        id: 'h7',
        ok: false,
        error: { code: 'timeout' },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives a snapshot its settle time on top of the default timeout', async () => {
    vi.useFakeTimers();
    try {
      let finish: (value: unknown) => void = () => undefined;
      const dispatch = createDispatcher(
        handlers({ 'page.snapshot': () => new Promise((resolve) => (finish = resolve)) }),
      );
      const pending = dispatch({ id: 'h8', op: 'page.snapshot', args: { settle_ms: 5000 } });
      await vi.advanceTimersByTimeAsync(24_000);
      finish({ elements: [] });
      await expect(pending).resolves.toMatchObject({ id: 'h8', ok: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns null for a message that is not a request', async () => {
    const log = vi.fn();
    const dispatch = createDispatcher(handlers(), { log });
    await expect(dispatch({ event: 'tabs.changed' })).resolves.toBeNull();
    expect(log).toHaveBeenCalledOnce();
  });
});

describe('toProtocolError', () => {
  it('uses the error name when the message is empty', () => {
    expect(toProtocolError(new RangeError())).toMatchObject({
      code: 'internal',
      message: 'RangeError',
    });
  });
});
