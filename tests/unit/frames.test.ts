import { mergeFrames, mergeText, splitElementId } from '../../src/background/frames';
import type { PageSnapshot, SnapshotElement } from '../../src/shared/protocol';

const viewport = { width: 1000, height: 800, dpr: 1, scroll_y: 0, scroll_height: 3000 };

function el(id: string, rect: [number, number, number, number], in_view = true): SnapshotElement {
  return { id, role: 'button', name: id, kind: 'button', rect, in_view };
}

function page(
  url: string,
  elements: SnapshotElement[],
  extra: Partial<PageSnapshot> = {},
): PageSnapshot {
  return {
    snapshot_id: 's1',
    url,
    title: '',
    headings: '',
    text: '',
    viewport,
    elements,
    ...extra,
  };
}

describe('splitElementId', () => {
  it('splits a frame element id and leaves a top one alone', () => {
    expect(splitElementId('f12.e3')).toEqual([12, 'e3']);
    expect(splitElementId('e3')).toEqual([undefined, 'e3']);
    expect(splitElementId('f.e3')).toEqual([undefined, 'f.e3']);
  });
});

describe('mergeFrames', () => {
  const top = page(
    'https://shop.example/',
    [el('e1', [10, 10, 50, 20]), el('e2', [10, 900, 50, 20], false)],
    {
      frames: [
        { url: 'https://pay.example/card', rect: [100, 300, 400, 200] },
        { url: 'https://ads.example/x', rect: [100, 2000, 300, 250] },
      ],
    },
  );

  it('moves a frame into the page by its box and renames its ids and groups', () => {
    const card = page('https://pay.example/card', [
      { ...el('e1', [5, 10, 100, 30]), list: { group: 'g1', index: 1, size: 3 } },
    ]);
    const merged = mergeFrames(top, [{ frameId: 7, page: card }], 120);
    expect(merged.map((e) => e.id)).toEqual(['e1', 'f7.e1', 'e2']);
    expect(merged[1]).toMatchObject({
      rect: [105, 310, 100, 30],
      in_view: true,
      list: { group: 'f7.g1', index: 1, size: 3 },
    });
  });

  it('puts the elements of a frame below the viewport out of view, after the top ones', () => {
    const ad = page('https://ads.example/x', [el('e1', [0, 0, 300, 250])]);
    const merged = mergeFrames(top, [{ frameId: 9, page: ad }], 120);
    expect(merged.map((e) => [e.id, e.in_view])).toEqual([
      ['e1', true],
      ['e2', false],
      ['f9.e1', false],
    ]);
  });

  it('matches a frame that redirected by its origin when that is unambiguous', () => {
    const redirected = page('https://pay.example/card?session=1', [el('e1', [0, 0, 10, 10])]);
    expect(mergeFrames(top, [{ frameId: 3, page: redirected }], 120)[1]).toMatchObject({
      id: 'f3.e1',
      rect: [100, 300, 10, 10],
      in_view: true,
    });
  });

  it('keeps a frame it cannot place, out of view, and drops frames with no area', () => {
    const nested = page('https://inner.example/', [el('e1', [1, 2, 3, 4])]);
    const tiny = page('https://pixel.example/', [el('e1', [0, 0, 1, 1])], {
      viewport: { ...viewport, width: 1, height: 1 },
    });
    const merged = mergeFrames(
      top,
      [
        { frameId: 4, page: nested },
        { frameId: 5, page: tiny },
      ],
      120,
    );
    expect(merged.map((e) => [e.id, e.in_view, e.rect])).toContainEqual([
      'f4.e1',
      false,
      [1, 2, 3, 4],
    ]);
    expect(merged.some((e) => e.id.startsWith('f5.'))).toBe(false);
  });

  it('gives each box to one frame and cuts the list to max', () => {
    const one = page('https://pay.example/card', [el('e1', [0, 0, 10, 10])]);
    const two = page('https://pay.example/card', [el('e1', [0, 0, 10, 10])]);
    const merged = mergeFrames(
      top,
      [
        { frameId: 1, page: one },
        { frameId: 2, page: two },
      ],
      120,
    );
    expect(merged.find((e) => e.id === 'f1.e1')?.in_view).toBe(true);
    expect(merged.find((e) => e.id === 'f2.e1')?.in_view).toBe(false);
    expect(mergeFrames(top, [{ frameId: 1, page: one }], 2).map((e) => e.id)).toEqual([
      'e1',
      'f1.e1',
    ]);
  });
});

describe('mergeText', () => {
  it('adds the text of frames shown in the viewport, in the order they sit', () => {
    const top = page('https://shop.example/', [], {
      text: 'Checkout Order total',
      frames: [
        { url: 'https://pay.example/card', rect: [100, 300, 400, 200] },
        { url: 'https://ads.example/x', rect: [100, 2000, 300, 250] },
      ],
    });
    const card = page('https://pay.example/card', [], { text: 'Paid' });
    const ad = page('https://ads.example/x', [], { text: 'Buy now' });
    expect(
      mergeText(
        top,
        [
          { frameId: 9, page: ad },
          { frameId: 7, page: card },
        ],
        1500,
      ),
    ).toBe('Checkout Order total | Paid');
    expect(mergeText(top, [{ frameId: 7, page: card }], 10)).toBe('Checkout O');
  });
});
