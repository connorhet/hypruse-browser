// The slice of the Chrome API the service worker uses, behind small interfaces so the
// handlers can be tested with fakes.

export type TabsApi = {
  get(tabId: number): Promise<chrome.tabs.Tab>;
  query(query: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]>;
  update(tabId: number, properties: chrome.tabs.UpdateProperties): Promise<unknown>;
  create(properties: chrome.tabs.CreateProperties): Promise<chrome.tabs.Tab>;
  remove(tabId: number): Promise<void>;
  goBack(tabId: number): Promise<void>;
  goForward(tabId: number): Promise<void>;
};

export type WindowsApi = {
  getAll(query: chrome.windows.QueryOptions): Promise<chrome.windows.Window[]>;
  getLastFocused(query: chrome.windows.QueryOptions): Promise<chrome.windows.Window>;
  update(windowId: number, info: chrome.windows.UpdateInfo): Promise<unknown>;
  create(data: chrome.windows.CreateData): Promise<chrome.windows.Window | undefined>;
};

export type TopSitesApi = {
  get(): Promise<chrome.topSites.MostVisitedURL[]>;
};

export type BrowserApi = { tabs: TabsApi; windows: WindowsApi; topSites: TopSitesApi };

export function chromeBrowserApi(): BrowserApi {
  return {
    tabs: {
      get: (tabId) => chrome.tabs.get(tabId),
      query: (query) => chrome.tabs.query(query),
      update: (tabId, properties) => chrome.tabs.update(tabId, properties),
      create: (properties) => chrome.tabs.create(properties),
      remove: (tabId) => chrome.tabs.remove(tabId),
      goBack: (tabId) => chrome.tabs.goBack(tabId),
      goForward: (tabId) => chrome.tabs.goForward(tabId),
    },
    windows: {
      getAll: (query) => chrome.windows.getAll(query),
      getLastFocused: (query) => chrome.windows.getLastFocused(query),
      update: (windowId, info) => chrome.windows.update(windowId, info),
      create: (data) => chrome.windows.create(data),
    },
    topSites: {
      get: () => chrome.topSites.get(),
    },
  };
}
