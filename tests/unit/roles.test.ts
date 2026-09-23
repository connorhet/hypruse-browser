// @vitest-environment jsdom
import { CANDIDATE_SELECTOR, isSearchField, kindOf, roleOf } from '../../src/content/roles';

function element(html: string): Element {
  document.body.innerHTML = html;
  const el = document.body.firstElementChild;
  if (!el) throw new Error('no element');
  return el;
}

function kind(html: string): string {
  const el = element(html);
  return kindOf(el, roleOf(el));
}

describe('roleOf', () => {
  it('uses the first explicit role', () => {
    expect(roleOf(element('<div role="tab menuitem"></div>'))).toBe('tab');
  });

  it('ignores presentation roles and derives from the tag', () => {
    expect(roleOf(element('<button role="presentation"></button>'))).toBe('button');
    expect(roleOf(element('<a href="/x"></a>'))).toBe('link');
    expect(roleOf(element('<a></a>'))).toBe('generic');
    expect(roleOf(element('<summary></summary>'))).toBe('button');
    expect(roleOf(element('<select></select>'))).toBe('combobox');
    expect(roleOf(element('<select multiple></select>'))).toBe('listbox');
    expect(roleOf(element('<textarea></textarea>'))).toBe('textbox');
    expect(roleOf(element('<div contenteditable=""></div>'))).toBe('textbox');
    expect(roleOf(element('<div onclick="1"></div>'))).toBe('generic');
  });

  it('derives input roles from the type', () => {
    expect(roleOf(element('<input>'))).toBe('textbox');
    expect(roleOf(element('<input type="search">'))).toBe('searchbox');
    expect(roleOf(element('<input type="checkbox">'))).toBe('checkbox');
    expect(roleOf(element('<input type="radio">'))).toBe('radio');
    expect(roleOf(element('<input type="submit">'))).toBe('button');
    expect(roleOf(element('<input list="x">'))).toBe('combobox');
  });
});

describe('kindOf', () => {
  it('maps roles to kinds', () => {
    expect(kind('<a href="/x">x</a>')).toBe('link');
    expect(kind('<button>x</button>')).toBe('button');
    expect(kind('<div role="tab">x</div>')).toBe('tab');
    expect(kind('<div role="option">x</div>')).toBe('option');
    expect(kind('<div role="menuitem">x</div>')).toBe('option');
    expect(kind('<input type="checkbox">')).toBe('toggle');
    expect(kind('<input type="radio">')).toBe('toggle');
    expect(kind('<button role="switch">x</button>')).toBe('toggle');
    expect(kind('<input type="email">')).toBe('input');
    expect(kind('<select></select>')).toBe('input');
    expect(kind('<div contenteditable="true"></div>')).toBe('input');
    expect(kind('<div onclick="1">x</div>')).toBe('other');
  });
});

describe('isSearchField', () => {
  const search = (html: string) => {
    const el = element(html);
    const target = el.matches('input, textarea') ? el : (el.querySelector('input, textarea') ?? el);
    return isSearchField(target, roleOf(target));
  };

  it('recognises search types and roles', () => {
    expect(search('<input type="search">')).toBe(true);
    expect(search('<div role="searchbox" contenteditable></div>')).toBe(true);
    expect(search('<input role="combobox">')).toBe(true);
    expect(search('<textarea role="combobox"></textarea>')).toBe(true);
  });

  it('recognises a field inside a search landmark', () => {
    expect(search('<form role="search"><input name="q"></form>')).toBe(true);
    expect(search('<search><input name="q"></search>')).toBe(true);
  });

  it('recognises "search" in the name, id, placeholder, label or test id', () => {
    expect(search('<input name="search_query">')).toBe(true);
    expect(search('<input id="SearchBox">')).toBe(true);
    expect(search('<input placeholder="Search Spotify">')).toBe(true);
    expect(search('<input aria-label="Search mail">')).toBe(true);
    expect(search('<input data-testid="search-input">')).toBe(true);
  });

  it('rejects ordinary fields and non-text inputs', () => {
    expect(search('<input name="email">')).toBe(false);
    expect(search('<textarea name="comment"></textarea>')).toBe(false);
    expect(search('<input type="submit" id="search-button">')).toBe(false);
    expect(search('<input type="checkbox" name="search-safe">')).toBe(false);
  });

  it('gives search fields their own kind', () => {
    expect(kind('<input type="search">')).toBe('search');
    expect(kind('<input data-testid="search-input" role="combobox">')).toBe('search');
  });
});

describe('CANDIDATE_SELECTOR', () => {
  it('matches the first pass candidates and nothing else', () => {
    document.body.innerHTML = `
      <a href="/a" id="c1">a</a><a id="n1">not a link</a>
      <button id="c2"></button><input id="c3"><input type="hidden" id="n2">
      <textarea id="c4"></textarea><select id="c5"></select>
      <details><summary id="c6">More</summary></details>
      <div contenteditable="true" id="c7"></div><div contenteditable="false" id="n3"></div>
      <div onclick="go()" id="c8"></div>
      <div role="button" id="c9"></div><div role="Link" id="c10"></div>
      <span role="switch" id="c11"></span><div role="list" id="n4"></div>
      <div id="n5">plain</div>`;
    const ids = Array.from(document.querySelectorAll(CANDIDATE_SELECTOR), (el) => el.id);
    expect(ids).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'c11']);
  });
});
