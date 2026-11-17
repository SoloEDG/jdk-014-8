import type { Rect } from "../../../shared/document";
import type { ReviewPanel } from "../lib/types";

export function confidenceTone(value: number) {
  if (value < 0.45) return "low";
  if (value < 0.62) return "mid";
  return "high";
}

export function pagePointFromEvent(
  event: PointerEvent,
  element: HTMLElement,
  page: { width: number; height: number },
) {
  const box = element.getBoundingClientRect();
  const x = ((event.clientX - box.left) / Math.max(1, box.width)) * page.width;
  const y = ((event.clientY - box.top) / Math.max(1, box.height)) * page.height;
  return {
    x: Math.max(0, Math.min(page.width, x)),
    y: Math.max(0, Math.min(page.height, y)),
  };
}

export function boxPercent(rect: Rect, page: { width: number; height: number }) {
  return {
    left: `${(rect.x / page.width) * 100}%`,
    top: `${(rect.y / page.height) * 100}%`,
    width: `${(rect.width / page.width) * 100}%`,
    height: `${(rect.height / page.height) * 100}%`,
  };
}

export function reviewStatus(panel: ReviewPanel) {
  if (panel.needsReview) return "对白待确认";
  if (panel.confidence < 0.45) return "低可信";
  if (panel.confidence < 0.62) return "需核对";
  return "";
}
