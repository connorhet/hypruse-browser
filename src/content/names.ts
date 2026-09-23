import { collapse, cut, isInEditable, staticText } from './text';

export const NAME_MAX = 60;

const FIELD_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const FIELD_INSIDE = 'textarea, select, [contenteditable]:not([contenteditable="false" i])';

function labelledBy(el: Element): string {
  const ids = el.getAttribute('aria-labelledby');
  if (!ids) return '';
  const doc = el.ownerDocument;
  return ids
    .split(/\s+/)
    .map((id) => (id ? doc.getElementById(id) : null))
    .filter((node) => node !== null && node !== el)
    .map((node) => staticText(node as Element))
    .join(' ');
}

function labelText(el: Element): string {
  const labels = (el as Partial<HTMLInputElement>).labels;
  if (!labels) return '';
  return Array.from(labels, (label) => staticText(label)).join(' ');
}

// A submit, reset or button input shows its value attribute as its label. That value is
// written by the page author, not typed by the user, so reading it is safe.
function buttonInputLabel(el: Element): string {
  if (el.tagName !== 'INPUT') return '';
  const type = (el as HTMLInputElement).type;
  if (type !== 'submit' && type !== 'reset' && type !== 'button') return '';
  const value = el.getAttribute('value');
  if (value !== null) return value;
  if (type === 'submit') return 'Submit';
  if (type === 'reset') return 'Reset';
  return '';
}

function descendantLabel(el: Element): string {
  for (const node of el.querySelectorAll('[aria-label], img[alt], [title]')) {
    const value =
      node.getAttribute('aria-label') || node.getAttribute('alt') || node.getAttribute('title');
    if (value?.trim()) return value;
  }
  return '';
}

// The name a person would use for the element. Sources are tried in order: aria-labelledby,
// aria-label, alt, title, the associated label, the placeholder, then visible text. Fields and
// editable regions never fall back to their text, so a value is never read.
export function accessibleName(el: Element, visibleText: (el: Element) => string): string {
  const editable = FIELD_TAGS.has(el.tagName) || isInEditable(el);
  const sources: (() => string | null)[] = [
    () => labelledBy(el),
    () => el.getAttribute('aria-label'),
    () => el.getAttribute('alt'),
    () => el.getAttribute('title'),
    () => labelText(el),
    () => el.getAttribute('placeholder'),
    () => buttonInputLabel(el),
    () => (editable || el.querySelector(FIELD_INSIDE) ? '' : visibleText(el)),
    () => (editable ? '' : descendantLabel(el)),
  ];
  for (const source of sources) {
    const name = collapse(source() ?? '');
    if (name) return cut(name, NAME_MAX);
  }
  return '';
}
