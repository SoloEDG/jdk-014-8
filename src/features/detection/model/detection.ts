import { ref, computed, shallowRef, type Ref } from "vue";
import type { ComicDocument, ComicPage, Panel } from "../../../shared/document";
import { makeId } from "../../../shared/commands";
import { DEFAULT_DIALOGUE } from "../../../shared/document";
import type { DetectionResult } from "../lib/detector";
import type { ReviewMode, ReviewPanel } from "../lib/types";
import {
  addPanel,
  mergeLateDetections,
  mergePanels,
  removePanel,
  reorderPanels,
  splitPanel,
  updatePanelRect,
  withReadingOrder,
} from "../lib/review";
import { attachExisting, decideApply, type ApplyStats } from "../lib/apply";
import { prepareImage, scaleRects, type PreparedImage } from "../lib/image";

const LOW_CONFIDENCE = 0.58;

interface Job {
  id: string;
  pageId: string;
  mode: ReviewMode;
  /** 用户主动在同一页重新识别：迟到提示要区分“重跑”与“真迟到” */
  rerun: boolean;
  /** 启动识别时的布局修订号；页面布局被改动后结果即视为迟到 */
  revision: number;
  progress: number;
}

export interface ApplyPayload {
  pageId: string;
  previous: Panel[];
  next: Panel[];
  stats: ApplyStats;
}

/**
 * 关闭 / 后台识别 / 建议就绪 / 审阅中 / 失败。
 * 识别与建议就绪阶段都不遮挡阅读，结果只有点“应用布局”才写入页面。
 */
export type ReviewPhase = "closed" | "loading" | "ready" | "review" | "error";

