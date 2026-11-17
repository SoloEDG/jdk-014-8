import type { Panel, Rect } from "./document";

export function rectCenter(rect: Rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** 点（页面坐标）落在哪个分镜里；重叠时取面积最小的那个。 */
export function panelAtPoint(
  panels: Array<Pick<Panel, "id" | "rect">>,
  x: number,
  y: number,
): string | null {
  let found: string | null = null;
  let area = Infinity;
  for (const panel of panels) {
    const r = panel.rect;
    if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) {
      const a = Math.max(1, r.width * r.height);
      if (a < area) {
        found = panel.id;
        area = a;
      }
    }
  }
  return found;
}

function intersection(a: Rect, b: Rect) {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return x * y;
}

/** 点不在任何框内时按最近边界归属，确保迁移不丢。 */
export function nearestPanel(
  panels: Array<Pick<Panel, "id" | "rect">>,
  x: number,
  y: number,
): string | null {
  const inside = panelAtPoint(panels, x, y);
  if (inside) return inside;
  let nearest: string | null = null;
  let best = Infinity;
  for (const panel of panels) {
    const r = panel.rect;
    const dx = Math.max(r.x - x, 0, x - (r.x + r.width));
    const dy = Math.max(r.y - y, 0, y - (r.y + r.height));
    const d = Math.hypot(dx, dy);
    if (d < best) {
      best = d;
      nearest = panel.id;
    }
  }
  return nearest;
}

/**
 * 把旧分镜上的引用（书签、声音触发点、当前镜头）迁移到新布局。
 * 优先看引用点是否落在新框内；不在任何框内时，优先选与旧框重叠面积最大的新框，
 * 其次才按距离，避免删掉一格后引用被带到页面另一端。
 */
export function migratePanelReference(
  previous: Array<Pick<Panel, "id" | "rect">>,
  next: Array<Pick<Panel, "id" | "rect">>,
  panelId: string,
): string | null {
  const old = previous.find((panel) => panel.id === panelId);
  if (!old) return null;
  if (next.some((panel) => panel.id === panelId)) return panelId;
  const center = rectCenter(old.rect);
  const inside = panelAtPoint(next, center.x, center.y);
  if (inside) return inside;
  let best: string | null = null;
  let bestArea = 0;
  for (const panel of next) {
    const area = intersection(panel.rect, old.rect);
    if (area > bestArea) {
      bestArea = area;
      best = panel.id;
    }
  }
  if (best) return best;
  // 新旧框恰好没有重叠（例如只剩细窄间隔）时，按中心距离选最近的区域。
  let nearestId: string | null = null;
  let nearestDistance = Infinity;
  for (const panel of next) {
    const c = rectCenter(panel.rect);
    const d = Math.hypot(c.x - center.x, c.y - center.y);
    if (d < nearestDistance) {
      nearestDistance = d;
      nearestId = panel.id;
    }
  }
  return nearestId;
}
