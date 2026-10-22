// @vitest-environment jsdom
import { collectCandidates, POINTER_BUDGET } from '../../src/content/candidates';
import { Lists, signature } from '../../src/content/lists';
import { visualOrder } from '../../src/content/order';
import { takeSnapshot } from '../../src/content/snapshot';
import type { SnapshotElement } from '../../src/shared/protocol';
import { fakeGeometry } from '../helpers/fake-geometry';

function snap(html: string, max = 120) {
  document.body.innerHTML = html;
  const geometry = fakeGeometry(document);
  return takeSnapshot(document, geometry, { snapshotId: 's1', max });
}

function names(elements: SnapshotElement[]): string[] {
  return elements.map((element) => element.name);
}

describe('takeSnapshot', () => {
  it('describes the page and each element', () => {
    document.title = 'Results';
    const { snapshot, handles } = snap(`
      <h1 data-rect="0 0 500 40">Search results</h1>
      <a href="/one" data-rect="10 100 200 20">First result</a>`);
    expect(snapshot).toMatchObject({
      snapshot_id: 's1',
      title: 'Results',
      headings: 'Search results',
      viewport: { width: 1000, height: 800, dpr: 1, scroll_y: 0, scroll_height: 3000 },
    });
    expect(snapshot.elements).toEqual([
      {
        id: 'e1',
        role: 'link',
        name: 'First result',
        kind: 'link',
        rect: [10, 100, 200, 20],
        in_view: true,
      },
    ]);
    expect(handles.get('e1')?.textContent).toBe('First result');
  });

  it('rounds rects to whole CSS pixels', () => {
    const { snapshot } = snap('<button data-rect="10.4 20.6 99.5 30.2">Go</button>');
    expect(snapshot.elements[0]!.rect).toEqual([10, 21, 100, 30]);
  });

  describe('visibility', () => {
    it('drops elements without a box, hidden ones and aria-hidden ones', () => {
      const { snapshot } = snap(`
        <button data-rect="0 0 100 20">Shown</button>
        <button>No box</button>
        <button data-rect="0 30 100 0">Zero height</button>
        <button data-rect="0 60 100 20" hidden>Display none</button>
        <div style="visibility: hidden"><button data-rect="0 90 100 20">Invisible</button></div>
        <div aria-hidden="true"><button data-rect="0 120 100 20">Aria hidden</button></div>
        <div inert><button data-rect="0 150 100 20">Inert</button></div>`);
      expect(names(snapshot.elements)).toEqual(['Shown']);
    });

    it('drops an element covered by something else', () => {
      const { snapshot } = snap(`
        <button data-rect="100 100 100 40">Covered</button>
        <button data-rect="300 100 100 40">Open</button>
        <div data-rect="0 0 250 300" style="background: white">cookie banner</div>`);
      expect(names(snapshot.elements)).toEqual(['Open']);
    });

    it('keeps an element whose hit lands on an ancestor with no candidate between', () => {
      const { snapshot } = snap(`
        <div data-rect="0 0 400 100">
          <span role="button" data-rect="10 10 80 20" style="pointer-events: none">Pass through</span>
        </div>`);
      expect(names(snapshot.elements)).toEqual(['Pass through']);
    });

    it('drops it when another candidate sits between it and the hit', () => {
      const { snapshot } = snap(`
        <div data-rect="0 0 400 100">
          <div role="button" style="pointer-events: none">
            <span role="link" data-rect="10 10 80 20" style="pointer-events: none">Inner</span>
          </div>
        </div>`);
      expect(names(snapshot.elements)).not.toContain('Inner');
    });

    it('keeps in view elements first, then those within one viewport below, and no further', () => {
      const { snapshot } = snap(`
        <a href="/c" data-rect="0 1200 100 20">Below</a>
        <a href="/d" data-rect="0 1700 100 20">Too far</a>
        <a href="/a" data-rect="0 700 100 20">Lower in view</a>
        <a href="/b" data-rect="0 -200 100 20">Above</a>
        <a href="/e" data-rect="1200 100 100 20">Off to the right</a>
        <a href="/f" data-rect="0 100 100 20">Top</a>`);
      expect(snapshot.elements.map((element) => [element.name, element.in_view] as const)).toEqual([
        ['Top', true],
        ['Lower in view', true],
        ['Below', false],
      ]);
    });

    it('hit tests a partly visible element at the centre of its visible part', () => {
      const { snapshot } = snap('<button data-rect="0 780 100 100">Half out</button>');
      expect(snapshot.elements[0]).toMatchObject({ name: 'Half out', in_view: true });
    });
  });

  it('drops candidates without a name', () => {
    const { snapshot } = snap(`
      <button data-rect="0 0 40 40"><svg></svg></button>
      <button data-rect="50 0 40 40" aria-label="Menu"><svg></svg></button>`);
    expect(names(snapshot.elements)).toEqual(['Menu']);
  });

  it('orders elements top to bottom, then left to right', () => {
    const { snapshot } = snap(`
      <button data-rect="500 100 80 20">Right</button>
      <button data-rect="0 300 80 20">Second row</button>
      <button data-rect="100 104 80 30">Left, taller</button>`);
    expect(names(snapshot.elements)).toEqual(['Left, taller', 'Right', 'Second row']);
  });

  it('merges duplicates outside lists, keeping the first in visual order', () => {
    const { snapshot } = snap(`
      <a href="/home" data-rect="0 500 80 20">Home</a>
      <a href="/home" data-rect="0 10 80 20">Home</a>
      <button data-rect="0 40 80 20">Home</button>`);
    expect(snapshot.elements.map((element) => [element.role, element.rect[1]])).toEqual([
      ['link', 10],
      ['button', 40],
    ]);
  });

  it('cuts the list to max after ordering', () => {
    const buttons = Array.from(
      { length: 10 },
      (_, i) => `<button data-rect="0 ${700 - i * 50} 80 20">B${i}</button>`,
    ).join('');
    const { snapshot, handles } = snap(buttons, 3);
    expect(names(snapshot.elements)).toEqual(['B9', 'B8', 'B7']);
    expect(snapshot.elements.map((element) => element.id)).toEqual(['e1', 'e2', 'e3']);
    expect([...handles.keys()]).toEqual(['e1', 'e2', 'e3']);
  });

  it('never puts a field value in the snapshot', () => {
    document.body.innerHTML = `
      <label for="q">Query</label><input id="q" data-rect="0 0 200 30">
      <input data-rect="0 40 200 30" aria-label="Card number" autocomplete="cc-number">
      <textarea data-rect="0 80 200 60" placeholder="Note">my diary entry</textarea>
      <div contenteditable data-rect="0 150 200 60" aria-label="Reply">draft words</div>`;
    const inputs = document.querySelectorAll('input');
    inputs[0]!.value = 'lofi beats';
    inputs[1]!.value = '4111111111111111';
    const { snapshot } = takeSnapshot(document, fakeGeometry(document), {
      snapshotId: 's1',
      max: 120,
    });
    const json = JSON.stringify(snapshot);
    for (const secret of ['lofi beats', '4111', 'diary', 'draft words']) {
      expect(json).not.toContain(secret);
    }
    expect(names(snapshot.elements)).toEqual(['Query', 'Card number', 'Note', 'Reply']);
  });

  it('collects headings h1 to h3 in document order, visible only, up to 400 characters', () => {
    const { snapshot } = snap(`
      <h2 data-rect="0 900 500 30">Up next</h2>
      <h1 data-rect="0 0 500 40">Lofi   radio</h1>
      <h3 hidden data-rect="0 50 100 20">Hidden</h3>
      <h4 data-rect="0 60 100 20">Too small</h4>
      <h3 data-rect="0 2000 500 20">${'x'.repeat(500)}</h3>`);
    expect(snapshot.headings.startsWith('Up next | Lofi radio | xxx')).toBe(true);
    expect(snapshot.headings.length).toBe(400);
  });

  describe('lists', () => {
    const results = (count: number, extra = '') =>
      Array.from(
        { length: count },
        (_, i) => `
        <div class="result card" data-rect="0 ${100 + i * 100} 600 90" ${extra}>
          <h3><a href="/r${i}" data-rect="10 ${110 + i * 100} 400 20">Result ${i + 1}</a></h3>
          <button data-rect="500 ${110 + i * 100} 60 20">More</button>
        </div>`,
      ).join('');

    it('numbers repeated items in visual order and tags every candidate in them', () => {
      const { snapshot } = snap(`<main><div id="results">${results(4)}</div></main>`);
      const listed = snapshot.elements.map((element) => [element.name, element.list]);
      expect(listed).toEqual([
        ['Result 1', { group: 'g1', index: 1, size: 4 }],
        ['More', { group: 'g1', index: 1, size: 4 }],
        ['Result 2', { group: 'g1', index: 2, size: 4 }],
        ['More', { group: 'g1', index: 2, size: 4 }],
        ['Result 3', { group: 'g1', index: 3, size: 4 }],
        ['More', { group: 'g1', index: 3, size: 4 }],
        ['Result 4', { group: 'g1', index: 4, size: 4 }],
        ['More', { group: 'g1', index: 4, size: 4 }],
      ]);
    });

    it('needs at least three items with the same signature', () => {
      const { snapshot } = snap(`<main><div>${results(2)}</div></main>`);
      expect(snapshot.elements.every((element) => element.list === undefined)).toBe(true);
      expect(names(snapshot.elements)).toEqual(['Result 1', 'More', 'Result 2']);
    });

    it('numbers a grid by rows even when the markup is in another order', () => {
      const card = (label: string, x: number, y: number) =>
        `<div class="tile" data-rect="${x} ${y} 180 180"><a href="/${label}" data-rect="${x + 10} ${y + 10} 160 20">${label}</a></div>`;
      const { snapshot } = snap(
        `<section>${card('D', 0, 300)}${card('B', 200, 100)}${card('A', 0, 100)}${card('C', 400, 100)}</section>`,
      );
      expect(snapshot.elements.map((element) => [element.name, element.list?.index])).toEqual([
        ['A', 1],
        ['B', 2],
        ['C', 3],
        ['D', 4],
      ]);
    });

    it('counts only visible items, including those out of range', () => {
      const { snapshot } = snap(
        `<ul>
          <li data-rect="0 100 300 30"><a href="/1" data-rect="0 100 300 30">One</a></li>
          <li hidden><a href="/x">Hidden</a></li>
          <li data-rect="0 140 300 30"><a href="/2" data-rect="0 140 300 30">Two</a></li>
          <li data-rect="0 5000 300 30"><a href="/3" data-rect="0 5000 300 30">Far</a></li>
        </ul>`,
      );
      expect(snapshot.elements.map((element) => [element.name, element.list])).toEqual([
        ['One', { group: 'g1', index: 1, size: 3 }],
        ['Two', { group: 'g1', index: 2, size: 3 }],
      ]);
    });

    it('gives separate lists separate group ids in order of appearance', () => {
      const chips = Array.from(
        { length: 3 },
        (_, i) => `<button class="chip" data-rect="${i * 100} 20 90 30">Chip ${i + 1}</button>`,
      ).join('');
      const { snapshot } = snap(`<nav>${chips}</nav><div>${results(3)}</div>`);
      expect(snapshot.elements[0]!.list).toEqual({ group: 'g1', index: 1, size: 3 });
      expect(snapshot.elements.find((element) => element.name === 'Result 1')!.list).toEqual({
        group: 'g2',
        index: 1,
        size: 3,
      });
    });

    it('keeps duplicates inside lists', () => {
      const { snapshot } = snap(`<div>${results(3)}</div>`);
      expect(names(snapshot.elements).filter((name) => name === 'More')).toHaveLength(3);
    });

    it('does not treat top level page sections as a list', () => {
      const { snapshot } = snap(`
        <div><a href="/a" data-rect="0 0 50 20">A</a></div>
        <div><a href="/b" data-rect="0 30 50 20">B</a></div>
        <div><a href="/c" data-rect="0 60 50 20">C</a></div>`);
      expect(snapshot.elements.every((element) => element.list === undefined)).toBe(true);
    });

    it('numbers rows, not the cells inside them', () => {
      const row = (n: number) =>
        `<div role="row" class="row" data-rect="0 ${n * 60} 900 56">
          <div role="gridcell"><button data-rect="0 ${n * 60} 40 40" aria-label="Play ${n}"></button></div>
          <div role="gridcell"><a href="#${n}" data-rect="50 ${n * 60} 200 20">Song ${n}</a></div>
          <div role="gridcell">3:0${n}</div>
        </div>`;
      const table = (n: number) =>
        `<tr data-rect="0 ${600 + n * 30} 900 28"><td><a href="#t${n}" data-rect="0 ${600 + n * 30} 100 20">Row ${n}</a></td><td>b</td><td>c</td></tr>`;
      const { snapshot } = snap(
        `<div role="rowgroup">${row(1)}${row(2)}${row(3)}</div><table><tbody>${table(1)}${table(2)}${table(3)}</tbody></table>`,
      );
      expect(
        snapshot.elements.map((element) => [element.name, element.list?.index, element.list?.size]),
      ).toEqual([
        ['Play 1', 1, 3],
        ['Song 1', 1, 3],
        ['Play 2', 2, 3],
        ['Song 2', 2, 3],
        ['Play 3', 3, 3],
        ['Song 3', 3, 3],
        ['Row 1', 1, 3],
        ['Row 2', 2, 3],
        ['Row 3', 3, 3],
      ]);
    });

    it('passes over look-alike siblings that are not alike inside', () => {
      // Every element inside a YouTube video carries the same class; only the videos
      // themselves are built from one template.
      const video = (n: number, y: number) =>
        `<div class="video" data-rect="0 ${y} 900 200">
          <div class="scoped" data-rect="400 ${y} 500 40"><h3><a href="/v${n}" data-rect="400 ${y} 400 20">Video ${n}</a></h3><span>badge</span></div>
          <div class="scoped" data-rect="400 ${y + 50} 500 30"><a href="/c${n}" data-rect="400 ${y + 50} 200 20">Channel ${n}</a></div>
          <div class="scoped" data-rect="400 ${y + 90} 500 30"><p>description</p><p>more</p><p>even more</p></div>
          <div class="scoped" hidden></div>
        </div>`;
      const { snapshot } = snap(`<main>${video(1, 0)}${video(2, 210)}${video(3, 420)}</main>`);
      expect(
        snapshot.elements.map((element) => [element.name, element.list?.index, element.list?.size]),
      ).toEqual([
        ['Video 1', 1, 3],
        ['Channel 1', 1, 3],
        ['Video 2', 2, 3],
        ['Channel 2', 2, 3],
        ['Video 3', 3, 3],
        ['Channel 3', 3, 3],
      ]);
    });

    it('needs three visible items built alike', () => {
      const { snapshot } = snap(`
        <header>
          <div class="section" data-rect="0 0 200 50"><a href="/" data-rect="0 0 100 50">Logo</a></div>
          <div class="section" data-rect="200 0 600 50"><form><input aria-label="Find" data-rect="200 0 500 50"></form></div>
          <div class="section" data-rect="800 0 200 50"><button data-rect="800 0 100 50">Sign in</button><span></span></div>
        </header>`);
      expect(snapshot.elements.every((element) => element.list === undefined)).toBe(true);
    });

    it('looks no more than eight ancestors up', () => {
      const deep = (label: string, y: number) =>
        `<div class="row" data-rect="0 ${y} 300 30">${'<div>'.repeat(9)}<a href="/${label}" data-rect="0 ${y} 300 30">${label}</a>${'</div>'.repeat(9)}</div>`;
      const { snapshot } = snap(`<main>${deep('A', 0)}${deep('B', 40)}${deep('C', 80)}</main>`);
      expect(snapshot.elements.every((element) => element.list === undefined)).toBe(true);
    });
  });

  describe('the cursor: pointer pass', () => {
    it('adds pointer elements that have no candidate ancestor', () => {
      const { snapshot } = snap(`
        <div class="track" style="cursor: pointer" data-rect="0 0 500 40">
          <span data-rect="10 10 200 20">Song title</span>
        </div>
        <a href="/x" style="cursor: pointer" data-rect="0 50 100 20"><span style="cursor: pointer" data-rect="0 50 100 20">Link text</span></a>`);
      expect(
        snapshot.elements.map((element) => [element.name, element.role, element.kind]),
      ).toEqual([
        ['Song title', 'generic', 'other'],
        ['Link text', 'link', 'link'],
      ]);
    });

    it('stops after checking the budget of elements', () => {
      const filler = Array.from(
        { length: POINTER_BUDGET },
        (_, i) => `<div data-rect="0 ${i} 10 1"></div>`,
      ).join('');
      document.body.innerHTML = `${filler}<div style="cursor: pointer" data-rect="0 500 100 20">Late</div>`;
      const geometry = fakeGeometry(document);
      expect(collectCandidates(document, geometry, geometry.viewportValue).pointer).toEqual([]);
      expect(
        collectCandidates(document, geometry, geometry.viewportValue, POINTER_BUDGET + 1).pointer,
      ).toHaveLength(1);
    });

    it('does not spend the budget on elements out of range or without a box', () => {
      const filler = Array.from({ length: POINTER_BUDGET }, () => '<div></div>').join('');
      document.body.innerHTML = `${filler}<div style="cursor: pointer" data-rect="0 500 100 20">Late</div>`;
      const geometry = fakeGeometry(document);
      expect(collectCandidates(document, geometry, geometry.viewportValue).pointer).toHaveLength(1);
    });
  });
});

