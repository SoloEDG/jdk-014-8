import { ref, watch, computed, type Ref } from "vue";
import type {
  Bookmark,
  ComicDocument,
  Panel,
  ReadingLocation,
  SoundTrigger,
} from "../../../shared/document";
import { makeId } from "../../../shared/commands";
import { migratePanelReference } from "../../../shared/panels";
import { writeSession, type SavedSession } from "../lib/storage";
import { readingMetrics } from "../lib/metrics";
export function useProgress(
  doc: Ref<ComicDocument>,
  location: Ref<ReadingLocation>,
  saved: SavedSession | null,
) {
  const bookmarks = ref<Bookmark[]>(saved?.bookmarks ?? []),
    triggers = ref<SoundTrigger[]>(saved?.triggers ?? []),
    status = ref("本地自动保存已开启"),
    metrics = computed(() => readingMetrics(doc.value, location.value));
  function save() {
    status.value = writeSession({
      document: doc.value,
      location: location.value,
      bookmarks: bookmarks.value,
      triggers: triggers.value,
    });
  }
  watch([doc, location, bookmarks, triggers], save, { deep: true });
  function add() {
    const same = bookmarks.value.find(
      (b) =>
        b.location.pageId === location.value.pageId &&
        b.location.panelId === location.value.panelId,
    );
    if (same) {
      status.value = "此处分镜已收藏";
      return;
    }
    const c = doc.value.chapters.find((c) => c.id === location.value.chapterId);
    bookmarks.value.push({
      id: makeId("bookmark"),
      label: `${c?.title ?? "章节"} · 第 ${metrics.value.pageIndex} 页`,
      location: { ...location.value },
      created: Date.now(),
    });
  }
  function remove(id: string) {
    bookmarks.value = bookmarks.value.filter((b) => b.id !== id);
  }
  function addTrigger(trigger: Omit<SoundTrigger, "id" | "created">) {
    if (
      triggers.value.some(
        (t) => t.pageId === trigger.pageId && t.panelId === trigger.panelId,
      )
    )
      return false;
    triggers.value.push({ ...trigger, id: makeId("trigger"), created: Date.now() });
    return true;
  }
  function removeTrigger(id: string) {
    triggers.value = triggers.value.filter((trigger) => trigger.id !== id);
  }
  function reconcile() {
    const ids = new Set(
      doc.value.chapters.flatMap((c) => c.pages.map((p) => p.id)),
    );
    bookmarks.value = bookmarks.value.filter((b) => ids.has(b.location.pageId));
    triggers.value = triggers.value.filter((t) => ids.has(t.pageId));
  }
  /**
   * 一页布局确认后，把书签、声音触发点和当前阅读镜头迁移到新区域。
   * previous 必须是应用前的分镜快照。
   */
  function remapPage(
    pageId: string,
    previous: Array<Pick<Panel, "id" | "rect">>,
    next: Panel[],
  ) {
    const remap = (panelId: string) => {
      const nextId = migratePanelReference(previous, next, panelId);
      return nextId ?? panelId;
    };
    for (const bookmark of bookmarks.value) {
      if (bookmark.location.pageId === pageId) {
        bookmark.location.panelId = remap(bookmark.location.panelId);
      }
    }
    for (const trigger of triggers.value) {
      if (trigger.pageId === pageId) {
        trigger.panelId = remap(trigger.panelId);
      }
    }
    if (location.value.pageId === pageId) {
      location.value.panelId = remap(location.value.panelId);
    }
  }
  return {
    bookmarks,
    triggers,
    status,
    metrics,
    add,
    remove,
    addTrigger,
    removeTrigger,
    reconcile,
    remapPage,
    save,
  };
}
