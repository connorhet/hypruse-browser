import type { BrowserApi } from '../../src/background/chrome';

type FakeTab = chrome.tabs.Tab & { id: number; history: string[]; position: number };

// An in-memory browser with windows and tabs, enough for the tab handlers.
export class FakeBrowser {
  windows: chrome.windows.Window[] = [];
  tabs: FakeTab[] = [];
  lastFocusedId: number | null = null;
  topSites: chrome.topSites.MostVisitedURL[] = [];
  private nextId = 100;

  addWindow(options: { focused?: boolean; type?: chrome.windows.Window['type'] } = {}): number {
    const id = this.nextId++;
    this.windows.push({
      id,
      focused: options.focused ?? false,
      type: options.type ?? 'normal',
      incognito: false,
      alwaysOnTop: false,
      state: 'normal',
    });
    if (options.focused) this.lastFocusedId = id;
    return id;
  }

  addTab(
    windowId: number,
    url: string,
    options: { active?: boolean; title?: string } = {},
  ): number {
    const id = this.nextId++;
    const index = this.tabs.filter((tab) => tab.windowId === windowId).length;
    this.tabs.push({
      id,
      windowId,
      index,
      url,
      title: options.title ?? url,
      active: options.active ?? false,
      audible: false,
      history: [url],
      position: 0,
    } as FakeTab);
    return id;
  }

  tab(id: number): FakeTab {
    const tab = this.tabs.find((candidate) => candidate.id === id);
    if (!tab) throw new Error(`No tab with id: ${id}.`);
    return tab;
  }

  private activate(tab: FakeTab): void {
    for (const other of this.tabs) {
      if (other.windowId === tab.windowId) other.active = other.id === tab.id;
    }
  }

  api(): BrowserApi {
    return {
      tabs: {
        get: async (id) => this.tab(id),
        query: async (query) =>
          this.tabs.filter(
            (tab) =>
              (query.active === undefined || tab.active === query.active) &&
              (query.windowId === undefined || tab.windowId === query.windowId) &&
              (!query.lastFocusedWindow || tab.windowId === this.lastFocusedId),
          ),
        update: async (id, properties) => {
          const tab = this.tab(id);
          if (properties.active) this.activate(tab);
          if (properties.url !== undefined) {
            tab.history = [...tab.history.slice(0, tab.position + 1), properties.url];
            tab.position = tab.history.length - 1;
            tab.url = properties.url;
          }
          return tab;
        },
        create: async (properties) => {
          const windowId = properties.windowId ?? this.lastFocusedId;
          if (windowId === null) throw new Error('no window');
          const id = this.addTab(windowId, properties.url ?? 'about:blank');
          const tab = this.tab(id);
          if (properties.active ?? true) this.activate(tab);
          return tab;
        },
        remove: async (id) => {
          this.tab(id);
          this.tabs = this.tabs.filter((tab) => tab.id !== id);
        },
        goBack: async (id) => {
          const tab = this.tab(id);
          if (tab.position === 0) throw new Error('Cannot find a next page in history.');
          tab.position -= 1;
          tab.url = tab.history[tab.position]!;
        },
        goForward: async (id) => {
          const tab = this.tab(id);
          if (tab.position >= tab.history.length - 1) {
            throw new Error('Cannot find a next page in history.');
          }
          tab.position += 1;
          tab.url = tab.history[tab.position]!;
        },
      },
      windows: {
        getAll: async (query) =>
          this.windows
            .filter((win) => !query.windowTypes || query.windowTypes.includes(win.type!))
            .map((win) => ({
              ...win,
              tabs: query.populate ? this.tabs.filter((tab) => tab.windowId === win.id) : [],
            })),
        getLastFocused: async () => {
          const win = this.windows.find((candidate) => candidate.id === this.lastFocusedId);
          if (!win) throw new Error('No last-focused window');
          return win;
        },
        update: async (id, info) => {
          const win = this.windows.find((candidate) => candidate.id === id);
          if (!win) throw new Error(`No window with id: ${id}.`);
          if (info.focused) {
            for (const other of this.windows) other.focused = other.id === id;
            this.lastFocusedId = id;
          }
          return win;
        },
        create: async (data) => {
          const id = this.addWindow({ focused: data.focused ?? true });
          const url = typeof data.url === 'string' ? data.url : 'about:blank';
          this.addTab(id, url, { active: true });
          return { ...this.windows.at(-1)!, tabs: this.tabs.filter((tab) => tab.windowId === id) };
        },
      },
      topSites: {
        get: async () => this.topSites,
      },
    };
  }
}
