import type { UploadResult } from '../shared/protocol';
import { PageError } from './errors';

function isFileInput(el: Element | null): el is HTMLInputElement {
  return el?.tagName === 'INPUT' && (el as HTMLInputElement).type.toLowerCase() === 'file';
}

// The file field an element stands for: itself, the field a label names, or the first file
// field inside it (a styled drop zone around a hidden input, say).
function fileInputOf(el: Element): HTMLInputElement | null {
  if (isFileInput(el)) return el;
  if (el.tagName === 'LABEL') {
    const control = (el as HTMLLabelElement).control;
    if (isFileInput(control)) return control;
  }
  const inner = el.querySelector('input[type="file" i]');
  return isFileInput(inner) ? inner : null;
}

function bytesOf(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Puts one file in a file field, as choosing it in the browser's picker would: the field's
// files are replaced, then input and change are dispatched so the page's own handlers run.
// No picker opens; Chrome shows one only for a real click.
export function uploadFile(el: Element, name: string, type: string, data: string): UploadResult {
  const field = fileInputOf(el);
  if (!field) throw new PageError('refused', 'this element is not a file field');
  if (field.disabled) throw new PageError('refused', 'the file field is disabled');
  const file = new File([bytesOf(data)], name, { type });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  field.files = transfer.files;
  field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
  return { name: file.name, size: file.size, files: field.files.length };
}
