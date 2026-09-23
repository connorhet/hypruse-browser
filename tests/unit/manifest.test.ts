import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

type Manifest = {
  manifest_version: number;
  name: string;
  version: string;
  minimum_chrome_version: string;
  key: string;
  incognito: string;
  permissions: string[];
  host_permissions: string[];
  background: { service_worker: string; type: string };
  icons: Record<string, string>;
  action?: unknown;
  options_page?: unknown;
};

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
}

function extensionIdFromKey(key: string): string {
  const digest = createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex');
  return Array.from(digest.slice(0, 32), (hex) =>
    String.fromCharCode('a'.charCodeAt(0) + parseInt(hex, 16)),
  ).join('');
}

const manifest = readJson('../../public/manifest.json') as Manifest;

describe('manifest', () => {
  it('pins the extension id the native host allows', () => {
    expect(extensionIdFromKey(manifest.key)).toBe('pcfjlemgcbbpppclachnobhnnnahpgoj');
  });

  it('matches the package version', () => {
    expect(manifest.version).toBe((readJson('../../package.json') as { version: string }).version);
  });

  it('asks for exactly the permissions the protocol needs', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.minimum_chrome_version).toBe('116');
    expect(manifest.incognito).toBe('not_allowed');
    expect([...manifest.permissions].sort()).toEqual(
      ['alarms', 'nativeMessaging', 'scripting', 'tabs', 'topSites'].sort(),
    );
    expect(manifest.host_permissions).toEqual(['<all_urls>']);
  });

  it('runs a module service worker and has no user interface', () => {
    expect(manifest.background).toEqual({ service_worker: 'background.js', type: 'module' });
    expect(manifest.action).toBeUndefined();
    expect(manifest.options_page).toBeUndefined();
    expect(Object.keys(manifest.icons).sort()).toEqual(['128', '16', '32', '48']);
  });
});
