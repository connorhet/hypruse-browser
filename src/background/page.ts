import {
  ProtocolError,
  type PageRequest,
  type PageSnapshot,
  type Snapshot,
} from '../shared/protocol';
import type { BrowserApi } from './chrome';
import type { Handlers } from './dispatch';
import { mergeFrames, mergeText, splitElementId, type FramePage } from './frames';
import { TEXT_MAX } from '../content/pagetext';
import type { FrameRun, PageRun } from './inject';
import type { Staging } from './uploads';
import { getTab, resolveTab, type ResolvedTab } from './tabs';

type PageHandlers = Pick<
  Handlers,
  'page.snapshot' | 'page.click' | 'page.type' | 'page.scroll' | 'page.upload'
>;

// How many snapshot ids the worker remembers the tab of.
export const REMEMBERED_SNAPSHOTS = 64;

// Snapshot ids are "s<n>-<tag>", where the tag is random for each life of the service worker.
// Ids therefore never repeat after the worker restarts, and an id from before a restart is
// answered with stale_snapshot instead of pointing at some other tab's newer snapshot.
export function snapshotIds(random: () => number = Math.random): () => string {
  const tag = Math.floor(random() * 36 ** 4)
    .toString(36)
    .padStart(4, '0');
  let counter = 0;
  return () => `s${++counter}-${tag}`;
}

export function createPageHandlers(deps: {
  api: BrowserApi;
  run: PageRun;
  // The page's frames below the top one; without it a snapshot reads the top frame only.
  runFrames?: FrameRun;
  // Where page.upload finds the file files.stage brought in.
  staging?: Staging;
  nextSnapshotId?: () => string;
}): PageHandlers {
  const { api, run } = deps;
  const nextSnapshotId = deps.nextSnapshotId ?? snapshotIds();
  const owners = new Map<string, number>();

  const remember = (snapshotId: string, tabId: number) => {
    owners.set(snapshotId, tabId);
    for (const oldest of owners.keys()) {
      if (owners.size <= REMEMBERED_SNAPSHOTS) break;
      owners.delete(oldest);
    }
  };

  const ownerOf = async (snapshotId: string): Promise<ResolvedTab> => {
    const tabId = owners.get(snapshotId);
    if (tabId === undefined) {
      throw new ProtocolError('stale_snapshot', `unknown snapshot ${snapshotId}; take a new one`);
    }
    try {
      return await getTab(api, tabId);
    } catch {
      throw new ProtocolError('stale_snapshot', `the tab of snapshot ${snapshotId} is gone`);
    }
  };

  return {
    'page.snapshot': async ({ tab_id, max, settle_ms }): Promise<Snapshot> => {
      const tab = await resolveTab(api, tab_id);
      const snapshotId = nextSnapshotId();
      const page = (await run(tab, {
        op: 'snapshot',
        args: { snapshot_id: snapshotId, max, settle_ms },
      })) as PageSnapshot;
      // the top frame has settled, so the frames are read as they are now
      const frames: FramePage[] = deps.runFrames
        ? (
            await deps.runFrames(tab, {
              op: 'snapshot',
              args: { snapshot_id: snapshotId, max, settle_ms: 0 },
            })
          ).map(({ frameId, result }) => ({ frameId, page: result as PageSnapshot }))
        : [];
      remember(snapshotId, tab.id);
      return {
        snapshot_id: page.snapshot_id,
        tab_id: tab.id,
        url: page.url,
        title: page.title,
        headings: page.headings,
        text: frames.length ? mergeText(page, frames, TEXT_MAX) : page.text,
        viewport: page.viewport,
        elements: frames.length ? mergeFrames(page, frames, max) : page.elements,
      };
    },

    'page.click': async ({ snapshot_id, element_id }) => {
      const owner = await ownerOf(snapshot_id);
      const [frameId, id] = splitElementId(element_id);
      const request: PageRequest = { op: 'click', args: { snapshot_id, element_id: id } };
      return frameId === undefined ? run(owner, request) : run(owner, request, frameId);
    },

    'page.type': async ({ snapshot_id, element_id, text, submit }) => {
      const owner = await ownerOf(snapshot_id);
      const [frameId, id] = splitElementId(element_id);
      const request: PageRequest = {
        op: 'type',
        args: { snapshot_id, element_id: id, text, submit },
      };
      return frameId === undefined ? run(owner, request) : run(owner, request, frameId);
    },

    'page.upload': async ({ snapshot_id, element_id, upload_id, name, type }) => {
      if (!deps.staging) throw new ProtocolError('internal', 'uploads are not wired');
      const owner = await ownerOf(snapshot_id);
      const data = deps.staging.take(upload_id);
      const [frameId, id] = splitElementId(element_id);
      const request: PageRequest = {
        op: 'upload',
        args: { snapshot_id, element_id: id, name, type, data },
      };
      return frameId === undefined ? run(owner, request) : run(owner, request, frameId);
    },

    'page.scroll': async ({ tab_id, direction }) =>
      run(await resolveTab(api, tab_id), { op: 'scroll', args: { direction } }),
  };
}
