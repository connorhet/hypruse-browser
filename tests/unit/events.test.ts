import { createTabEvents, watchTabs } from '../../src/background/events';
import type { TabsChangedEvent } from '../../src/shared/protocol';

type Listener = (...args: never[]) => void;

function source() {
  const listeners: Record<string, Listener[]> = {};
  const channel = (name: string) => ({
    addListener: (listener: Listener) => (listeners[name] ??= []).push(listener),
  });
  return {
    api: {
      onActivated: channel('activated'),
      onCreated: channel('created'),
      onRemoved: channel('removed'),
      onUpdated: channel('updated'),
    },
    fire(name: string, ...args: unknown[]) {
      for (const listener of listeners[name] ?? [])
        (listener as (...a: unknown[]) => void)(...args);
    },
  };
}

describe('createTabEvents', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends the first change at once', () => {
    const emitted: TabsChangedEvent[] = [];
    const events = createTabEvents((event) => emitted.push(event));
    events.notify('activated', 12);
    expect(emitted).toEqual([{ event: 'tabs.changed', data: { reason: 'activated', tab_id: 12 } }]);
  });

  it('collapses a burst into one trailing event with the latest reason', () => {
    const emitted: TabsChangedEvent[] = [];
    const events = createTabEvents((event) => emitted.push(event));
    events.notify('created', 5);
    events.notify('updated', 5);
    events.notify('activated', 5);
    expect(emitted).toHaveLength(1);
    vi.advanceTimersByTime(200);
    expect(emitted.map((event) => event.data.reason)).toEqual(['created', 'activated']);
    vi.advanceTimersByTime(200);
    expect(emitted).toHaveLength(2);
  });

  it('throttles each tab on its own', () => {
    const emitted: TabsChangedEvent[] = [];
    const events = createTabEvents((event) => emitted.push(event));
    events.notify('updated', 1);
    events.notify('updated', 2);
    expect(emitted.map((event) => event.data.tab_id)).toEqual([1, 2]);
  });

  it('sends at once again after a quiet interval', () => {
    const emitted: TabsChangedEvent[] = [];
    const events = createTabEvents((event) => emitted.push(event));
    events.notify('updated', 1);
    vi.advanceTimersByTime(250);
    events.notify('removed', 1);
    expect(emitted.map((event) => event.data.reason)).toEqual(['updated', 'removed']);
  });
});

describe('watchTabs', () => {
  it('reports activation, creation, removal, finished loads and new titles', () => {
    const notify = vi.fn();
    const tabs = source();
    watchTabs(tabs.api, { notify });
    tabs.fire('activated', { tabId: 1, windowId: 9 });
    tabs.fire('created', { id: 2 });
    tabs.fire('removed', 3, { windowId: 9, isWindowClosing: false });
    tabs.fire('updated', 4, { status: 'complete' });
    tabs.fire('updated', 5, { title: 'New title' });
    expect(notify.mock.calls).toEqual([
      ['activated', 1],
      ['created', 2],
      ['removed', 3],
      ['updated', 4],
      ['updated', 5],
    ]);
  });

  it('ignores loading, favicon and audio updates', () => {
    const notify = vi.fn();
    const tabs = source();
    watchTabs(tabs.api, { notify });
    tabs.fire('updated', 4, { status: 'loading' });
    tabs.fire('updated', 4, { favIconUrl: 'https://example.com/icon.png' });
    tabs.fire('updated', 4, { audible: true });
    tabs.fire('created', {});
    expect(notify).not.toHaveBeenCalled();
  });
});
