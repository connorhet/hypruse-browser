import type { ElementKind } from '../shared/protocol';

export const WIDGET_ROLES = [
  'button',
  'link',
  'tab',
  'menuitem',
  'option',
  'checkbox',
  'radio',
  'switch',
  'searchbox',
  'combobox',
  'textbox',
];

// First pass candidates: things that are clickable or typeable by their markup.
export const CANDIDATE_SELECTOR = [
  'a[href]',
  'button',
  'input:not([type="hidden" i])',
  'textarea',
  'select',
  'summary',
  '[contenteditable]:not([contenteditable="false" i])',
  '[onclick]',
  ...WIDGET_ROLES.map((role) => `[role~="${role}" i]`),
].join(', ');

const INPUT_ROLES: Record<string, string> = {
  checkbox: 'checkbox',
  radio: 'radio',
  search: 'searchbox',
  button: 'button',
  submit: 'button',
  reset: 'button',
  image: 'button',
  file: 'button',
  color: 'button',
  range: 'slider',
  number: 'spinbutton',
};

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'email', 'tel']);
const SEARCH_HINT_ATTRIBUTES = ['name', 'id', 'placeholder', 'aria-label', 'data-testid'];

export function inputType(el: Element): string {
  return el.tagName === 'INPUT' ? (el as HTMLInputElement).type.toLowerCase() : '';
}

export function roleOf(el: Element): string {
  const explicit = (el.getAttribute('role') ?? '').trim().toLowerCase().split(/\s+/)[0];
  if (explicit && explicit !== 'none' && explicit !== 'presentation') return explicit;
  switch (el.tagName) {
    case 'A':
    case 'AREA':
      return el.hasAttribute('href') ? 'link' : 'generic';
    case 'BUTTON':
    case 'SUMMARY':
      return 'button';
    case 'SELECT': {
      const select = el as HTMLSelectElement;
      return select.multiple || select.size > 1 ? 'listbox' : 'combobox';
    }
    case 'TEXTAREA':
      return 'textbox';
    case 'INPUT': {
      const type = inputType(el);
      if (el.hasAttribute('list') && TEXT_INPUT_TYPES.has(type)) return 'combobox';
      return INPUT_ROLES[type] ?? 'textbox';
    }
  }
  const editable = el.getAttribute('contenteditable');
  if (editable !== null && editable.toLowerCase() !== 'false') return 'textbox';
  return 'generic';
}

// A search box: a searchbox, or a text input or textarea that is a combobox, sits in a
// search landmark, or mentions "search" in its name, id, placeholder, label or test id.
export function isSearchField(el: Element, role: string): boolean {
  if (role === 'searchbox') return true;
  if (el.tagName === 'INPUT') {
    if (!TEXT_INPUT_TYPES.has(inputType(el))) return false;
  } else if (el.tagName !== 'TEXTAREA') {
    return false;
  }
  if (role === 'combobox') return true;
  if (el.closest('[role~="search" i], search') !== null) return true;
  return SEARCH_HINT_ATTRIBUTES.some((name) =>
    (el.getAttribute(name) ?? '').toLowerCase().includes('search'),
  );
}

export function kindOf(el: Element, role: string): ElementKind {
  if (isSearchField(el, role)) return 'search';
  switch (role) {
    case 'link':
      return 'link';
    case 'button':
      return 'button';
    case 'tab':
      return 'tab';
    case 'option':
    case 'menuitem':
    case 'treeitem':
      return 'option';
    case 'checkbox':
    case 'radio':
    case 'switch':
    case 'menuitemcheckbox':
    case 'menuitemradio':
      return 'toggle';
    case 'textbox':
    case 'combobox':
    case 'listbox':
    case 'spinbutton':
    case 'slider':
      return 'input';
    default:
      return 'other';
  }
}
