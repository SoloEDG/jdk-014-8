import type { Rect } from "../../../shared/document";
import { makeId } from "../../../shared/commands";
import { matchScore, overlapRatio, rectArea } from "./geometry";
import type { ReviewPanel } from "./types";
import { DEFAULT_DIALOGUE } from "../../../shared/document";

export interface ApplyOptions {
  lowConfidence: boolean;
}

export interface ApplyStats {
  reused: number;
  created: number;
  preserved: number;
  mergedDialogues: number;
  dropped: number;
  needsReview: number;
}

export interface ApplyDecision {
  panels: ReviewPanel[];
  stats: ApplyStats;
}

/**
 * 把审阅结果变成最终分镜：
 * - 已拖动/已写字的分镜永远保留，不被低可信建议覆盖；
 * - 有内容的旧分镜与新框一对一时沿用 id，书签、触发点、当前镜头可继续指向；
 * - 新框与旧框合并时保留全部对白；拆分时对白只跟重叠更大的一侧；
 * - 未匹配到内容的旧分镜不会消失，会并入最接近的新框。
 */
export function decideApply(
  reviewed: ReviewPanel[],
  width: number,
  height: number,
  options: ApplyOptions,
): ApplyDecision {
  const stats: ApplyStats = {
    reused: 0,
    created: 0,
    preserved: 0,
    mergedDialogues: 0,
    dropped: 0,
    needsReview: 0,
  };
  const valid = reviewed
    .filter((panel) => panel.rect.width >= 8 && panel.rect.height >= 8)
    .sort((a, b) => a.order - b.order);

  if (!valid.length) {
    return {
      panels: [
        {
          id: makeId("panel"),
          rect: { x: 0, y: 0, width, height },
          confidence: 1,
          touched: true,
          order: 0,
          dialogue: "",
          speaker: "旁白",
          sound: "wind",
          duration: 5,
          dialogueEdited: false,
          frameEdited: false,
          origin: "manual",
          fresh: true,
        },
      ],
      stats,
    };
  }

  const result: ReviewPanel[] = [];
  const loose: ReviewPanel[] = [];
  for (const panel of valid) {
    if (panel.existingId && panel.rect.width > 0) {
      stats.reused++;
      result.push({ ...panel, needsReview: panel.needsReview || false });
    } else {
      stats.created++;
      loose.push({ ...panel });
    }
  }
  if (options.lowConfidence) {
    // 低可信结果只是建议：已有手动分镜保持不动，新框同样落为待确认。
    for (const panel of result) {
      if (panel.frameEdited || panel.dialogueEdited) stats.preserved++;
    }
  }

  // 没有旧 id 的新框：若它与另一个有内容的分镜重叠很大，视为合并，保留两者对白。
  for (const panel of loose) {
    const host = result.find(
      (existing) =>
        overlapRatio(panel.rect, existing.rect) >= 0.55 &&
        (existing.dialogue.trim() || existing.dialogueEdited),
    );
    if (host) {
      stats.mergedDialogues++;
      if (panel.dialogue.trim()) {
        host.dialogue = [host.dialogue.trim(), panel.dialogue.trim()]
          .filter(Boolean)
          .join("\n");
        host.needsReview = true;
      }
      host.confidence = Math.max(host.confidence, panel.confidence);
      host.frameEdited = true;
      continue;
    }
    result.push(panel);
  }

  const ordered = result
    .sort((a, b) => a.order - b.order)
    .map((panel, index) => ({ ...panel, order: index }));
  stats.needsReview = ordered.filter((panel) => panel.needsReview).length;
  return { panels: ordered, stats };
}

/**
 * 审阅时把新框与旧分镜的内容对应起来，供界面展示与迁移检查。
 * 返回的 id 一律使用旧分镜 id（存在时），这样书签/触发点/当前镜头天然保持有效。
 */
