<script setup lang="ts">
import { computed } from "vue";
import { ArrowRight, Bookmark, Check, Headphones, MousePointer2, X } from "lucide-vue-next";
import type { ComicPage, Panel } from "../../../shared/document";
import type { ReviewPanel } from "../lib/types";
import { applySummaryText, compareLayouts } from "../lib/apply";
import { migratePanelReference } from "../../../shared/panels";
import { boxPercent } from "./helpers";

const props = defineProps<{
  page: ComicPage;
  panels: ReviewPanel[];
  bookmarks: Array<{ id: string; label: string; panelId: string; pageId: string }>;
  triggers: Array<{ id: string; label: string; panelId: string; pageId: string }>;
  currentPanelId: string;
  lowConfidence: boolean;
  statsText: string;
}>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();

const ordered = computed(() =>
  [...props.panels].sort((a, b) => a.order - b.order),
);
const comparison = computed(() =>
  compareLayouts(props.page, props.page.panels, ordered.value),
);
const nextPanels = computed<Panel[]>(() =>
  ordered.value.map((panel) => ({
    id: panel.existingId ?? panel.id,
    rect: panel.rect,
    dialogue: panel.dialogue,
    speaker: panel.speaker,
    sound: panel.sound,
    duration: panel.duration,
    origin: panel.origin,
    dialogueEdited: panel.dialogueEdited,
    frameEdited: panel.frameEdited,
  })),
);
const changedOrder = computed(() => {
  const before = props.page.panels.map((panel) => panel.id);
  const after = ordered.value.map((panel) => panel.existingId ?? panel.id);
  return before.join("|") !== after.join("|");
});
const bookmarkMoves = computed(() =>
  props.bookmarks
    .filter((bookmark) => bookmark.pageId === props.page.id)
    .map((bookmark) => ({
      ...bookmark,
      target: migratePanelReference(props.page.panels, nextPanels.value, bookmark.panelId),
    })),
);
const triggerMoves = computed(() =>
  props.triggers
    .filter((trigger) => trigger.pageId === props.page.id)
    .map((trigger) => ({
      ...trigger,
      target: migratePanelReference(props.page.panels, nextPanels.value, trigger.panelId),
    })),
);
const cameraTarget = computed(() =>
  migratePanelReference(props.page.panels, nextPanels.value, props.currentPanelId),
);
const pendingReview = computed(
  () => ordered.value.filter((panel) => panel.needsReview).length,
);
</script>
<template>
  <Teleport to="body">
    <div class="apply-overlay" role="dialog" aria-modal="true" aria-label="确认应用布局">
      <section class="apply-dialog">
        <header>
          <div>
            <strong>应用前对照</strong>
            <small>确认后才会写入页面；取消不改动任何现有内容。</small>
          </div>
          <button title="取消" @click="emit('cancel')"><X :size="15" /></button>
        </header>
        <div class="apply-grid">
          <figure>
            <figcaption>原布局 · {{ comparison.existingCount }} 格</figcaption>
            <div class="compare-stage">
            <div
              class="compare-frame"
              :style="{ aspectRatio: `${page.width}/${page.height}` }"
            >
              <img :src="page.image" alt="" />
              <div
                v-for="(panel, index) in page.panels"
                :key="panel.id"
                class="compare-box original"
                :style="boxPercent(panel.rect, page)"
              >
                <span>{{ index + 1 }}</span>
              </div>
            </div>
            </div>
          </figure>
          <ArrowRight class="between" :size="18" />
          <figure>
            <figcaption>确认后 · {{ ordered.length }} 格</figcaption>
            <div class="compare-stage">
            <div
              class="compare-frame"
              :style="{ aspectRatio: `${page.width}/${page.height}` }"
            >
              <img :src="page.image" alt="" />
              <div
                v-for="(panel, index) in ordered"
                :key="panel.id"
                class="compare-box next"
                :class="{ needs: panel.needsReview }"
                :style="boxPercent(panel.rect, page)"
              >
                <span>{{ index + 1 }}</span>
              </div>
            </div>
            </div>
          </figure>
        </div>
        <div class="apply-summary">
          <p>{{ statsText }}</p>
          <ul>
            <li v-if="changedOrder">
              阅读顺序将调整，按新顺序推进镜头；当前镜头会随之迁移。
            </li>
            <li v-if="bookmarkMoves.length">
              <Bookmark :size="12" /> {{ bookmarkMoves.length }} 个书签将按区域迁移：
              {{
                bookmarkMoves.filter((b) => b.target !== b.panelId).length
              }} 个改指向
            </li>
            <li v-if="triggerMoves.length">
              <Headphones :size="12" /> {{ triggerMoves.length }} 个声音触发点：
              {{ triggerMoves.filter((t) => t.target !== t.panelId).length }} 个随区域迁移
            </li>
            <li v-if="cameraTarget && cameraTarget !== currentPanelId">
              <MousePointer2 :size="12" /> 当前镜头将移到新区域
            </li>
            <li v-if="pendingReview" class="warn">
              {{ pendingReview }} 格对白归属待确认，应用后仍可点“确认”处理。
            </li>
            <li v-if="lowConfidence" class="warn">
              本次建议可信度不高；已手动编辑的框不会被覆盖。
            </li>
          </ul>
        </div>
        <footer>
          <button @click="emit('cancel')">取消</button>
          <button class="primary" @click="emit('confirm')">
            <Check :size="14" /> 确认应用
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
