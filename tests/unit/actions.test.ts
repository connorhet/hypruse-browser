// @vitest-environment jsdom
import { createAgent } from '../../src/content/agent';
import { click } from '../../src/content/click';
import { PageError } from '../../src/content/errors';
import { Registry } from '../../src/content/registry';
import { scroll, scrollTarget } from '../../src/content/scroll';
import { settle } from '../../src/content/settle';
import { isSensitive, typeText } from '../../src/content/type';
import { fakeGeometry } from '../helpers/fake-geometry';

function pageError(work: () => unknown): PageError {
  try {
    work();
  } catch (error) {
    if (error instanceof PageError) return error;
    throw error;
  }
  throw new Error('expected a PageError');
}

describe('Registry', () => {
  function setup() {
    document.body.innerHTML = '<button id="a">A</button><button id="b">B</button>';
    const registry = new Registry(document);
    const a = document.getElementById('a')!;
    const b = document.getElementById('b')!;
    registry.replace(
      's1',
      new Map([
        ['e1', a],
        ['e2', b],
      ]),
    );
    return { registry, a, b };
  }

  it('resolves an element of the latest snapshot', () => {
    const { registry, a } = setup();
    expect(registry.resolve('s1', 'e1')).toBe(a);
  });

  it('refuses a snapshot that is not the latest', () => {
    const { registry, b } = setup();
    registry.replace('s2', new Map([['e1', b]]));
    expect(pageError(() => registry.resolve('s1', 'e1')).code).toBe('stale_snapshot');
    expect(registry.resolve('s2', 'e1')).toBe(b);
  });

  it('refuses an element that has left the page', () => {
    const { registry, a } = setup();
    a.remove();
    expect(pageError(() => registry.resolve('s1', 'e1')).code).toBe('stale_snapshot');
  });

  it('refuses after the page navigated, but not after a hash change', () => {
    const { registry, a } = setup();
    history.pushState(null, '', '#section');
    expect(registry.resolve('s1', 'e1')).toBe(a);
    history.pushState(null, '', '/watch?v=other');
    expect(pageError(() => registry.resolve('s1', 'e1')).code).toBe('stale_snapshot');
    history.pushState(null, '', '/');
  });

  it('answers not_found for an element id the snapshot does not have', () => {
    const { registry } = setup();
    expect(pageError(() => registry.resolve('s1', 'e9')).code).toBe('not_found');
  });

  it('knows no snapshot before the first one', () => {
    const registry = new Registry(document);
    expect(pageError(() => registry.resolve('s1', 'e1')).code).toBe('stale_snapshot');
  });
});

describe('click', () => {
  it('hovers, presses, focuses, releases and clicks at the centre', () => {
    document.body.innerHTML = '<button data-rect="100 200 80 40">Go</button>';
    const button = document.querySelector('button')!;
    const seen: string[] = [];
    let at: [number, number] = [0, 0];
    for (const type of [
      'pointerover',
      'pointerenter',
      'mouseover',
      'pointerdown',
      'mousedown',
      'focus',
      'pointerup',
      'mouseup',
      'click',
    ]) {
      button.addEventListener(type, (event) => {
        seen.push(type);
        if (event instanceof MouseEvent && type === 'mousedown')
          at = [event.clientX, event.clientY];
      });
    }
    let bubbled = false;
    document.body.addEventListener('mousedown', () => (bubbled = true));
    click(button, fakeGeometry(document));
    expect(seen).toEqual([
      'pointerover',
      'pointerenter',
      'mouseover',
      'pointerdown',
      'mousedown',
      'focus',
      'pointerup',
      'mouseup',
      'click',
    ]);
    expect(at).toEqual([140, 220]);
    expect(bubbled).toBe(true);
    expect(document.activeElement).toBe(button);
  });

  it('scrolls an element into the middle when its centre is off screen', () => {
    document.body.innerHTML = '<a href="#x" data-rect="0 1500 100 20">Far</a>';
    const link = document.querySelector('a')!;
    const scrollIntoView = vi.fn(() => link.setAttribute('data-rect', '0 390 100 20'));
    link.scrollIntoView = scrollIntoView;
    let releasedAt = -1;
    link.addEventListener('mouseup', (event) => (releasedAt = event.clientY));
    click(link, fakeGeometry(document));
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: 'center',
      inline: 'center',
      behavior: 'instant',
    });
    expect(releasedAt).toBe(400);
  });
});

