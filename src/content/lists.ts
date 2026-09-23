import type { Geometry } from './geometry';
import { visualOrder } from './order';
import { isRendered } from './visibility';

// How far above a candidate to look for the repeated item that holds it.
export const LIST_DEPTH = 8;
export const LIST_MIN_ITEMS = 3;

export type ListSlot = { key: string; index: number; size: number };

type Group = {
  key: string;
  // Visible items in visual order, numbered from 1; null when the siblings are not a list.
  order: Map<Element, number> | null;
};

const CELL_ROLES = new Set(['cell', 'gridcell', 'columnheader', 'rowheader']);

// The cells of a table row repeat too, but the row is the item a person counts.
function isCell(el: Element): boolean {
  if (el.tagName === 'TD' || el.tagName === 'TH') return true;
  const role = (el.getAttribute('role') ?? '').trim().toLowerCase().split(/\s+/)[0] ?? '';
  return CELL_ROLES.has(role);
}

export function signature(el: Element): string {
  return [el.tagName.toLowerCase(), ...Array.from(el.classList).sort()].join('.');
}

// The tag names of an element's children: list items built from one template share it.
export function shape(el: Element): string {
  return Array.from(el.children, (child) => child.tagName).join(',');
}

// Finds repeated items (search results, track rows, video cards) and numbers them in visual
// order. An item is the first element, from the candidate up through LIST_DEPTH ancestors,
// whose parent has at least LIST_MIN_ITEMS children with its signature, tag name plus sorted
// class list. Two refinements keep this from firing on things that only look alike:
//  - at least LIST_MIN_ITEMS of those siblings must be visible and share one shape, since
//    component frameworks give every element inside a component the same class (YouTube
//    marks the title block and the channel block of a video alike);
//  - table and grid cells are passed over, so a button in a track row is numbered by its
//    row, not its column.
export class Lists {
  private readonly counts = new Map<Element, Map<string, number>>();
  private readonly groups = new Map<Element, Map<string, Group>>();
  private nextKey = 1;

  constructor(private readonly geometry: Geometry) {}

  slot(el: Element): ListSlot | null {
    let node = el;
    for (let depth = 0; depth <= LIST_DEPTH; depth += 1) {
      const parent = node.parentElement;
      if (!parent || parent.tagName === 'BODY' || parent.tagName === 'HTML') return null;
      const sig = signature(node);
      if (!isCell(node) && this.count(parent, sig) >= LIST_MIN_ITEMS) {
        const { key, order } = this.group(parent, sig);
        const index = order?.get(node);
        if (order && index !== undefined) return { key, index, size: order.size };
      }
      node = parent;
    }
    return null;
  }

  private count(parent: Element, sig: string): number {
    let bySignature = this.counts.get(parent);
    if (!bySignature) {
      bySignature = new Map();
      for (const child of parent.children) {
        const childSig = signature(child);
        bySignature.set(childSig, (bySignature.get(childSig) ?? 0) + 1);
      }
      this.counts.set(parent, bySignature);
    }
    return bySignature.get(sig) ?? 0;
  }

  private group(parent: Element, sig: string): Group {
    let bySignature = this.groups.get(parent);
    if (!bySignature) {
      bySignature = new Map();
      this.groups.set(parent, bySignature);
    }
    let group = bySignature.get(sig);
    if (!group) {
      group = { key: `list${this.nextKey++}`, order: this.number(parent, sig) };
      bySignature.set(sig, group);
    }
    return group;
  }

  private number(parent: Element, sig: string): Map<Element, number> | null {
    const items = Array.from(parent.children).filter(
      (child) => signature(child) === sig && isRendered(child, this.geometry),
    );
    const shapes = new Map<string, number>();
    for (const item of items) shapes.set(shape(item), (shapes.get(shape(item)) ?? 0) + 1);
    if (Math.max(0, ...shapes.values()) < LIST_MIN_ITEMS) return null;
    const sorted = visualOrder(items, (item) => this.geometry.rect(item));
    return new Map(sorted.map((item, i) => [item, i + 1]));
  }
}
