import type { BrowserApi } from './chrome';
import type { Handlers } from './dispatch';

export type Site = { url: string; host: string; title: string };

function toSite(entry: chrome.topSites.MostVisitedURL): Site | null {
  let url: URL;
  try {
    url = new URL(entry.url);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return { url: entry.url, host: url.hostname, title: entry.title };
}

export function createSiteHandlers(api: BrowserApi): Pick<Handlers, 'sites.top'> {
  return {
    'sites.top': async () => {
      const entries = await api.topSites.get();
      return { sites: entries.map(toSite).filter((site) => site !== null) };
    },
  };
}
