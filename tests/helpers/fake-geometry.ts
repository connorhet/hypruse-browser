import type { Geometry, Rect } from '../../src/content/geometry';
import type { Viewport } from '../../src/shared/protocol';

// Layout for jsdom, which has none. Markup describes it:
//   data-rect="x y w h"           the element's box in viewport coordinates
//   data-scroll="top height client" scroll metrics
//   style="..."                   display, visibility, cursor, overflow-y, pointer-events
//   hidden                        like display: none
// Hit testing returns the last element in document order whose box holds the point, so later
// markup paints on top, as positioned overlays usually do.

const ZERO: Rect = { x: 0, y: 0, width: 0, height: 0 };

function styleOf(el: Element): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const part of (el.getAttribute('style') ?? '').split(';')) {
    const at = part.indexOf(':');
    if (at === -1) continue;
    declarations.set(part.slice(0, at).trim().toLowerCase(), part.slice(at + 1).trim());
  }
  return declarations;
}

function inherited(el: Element, property: string): string | undefined {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const value = styleOf(node).get(property);
    if (value) return value;
  }
  return undefined;
}

function displayNone(el: Element): boolean {
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (node.hasAttribute('hidden') || styleOf(node).get('display') === 'none') return true;
  }
  return false;
}

export type FakeGeometry = Geometry & { viewportValue: Viewport };

export function fakeGeometry(doc: Document, viewport: Partial<Viewport> = {}): FakeGeometry {
  const viewportValue: Viewport = {
    width: 1000,
    height: 800,
    dpr: 1,
    scroll_y: 0,
    scroll_height: 3000,
    ...viewport,
  };
  const rect = (el: Element): Rect => {
    const raw = el.getAttribute('data-rect');
    if (!raw || displayNone(el)) return ZERO;
    const [x = 0, y = 0, width = 0, height = 0] = raw
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    return { x, y, width, height };
  };
  return {
    viewportValue,
    rect,
    style: (el) => ({
      display: styleOf(el).get('display') ?? 'block',
      visibility: inherited(el, 'visibility') ?? 'visible',
      cursor: inherited(el, 'cursor') ?? 'auto',
      overflowY: styleOf(el).get('overflow-y') ?? 'visible',
    }),
    hit(x, y) {
      let top: Element | null = null;
      for (const el of doc.querySelectorAll('[data-rect]')) {
        if (inherited(el, 'pointer-events') === 'none') continue;
        const box = rect(el);
        if (box.width <= 0 || box.height <= 0) continue;
        if (x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height) top = el;
      }
      return top;
    },
    viewport: () => ({ ...viewportValue }),
    text: (el) => el.textContent,
    scrollMetrics(el) {
      const [scrollTop = 0, scrollHeight = 0, clientHeight = 0] = (
        el.getAttribute('data-scroll') ?? '0 0 0'
      )
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      return { scrollTop, scrollHeight, clientHeight };
    },
  };
}
