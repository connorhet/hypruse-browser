import type { Rect } from './geometry';

// Reading order: top to bottom, then left to right. Items whose tops are closer than half the
// smaller height share a row, so a toolbar of mixed heights still reads left to right.
export function visualOrder<T>(items: readonly T[], rectOf: (item: T) => Rect): T[] {
  const byTop = [...items].sort((a, b) => rectOf(a).y - rectOf(b).y || rectOf(a).x - rectOf(b).x);
  const rows = new Map<T, number>();
  let row = -1;
  let anchor: Rect | null = null;
  for (const item of byTop) {
    const rect = rectOf(item);
    if (!anchor || rect.y - anchor.y >= Math.min(anchor.height, rect.height) / 2) {
      row += 1;
      anchor = rect;
    }
    rows.set(item, row);
  }
  return byTop.sort(
    (a, b) =>
      (rows.get(a) ?? 0) - (rows.get(b) ?? 0) ||
      rectOf(a).x - rectOf(b).x ||
      rectOf(a).y - rectOf(b).y,
  );
}
