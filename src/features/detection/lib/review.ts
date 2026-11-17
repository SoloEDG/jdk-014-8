import type { Rect } from "../../../shared/document";
import type { DetectedBox } from "./detector";
import type { ReviewPanel } from "./types";
import { overlapRatio, unionOf, centerOf, clampRect } from "./geometry";

const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

export function sortByReading<T extends { rect: Rect; order: number }>(
  items: T[],
  direction: "ltr" | "rtl" = "ltr",
): T[] {
  const entries = items.map((item) => ({ item, index: item.order }));
  entries.sort(
    (a, b) =>
      a.item.rect.y - b.item.rect.y ||
      (direction === "ltr"
        ? a.item.rect.x - b.item.rect.x
        : b.item.rect.x - a.item.rect.x) ||
      a.index - b.index,
  );
  const rows: Array<typeof entries> = [];
  for (const entry of entries) {
    const row = rows[rows.length - 1];
    if (!row) {
      rows.push([entry]);
      continue;
    }
    const top = Math.min(...row.map((e) => e.item.rect.y));
    const bottom = Math.max(
      ...row.map((e) => e.item.rect.y + e.item.rect.height),
    );
    const overlap = Math.max(
      0,
      Math.min(bottom, entry.item.rect.y + entry.item.rect.height) -
        Math.max(top, entry.item.rect.y),
    );
    const shortest = Math.max(
      1,
      Math.min(
        ...row.map((e) => e.item.rect.height),
        entry.item.rect.height,
      ),
    );
    if (overlap / shortest >= 0.3) row.push(entry);
    else rows.push([entry]);
  }
  const ordered: typeof entries = [];
  for (const row of rows) {
    row.sort((a, b) =>
      direction === "ltr"
        ? a.item.rect.x - b.item.rect.x || a.item.rect.y - b.item.rect.y
        : b.item.rect.x - a.item.rect.x || a.item.rect.y - b.item.rect.y,
    );
    ordered.push(...row);
  }
  return ordered.map((entry) => entry.item);
}

export function withReadingOrder<T extends { rect: Rect; order: number }>(
  items: T[],
  direction: "ltr" | "rtl" = "ltr",
): T[] {
  return sortByReading(items, direction).map((item, index) => ({
    ...item,
    order: index,
  }));
}

export function panelRectWithin(
  rect: Rect,
  width: number,
  height: number,
): Rect {
  return clampRect(rect, width, height, 10);
}

export function resizePanelRect(
  rect: Rect,
  handle: string,
  dx: number,
  dy: number,
  width: number,
  height: number,
): Rect {
  let { x, y, width: w, height: h } = rect;
  if (handle.includes("w")) {
    const right = x + w;
    x = clamp(x + dx, 0, right - 10);
    w = right - x;
  }
  if (handle.includes("e")) {
    w = clamp(w + dx, 10, width - x);
  }
  if (handle.includes("n")) {
    const bottom = y + h;
    y = clamp(y + dy, 0, bottom - 10);
    h = bottom - y;
  }
  if (handle.includes("s")) {
    h = clamp(h + dy, 10, height - y);
  }
  return panelRectWithin({ x, y, width: w, height: h }, width, height);
}

export function movePanelRect(
  rect: Rect,
  dx: number,
  dy: number,
  width: number,
  height: number,
): Rect {
  return panelRectWithin(
    { ...rect, x: rect.x + dx, y: rect.y + dy },
    width,
    height,
  );
}

export function mergePanels(
  panels: ReviewPanel[],
  ids: string[],
  width: number,
  height: number,
): { panels: ReviewPanel[]; merged: ReviewPanel | null } {
  const selected = panels.filter((panel) => ids.includes(panel.id));
  if (selected.length < 2) return { panels, merged: null };
  const keep = selected.reduce((a, b) => (a.order <= b.order ? a : b));
  const rect = unionOf(selected.map((panel) => panel.rect));
  const dialogues = selected
    .map((panel) => panel.dialogue.trim())
    .filter(Boolean);
  const merged: ReviewPanel = {
    ...keep,
    rect: clampRect(rect, width, height, 10),
    dialogue: [...new Set(dialogues)].join("\n"),
    dialogueEdited: selected.some((panel) => panel.dialogueEdited),
    needsReview: selected.length > 1 || selected.some((p) => p.needsReview),
    confidence: Math.min(...selected.map((panel) => panel.confidence)),
    touched: true,
    frameEdited: true,
    fresh: selected.every((panel) => panel.fresh),
    origin:
      selected.every((panel) => panel.origin === "manual")
        ? "manual"
        : selected.some((panel) => panel.origin === "detected")
          ? "detected"
          : selected[0]!.origin,
  };
  const result = panels
    .filter((panel) => !ids.includes(panel.id) || panel.id === keep.id)
    .map((panel) => (panel.id === keep.id ? merged : panel))
    .sort((a, b) => a.order - b.order)
    .map((panel, index) => ({ ...panel, order: index }));
  return { panels: result, merged };
}

