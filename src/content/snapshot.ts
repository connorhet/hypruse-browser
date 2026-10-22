import type { ElementKind, FrameBox, PageSnapshot, SnapshotElement } from '../shared/protocol';
import { collectCandidates } from './candidates';
import type { Geometry, Rect } from './geometry';
import { Lists, type ListSlot } from './lists';
import { accessibleName } from './names';
import { visualOrder } from './order';
import { pageText } from './pagetext';
import { kindOf, roleOf } from './roles';
import { collapse, cut, isInEditable } from './text';
import { isHitTarget, isRendered, placement } from './visibility';

export const HEADINGS_MAX = 400;

type Entry = {
  el: Element;
  rect: Rect;
  inView: boolean;
  role: string;
  name: string;
  kind: ElementKind;
  slot: ListSlot | null;
};

export type SnapshotOutput = {
  snapshot: PageSnapshot;
  // Element id to element, for the registry.
  handles: Map<string, Element>;
};

function headingsOf(doc: Document, geometry: Geometry): string {
  const parts: string[] = [];
  let length = 0;
  for (const heading of doc.querySelectorAll('h1, h2, h3')) {
    if (length >= HEADINGS_MAX) break;
    if (isInEditable(heading) || !isRendered(heading, geometry)) continue;
    const text = collapse(geometry.text(heading));
    if (!text) continue;
    parts.push(text);
    length += text.length + 3;
  }
  return cut(parts.join(' | '), HEADINGS_MAX);
}

function toRect(rect: Rect): [number, number, number, number] {
  return [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)];
}

// The frames this document shows, with the URL each was asked to load: a frame's own
// document reports that URL too, which is how the service worker tells which box is whose.
function framesOf(doc: Document, geometry: Geometry): FrameBox[] {
  const boxes: FrameBox[] = [];
  for (const frame of doc.querySelectorAll('iframe, frame')) {
    const rect = geometry.rect(frame);
    if (rect.width <= 1 || rect.height <= 1 || !isRendered(frame, geometry, rect)) continue;
    const url =
      frame.getAttribute('srcdoc') !== null
        ? 'about:srcdoc'
        : (frame as HTMLIFrameElement).src || 'about:blank';
    boxes.push({ url, rect: toRect(rect) });
  }
  return boxes;
}

// Reads the page: named, visible, reachable things to click or type into, in reading order,
// with repeated items numbered. Values are never read.
export function takeSnapshot(
  doc: Document,
  geometry: Geometry,
  options: { snapshotId: string; max: number },
): SnapshotOutput {
  const viewport = geometry.viewport();
  const { semantic, pointer, matched } = collectCandidates(doc, geometry, viewport);
  const lists = new Lists(geometry);

  const entries: Entry[] = [];
  for (const el of [...semantic, ...pointer]) {
    const rect = geometry.rect(el);
    if (!isRendered(el, geometry, rect)) continue;
    const where = placement(rect, viewport);
    if (!where) continue;
    if (where === 'view' && !isHitTarget(el, rect, geometry, viewport, matched)) continue;
    const name = accessibleName(el, geometry.text);
    if (!name) continue;
    const role = roleOf(el);
    entries.push({
      el,
      rect,
      inView: where === 'view',
      role,
      name,
      kind: kindOf(el, role),
      slot: lists.slot(el),
    });
  }

  const ordered = [
    ...visualOrder(
      entries.filter((entry) => entry.inView),
      (entry) => entry.rect,
    ),
    ...visualOrder(
      entries.filter((entry) => !entry.inView),
      (entry) => entry.rect,
    ),
  ];

  // Outside lists, the same role and name twice is one thing to the person speaking.
  const seen = new Set<string>();
  const kept: Entry[] = [];
  for (const entry of ordered) {
    if (kept.length >= options.max) break;
    if (!entry.slot) {
      const key = `${entry.role}\u0000${entry.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    kept.push(entry);
  }

  const groups = new Map<string, string>();
  const handles = new Map<string, Element>();
  const elements = kept.map((entry, i): SnapshotElement => {
    const id = `e${i + 1}`;
    handles.set(id, entry.el);
    const element: SnapshotElement = {
      id,
      role: entry.role,
      name: entry.name,
      kind: entry.kind,
      rect: toRect(entry.rect),
      in_view: entry.inView,
    };
    if (entry.slot) {
      let group = groups.get(entry.slot.key);
      if (!group) {
        group = `g${groups.size + 1}`;
        groups.set(entry.slot.key, group);
      }
      element.list = { group, index: entry.slot.index, size: entry.slot.size };
    }
    return element;
  });

  return {
    snapshot: {
      snapshot_id: options.snapshotId,
      url: doc.URL,
      title: doc.title,
      headings: headingsOf(doc, geometry),
      text: pageText(doc, geometry, viewport),
      viewport,
      elements,
      frames: framesOf(doc, geometry),
    },
    handles,
  };
}