describe('typeText', () => {
  it('sets the value so a React style tracker sees the change', () => {
    document.body.innerHTML = '<form><input name="q"></form>';
    const input = document.querySelector('input')!;
    // React replaces the value property on the instance to remember the last value it set.
    const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
    let tracked = '';
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: () => native.get!.call(input) as string,
      set: (value: string) => {
        tracked = value;
        native.set!.call(input, value);
      },
    });
    const changes: string[] = [];
    input.addEventListener('input', (event) => {
      const actual = native.get!.call(input) as string;
      if (actual !== tracked) changes.push(actual);
      expect(event.inputType).toBe('insertText');
    });
    let changed = false;
    input.addEventListener('change', () => (changed = true));
    typeText(input, 'lofi beats', false);
    expect(changes).toEqual(['lofi beats']);
    expect(changed).toBe(true);
    expect(document.activeElement).toBe(input);
  });

  it('replaces the existing text', () => {
    document.body.innerHTML = '<textarea>old words</textarea>';
    const textarea = document.querySelector('textarea')!;
    typeText(textarea, 'new words', false);
    expect(textarea.value).toBe('new words');
  });

  it('presses Enter and submits the form when nothing prevents it', () => {
    document.body.innerHTML = '<form><input name="q"></form>';
    const form = document.querySelector('form')!;
    const input = document.querySelector('input')!;
    const keys: string[] = [];
    input.addEventListener('keydown', (event) => {
      // keyCode is deprecated, and still what many sites read to spot Enter.
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      keys.push(`${event.type}:${event.key}:${event.code}:${event.keyCode}`);
    });
    input.addEventListener('keypress', (event) => keys.push(`${event.type}:${event.key}`));
    input.addEventListener('keyup', (event) => keys.push(`${event.type}:${event.key}`));
    const submitted = vi.fn((event: Event) => event.preventDefault());
    form.addEventListener('submit', submitted);
    typeText(input, 'query', true);
    expect(keys).toEqual(['keydown:Enter:Enter:13', 'keypress:Enter', 'keyup:Enter']);
    expect(submitted).toHaveBeenCalledOnce();
  });

  it('does not submit when the page handles Enter itself', () => {
    document.body.innerHTML = '<form><input name="q"></form>';
    const form = document.querySelector('form')!;
    const input = document.querySelector('input')!;
    input.addEventListener('keydown', (event) => event.preventDefault());
    const submitted = vi.fn((event: Event) => event.preventDefault());
    form.addEventListener('submit', submitted);
    typeText(input, 'query', true);
    expect(submitted).not.toHaveBeenCalled();
  });

  it('types into a field inside a wrapper element', () => {
    document.body.innerHTML = '<div role="combobox"><input></div>';
    typeText(document.querySelector('div')!, 'inside', false);
    expect(document.querySelector('input')!.value).toBe('inside');
  });

  it('types into a contenteditable region', () => {
    document.body.innerHTML = '<div contenteditable="true">old</div>';
    const editor = document.querySelector('div')!;
    const inputs: string[] = [];
    editor.addEventListener('input', (event) => inputs.push(event.data ?? ''));
    typeText(editor, 'hello', false);
    expect(editor.textContent).toBe('hello');
    expect(inputs).toEqual(['hello']);
  });

  describe('refusals', () => {
    it('refuses password fields', () => {
      document.body.innerHTML = '<input type="password">';
      const input = document.querySelector('input')!;
      expect(pageError(() => typeText(input, 'hunter2', false)).code).toBe('refused');
      expect(input.value).toBe('');
    });

    it('refuses payment card fields', () => {
      document.body.innerHTML =
        '<input autocomplete="cc-number"><input autocomplete="billing cc-csc">';
      for (const input of document.querySelectorAll('input')) {
        expect(pageError(() => typeText(input, '4111', false)).code).toBe('refused');
        expect(input.value).toBe('');
      }
    });

    it('refuses a password field reached through its wrapper', () => {
      document.body.innerHTML = '<div role="textbox"><input type="password"></div>';
      expect(pageError(() => typeText(document.querySelector('div')!, 'x', false)).code).toBe(
        'refused',
      );
    });

    it('refuses elements that take no text, and disabled or read-only fields', () => {
      document.body.innerHTML =
        '<button>b</button><input type="checkbox"><input disabled><input readonly>';
      expect(pageError(() => typeText(document.querySelector('button')!, 'x', false)).code).toBe(
        'refused',
      );
      for (const input of document.querySelectorAll('input')) {
        expect(pageError(() => typeText(input, 'x', false)).code).toBe('refused');
      }
    });

    it('knows which fields are sensitive', () => {
      document.body.innerHTML =
        '<input type="password"><input autocomplete="cc-exp"><input autocomplete="new-password"><input autocomplete="email">';
      expect(Array.from(document.querySelectorAll('input'), isSensitive)).toEqual([
        true,
        true,
        true,
        false,
      ]);
    });
  });
});

