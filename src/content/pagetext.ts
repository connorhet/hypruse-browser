import type { Viewport } from '../shared/protocol';
import type { Geometry } from './geometry';
import { collapse, cut } from './text';
import { placement } from './visibility';

// How much of a page's visible text a snapshot carries, and how many text nodes it reads to
// find it.
export const TEXT_MAX = 1500;
export const TEXT_NODE_BUDGET = 4000;

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;
// As for names: code, and anything that holds what the user typed, is never read.
const SKIPPED_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'TEXTAREA',
  'SELECT',
  'INPUT',
  'IFRAME',
]);

function hostsEditable(el: Element): boolean {
  const value = el.getAttribute('contenteditable');
  return value !== null && value.toLowerCase() !== 'false';
}

// Hidden, so nothing under it is shown: the cheap checks that hold for a whole subtree.
function hidesSubtree(el: Element, geometry: Geometry): boolean {
  if (SKIPPED_TAGS.has(el.tagName) || hostsEditable(el)) return true;
  if (el.getAttribute('aria-hidden')?.toLowerCase() === 'true' || el.hasAttribute('inert')) {
    return true;
  }
  const look = geometry.style(el);
  return look.display === 'none' || look.visibility === 'hidden';
}

// The text a person sees in the viewport, in document order: what a page says back after an
// action ("Paid", "No results", an error), which the element list does not carry. Field values
// and editable regions are never read, and the text is cut to `max` characters.
export function pageText(
  doc: Document,
  geometry: Geometry,
  viewport: Viewport,
  max: number = TEXT_MAX,
): string {
  const parts: string[] = [];
  let length = 0;
  let read = 0;
  const shown = new Map<Element, boolean>();
  const inView = (el: Element): boolean => {
    let answer = shown.get(el);
    if (answer === undefined) {
      const rect = geometry.rect(el);
      answer = rect.width > 0 && rect.height > 0 && placement(rect, viewport) === 'view';
      shown.set(el, answer);
    }
    return answer;
  };
  const walk = (node: Node): void => {
    for (const child of node.childNodes) {
      if (length > max || read >= TEXT_NODE_BUDGET) return;
      if (child.nodeType === TEXT_NODE) {
        read += 1;
        const text = collapse(child.nodeValue ?? '');
        if (text && child.parentElement && inView(child.parentElement)) {
          parts.push(text);
          length += text.length + 1;
        }
      } else if (child.nodeType === ELEMENT_NODE && !hidesSubtree(child as Element, geometry)) {
        walk(child);
      }
    }
  };
  walk(doc.body);
  return cut(parts.join(' '), max);
}