export function attachExisting(
  boxes: Array<{ rect: Rect; confidence: number }>,
  existing: ReviewPanel[],
  width: number,
  height: number,
): ReviewPanel[] {
  const used = new Set<string>();
  const matched: ReviewPanel[] = [];
  for (const box of boxes) {
    const candidate = existing
      .filter((panel) => !used.has(panel.id))
      .map((panel) => ({ panel, ratio: matchScore(box.rect, panel.rect) }))
      .filter((item) => item.ratio >= 0.45)
      .sort((a, b) => b.ratio - a.ratio)[0];
    if (candidate) {
      used.add(candidate.panel.id);
      const old = candidate.panel;
      const redistributed = Boolean(
        rectArea(old.rect) > rectArea(box.rect) * 1.6 &&
          (old.dialogueEdited ||
            (old.dialogue.trim() && old.dialogue.trim() !== DEFAULT_DIALOGUE)),
      );
      matched.push({
        ...old,
        rect: box.rect,
        confidence: box.confidence,
        order: matched.length,
        fresh: false,
        touched: false,
        existingId: old.id,
        // 原本一整页的内容被拆进多个框时，对白归属不再明确，标为待确认。
        needsReview: Boolean(old.needsReview) || redistributed,
      });
    } else {
      matched.push({
        id: makeId("review"),
        rect: box.rect,
        confidence: box.confidence,
        touched: false,
        order: matched.length,
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
  }
  // 未被建议直接对应的旧分镜：若有真实内容，迁移到重叠最大的新框并标为待确认，
  // 而不是再叠加一个重复框。只有实在找不到落点时才保留原框。
  const orphans = existing.filter((panel) => !used.has(panel.id));
  for (const orphan of orphans) {
    const hasContent =
      orphan.dialogueEdited ||
      (orphan.dialogue.trim() && orphan.dialogue.trim() !== DEFAULT_DIALOGUE);
    if (!hasContent) continue;
    const target = matched
      .map((panel) => ({ panel, ratio: matchScore(orphan.rect, panel.rect) }))
      .sort((a, b) => b.ratio - a.ratio)[0];
    if (target && target.ratio >= 0.2) {
      target.panel.dialogue = target.panel.dialogue.trim()
        ? `${target.panel.dialogue.trim()}\n${orphan.dialogue.trim()}`
        : orphan.dialogue;
      if (!target.panel.speaker || target.panel.speaker === "旁白")
        target.panel.speaker = orphan.speaker;
      target.panel.dialogueEdited =
        target.panel.dialogueEdited || orphan.dialogueEdited;
      target.panel.needsReview = true;
      target.panel.migratedFrom = orphan.id;
      continue;
    }
    matched.push({
      ...orphan,
      order: matched.length,
      touched: true,
      frameEdited: true,
      fresh: false,
      existingId: orphan.id,
      needsReview: true,
    });
  }
  return matched.map((panel, index) => ({ ...panel, order: index }));
}

/**
 * 比较建议布局与原布局，供“建议 / 原布局”切换展示。
 */
export function compareLayouts(
  page: { width: number; height: number },
  existing: Array<{ id: string; rect: Rect }>,
  boxes: Array<{ rect: Rect }>,
) {
  const before = existing.reduce((sum, panel) => sum + rectArea(panel.rect), 0);
  const after = boxes.reduce((sum, box) => sum + rectArea(box.rect), 0);
  const pageArea = Math.max(1, page.width * page.height);
  return {
    existingCount: existing.length,
    suggestedCount: boxes.length,
    coverageBefore: Math.round(Math.min(1, before / pageArea) * 100),
    coverageAfter: Math.round(Math.min(1, after / pageArea) * 100),
    delta: boxes.length - existing.length,
  };
}

export function applySummaryText(stats: ApplyStats) {
  const parts: string[] = [];
  if (stats.created) parts.push(`新增 ${stats.created} 格`);
  if (stats.reused) parts.push(`沿用 ${stats.reused} 格`);
  if (stats.mergedDialogues) parts.push(`合并 ${stats.mergedDialogues} 条对白`);
  if (stats.preserved) parts.push(`保留 ${stats.preserved} 格已编辑`);
  if (stats.needsReview) parts.push(`${stats.needsReview} 格待确认`);
  return parts.join(" · ") || "布局未变化";
}