export function useDetection(
  doc: Ref<ComicDocument>,
  onApplied: (payload: ApplyPayload) => void,
) {
  const pageId = ref("");
  const phase = ref<ReviewPhase>("closed");
  /** 审阅浮层是否打开；重新识别或收起阅读时保持与流程阶段解耦。 */
  const reviewOpen = ref(false);
  const mode = ref<ReviewMode>("fast");
  const progress = ref(0);
  const error = ref("");
  const result = shallowRef<DetectionResult | null>(null);
  const panels = ref<ReviewPanel[]>([]);
  const selected = ref<string[]>([]);
  const revision = ref(0);
  const orderTouched = ref(false);
  const showOriginal = ref(false);
  const notice = ref("");
  const stale = ref(false);
  const job = shallowRef<Job | null>(null);
  const revisions = new Map<string, number>();
  let worker: Worker | null = null;

  const page = computed(() => findPage(pageId.value));
  const original = computed<Panel[]>(() => page.value?.panels ?? []);
  const ordered = computed(() =>
    [...panels.value].sort((a, b) => a.order - b.order),
  );
  const lowConfidence = computed(() => {
    if (!result.value) return false;
    if (result.value.confidence < LOW_CONFIDENCE) return true;
    return (
      result.value.boxes.length > 1 &&
      result.value.boxes.some((box) => box.confidence < 0.45)
    );
  });
  const touched = computed(() =>
    panels.value.some((panel) => panel.touched || panel.dialogueEdited),
  );
  const reviewCount = computed(
    () => panels.value.filter((panel) => panel.needsReview).length,
  );

  function nearestOf(panels: Panel[], rect: Panel["rect"]): Panel | null {
  let best: Panel | null = null;
  let bestScore = -Infinity;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  for (const panel of panels) {
    const r = panel.rect;
    const ox = Math.max(0, Math.min(cx, r.x + r.width) - Math.max(cx, r.x));
    const oy = Math.max(0, Math.min(cy, r.y + r.height) - Math.max(cy, r.y));
    const inside = cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height;
    const score = (inside ? 1e9 : 0) + ox * oy - Math.hypot(r.x + r.width / 2 - cx, r.y + r.height / 2 - cy);
    if (score > bestScore) {
      bestScore = score;
      best = panel;
    }
  }
  return best;
}

function findPage(id: string): ComicPage | null {
    for (const chapter of doc.value.chapters) {
      const found = chapter.pages.find((p) => p.id === id);
      if (found) return found;
    }
    return null;
  }

  function revisionOf(id: string) {
    return revisions.get(id) ?? 0;
  }

  function toReviewPanels(target: ComicPage): ReviewPanel[] {
    return target.panels.map((panel, index) => ({
      id: panel.id,
      rect: { ...panel.rect },
      confidence: 1,
      touched: false,
      order: index,
      existingId: panel.id,
      dialogue: panel.dialogue,
      speaker: panel.speaker,
      sound: panel.sound,
      duration: panel.duration,
      dialogueEdited: panel.dialogueEdited ?? false,
      frameEdited: panel.frameEdited ?? false,
      needsReview: panel.needsReview ?? false,
      origin: panel.origin ?? "import",
      fresh: false,
    }));
  }

  /** 识别/等待期间用户可能已在阅读器改过对白，进入审阅前先同步文档内容。 */
  function syncFromDocument(target: ComicPage) {
    const byId = new Map(target.panels.map((panel) => [panel.id, panel]));
    panels.value = panels.value.map((panel) => {
      if (!panel.existingId) return panel;
      const current = byId.get(panel.existingId);
      if (!current) return panel;
      if (panel.dialogueEdited || panel.frameEdited) return panel;
      return {
        ...panel,
        dialogue: current.dialogue,
        speaker: current.speaker,
        sound: current.sound,
        duration: current.duration,
        dialogueEdited: current.dialogueEdited ?? false,
        frameEdited: current.frameEdited ?? false,
      };
    });
    revision.value = revisionOf(target.id);
  }

  function prepare(id: string) {
    const target = findPage(id);
    if (!target) return;
    phase.value = "ready";
    resetToOriginal(id);
    syncFromDocument(target);
  }

  function resetToOriginal(id: string) {
    const target = findPage(id);
    if (!target) return;
    panels.value = toReviewPanels(target);
    revision.value = revisionOf(id);
  }

  function clearSession() {
    pageId.value = "";
    result.value = null;
    panels.value = [];
    selected.value = [];
    orderTouched.value = false;
    showOriginal.value = false;
    notice.value = "";
    stale.value = false;
    error.value = "";
    progress.value = 0;
  }

  async function start(id: string, nextMode: ReviewMode = mode.value) {
    const target = findPage(id);
    if (!target) return;
    // 已有未应用的编辑（拖动、改字、排序）时先询问是否保留，避免重新识别抹掉手工成果。
    const pending =
      panels.value.length > 0 &&
      (touched.value ||
        orderTouched.value ||
        panels.value.some(
          (panel) => panel.dialogue !== originalFor(panel) || panel.needsReview,
        ));
    if (pending && id === pageId.value) {
      const keep = window.confirm(
        "当前审阅有尚未应用的调整。重新识别会以原布局为基础，确定继续吗？（已写入页面的对白不受影响）",
      );
      if (!keep) return;
    }
    const carryOver = pending && id === pageId.value ? panels.value : null;
    cancelJob();
    pageId.value = id;
    mode.value = nextMode;
    phase.value = "loading";
    if (reviewOpen.value) phase.value = "loading";
    progress.value = 0;
    error.value = "";
    notice.value = "";
    stale.value = false;
    showOriginal.value = false;
    selected.value = [];
    revision.value = revisionOf(id);
    panels.value = carryOver
      ? carryOver.map((panel) => ({ ...panel }))
      : toReviewPanels(target);
    orderTouched.value = carryOver ? orderTouched.value : false;
    result.value = null;
    clearSessionNotice();
    const current: Job = {
      id: makeId("detect"),
      pageId: id,
      mode: nextMode,
      revision: revisionOf(id),
      progress: 0,
      rerun: Boolean(carryOver),
    };
    job.value = current;
    try {
      const prepared = await prepareImage(
        target.image,
        target.width,
        target.height,
        nextMode,
      );
      if (job.value?.id !== current.id) {
        prepared.bitmap.close();
        return;
      }
      if (typeof Worker === "undefined") {
        await runInline(current, prepared);
        return;
      }
      worker = new Worker(new URL("../lib/detector.worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = (event: MessageEvent) =>
        handleMessage(current, event.data as WorkerMessage, prepared);
      worker.onerror = () =>
        fail(current, "识别线程启动失败；现有布局不受影响，可重试");
      worker.postMessage(
        {
          type: "detect",
          jobId: current.id,
          bitmap: prepared.bitmap,
          mode: nextMode,
        },
        [prepared.bitmap],
      );
    } catch (cause) {
      fail(current, cause instanceof Error ? cause.message : "无法读取图片");
    }
  }

  function clearSessionNotice() {
    notice.value = "";
  }

  function originalFor(panel: ReviewPanel) {
    if (!panel.existingId) return "";
    const current = findPage(pageId.value)?.panels.find(
      (item) => item.id === panel.existingId,
    );
    return current?.dialogue ?? "";
  }

  interface WorkerMessage {
    type: "progress" | "done" | "error";
    jobId: string;
    value?: number;
    result?: DetectionResult;
    message?: string;
  }

  function handleMessage(
    jobState: Job,
    message: WorkerMessage,
    prepared: PreparedImage,
  ) {
    if (job.value?.id !== jobState.id) return;
    if (message.type === "progress") {
      progress.value = message.value ?? progress.value;
      return;
    }
    disposeWorker();
    if (message.type === "error") {
      fail(jobState, message.message ?? "识别失败，现有布局已保留");
      return;
    }
    if (message.type === "done" && message.result) {
      accept(jobState, message.result, prepared);
    }
  }

  async function runInline(jobState: Job, prepared: PreparedImage) {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = prepared.bitmap.width;
      canvas.height = prepared.bitmap.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("浏览器不支持画布读取");
      context.drawImage(prepared.bitmap, 0, 0);
      prepared.bitmap.close();
      await new Promise((resolve) => setTimeout(resolve, 16));
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const { detectPanels } = await import("../lib/detector");
      const detection = detectPanels(
        { data: image.data, width: image.width, height: image.height },
        jobState.mode,
        (value) => {
          if (job.value?.id === jobState.id) progress.value = value;
        },
      );
      if (job.value?.id !== jobState.id) return;
      accept(jobState, detection, prepared);
    } catch (cause) {
      fail(jobState, cause instanceof Error ? cause.message : "识别失败");
    }
  }

  function accept(
    jobState: Job,
    detection: DetectionResult,
    prepared: PreparedImage,
  ) {
    job.value = null;
    const target = findPage(jobState.pageId);
    if (!target) {
      clearSession();
      phase.value = "closed";
      return;
    }
    const scaled: DetectionResult = {
      ...detection,
      boxes: scaleRects(
        detection.boxes,
        prepared,
        target.width,
        target.height,
      ),
    };
    result.value = scaled;
    progress.value = 1;
    phase.value = reviewOpen.value ? "review" : "ready";
    // 读取期间用户在阅读器里改的对白要先同步进来，再判断结果是否迟到。
    syncFromDocument(target);
    const layoutMoved =
      revision.value !== jobState.revision ||
      revisionOf(target.id) !== jobState.revision;
    const edited = panels.value.some(
      (panel) =>
        panel.touched || panel.dialogueEdited || Boolean(panel.needsReview),
    );
    if (!layoutMoved && !edited) {
      const attached = attachExisting(
        scaled.boxes,
        panels.value,
        target.width,
        target.height,
      );
      panels.value = withReadingOrder(attached, "ltr");
      orderTouched.value = false;
      stale.value = false;
      notice.value = "";
      return;
    }
    stale.value = true;
    const late = mergeLateDetections(
      panels.value,
      scaled.boxes,
      target.width,
      target.height,
      orderTouched.value,
      scaled.confidence < LOW_CONFIDENCE,
    );
    panels.value = late.panels;
    if (jobState.rerun) {
      notice.value = `已按${jobState.mode === "fine" ? "精细" : "快速"}模式重新识别；你拖动过或写过对白的框已原样保留，其余框按新建议更新。`;
    } else {
      notice.value = layoutMoved
        ? "这页的布局在识别期间被修改过。建议只补充你未编辑的区域，不会覆盖已确认的框。"
        : "识别期间你改过对白或框线。迟到的建议只补到未编辑区域，原有对白保持原格。";
    }
  }

  function fail(jobState: Job, message: string) {
    if (job.value?.id !== jobState.id) return;
    job.value = null;
    disposeWorker();
    phase.value = "error";
    error.value = message;
    progress.value = 0;
  }

  function disposeWorker() {
    worker?.terminate();
    worker = null;
  }

  function cancelJob() {
    if (job.value) {
      worker?.postMessage({ type: "cancel", jobId: job.value.id });
      job.value = null;
    }
    disposeWorker();
  }

  /** 取消识别/放弃建议：页面布局完全没有被改动。 */
  function cancel() {
    cancelJob();
    clearSession();
    reviewOpen.value = false;
    phase.value = "closed";
  }

  /** 收起审阅面板但保留建议，回到阅读；下次可继续对照。 */
  function dismiss() {
    reviewOpen.value = false;
    if (phase.value === "review" && result.value) phase.value = "ready";
  }

  /** 进入详细审阅；若在等待期间改过对白，先同步。 */
  function enterReview() {
    const target = page.value;
    if (!target) return;
    syncFromDocument(target);
    selected.value = [];
    reviewOpen.value = true;
    if (phase.value !== "loading") phase.value = "review";
  }

  function close() {
    cancelJob();
    clearSession();
    reviewOpen.value = false;
    phase.value = "closed";
  }

  function keepWhole() {
    const target = page.value;
    if (!target) return;
    cancelJob();
    result.value = null;
    stale.value = false;
    orderTouched.value = false;
    selected.value = [];
    const source = original.value;
    panels.value = [
      {
        id:
          source.length === 1
            ? source[0]!.id
            : `whole-${Date.now().toString(36)}`,
        rect: { x: 0, y: 0, width: target.width, height: target.height },
        confidence: 1,
        touched: true,
        order: 0,
        existingId: source.length === 1 ? source[0]!.id : undefined,
        dialogue: source.length === 1 ? source[0]!.dialogue : "",
        speaker: source.length === 1 ? source[0]!.speaker : "旁白",
        sound: source.length === 1 ? source[0]!.sound : "wind",
        duration: source.length === 1 ? source[0]!.duration : 5,
        dialogueEdited: source.some((panel) => panel.dialogueEdited),
        frameEdited: false,
        needsReview: false,
        origin: "manual",
        fresh: true,
      },
    ];
    reviewOpen.value = true;
    phase.value = "review";
    notice.value = "已保留整页为一个阅读区域；可手动加框，或稍后重新识别。";
  }

  function toggleSelect(id: string, additive: boolean) {
    if (!additive) {
      selected.value = selected.value.includes(id) ? [] : [id];
      return;
    }
    selected.value = selected.value.includes(id)
      ? selected.value.filter((item) => item !== id)
      : [...selected.value, id];
  }

  function mergeSelected() {
    const target = page.value;
    if (!target || selected.value.length < 2) return;
    const outcome = mergePanels(
      ordered.value,
      selected.value,
      target.width,
      target.height,
    );
    if (!outcome.merged) return;
    panels.value = withReadingOrder(outcome.panels, "ltr");
    selected.value = [outcome.merged.id];
    orderTouched.value = true;
    stale.value = false;
    notice.value = "已合并；对白按原顺序保留，可继续编辑。";
  }

  function splitSelected(axis: "x" | "y") {
    const target = page.value;
    const id = selected.value[0];
    if (!target || !id) return;
    const outcome = splitPanel(
      ordered.value,
      id,
      axis,
      target.width,
      target.height,
    );
    panels.value = withReadingOrder(outcome.panels, "ltr");
    selected.value = outcome.parts.map((part) => part.id);
    orderTouched.value = true;
    stale.value = false;
    notice.value = "已拆分；对白留在中心所在的一侧，请核对另一侧是否需要补写。";
  }

  function addManual(rect: { x: number; y: number; width: number; height: number }) {
    const target = page.value;
    if (!target) return;
    const outcome = addPanel(ordered.value, rect, target.width, target.height);
    panels.value = withReadingOrder(outcome.panels, "ltr");
    selected.value = [outcome.panel.id];
    orderTouched.value = true;
    stale.value = false;
    notice.value = "已手动加框。";
  }

  function updateRect(
    id: string,
    rect: { x: number; y: number; width: number; height: number },
  ) {
    const target = page.value;
    if (!target) return;
    panels.value = updatePanelRect(
      ordered.value,
      id,
      rect,
      target.width,
      target.height,
    );
    stale.value = false;
  }

  function removeSelected(id: string) {
    if (ordered.value.length <= 1) {
      notice.value = "至少保留一个阅读区域；可改为“保留整页”。";
      return;
    }
    panels.value = removePanel(ordered.value, id);
    selected.value = selected.value.filter((item) => item !== id);
    stale.value = false;
  }

  function moveOrder(id: string, to: number) {
    if (!id) return;
    panels.value = reorderPanels(ordered.value, id, to);
    orderTouched.value = true;
  }

  function autoOrder() {
    panels.value = withReadingOrder(ordered.value, "ltr");
    orderTouched.value = false;
    notice.value = "已按横向行带重新建议阅读顺序，可继续拖动编号调整。";
  }

  function setDialogue(id: string, value: string) {
    panels.value = ordered.value.map((panel) =>
      panel.id === id
        ? { ...panel, dialogue: value, dialogueEdited: true, needsReview: false }
        : panel,
    );
  }

  function setSpeaker(id: string, value: string) {
    panels.value = ordered.value.map((panel) =>
      panel.id === id ? { ...panel, speaker: value, dialogueEdited: true } : panel,
    );
  }

  function setSound(id: string, sound: ReviewPanel["sound"]) {
    panels.value = ordered.value.map((panel) =>
      panel.id === id ? { ...panel, sound } : panel,
    );
  }

  function markReviewed(id: string) {
    panels.value = ordered.value.map((panel) =>
      panel.id === id ? { ...panel, needsReview: false } : panel,
    );
  }

  /**
   * 唯一的页面写入点。页面原本的分镜在读取期间发生变化的，结果作废而非覆盖。
   */
  function apply(): ApplyStats | null {
    const target = page.value;
    if (!target) return null;
    if (revisionOf(target.id) !== revision.value) {
      notice.value = "这页的布局已在别处修改，请重新打开审阅后再应用。";
      return null;
    }
    const previous = target.panels.map((panel) => ({
      ...panel,
      rect: { ...panel.rect },
    }));
    const decision = decideApply(ordered.value, target.width, target.height, {
      lowConfidence: lowConfidence.value,
    });
    const next: Panel[] = decision.panels.map((panel) => ({
      id: panel.existingId ?? panel.id,
      rect: { ...panel.rect },
      dialogue: panel.dialogue.trim() || DEFAULT_DIALOGUE,
      speaker: panel.speaker,
      sound: panel.sound,
      duration: panel.duration,
      origin: panel.origin,
      dialogueEdited: panel.dialogueEdited,
      frameEdited: panel.frameEdited,
      needsReview: panel.needsReview ?? false,
    }));
    // 兜底：任何已写内容若在决策中无落点（极端合并/删除顺序），并入最近区域，
    // 绝不因应用布局而静默丢失对白。
    const kept = new Set(next.map((panel) => panel.dialogue.trim()).filter(Boolean));
    for (const panel of previous) {
      const text = panel.dialogue.trim();
      if (!text || text === DEFAULT_DIALOGUE || !panel.dialogueEdited) continue;
      if (kept.has(text)) continue;
      const targetPanel = nearestOf(next, panel.rect);
      if (!targetPanel) continue;
      targetPanel.dialogue = targetPanel.dialogue.trim()
        ? `${targetPanel.dialogue.trim()}\n${text}`
        : text;
      targetPanel.dialogueEdited = true;
      targetPanel.needsReview = true;
      kept.add(text);
      decision.stats.mergedDialogues++;
    }
    target.panels = next;
    target.layout = {
      source: lowConfidence.value ? "manual" : "detected",
      revision: revisionOf(target.id) + 1,
      updated: Date.now(),
    };
    revisions.set(target.id, revisionOf(target.id) + 1);
    onApplied({ pageId: target.id, previous, next, stats: decision.stats });
    close();
    return decision.stats;
  }

  /** 页面被外部替换/删除时作废进行中的结果。 */
  function invalidate(id: string) {
    revisions.set(id, revisionOf(id) + 1);
    if (pageId.value === id) revision.value = revisionOf(id);
  }

  return {
    pageId,
    phase,
    reviewOpen,
    mode,
    progress,
    error,
    result,
    panels: ordered,
    selected,
    revision,
    orderTouched,
    showOriginal,
    notice,
    stale,
    lowConfidence,
    touched,
    reviewCount,
    page,
    original,
    start,
    cancel,
    dismiss,
    close,
    enterReview,
    keepWhole,
    toggleSelect,
    mergeSelected,
    splitSelected,
    removeSelected,
    addManual,
    updateRect,
    moveOrder,
    autoOrder,
    setDialogue,
    setSpeaker,
    setSound,
    markReviewed,
    apply,
    invalidate,
    setMode: (value: ReviewMode) => {
      mode.value = value;
    },
  };
}
