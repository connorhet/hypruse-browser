import type { TabsChangedEvent, TabsChangedReason } from '../shared/protocol';

export const EVENT_INTERVAL_MS = 200;

export type TabEvents = { notify(reason: TabsChangedReason, tabId: number): void };

type TimerDeps = {
  setTimer?: (callback: () => void, ms: number) => unknown;
  intervalMs?: number;
};

// At most one tabs.changed per tab every 200 ms. The first change goes out at once; changes
// that arrive inside the window collapse into one trailing event carrying the latest reason,
// so the final state of a burst is never lost.
export function createTabEvents(
  emit: (event: TabsChangedEvent) => void,
  deps: TimerDeps = {},
): TabEvents {
  const setTimer = deps.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const interval = deps.intervalMs ?? EVENT_INTERVAL_MS;
  const pending = new Map<number, TabsChangedReason | null>();

  const send = (reason: TabsChangedReason, tabId: number) =>
    emit({ event: 'tabs.changed', data: { reason, tab_id: tabId } });

  const flush = (tabId: number) => {
    const reason = pending.get(tabId);
    if (reason) {
      send(reason, tabId);
      pending.set(tabId, null);
      setTimer(() => flush(tabId), interval);
    } else {
      pending.delete(tabId);
    }
  };

  return {
    notify(reason, tabId) {
      if (pending.has(tabId)) {
        pending.set(tabId, reason);
        return;
      }
      send(reason, tabId);
      pending.set(tabId, null);
      setTimer(() => flush(tabId), interval);
    },
  };
}

type TabEventSource = {
  onActivated: { addListener(listener: (info: { tabId: number }) => void): void };
  onCreated: { addListener(listener: (tab: { id?: number | undefined }) => void): void };
  onRemoved: { addListener(listener: (tabId: number) => void): void };
  onUpdated: {
    addListener(
      listener: (tabId: number, change: { status?: string; title?: string }) => void,
    ): void;
  };
};

// Only a finished load or a new title counts as an update; favicon and audio changes do not.
export function watchTabs(source: TabEventSource, events: TabEvents): void {
  source.onActivated.addListener(({ tabId }) => events.notify('activated', tabId));
  source.onCreated.addListener((tab) => {
    if (tab.id !== undefined) events.notify('created', tab.id);
  });
  source.onRemoved.addListener((tabId) => events.notify('removed', tabId));
  source.onUpdated.addListener((tabId, change) => {
    if (change.status === 'complete' || change.title !== undefined) {
      events.notify('updated', tabId);
    }
  });
}
