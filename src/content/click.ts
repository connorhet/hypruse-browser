import type { Geometry } from './geometry';
import { visibleCentre } from './visibility';

// Clicks like a mouse would: scroll the element to the middle when its centre is off screen,
// hover, press, focus, release, then click().
export function click(el: Element, geometry: Geometry): void {
  const viewport = geometry.viewport();
  let rect = geometry.rect(el);
  const centreX = rect.x + rect.width / 2;
  const centreY = rect.y + rect.height / 2;
  if (centreX < 0 || centreX > viewport.width || centreY < 0 || centreY > viewport.height) {
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    rect = geometry.rect(el);
  }
  const { x, y } = visibleCentre(rect, geometry.viewport());
  const mouse: MouseEventInit = {
    bubbles: true,
    composed: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  };
  const pointer: PointerEventInit = {
    ...mouse,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
  };
  const Pointer = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;

  el.dispatchEvent(new Pointer('pointerover', pointer));
  el.dispatchEvent(new Pointer('pointerenter', pointer));
  el.dispatchEvent(new MouseEvent('mouseover', mouse));
  el.dispatchEvent(new Pointer('pointerdown', { ...pointer, buttons: 1 }));
  el.dispatchEvent(new MouseEvent('mousedown', { ...mouse, buttons: 1 }));
  if (el instanceof HTMLElement || el instanceof SVGElement) el.focus({ preventScroll: true });
  el.dispatchEvent(new Pointer('pointerup', pointer));
  el.dispatchEvent(new MouseEvent('mouseup', mouse));
  if (el instanceof HTMLElement) {
    el.click();
  } else {
    el.dispatchEvent(new MouseEvent('click', mouse));
  }
}
