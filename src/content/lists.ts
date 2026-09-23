import type { Geometry } from './geometry';
import { visualOrder } from './order';
import { isRendered } from './visibility';

// How far above a candidate to look for the repeated item that holds it.
export const LIST_DEPTH = 8;
export const LIST_MIN_ITEMS = 3;

export type ListSlot = { key: string; index: number; size: number };

export function signature(el: Element): string {
  return [el.tagName.toLowerCase(), ...Array.from(el.classList).sort()].join('.');
}

// Finds repeated items (search results, track rows, video cards) and numbers them in visual
// order. An item is the first element, from the candidate up through LIST_DEPTH ancestors,
// whose parent has at least LIST_MIN_ITEMS children with its signature.
export class Lists {
  private readonly counts = new Map<Element, Map<string, number>>();
  private readonly numbering = new Map<string, Map<Element, number>>();
  private readonly groupKeys = new Map<Element, Map<string, string>>();
  private nextKey = 1;

  constructor(private readonly geometry: Geometry) {}

  slot(el: Element): ListSlot | null {
    let node = el;
    for (let depth = 0; depth <= LIST_DEPTH; depth += 1) {
      const parent = node.parentElement;
      if (!parent || parent.tagName === 'BODY' || parent.tagName === 'HTML') return null;
      const sig = signature(node);
      if (this.count(parent, sig) >= LIST_MIN_ITEMS) return this.position(parent, sig, node);
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

  private key(parent: Element, sig: string): string {
    let bySignature = this.groupKeys.get(parent);
    if (!bySignature) {
      bySignature = new Map();
      this.groupKeys.set(parent, bySignature);
    }
    let key = bySignature.get(sig);
    if (!key) {
      key = `list${this.nextKey++}`;
      bySignature.set(sig, key);
    }
    return key;
  }

  private position(parent: Element, sig: string, item: Element): ListSlot | null {
    const key = this.key(parent, sig);
    let order = this.numbering.get(key);
    if (!order) {
      const items = Array.from(parent.children).filter(
        (child) => signature(child) === sig && isRendered(child, this.geometry),
      );
      const sorted = visualOrder(items, (child) => this.geometry.rect(child));
      order = new Map(sorted.map((child, i) => [child, i + 1]));
      this.numbering.set(key, order);
    }
    const index = order.get(item);
    return index === undefined ? null : { key, index, size: order.size };
  }
}
