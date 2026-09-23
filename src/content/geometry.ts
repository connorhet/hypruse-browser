import type { Viewport } from '../shared/protocol';

export type Rect = { x: number; y: number; width: number; height: number };

export type Look = { display: string; visibility: string; cursor: string; overflowY: string };

export type ScrollMetrics = { scrollTop: number; scrollHeight: number; clientHeight: number };

// Everything the content script needs from layout, in one place, so the snapshot logic can
// be tested in a DOM without a layout engine.
export type Geometry = {
  rect(el: Element): Rect;
  style(el: Element): Look;
  hit(x: number, y: number): Element | null;
  viewport(): Viewport;
  // Rendered text, as innerText gives it.
  text(el: Element): string;
  scrollMetrics(el: Element): ScrollMetrics;
};

export function browserGeometry(win: Window): Geometry {
  const doc = win.document;
  return {
    rect(el) {
      const { x, y, width, height } = el.getBoundingClientRect();
      return { x, y, width, height };
    },
    style(el) {
      const style = win.getComputedStyle(el);
      return {
        display: style.display,
        visibility: style.visibility,
        cursor: style.cursor,
        overflowY: style.overflowY,
      };
    },
    hit: (x, y) => doc.elementFromPoint(x, y),
    viewport() {
      const scroller = doc.scrollingElement ?? doc.documentElement;
      return {
        width: win.innerWidth,
        height: win.innerHeight,
        dpr: win.devicePixelRatio,
        scroll_y: Math.round(win.scrollY),
        scroll_height: scroller.scrollHeight,
      };
    },
    text: (el) => (el instanceof HTMLElement ? el.innerText : el.textContent),
    scrollMetrics: (el) => ({
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }),
  };
}
