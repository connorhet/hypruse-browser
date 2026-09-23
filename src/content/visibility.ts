import type { Viewport } from '../shared/protocol';
import type { Geometry, Rect } from './geometry';

// Visible: a box with area, not hidden by CSS, and not removed from the accessibility tree.
export function isRendered(el: Element, geometry: Geometry, rect = geometry.rect(el)): boolean {
  if (!(rect.width > 0 && rect.height > 0)) return false;
  const look = geometry.style(el);
  if (look.display === 'none' || look.visibility === 'hidden' || look.visibility === 'collapse') {
    return false;
  }
  return el.closest('[aria-hidden="true" i], [inert]') === null;
}

export function intersectsViewport(rect: Rect, viewport: Viewport): boolean {
  return (
    rect.x < viewport.width &&
    rect.x + rect.width > 0 &&
    rect.y < viewport.height &&
    rect.y + rect.height > 0
  );
}

export type Placement = 'view' | 'below';

// In view, within one viewport below it, or neither (and then not worth listing).
export function placement(rect: Rect, viewport: Viewport): Placement | null {
  if (intersectsViewport(rect, viewport)) return 'view';
  const horizontal = rect.x < viewport.width && rect.x + rect.width > 0;
  if (horizontal && rect.y >= viewport.height && rect.y < 2 * viewport.height) return 'below';
  return null;
}

// The centre of the part of the rect that is inside the viewport.
export function visibleCentre(rect: Rect, viewport: Viewport): { x: number; y: number } {
  const left = Math.max(rect.x, 0);
  const right = Math.min(rect.x + rect.width, viewport.width);
  const top = Math.max(rect.y, 0);
  const bottom = Math.min(rect.y + rect.height, viewport.height);
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

// Whether a click at the element's centre would reach it: the hit is the element, inside it,
// or an ancestor with no other candidate in between (a pointer-events: none label, say).
export function isHitTarget(
  el: Element,
  rect: Rect,
  geometry: Geometry,
  viewport: Viewport,
  candidates: ReadonlySet<Element>,
): boolean {
  const { x, y } = visibleCentre(rect, viewport);
  const hit = geometry.hit(x, y);
  if (!hit) return false;
  if (hit === el || el.contains(hit)) return true;
  if (!hit.contains(el)) return false;
  for (let node = el.parentElement; node && node !== hit; node = node.parentElement) {
    if (candidates.has(node)) return false;
  }
  return true;
}
