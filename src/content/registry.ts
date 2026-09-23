import { PageError } from './errors';

function withoutHash(url: string): string {
  const at = url.indexOf('#');
  return at === -1 ? url : url.slice(0, at);
}

// Per document: the latest snapshot id and weak handles to its elements. Only the latest
// snapshot can be acted on, so a click never lands on whatever is at that spot now.
export class Registry {
  private latest: string | null = null;
  private url = '';
  private handles = new Map<string, WeakRef<Element>>();

  constructor(private readonly doc: Document) {}

  replace(snapshotId: string, elements: ReadonlyMap<string, Element>): void {
    this.latest = snapshotId;
    this.url = withoutHash(this.doc.URL);
    this.handles = new Map(Array.from(elements, ([id, el]) => [id, new WeakRef(el)]));
  }

  resolve(snapshotId: string, elementId: string): Element {
    if (snapshotId !== this.latest) {
      throw new PageError(
        'stale_snapshot',
        `snapshot ${snapshotId} is not the latest one of this page; take a new snapshot`,
      );
    }
    if (withoutHash(this.doc.URL) !== this.url) {
      throw new PageError('stale_snapshot', 'the page has navigated since the snapshot');
    }
    const ref = this.handles.get(elementId);
    if (!ref) throw new PageError('not_found', `no element ${elementId} in snapshot ${snapshotId}`);
    const el = ref.deref();
    if (!el?.isConnected) {
      throw new PageError('stale_snapshot', `element ${elementId} is no longer on the page`);
    }
    return el;
  }
}
