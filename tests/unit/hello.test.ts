import { buildHello, describeBrowser } from '../../src/background/hello';

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

function withBrands(brands: { brand: string; version: string }[]) {
  return {
    userAgent: UA,
    userAgentData: { getHighEntropyValues: async () => ({ fullVersionList: brands }) },
  };
}

describe('describeBrowser', () => {
  it('reports the full Chrome version from client hints', async () => {
    const nav = withBrands([
      { brand: 'Not)A;Brand', version: '99.0.0.0' },
      { brand: 'Chromium', version: '151.0.7922.137' },
      { brand: 'Google Chrome', version: '151.0.7922.137' },
    ]);
    await expect(describeBrowser(nav)).resolves.toBe('Chrome/151.0.7922.137');
  });

  it('names other Chromium browsers by their brand', async () => {
    const nav = withBrands([
      { brand: 'Chromium', version: '151.0.7922.137' },
      { brand: 'Brave', version: '151.0.7922.137' },
    ]);
    await expect(describeBrowser(nav)).resolves.toBe('Brave/151.0.7922.137');
  });

  it('reports plain Chromium', async () => {
    const nav = withBrands([
      { brand: 'Not_A Brand', version: '24.0.0.0' },
      { brand: 'Chromium', version: '151.0.7922.34' },
    ]);
    await expect(describeBrowser(nav)).resolves.toBe('Chromium/151.0.7922.34');
  });

  it('falls back to the user agent string', async () => {
    await expect(describeBrowser({ userAgent: UA })).resolves.toBe('Chrome/151.0.0.0');
    const failing = {
      userAgent: UA,
      userAgentData: {
        getHighEntropyValues: () => Promise.reject(new Error('not allowed')),
      },
    };
    await expect(describeBrowser(failing)).resolves.toBe('Chrome/151.0.0.0');
    await expect(describeBrowser({ userAgent: 'curl/8' })).resolves.toBe('unknown');
  });
});

describe('buildHello', () => {
  it('carries the protocol and extension versions', async () => {
    await expect(buildHello('0.1.0', { userAgent: UA })).resolves.toEqual({
      hello: { protocol: 1, extension: '0.1.0', browser: 'Chrome/151.0.0.0' },
    });
  });
});
