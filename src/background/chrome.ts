// The slice of the Chrome API the service worker uses, behind small interfaces so the
// handlers can be tested with fakes.
import { CONTENT_FILE, type ScriptRunner } from './inject';

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

export function chromeScriptRunner(): ScriptRunner {
  return {
    async inject(tabId, frameId) {
      const target = frameId === undefined ? { tabId } : { tabId, frameIds: [frameId] };
      await chrome.scripting.executeScript({ target, files: [CONTENT_FILE] });
    },
    async callFrames(tabId, request, version) {
      const target = { tabId, allFrames: true };
      // a frame Chrome will not script is skipped; the install failing as a whole only
      // means no frame gets an agent, which the call below then shows as no answer
      await chrome.scripting.executeScript({ target, files: [CONTENT_FILE] }).catch(() => []);
      const results = await chrome.scripting.executeScript({
        target,
        func: (op: string, args: unknown, expected: string) => {
          const agent = globalThis.__hypruseBrowser;
          return agent?.version === expected ? agent.handle(op, args) : null;
        },
        args: [request.op, request.args, version],
      });
      return results.map((result) => ({ frameId: result.frameId, result: result.result }));
    },
    async call(tabId, request, version, frameId) {
      const results = await chrome.scripting.executeScript({
        target: frameId === undefined ? { tabId } : { tabId, frameIds: [frameId] },
        // Serialised and run in the page, so it may use nothing from this module.
        func: (op: string, args: unknown, expected: string) => {
          const agent = globalThis.__hypruseBrowser;
          return agent?.version === expected ? agent.handle(op, args) : null;
        },
        args: [request.op, request.args, version],
      });
      return results[0]?.result;
    },
  };
}
