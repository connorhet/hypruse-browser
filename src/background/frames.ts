import type { FrameBox, PageSnapshot, SnapshotElement, Viewport } from '../shared/protocol';

// A page's frames are separate documents, each with an agent of its own that numbers its
// elements e1, e2 and so on. In a merged snapshot an element of frame 12 is "f12.e3", and its
// list groups are "f12.g1", so no id from one document can be taken for another's.
const FRAME_ELEMENT = /^f(\d+)\.(.+)$/;

export type FramePage = { frameId: number; page: PageSnapshot };

// The frame an element id belongs to (undefined for the top frame) and its id there.
export function splitElementId(id: string): [number | undefined, string] {
  const [, frame, local] = FRAME_ELEMENT.exec(id) ?? [];
  return frame !== undefined && local !== undefined ? [Number(frame), local] : [undefined, id];
}

function meets(rect: readonly number[], viewport: Viewport): boolean {
  const [x, y, w, h] = rect as [number, number, number, number];
  return x < viewport.width && y < viewport.height && x + w > 0 && y + h > 0;
}

// The box the top document shows a frame in: the first unused one asked to load the URL the
// frame's document has, else the only unused one of the same origin (a frame that redirected).
function boxOf(url: string, boxes: FrameBox[], used: Set<FrameBox>): FrameBox | undefined {
  const free = boxes.filter((box) => !used.has(box));
  const exact = free.find((box) => box.url === url);
  if (exact) return exact;
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return undefined;
  }
  const same = free.filter((box) => {
    try {
      return new URL(box.url).origin === origin;
    } catch {
      return false;
    }
  });
  return same.length === 1 ? same[0] : undefined;
}

// One snapshot of the whole page: the top document's elements and those of its frames, in
// view first. A frame's element is moved into the top viewport by its frame's box, and is in
// view only when that box is; a frame whose box cannot be found (a frame inside a frame) keeps
// its elements, out of view, with rects relative to that frame. Frames with no area are left
// out. The list is cut to `max`.
export function mergeFrames(
  top: PageSnapshot,
  children: FramePage[],
  max: number,
): SnapshotElement[] {
  const used = new Set<FrameBox>();
  const placed: { y: number; x: number; elements: SnapshotElement[] }[] = [];
  for (const { frameId, page } of children) {
    if (page.viewport.width <= 1 || page.viewport.height <= 1) continue;
    const box = boxOf(page.url, top.frames ?? [], used);
    if (box) used.add(box);
    const [dx, dy] = box ? box.rect : [0, 0];
    const shown = box !== undefined && meets(box.rect, top.viewport);
    const elements = page.elements.map((element): SnapshotElement => {
      const [x, y, w, h] = element.rect;
      const rect: [number, number, number, number] = [x + dx, y + dy, w, h];
      const moved: SnapshotElement = {
        ...element,
        id: `f${frameId}.${element.id}`,
        rect,
        in_view: element.in_view && shown && meets(rect, top.viewport),
      };
      if (element.list)
        moved.list = { ...element.list, group: `f${frameId}.${element.list.group}` };
      return moved;
    });
    placed.push({ y: box ? box.rect[1] : Infinity, x: box ? box.rect[0] : Infinity, elements });
  }
  placed.sort((a, b) => a.y - b.y || a.x - b.x);
  const framed = placed.flatMap((frame) => frame.elements);
  return [
    ...top.elements.filter((element) => element.in_view),
    ...framed.filter((element) => element.in_view),
    ...top.elements.filter((element) => !element.in_view),
    ...framed.filter((element) => !element.in_view),
  ].slice(0, max);
}