export function splitPanel(
  panels: ReviewPanel[],
  id: string,
  axis: "x" | "y",
  width: number,
  height: number,
): { panels: ReviewPanel[]; parts: ReviewPanel[] } {
  const index = panels.findIndex((panel) => panel.id === id);
  const target = panels[index];
  if (!target) return { panels, parts: [] };
  const rect = target.rect;
  const ratio = 0.5;
  let pieces: Rect[];
  if (axis === "x") {
    const w = Math.max(10, Math.round(rect.width * ratio));
    pieces = [
      { ...rect, width: w },
      {
        x: rect.x + w,
        y: rect.y,
        width: Math.max(10, rect.width - w),
        height: rect.height,
      },
    ];
  } else {
    const h = Math.max(10, Math.round(rect.height * ratio));
    pieces = [
      { ...rect, height: h },
      {
        x: rect.x,
        y: rect.y + h,
        width: rect.width,
        height: Math.max(10, rect.height - h),
      },
    ];
  }
  const center = centerOf(rect);
  const contentIndex =
    center.x <= pieces[0]!.x + pieces[0]!.width &&
    center.y <= pieces[0]!.y + pieces[0]!.height
      ? 0
      : 1;
  const parts: ReviewPanel[] = pieces.map((piece, i) => ({
    ...target,
    id: i === 0 ? target.id : `${target.id}-s${Date.now().toString(36)}`,
    rect: clampRect(piece, width, height, 10),
    order: target.order + i,
    dialogue: i === contentIndex ? target.dialogue : "",
    dialogueEdited: i === contentIndex ? target.dialogueEdited : false,
    needsReview:
      i === contentIndex ? target.needsReview : Boolean(target.dialogue.trim()),
    touched: true,
    frameEdited: true,
    fresh: i === 0 ? target.fresh : true,
    existingId: i === 0 ? target.existingId : undefined,
  }));
  const result = [
    ...panels.slice(0, index),
    ...parts,
    ...panels.slice(index + 1),
  ]
    .sort((a, b) => a.order - b.order)
    .map((panel, order) => ({ ...panel, order }));
  return { panels: result, parts };
}

