import type { Viewport } from '../shared/protocol';
import type { Geometry } from './geometry';
import { CANDIDATE_SELECTOR } from './roles';
import { placement } from './visibility';

// How many elements the cursor: pointer pass may read the style of.
export const POINTER_BUDGET = 400;
// A hard stop for the walk itself on very large documents.
const MAX_VISITED = 20_000;

const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OBJECT']);

export type Candidates = {
  // Elements that match the candidate selector, in document order.
  semantic: Element[];
  // Elements found by the second pass: cursor: pointer, no candidate ancestor.
  pointer: Element[];
  // Everything that matched the selector, visible or not.
  matched: ReadonlySet<Element>;
};

export function collectCandidates(
  doc: Document,
  geometry: Geometry,
  viewport: Viewport,
  budget = POINTER_BUDGET,
): Candidates {
  const semantic = Array.from(doc.querySelectorAll(CANDIDATE_SELECTOR));
  const matched = new Set(semantic);
  const pointer: Element[] = [];
  const root = doc.body as Element | null;
  if (!root) return { semantic, pointer, matched };

  // Pre-order walk, so the outermost pointer element is found first and its subtree, whose
  // cursor is inherited, is skipped. So is every candidate's subtree.
  const stack = Array.from(root.children).reverse();
  let checked = 0;
  let visited = 0;
  while (stack.length > 0 && checked < budget && visited < MAX_VISITED) {
    const el = stack.pop();
    if (!el || matched.has(el) || SKIPPED_TAGS.has(el.tagName)) continue;
    visited += 1;
    const rect = geometry.rect(el);
    if (rect.width > 0 && rect.height > 0 && placement(rect, viewport)) {
      checked += 1;
      if (geometry.style(el).cursor === 'pointer') {
        pointer.push(el);
        continue;
      }
    }
    for (let i = el.children.length - 1; i >= 0; i -= 1) {
      const child = el.children[i];
      if (child) stack.push(child);
    }
  }
  return { semantic, pointer, matched };
}
