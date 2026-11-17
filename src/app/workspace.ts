import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { demoDocument, useLibrary } from "../features/library";
import { useChapters } from "../features/chapters";
import { useReader } from "../features/reader";
import { useAudio } from "../features/audio";
import { useProgress, readSession } from "../features/progress";
import { useDetection } from "../features/detection";
import type { ApplyPayload } from "../features/detection";
import type { SoundTrigger } from "../shared/document";
export function useWorkspace() {
  const saved = readSession(),
    doc = ref(saved?.document ?? demoDocument()),
    reader = useReader(doc);
  if (saved) reader.dispatch({ type: "restore", location: saved.location });
  const progress = useProgress(doc, reader.location, saved),
    detection = useDetection(doc, (payload) => applyLayout(payload)),
    library = useLibrary(doc, (id, pageId) => {
      reader.dispatch({ type: "chapter", id });
      progress.reconcile();
      // 新导入的整页默认只有一个大格：给出建议，但不自动覆盖布局。
      if (pageId) void detection.start(pageId, "fast");
    }),
    chapters = useChapters(doc, () => {
      reader.reconcile();
      progress.reconcile();
    });
  const panel = computed(() => reader.current.value.panel),
    audio = useAudio(panel),
    pageTriggers = computed<SoundTrigger[]>(() =>
      progress.triggers.value.filter(
        (trigger) => trigger.pageId === reader.location.value.pageId,
      ),
    ),
    triggerBusy = ref(false);

  function applyLayout(payload: ApplyPayload) {
    // 书签、声音触发点与当前镜头迁移到确认后的区域。
    progress.remapPage(payload.pageId, payload.previous, payload.next);
    reader.reconcile();
  }

  function addTrigger() {
    const target = panel.value,
      page = reader.current.value.page;
    if (!target || !page) return;
    triggerBusy.value = true;
    const ok = progress.addTrigger({
      pageId: page.id,
      panelId: target.id,
      label: `${target.speaker} · ${target.dialogue.slice(0, 14)}`,
      sound: target.sound,
    });
    audio.error.value = ok ? "" : "这个分镜已经有声音触发点";
    triggerBusy.value = false;
  }

  function keydown(e: KeyboardEvent) {
    if ((e.target as HTMLElement)?.closest("input,textarea,button,select")) return;
    // 审阅面板打开时，方向键留给框编辑，避免同时翻页。
    if (detection.reviewOpen.value) {
      if (e.key === "Escape") {
        e.preventDefault();
        detection.dismiss();
      }
      return;
    }
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      reader.dispatch({ type: "move", delta: e.key === "ArrowRight" ? 1 : -1 });
    }
    if (e.key === " ") {
      e.preventDefault();
      audio.toggle();
    }
    if (e.key === "Escape") reader.setMode("page");
  }
  onMounted(() => window.addEventListener("keydown", keydown));
  onBeforeUnmount(() => window.removeEventListener("keydown", keydown));

  // 换页时收起上一页的建议，避免结果写到错误的页。
  watch(
    () => reader.current.value.page?.id,
    (id) => {
      if (detection.phase.value !== "closed" && detection.pageId.value !== id)
        detection.cancel();
    },
  );

  return {
    doc,
    reader,
    progress,
    library,
    chapters,
    audio,
    detection,
    panel,
    pageTriggers,
    addTrigger,
    triggerBusy,
    applyLayout,
  };
}