describe('visualOrder', () => {
  it('reads rows left to right', () => {
    const rects = [
      { x: 300, y: 0, width: 10, height: 20 },
      { x: 0, y: 30, width: 10, height: 20 },
      { x: 0, y: 5, width: 10, height: 20 },
    ];
    expect(visualOrder(rects, (rect) => rect)).toEqual([rects[2], rects[0], rects[1]]);
  });
});

describe('Lists', () => {
  it('signs elements by tag and sorted classes', () => {
    document.body.innerHTML = '<li class="b a"></li>';
    expect(signature(document.querySelector('li')!)).toBe('li.a.b');
  });

  it('returns no slot for an element outside any list', () => {
    document.body.innerHTML = '<main><p><a href="/x" data-rect="0 0 10 10">x</a></p></main>';
    const lists = new Lists(fakeGeometry(document));
    expect(lists.slot(document.querySelector('a')!)).toBeNull();
  });
});

describe('frame boxes', () => {
  it('reports each rendered frame with the URL it was asked to load', () => {
    const { snapshot } = snap(`
      <iframe src="https://pay.example/card" data-rect="100 300 400 200"></iframe>
      <iframe srcdoc="<p>hi</p>" data-rect="0 600 300 100"></iframe>
      <iframe src="https://pixel.example/" data-rect="0 0 1 1"></iframe>
      <iframe src="https://hidden.example/" data-rect="0 0 300 300" hidden></iframe>`);
    expect(snapshot.frames).toEqual([
      { url: 'https://pay.example/card', rect: [100, 300, 400, 200] },
      { url: 'about:srcdoc', rect: [0, 600, 300, 100] },
    ]);
  });
});
