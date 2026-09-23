import { expect, test, type Page } from '@playwright/test';
import type { Snapshot, SnapshotElement, TabInfo } from '../../src/shared/protocol';
import { EXTENSION_ID, FIXTURES, launch, type Harness } from './harness';

// Every operation runs for real: requests go through the dispatcher in the extension's
// service worker, which drives Chromium's tabs and injects content.js into the fixture pages.

let harness: Harness;

test.beforeAll(async () => {
  harness = await launch();
});

test.afterAll(async () => {
  await harness.close();
});

async function open(path: string): Promise<{ page: Page; tabId: number }> {
  const page = await harness.context.newPage();
  await page.goto(`${FIXTURES}${path}`);
  return { page, tabId: await harness.tabIdOf(page) };
}

async function snapshot(tabId: number, args: Record<string, unknown> = {}): Promise<Snapshot> {
  return harness.call<Snapshot>('page.snapshot', { tab_id: tabId, ...args });
}

function byName(snap: Snapshot, name: string): SnapshotElement {
  const element = snap.elements.find((candidate) => candidate.name === name);
  if (!element) {
    throw new Error(`no element named ${name} in ${snap.elements.map((e) => e.name).join(', ')}`);
  }
  return element;
}

test('loads with the pinned extension id and answers ping', async () => {
  expect(harness.extensionId).toBe(EXTENSION_ID);
  await expect(harness.call('ping')).resolves.toEqual({ extension: '0.1.0' });
});

test('answers bad_request for an unknown op or bad args', async () => {
  await expect(harness.request('tabs.fly')).resolves.toMatchObject({
    ok: false,
    error: { code: 'bad_request' },
  });
  await expect(harness.request('tabs.activate', { tab_id: 'x' })).resolves.toMatchObject({
    ok: false,
    error: { code: 'bad_request' },
  });
});

test.describe('tabs', () => {
  test('lists, opens, activates, navigates and closes tabs', async () => {
    const { page, tabId } = await open('/results.html');
    const { tabs } = await harness.call<{ tabs: TabInfo[] }>('tabs.list');
    expect(tabs.find((tab) => tab.id === tabId)).toMatchObject({
      url: `${FIXTURES}/results.html`,
      title: 'Results fixture',
      audible: false,
    });

    const opened = await harness.call<{ tab_id: number }>('tabs.open', {
      url: `${FIXTURES}/target.html`,
      where: 'new',
    });
    await expect
      .poll(async () => {
        const list = await harness.call<{ tabs: TabInfo[] }>('tabs.list');
        return list.tabs.find((tab) => tab.id === opened.tab_id)?.title;
      })
      .toBe('Target fixture');

    await harness.call('tabs.activate', { tab_id: tabId });
    await expect
      .poll(async () => {
        const list = await harness.call<{ tabs: TabInfo[] }>('tabs.list');
        return list.tabs.find((tab) => tab.id === tabId)?.active;
      })
      .toBe(true);

    await harness.call('tabs.close', { tab_id: opened.tab_id });
    await expect
      .poll(async () => {
        const list = await harness.call<{ tabs: TabInfo[] }>('tabs.list');
        return list.tabs.some((tab) => tab.id === opened.tab_id);
      })
      .toBe(false);
    await expect(harness.request('tabs.close', { tab_id: opened.tab_id })).resolves.toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    await page.close();
  });

  test('goes back and forward in a tab', async () => {
    const { page, tabId } = await open('/results.html');
    await page.goto(`${FIXTURES}/target.html`);
    await harness.call('tabs.history', { tab_id: tabId, direction: 'back' });
    await expect(page).toHaveURL(`${FIXTURES}/results.html`);
    await harness.call('tabs.history', { tab_id: tabId, direction: 'forward' });
    await expect(page).toHaveURL(`${FIXTURES}/target.html`);
    await page.close();
  });

  test('opens in the current tab', async () => {
    const { page, tabId } = await open('/results.html');
    await harness.call('tabs.activate', { tab_id: tabId });
    const result = await harness.call<{ tab_id: number }>('tabs.open', {
      url: `${FIXTURES}/target.html?current=1`,
      where: 'current',
    });
    expect(result.tab_id).toBe(tabId);
    await expect(page).toHaveURL(`${FIXTURES}/target.html?current=1`);
    await page.close();
  });

  test('refuses to open anything but http and https', async () => {
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'chrome://settings']) {
      await expect(harness.request('tabs.open', { url, where: 'new' })).resolves.toMatchObject({
        ok: false,
        error: { code: 'refused' },
      });
    }
  });

  test('reads top sites', async () => {
    const result = await harness.call<{ sites: unknown[] }>('sites.top');
    expect(Array.isArray(result.sites)).toBe(true);
  });
});

