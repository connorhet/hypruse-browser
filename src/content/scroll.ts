import type { ScrollResult } from '../shared/protocol';
import type { Geometry } from './geometry';

const SCROLLABLE = new Set(['auto', 'scroll', 'overlay']);
export const SCROLL_FRACTION = 0.8;

export type Direction = 'up' | 'down' | 'top' | 'bottom';

// The element that actually scrolls: the nearest scrollable ancestor of whatever is at the
// middle of the viewport (Spotify scrolls a panel, not the document), else the document.
export function scrollTarget(doc: Document, geometry: Geometry): Element {
  const viewport = geometry.viewport();
  const fallback = doc.scrollingElement ?? doc.documentElement;
  for (
    let node = geometry.hit(viewport.width / 2, viewport.height / 2);
    node && node !== doc.body && node !== doc.documentElement;
    node = node.parentElement
  ) {
    if (!SCROLLABLE.has(geometry.style(node).overflowY)) continue;
    const metrics = geometry.scrollMetrics(node);
    if (metrics.scrollHeight > metrics.clientHeight + 1) return node;
  }
  return fallback;
}

// Starts a smooth scroll and reports where it is heading.
export function scroll(doc: Document, geometry: Geometry, direction: Direction): ScrollResult {
  const target = scrollTarget(doc, geometry);
  const { scrollTop, scrollHeight, clientHeight } = geometry.scrollMetrics(target);
  const bottom = Math.max(0, scrollHeight - clientHeight);
  const step = SCROLL_FRACTION * clientHeight;
  const wanted = {
    up: scrollTop - step,
    down: scrollTop + step,
    top: 0,
    bottom,
  }[direction];
  const destination = Math.round(Math.min(Math.max(wanted, 0), bottom));
  target.scrollTo({ top: destination, behavior: 'smooth' });
  return { scroll_y: destination, scroll_height: scrollHeight };
}
