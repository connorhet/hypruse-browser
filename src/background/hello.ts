import { PROTOCOL_VERSION, type Hello } from '../shared/protocol';

type Brand = { brand: string; version: string };

// navigator.userAgentData is not in the TypeScript DOM library yet.
export type NavigatorLike = {
  userAgent: string;
  userAgentData?: {
    getHighEntropyValues(hints: string[]): Promise<{ fullVersionList?: Brand[] }>;
  };
};

const GREASE = /not.?a.?brand/i;

function shortName(brand: string): string {
  return brand.replace(/^(Google|Microsoft) /, '');
}

// "Chrome/151.0.7922.137". The user agent string only carries "151.0.0.0" since Chrome
// reduced it, so the full version comes from client hints when they are available.
export async function describeBrowser(nav: NavigatorLike): Promise<string> {
  try {
    const values = await nav.userAgentData?.getHighEntropyValues(['fullVersionList']);
    const brands = (values?.fullVersionList ?? []).filter((entry) => !GREASE.test(entry.brand));
    const brand =
      brands.find((entry) => entry.brand !== 'Chromium') ??
      brands.find((entry) => entry.brand === 'Chromium');
    if (brand) return `${shortName(brand.brand)}/${brand.version}`;
  } catch {
    // Fall back to the user agent string below.
  }
  const match = /(Chrome|Chromium)\/([\d.]+)/.exec(nav.userAgent);
  return match ? `${match[1] ?? 'Chrome'}/${match[2] ?? ''}` : 'unknown';
}

export async function buildHello(extensionVersion: string, nav: NavigatorLike): Promise<Hello> {
  return {
    hello: {
      protocol: PROTOCOL_VERSION,
      extension: extensionVersion,
      browser: await describeBrowser(nav),
    },
  };
}
