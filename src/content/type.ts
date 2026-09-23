import { PageError } from './errors';
import { inputType } from './roles';
import { isInEditable } from './text';

const TYPEABLE_INPUT_TYPES = new Set(['text', 'search', 'url', 'email', 'tel', 'number']);
const PASSWORD_AUTOCOMPLETE = new Set(['current-password', 'new-password']);

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

function isField(el: Element): boolean {
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || isInEditable(el);
}

// The element itself when it takes text, else the first field inside it (a combobox wrapper
// around its input, say).
function fieldOf(el: Element): Field | null {
  if (isField(el)) return el as Field;
  const inner = el.querySelector(
    'input:not([type="hidden" i]), textarea, [contenteditable]:not([contenteditable="false" i])',
  );
  return inner as Field | null;
}

// Passwords and payment card fields are never typed into, whatever the caller asks.
export function isSensitive(el: Element): boolean {
  if (inputType(el) === 'password') return true;
  const tokens = (el.getAttribute('autocomplete') ?? '').toLowerCase().split(/\s+/);
  return tokens.some((token) => token.startsWith('cc-') || PASSWORD_AUTOCOMPLETE.has(token));
}

function selectAllOf(el: HTMLElement): void {
  const selection = el.ownerDocument.getSelection();
  if (!selection) return;
  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  selection.removeAllRanges();
  selection.addRange(range);
}

// Sets a value through the prototype's setter, which bypasses the instance setter that React
// style frameworks install, so their input handler sees a real change.
function setNativeValue(field: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  const proto =
    field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(field, text);
  else field.value = text;
}

function pressEnter(field: Field): void {
  const init: KeyboardEventInit = {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true,
    composed: true,
  };
  const proceed = field.dispatchEvent(new KeyboardEvent('keydown', init));
  field.dispatchEvent(new KeyboardEvent('keypress', { ...init, charCode: 13 }));
  field.dispatchEvent(new KeyboardEvent('keyup', init));
  if (!proceed) return;
  const form = 'form' in field && field.form ? field.form : field.closest('form');
  form?.requestSubmit();
}

export function typeText(el: Element, text: string, submit: boolean): void {
  const field = fieldOf(el);
  if (!field) throw new PageError('refused', 'the element does not take text');
  if (isSensitive(field)) {
    throw new PageError('refused', 'will not type into a password or payment field');
  }
  const isInput = field.tagName === 'INPUT';
  const isTextArea = field.tagName === 'TEXTAREA';
  if (isInput && !TYPEABLE_INPUT_TYPES.has(inputType(field))) {
    throw new PageError('refused', `will not type into an input of type ${inputType(field)}`);
  }
  if (isInput || isTextArea) {
    const control = field as HTMLInputElement | HTMLTextAreaElement;
    if (control.disabled || control.readOnly) {
      throw new PageError('refused', 'the field is disabled or read-only');
    }
    control.focus();
    control.select();
    setNativeValue(control, text);
    control.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: 'insertText',
        data: text,
      }),
    );
    control.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    field.focus();
    selectAllOf(field);
    const doc = field.ownerDocument;
    // execCommand keeps the editor's own undo stack and input handling; it is deprecated but
    // still the only way to type into a contenteditable like a person does.
    const exec = (doc as { execCommand?: Document['execCommand'] }).execCommand;
    const inserted = typeof exec === 'function' && exec.call(doc, 'insertText', false, text);
    if (!inserted) {
      field.textContent = text;
      field.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          composed: true,
          inputType: 'insertText',
          data: text,
        }),
      );
    }
  }
  if (submit) pressEnter(field);
}
