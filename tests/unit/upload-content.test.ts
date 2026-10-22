// @vitest-environment jsdom
import { uploadFile } from '../../src/content/upload';
import { PageError } from '../../src/content/errors';

// jsdom has no DataTransfer; this is the slice uploadFile uses, enough for a FileList.
class FakeDataTransfer {
  private list: File[] = [];
  readonly items = { add: (file: File) => this.list.push(file) };
  get files(): FileList {
    const files = [...this.list];
    return Object.assign(files, { item: (i: number) => files[i] ?? null });
  }
}

beforeAll(() => {
  vi.stubGlobal('DataTransfer', FakeDataTransfer);
});

function fieldWith(html: string): Element {
  document.body.innerHTML = html;
  const input = document.querySelector('input');
  // jsdom's FileList setter only takes a real FileList, so the test holds the files itself
  if (input) {
    let files: FileList | null = null;
    Object.defineProperty(input, 'files', { get: () => files, set: (v: FileList) => (files = v) });
  }
  return document.body.firstElementChild!;
}

describe('uploadFile', () => {
  it('puts the file in the field and lets the page hear about it', async () => {
    const el = fieldWith('<input type="file">');
    const heard: string[] = [];
    el.addEventListener('input', () => heard.push('input'));
    el.addEventListener('change', () => heard.push('change'));
    expect(uploadFile(el, 'cv.txt', 'text/plain', btoa('hello'))).toEqual({
      name: 'cv.txt',
      size: 5,
      files: 1,
    });
    const file = (el as HTMLInputElement).files![0]!;
    expect([file.name, file.type, await file.text()]).toEqual(['cv.txt', 'text/plain', 'hello']);
    expect(heard).toEqual(['input', 'change']);
  });

  it('finds the field inside a drop zone or behind its label', () => {
    expect(uploadFile(fieldWith('<div><input type="file"></div>'), 'a', '', '').files).toBe(1);
    document.body.innerHTML = '<label for="f">Attach</label><input id="f" type="file">';
    const input = document.querySelector('input')!;
    let files: FileList | null = null;
    Object.defineProperty(input, 'files', { get: () => files, set: (v: FileList) => (files = v) });
    expect(uploadFile(document.querySelector('label')!, 'a', '', '').files).toBe(1);
  });

  it('refuses what is not a file field, or is disabled', () => {
    expect(() => uploadFile(fieldWith('<button>Go</button>'), 'a', '', '')).toThrow(PageError);
    expect(() => uploadFile(fieldWith('<input type="file" disabled>'), 'a', '', '')).toThrow(
      /disabled/,
    );
  });
});