test.describe('page snapshot', () => {
  test('numbers results, skips covered and hidden elements, and reads headings', async () => {
    const { page, tabId } = await open('/results.html');
    const snap = await snapshot(tabId);
    expect(snap).toMatchObject({
      tab_id: tabId,
      url: `${FIXTURES}/results.html`,
      title: 'Results fixture',
    });
    expect(snap.snapshot_id).toMatch(/^s\d+-[0-9a-z]{4}$/);
    expect(snap.headings).toContain('Results for lofi');
    expect(snap.viewport.width).toBeGreaterThan(0);
    expect(snap.viewport.scroll_height).toBeGreaterThan(snap.viewport.height);

    const second = byName(snap, 'Result number 2');
    expect(second).toMatchObject({ role: 'link', kind: 'link', in_view: true });
    expect(second.list).toMatchObject({ index: 2, size: 20 });
    const more = snap.elements.filter((element) => element.name === 'More actions');
    expect(more.length).toBeGreaterThan(1);
    expect(more[1]!.list).toMatchObject({ group: second.list!.group, index: 2 });

    expect(byName(snap, 'Search results').kind).toBe('search');
    expect(byName(snap, 'Main menu').kind).toBe('button');
    expect(byName(snap, 'Accept cookies').in_view).toBe(true);
    const names = snap.elements.map((element) => element.name);
    expect(names).not.toContain('Hidden behind the banner');
    expect(names).not.toContain('Aria hidden button');
    expect(names).not.toContain('Invisible button');
    expect(snap.elements[0]!.id).toBe('e1');
    await page.close();
  });

  test('cuts the element list to max', async () => {
    const { page, tabId } = await open('/results.html');
    const snap = await snapshot(tabId, { max: 5 });
    expect(snap.elements).toHaveLength(5);
    await page.close();
  });

  test('clicks the second result by its handle', async () => {
    const { page, tabId } = await open('/results.html');
    const snap = await snapshot(tabId);
    const second = byName(snap, 'Result number 2');
    await harness.call('page.click', { snapshot_id: snap.snapshot_id, element_id: second.id });
    await expect(page).toHaveURL(`${FIXTURES}/target.html?n=2`);
    await page.close();
  });

  test('scrolls an element below the fold into view before clicking it', async () => {
    const { page, tabId } = await open('/results.html');
    const snap = await snapshot(tabId);
    const below = snap.elements.find((element) => !element.in_view && element.kind === 'link');
    expect(below).toBeDefined();
    await harness.call('page.click', { snapshot_id: snap.snapshot_id, element_id: below!.id });
    await expect(page).toHaveURL(/\/target\.html\?n=\d+$/);
    await page.close();
  });

  test('answers stale_snapshot for an old snapshot and after a reload', async () => {
    const { page, tabId } = await open('/results.html');
    const first = await snapshot(tabId);
    const second = await snapshot(tabId);
    const id = byName(first, 'Result number 1').id;
    await expect(
      harness.request('page.click', { snapshot_id: first.snapshot_id, element_id: id }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'stale_snapshot' } });
    await page.reload();
    await expect(
      harness.request('page.click', { snapshot_id: second.snapshot_id, element_id: id }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'stale_snapshot' } });
    await expect(
      harness.request('page.click', { snapshot_id: 's999-zzzz', element_id: 'e1' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'stale_snapshot' } });
    await page.close();
  });

  test('answers restricted_page for a browser page', async () => {
    const page = await harness.context.newPage();
    await page.goto('chrome://version');
    const { tabs } = await harness.call<{ tabs: TabInfo[] }>('tabs.list');
    const tab = tabs.find((candidate) => candidate.url.startsWith('chrome://version'));
    expect(tab).toBeDefined();
    await expect(harness.request('page.snapshot', { tab_id: tab!.id })).resolves.toMatchObject({
      ok: false,
      error: { code: 'restricted_page' },
    });
    await page.close();
  });

  test('snapshots the active tab of the last focused window by default', async () => {
    const { page, tabId } = await open('/target.html');
    await harness.call('tabs.activate', { tab_id: tabId });
    await expect
      .poll(async () => (await harness.call<Snapshot>('page.snapshot')).tab_id)
      .toBe(tabId);
    await page.close();
  });
});

