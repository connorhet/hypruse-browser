// @vitest-environment jsdom
import { accessibleName, NAME_MAX } from '../../src/content/names';

const text = (el: Element) => el.textContent;

function nameOf(html: string, selector = '#target'): string {
  document.body.innerHTML = html;
  const el = document.querySelector(selector);
  if (!el) throw new Error(`no ${selector}`);
  return accessibleName(el, text);
}

describe('accessibleName', () => {
  it('prefers aria-labelledby over everything else', () => {
    expect(
      nameOf(
        '<span id="a">Play</span><span id="b">Song</span><button id="target" aria-labelledby="a b" aria-label="x">y</button>',
      ),
    ).toBe('Play Song');
  });

  it('then aria-label, alt and title', () => {
    expect(nameOf('<button id="target" aria-label="Close" title="t">X</button>')).toBe('Close');
    expect(nameOf('<img id="target" alt="Logo" title="t" role="button">')).toBe('Logo');
    expect(nameOf('<a id="target" href="#" title="Home"></a>')).toBe('Home');
  });

  it('then the associated label, for and wrapping', () => {
    expect(nameOf('<label for="target">Email</label><input id="target" placeholder="p">')).toBe(
      'Email',
    );
    expect(nameOf('<label>Remember me <input id="target" type="checkbox"></label>')).toBe(
      'Remember me',
    );
  });

  it('then the placeholder', () => {
    expect(nameOf('<input id="target" placeholder="Search YouTube">')).toBe('Search YouTube');
  });

  it('then visible text, whitespace collapsed', () => {
    expect(nameOf('<a id="target" href="#">\n  Lofi   hip hop\n radio </a>')).toBe(
      'Lofi hip hop radio',
    );
  });

  it(`cuts names at ${NAME_MAX} characters`, () => {
    const name = nameOf(`<button id="target">${'word '.repeat(30)}</button>`);
    expect(name.length).toBeLessThanOrEqual(NAME_MAX);
    expect(name.startsWith('word word')).toBe(true);
    expect(name.endsWith(' ')).toBe(false);
  });

  it('labels submit inputs with their value attribute', () => {
    expect(nameOf('<input id="target" type="submit" value="Google Search">')).toBe('Google Search');
    expect(nameOf('<input id="target" type="submit">')).toBe('Submit');
  });

  it('falls back to a labelled descendant when there is no text', () => {
    expect(nameOf('<a id="target" href="#"><img alt="Channel avatar"></a>')).toBe('Channel avatar');
    expect(nameOf('<button id="target"><svg aria-label="Like"></svg></button>')).toBe('Like');
  });

  it('returns nothing for an element with no name', () => {
    expect(nameOf('<button id="target"><svg></svg></button>')).toBe('');
  });

  describe('never reads a value', () => {
    it('ignores what an input holds', () => {
      document.body.innerHTML = '<input id="target">';
      const input = document.querySelector('input')!;
      input.value = 'hunter2';
      expect(accessibleName(input, text)).toBe('');
    });

    it('ignores the contents of a textarea', () => {
      expect(nameOf('<textarea id="target">my private note</textarea>')).toBe('');
      expect(nameOf('<textarea id="target" aria-label="Message">secret</textarea>')).toBe(
        'Message',
      );
    });

    it('ignores the contents of a contenteditable region', () => {
      expect(nameOf('<div id="target" contenteditable="true">draft reply</div>')).toBe('');
      expect(
        nameOf('<div contenteditable><a id="target" href="#">link typed by me</a></div>'),
      ).toBe('');
    });

    it('does not read a label through a field inside it', () => {
      expect(
        nameOf('<label for="target">Note <textarea>secret</textarea></label><input id="target">'),
      ).toBe('Note');
    });

    it('does not name a wrapper by the text of a field inside it', () => {
      expect(nameOf('<div id="target" onclick="1"><textarea>secret</textarea></div>')).toBe('');
    });

    it('does not read a select as text', () => {
      expect(nameOf('<select id="target"><option>One</option><option>Two</option></select>')).toBe(
        '',
      );
    });
  });
});