describe('scroll', () => {
  it('scrolls the scrollable panel under the middle of the viewport', () => {
    document.body.innerHTML = `
      <nav style="overflow-y: auto" data-scroll="0 2000 800" data-rect="0 0 200 800"></nav>
      <main style="overflow-y: auto" data-scroll="0 5000 700" data-rect="200 0 800 700">
        <div data-rect="200 0 800 5000"><div id="row" data-rect="200 380 800 60">row</div></div>
      </main>`;
    const geometry = fakeGeometry(document);
    const main = document.querySelector('main')!;
    expect(scrollTarget(document, geometry)).toBe(main);
    const scrollTo = vi.fn();
    main.scrollTo = scrollTo;
    expect(scroll(document, geometry, 'down')).toEqual({ scroll_y: 560, scroll_height: 5000 });
    expect(scrollTo).toHaveBeenCalledWith({ top: 560, behavior: 'smooth' });
  });

  it('skips ancestors that do not scroll', () => {
    document.body.innerHTML = `
      <div style="overflow-y: hidden" data-scroll="0 5000 800" data-rect="0 0 1000 800">
        <div style="overflow-y: auto" data-scroll="0 800 800" data-rect="0 0 1000 800">
          <p data-rect="0 0 1000 800">text</p>
        </div>
      </div>`;
    expect(scrollTarget(document, fakeGeometry(document))).toBe(document.documentElement);
  });

  it('falls back to the document', () => {
    document.body.innerHTML = '<p data-rect="0 0 1000 800">text</p>';
    expect(scrollTarget(document, fakeGeometry(document))).toBe(
      document.scrollingElement ?? document.documentElement,
    );
  });

  it('computes destinations for each direction, clamped to the ends', () => {
    document.body.innerHTML = `
      <main style="overflow-y: scroll" data-scroll="1000 3000 500" data-rect="0 0 1000 800"></main>`;
    const main = document.querySelector('main')!;
    main.scrollTo = vi.fn();
    const geometry = fakeGeometry(document);
    expect(scroll(document, geometry, 'down').scroll_y).toBe(1400);
    expect(scroll(document, geometry, 'up').scroll_y).toBe(600);
    expect(scroll(document, geometry, 'top').scroll_y).toBe(0);
    expect(scroll(document, geometry, 'bottom').scroll_y).toBe(2500);
    main.setAttribute('data-scroll', '2400 3000 500');
    expect(scroll(document, geometry, 'down').scroll_y).toBe(2500);
    main.setAttribute('data-scroll', '100 3000 500');
    expect(scroll(document, geometry, 'up').scroll_y).toBe(0);
  });
});

describe('settle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns at once when no settle time is asked for', async () => {
    await expect(settle(document, 0)).resolves.toBeUndefined();
  });

  it('waits for 250 ms without DOM changes', async () => {
    let done = false;
    void settle(document, 5000).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(200);
    document.body.append(document.createElement('div'));
    await vi.advanceTimersByTimeAsync(200);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(60);
    expect(done).toBe(true);
  });

  it('gives up at settle_ms when the page keeps changing', async () => {
    let done = false;
    void settle(document, 1000).then(() => (done = true));
    for (let i = 0; i < 9; i += 1) {
      document.body.append(document.createElement('span'));
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toBe(true);
  });
});

describe('createAgent', () => {
  it('snapshots, then clicks by handle', async () => {
    document.body.innerHTML = '<button data-rect="0 0 100 30">Play</button>';
    const clicked = vi.fn();
    document.querySelector('button')!.addEventListener('click', clicked);
    const agent = createAgent(document, fakeGeometry(document), '1.0.0');
    const snapshot = await agent.handle('snapshot', { snapshot_id: 's4', max: 10, settle_ms: 0 });
    expect(snapshot).toMatchObject({ ok: true, result: { snapshot_id: 's4' } });
    await expect(agent.handle('click', { snapshot_id: 's4', element_id: 'e1' })).resolves.toEqual({
      ok: true,
      result: {},
    });
    expect(clicked).toHaveBeenCalledOnce();
  });

  it('answers stale_snapshot for an older snapshot', async () => {
    document.body.innerHTML = '<button data-rect="0 0 100 30">Play</button>';
    const agent = createAgent(document, fakeGeometry(document), '1.0.0');
    await agent.handle('snapshot', { snapshot_id: 's1', max: 10, settle_ms: 0 });
    await agent.handle('snapshot', { snapshot_id: 's2', max: 10, settle_ms: 0 });
    await expect(
      agent.handle('click', { snapshot_id: 's1', element_id: 'e1' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'stale_snapshot' } });
  });

  it('answers refused for a password field', async () => {
    document.body.innerHTML =
      '<input type="password" aria-label="Password" data-rect="0 0 100 30">';
    const agent = createAgent(document, fakeGeometry(document), '1.0.0');
    await agent.handle('snapshot', { snapshot_id: 's1', max: 10, settle_ms: 0 });
    await expect(
      agent.handle('type', { snapshot_id: 's1', element_id: 'e1', text: 'x', submit: false }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'refused' } });
  });

  it('turns unexpected exceptions into internal errors and unknown ops into bad_request', async () => {
    const geometry = fakeGeometry(document);
    geometry.viewport = () => {
      throw new TypeError('layout exploded');
    };
    const agent = createAgent(document, geometry, '1.0.0');
    await expect(agent.handle('scroll', { direction: 'down' })).resolves.toEqual({
      ok: false,
      error: { code: 'internal', message: 'layout exploded' },
    });
    await expect(agent.handle('dance', {})).resolves.toMatchObject({
      ok: false,
      error: { code: 'bad_request' },
    });
    expect(agent.version).toBe('1.0.0');
  });
});