test.describe('track list in a scrolling panel', () => {
  test('numbers rows, finds cursor: pointer elements, and clicks a row button', async () => {
    const { page, tabId } = await open('/tracks.html');
    const snap = await snapshot(tabId);
    const play = byName(snap, 'Play Song 2 by Artist 2');
    expect(play.list).toMatchObject({ index: 2, size: 50 });
    expect(byName(snap, 'Song 2').list).toMatchObject({ group: play.list!.group, index: 2 });
    expect(byName(snap, 'Made for you')).toMatchObject({ role: 'generic', kind: 'other' });
    await harness.call('page.click', { snapshot_id: snap.snapshot_id, element_id: play.id });
    await expect(page.locator('#now')).toHaveText('Now playing: Song 2 by Artist 2');

    const shelf = byName(snap, 'Recently played');
    await harness.call('page.click', { snapshot_id: snap.snapshot_id, element_id: shelf.id });
    await expect(page.locator('#now')).toHaveText('Shelf: Recently played');
    await page.close();
  });

  test('scrolls the panel that scrolls, not the document', async () => {
    const { page, tabId } = await open('/tracks.html');
    const clientHeight = await page.locator('#main').evaluate((main) => main.clientHeight);
    const result = await harness.call<{ scroll_y: number; scroll_height: number }>('page.scroll', {
      tab_id: tabId,
      direction: 'down',
    });
    expect(result.scroll_y).toBe(Math.round(clientHeight * 0.8));
    expect(result.scroll_height).toBeGreaterThan(clientHeight);
    await expect
      .poll(() => page.locator('#main').evaluate((main) => Math.round(main.scrollTop)))
      .toBe(result.scroll_y);
    expect(await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)).toBe(0);

    const after = await snapshot(tabId);
    const firstRow = after.elements.find((element) => element.name.startsWith('Play Song'));
    expect(firstRow?.list?.index).toBeGreaterThan(1);

    const bottom = await harness.call<{ scroll_y: number }>('page.scroll', {
      tab_id: tabId,
      direction: 'bottom',
    });
    await expect
      .poll(() => page.locator('#main').evaluate((main) => Math.round(main.scrollTop)))
      .toBe(bottom.scroll_y);
    const top = await harness.call<{ scroll_y: number }>('page.scroll', {
      tab_id: tabId,
      direction: 'top',
    });
    expect(top.scroll_y).toBe(0);
    await page.close();
  });

  test('scrolls the document on an ordinary page', async () => {
    const { page, tabId } = await open('/results.html');
    const result = await harness.call<{ scroll_y: number }>('page.scroll', {
      tab_id: tabId,
      direction: 'down',
    });
    expect(result.scroll_y).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(result.scroll_y);
    await page.close();
  });
});

test.describe('search form', () => {
  test('types into the search box, submits, and snapshots the results once they settle', async () => {
    const { page, tabId } = await open('/search.html');
    const snap = await snapshot(tabId);
    const box = snap.elements.find((element) => element.kind === 'search');
    expect(box?.name).toBe('What do you want to play?');
    await harness.call('page.type', {
      snapshot_id: snap.snapshot_id,
      element_id: box!.id,
      text: 'lofi beats',
      submit: true,
    });
    await expect(page.locator('#state')).toHaveText('query: lofi beats');
    await expect(page.locator('#keys')).toHaveText('Enter/Enter/13');
    await expect(page.locator('#submits')).toHaveText('1');

    const settled = await snapshot(tabId, { settle_ms: 5000 });
    const hit = byName(settled, 'lofi beats result 2');
    expect(hit.list).toMatchObject({ index: 2, size: 3 });
    await page.close();
  });

  test('refuses password and card fields and never reads values', async () => {
    const { page, tabId } = await open('/search.html');
    const snap = await snapshot(tabId);
    for (const name of ['Password', 'Card number']) {
      await expect(
        harness.request('page.type', {
          snapshot_id: snap.snapshot_id,
          element_id: byName(snap, name).id,
          text: 'secret',
        }),
      ).resolves.toMatchObject({ ok: false, error: { code: 'refused' } });
    }
    await expect(page.locator('#password')).toHaveValue('');
    await expect(page.locator('#card')).toHaveValue('');

    await harness.call('page.type', {
      snapshot_id: snap.snapshot_id,
      element_id: byName(snap, 'Message').id,
      text: 'typed into the editor',
    });
    await expect(page.locator('#editor')).toHaveText('typed into the editor');
    await harness.call('page.type', {
      snapshot_id: snap.snapshot_id,
      element_id: byName(snap, 'What do you want to play?').id,
      text: 'private query',
    });

    const json = JSON.stringify(await snapshot(tabId));
    for (const secret of ['my secret note', 'typed into the editor', 'private query']) {
      expect(json).not.toContain(secret);
    }
    await page.close();
  });
});