export function addPanel(
  panels: ReviewPanel[],
  rect: Rect,
  width: number,
  height: number,
): { panels: ReviewPanel[]; panel: ReviewPanel } {
  const panel: ReviewPanel = {
    id: `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    rect: clampRect(rect, width, height, 10),
    confidence: 1,
    touched: true,
    order: panels.length,
    dialogue: "",
    speaker: "旁白",
    sound: "wind",
    duration: 5,
    dialogueEdited: false,
    frameEdited: true,
    origin: "manual",
    fresh: true,
  };
  return { panels: [...panels, panel], panel };
}

export function removePanel(
  panels: ReviewPanel[],
  id: string,
): ReviewPanel[] {
  return panels
    .filter((panel) => panel.id !== id)
    .sort((a, b) => a.order - b.order)
    .map((panel, index) => ({ ...panel, order: index }));
}

export function reorderPanels(
  panels: ReviewPanel[],
  id: string,
  to: number,
): ReviewPanel[] {
  const ordered = [...panels].sort((a, b) => a.order - b.order);
  const from = ordered.findIndex((panel) => panel.id === id);
  if (from < 0) return panels;
  const target = clamp(to, 0, ordered.length - 1);
  if (target === from) return panels;
  const [panel] = ordered.splice(from, 1);
  ordered.splice(target, 0, panel!);
  return ordered.map((item, index) => ({ ...item, order: index }));
}

export function updatePanelRect(
  panels: ReviewPanel[],
  id: string,
  rect: Rect,
  width: number,
  height: number,
): ReviewPanel[] {
  return panels.map((panel) =>
    panel.id === id
      ? {
          ...panel,
          rect: panelRectWithin(rect, width, height),
          touched: true,
          frameEdited: true,
          confidence: Math.max(panel.confidence, 0.99),
        }
      : panel,
  );
}

export interface LateMergeResult {
  panels: ReviewPanel[];
  applied: number;
  skipped: number;
  moved: number;
}

/**
 * 合并迟到的识别结果。约束：
 * - 用户拖动或改过框线的框，框线不被替换；
 * - 对白、说话人永远跟着“内容最多的旧框”，不会因为新框多就换格；
 * - 一整页框被识别成多格时，旧对白迁移到与旧框重叠最大的新格并标为待确认；
 * - 其余建议补成新框，不与已确认区域大面积重叠；
 * - 用户已排过顺序则保持该顺序，否则按新布局重新建议。
 */
export function mergeLateDetections(
  panels: ReviewPanel[],
  boxes: DetectedBox[],
  width: number,
  height: number,
  orderTouched: boolean,
  lowConfidence: boolean,
): LateMergeResult {
  const frameLocked = panels.filter((panel) => panel.touched || panel.frameEdited);
  const candidates = panels.filter((panel) => !frameLocked.includes(panel));
  const consumed = new Set<DetectedBox>();
  let moved = 0;

  // 每个未锁定的推荐框优先认领与其重叠最大的一个建议（保持一一对应）。
  const updated: ReviewPanel[] = candidates.map((panel) => {
    const candidate = boxes
      .filter((box) => !consumed.has(box))
      .map((box) => ({ box, ratio: overlapRatio(panel.rect, box.rect) }))
      .filter((item) => item.ratio >= 0.55)
      .sort((a, b) => b.ratio - a.ratio)[0];
    if (!candidate) return panel;
    consumed.add(candidate.box);
    const shrunk = panel.rect.width * panel.rect.height >
      candidate.box.rect.width * candidate.box.rect.height * 1.6;
    const hasContent =
      panel.dialogueEdited || panel.dialogue.trim().length > 0;
    return {
      ...panel,
      rect: clampRect(candidate.box.rect, width, height, 10),
      confidence: Math.max(panel.confidence, candidate.box.confidence),
      fresh: false,
      // 原本一整页的框被拆成多格时，对白归属需要人工确认。
      needsReview: Boolean(panel.needsReview) || (shrunk && hasContent),
    };
  });

  const settled = [...frameLocked, ...updated];
  const additions: ReviewPanel[] = [];
  let skipped = 0;
  for (const box of boxes) {
    if (consumed.has(box)) continue;
    if (lowConfidence) {
      // 低可信建议不应在已编辑内容旁边制造大量待确认框。
      const overlaps = settled.some(
        (panel) => overlapRatio(panel.rect, box.rect) > 0.45,
      );
      if (overlaps) {
        skipped++;
        continue;
      }
    }
    const closest = settled
      .map((panel) => ({ panel, ratio: overlapRatio(box.rect, panel.rect) }))
      .sort((a, b) => b.ratio - a.ratio)[0];
    if (closest && closest.ratio > 0.3) {
      // 新建议主要是旧框的一部分：说明是同一格的细分，交给人工确认。
      skipped++;
      continue;
    }
    additions.push({
      id: `late-${Date.now().toString(36)}-${additions.length}`,
      rect: clampRect(box.rect, width, height, 10),
      confidence: box.confidence,
      touched: false,
      order: 0,
      dialogue: "",
      speaker: "旁白",
      sound: "wind",
      duration: 5,
      dialogueEdited: false,
      frameEdited: false,
      origin: "detected",
      fresh: true,
    });
  }

  // 未能在建议里找到对应、但有内容的旧框：把内容迁移到重叠最大的新区域。
  const absorbed = new Set<string>();
  for (const panel of updated) {
    if (panel.dialogue.trim() || panel.dialogueEdited) continue;
    const donor = candidates
      .filter(
        (old) =>
          !absorbed.has(old.id) &&
          old !== panel &&
          (old.dialogueEdited ||
            old.dialogue.trim()) &&
          overlapRatio(old.rect, panel.rect) >= 0.2,
      )
      .sort(
        (a, b) =>
          overlapRatio(b.rect, panel.rect) - overlapRatio(a.rect, panel.rect),
      )[0];
    if (!donor) continue;
    absorbed.add(donor.id);
    moved++;
    panel.dialogue = donor.dialogue;
    panel.speaker = donor.speaker;
    panel.sound = donor.sound;
    panel.duration = donor.duration;
    panel.dialogueEdited = donor.dialogueEdited;
    panel.needsReview = true;
    panel.migratedFrom = donor.id;
  }

  const merged = [...settled, ...additions].filter(
    (panel, index, all) =>
      all.findIndex((item) => item.id === panel.id) === index,
  );
  const ordered = orderTouched
    ? [...merged].sort((a, b) => a.order - b.order)
    : withReadingOrder(merged, "ltr");
  return {
    panels: ordered.map((panel, index) => ({ ...panel, order: index })),
    applied: updated.length + additions.length,
    skipped,
    moved,
  };
}

export interface PanelDiff {
  unchanged: number;
  adjusted: number;
  added: number;
  removed: number;
}

export function diffPanels(
  original: Array<{ id: string; rect: Rect }>,
  reviewed: ReviewPanel[],
): PanelDiff {
  const byExisting = new Map<string, ReviewPanel>();
  for (const panel of reviewed) {
    if (panel.existingId) byExisting.set(panel.existingId, panel);
  }
  let unchanged = 0;
  let adjusted = 0;
  let removed = 0;
  for (const panel of original) {
    const match = byExisting.get(panel.id);
    if (!match) {
      removed++;
      continue;
    }
    const a = panel.rect;
    const b = match.rect;
    if (
      Math.abs(a.x - b.x) <= 2 &&
      Math.abs(a.y - b.y) <= 2 &&
      Math.abs(a.width - b.width) <= 2 &&
      Math.abs(a.height - b.height) <= 2
    )
      unchanged++;
    else adjusted++;
  }
  const existing = new Set(original.map((panel) => panel.id));
  const added = reviewed.filter(
    (panel) => !panel.existingId || !existing.has(panel.existingId),
  ).length;
  return { unchanged, adjusted, added, removed };
}
