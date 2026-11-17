<script setup lang="ts">
import { computed, ref } from "vue";
import {
  BookOpen,
  ChevronRight,
  Grid2X2,
  Scan,
  Minus,
  Plus,
  Bookmark,
  Cloud,
  PanelLeftClose,
  ScanSearch,
} from "lucide-vue-next";
import { LibraryPanel } from "../features/library";
import { ChapterPanel } from "../features/chapters";
import { ReaderStage, PanelStrip } from "../features/reader";
import { AudioPanel } from "../features/audio";
import { ProgressPanel } from "../features/progress";
import {
  ApplyDialog,
  DetectionBanner,
  PanelReview,
} from "../features/detection";
import { applySummaryText } from "../features/detection/lib/apply";
import { useWorkspace } from "./workspace";
const {
  doc,
  reader: r,
  progress: p,
  library: l,
  chapters: c,
  audio: a,
  detection: d,
  pageTriggers,
  addTrigger,
} = useWorkspace();
const current = r.current,
  currentPage = computed(() => r.current.value.page),
  currentPanel = computed(() => r.current.value.panel),
  at = r.location,
  mode = r.mode,
  metrics = p.metrics,
  bookmarks = p.bookmarks,
  status = p.status,
  cue = a.cue;
const chapterIndex = computed(
  () => doc.value.chapters.findIndex((c) => c.id === at.value.chapterId) + 1,
);
const confirming = ref(false);
const applyStats = ref("");
const detectionRunning = computed(
  () => d.phase.value === "loading" || d.phase.value === "ready",
);
const bookmarkRows = computed(() =>
  bookmarks.value.map((mark) => ({
    id: mark.id,
    label: mark.label,
    pageId: mark.location.pageId,
    panelId: mark.location.panelId,
  })),
);
function focus(id: string) {
  r.dispatch({ type: "panel", id });
  r.setMode("panel");
}
function startReview() {
  if (d.phase.value === "ready" || d.phase.value === "review" || d.reviewOpen.value)
    d.enterReview();
  else if (currentPage.value) void d.start(currentPage.value.id, d.mode.value);
}
function beginApply() {
  if (!currentPage.value) return;
  confirming.value = true;
}
function confirmApply() {
  const stats = d.apply();
  confirming.value = false;
  if (stats) applyStats.value = applySummaryText(stats);
}
function cancelApply() {
  confirming.value = false;
}
function saveDialogue(id: string, value: string) {
  const page = r.current.value.page;
  const panel = page?.panels.find((item) => item.id === id);
  if (!panel) return;
  panel.dialogue = value;
  panel.dialogueEdited = true;
  panel.needsReview = false;
}
function saveSpeaker(id: string, value: string) {
  const page = r.current.value.page;
  const panel = page?.panels.find((item) => item.id === id);
  if (!panel) return;
  panel.speaker = value;
  panel.dialogueEdited = true;
}
function saveCueDialogue(text: string, speaker: string) {
  if (!currentPanel.value) return;
  saveDialogue(currentPanel.value.id, text);
  saveSpeaker(currentPanel.value.id, speaker);
}
function toggleTrigger() {
  const existing = pageTriggers.value.find((t) => t.panelId === at.value.panelId);
  if (existing) p.removeTrigger(existing.id);
  else addTrigger();
}
</script>
<template>
  <div class="app-shell">
    <header class="app-header">
      <a class="brand" href="./"
        ><div class="brand-icon"><BookOpen :size="22" /></div>
        <strong>PANEL<span>沉浸漫画</span></strong></a
      >
      <nav>
        <span>我的书架</span><ChevronRight :size="13" /><strong>{{
          doc.title
        }}</strong
        ><span class="preview-tag">正在阅读</span>
      </nav>
      <div class="header-right">
        <Cloud :size="15" /><span>本地已就绪</span>
        <div class="avatar">林</div>
      </div>
    </header>
    <div class="workspace">
      <aside class="left-sidebar">
        <div class="book-cover">
          <img :src="doc.chapters[0]?.pages[0]?.image" alt="雨停之前漫画封面" />
          <div>
            <small>ORIGINAL COMIC</small>
            <h1>{{ doc.title }}</h1>
            <p>{{ doc.author }} 著</p>
          </div>
          <span>全彩 · 沉浸版</span>
        </div>
        <div class="book-details">
          <h2>{{ doc.title }} <span>连载中</span></h2>
          <p>当城市沉睡，故事才刚刚开始。</p>
          <div><span>都市悬疑</span><span>氛围叙事</span></div>
        </div>
        <ChapterPanel
          :chapters="doc.chapters"
          :active="at.chapterId"
          :editing="c.editing.value"
          :draft="c.draft.value"
          :error="c.error.value"
          @select="r.dispatch({ type: 'chapter', id: $event })"
          @rename="c.begin"
          @move="c.move"
          @remove="c.remove"
          @draft="c.draft.value = $event"
          @save="c.rename"
        /><LibraryPanel
          :busy="l.busy.value"
          :message="l.message.value"
          @import="l.importFiles"
          @reset="l.reset"
        />
        <div class="sidebar-footer">
          <PanelLeftClose :size="14" /> 你的私人漫画放映室 <span>v1.0</span>
        </div>
      </aside>
      <main class="reading-workspace">
        <div class="reader-toolbar">
          <div>
            <span class="chapter-eyebrow"
              >CHAPTER {{ String(chapterIndex).padStart(2, "0") }}</span
            >
            <h2>{{ current.chapter?.title }}</h2>
          </div>
          <div class="reader-tools">
            <button
              class="detect-toggle"
              :class="{ active: detectionRunning || d.reviewOpen.value }"
              :disabled="!currentPage || d.phase.value === 'loading'"
              :title="
                d.reviewOpen.value
                  ? '回到分镜框审阅'
                  : '在浏览器里找出分镜框并建议阅读顺序'
              "
              @click="startReview"
            >
              <ScanSearch :size="14" />
              {{
                d.phase.value === "loading"
                  ? `识别 ${Math.round(d.progress.value * 100)}%`
                  : d.phase.value === "ready"
                    ? "查看识别建议"
                    : d.reviewOpen.value
                      ? "继续审阅"
                      : "识别分镜框"
              }}
            </button>
            <span class="tool-divider"></span>
            <div class="mode-switch">
              <button
                :class="{ active: mode === 'page' }"
                @click="r.setMode('page')"
              >
                <Grid2X2 :size="14" /> 整页</button
              ><button
                :class="{ active: mode === 'panel' }"
                @click="r.setMode('panel')"
              >
                <Scan :size="14" /> 逐格
              </button>
            </div>
            <span class="tool-divider"></span
            ><button aria-label="缩小" @click="r.zoom(-0.2)">
              <Minus :size="15" /></button
            ><span class="zoom-value">{{ Math.round(at.zoom * 100) }}%</span
            ><button aria-label="放大" @click="r.zoom(0.2)">
              <Plus :size="15" /></button
            ><button title="收藏当前分镜" @click="p.add">
              <Bookmark :size="16" />
            </button>
          </div>
        </div>
        <DetectionBanner
          class="detect-banner-slot"
          :phase="d.phase.value"
          :progress="d.progress.value"
          :mode="d.mode.value"
          :result="d.result.value"
          :page-count="metrics.pageCount"
          :panel-count="currentPage?.panels.length ?? 0"
          :low-confidence="d.lowConfidence.value"
          :stale="d.stale.value"
          :error="d.error.value"
          @review="d.enterReview()"
          @cancel="d.cancel()"
          @retry="d.start(d.pageId.value, $event)"
        />
        <p v-if="applyStats" class="detect-applied" role="status">
          已应用布局：{{ applyStats }}
        </p>
        <ReaderStage
          v-if="currentPage && currentPanel"
          :page="currentPage"
          :panel="currentPanel"
          :location="at"
          :mode="mode"
          :editing="mode === 'panel'"
          @move="r.dispatch({ type: 'move', delta: $event })"
          @pan="r.pan"
          @panel="focus"
          @dialogue="saveDialogue"
          @speaker="saveSpeaker"
        />
        <div class="page-position">
          <span>{{ current.chapter?.subtitle }}</span>
          <div>
            <b>{{ String(metrics.pageIndex).padStart(2, "0") }}</b
            ><span>/ {{ String(metrics.pageCount).padStart(2, "0") }}</span
            ><small>页</small>
          </div>
          <span>阅读位置自动保存 <i></i></span>
        </div>
        <PanelStrip
          v-if="currentPage"
          :page="currentPage"
          :active="at.panelId"
          :triggers="pageTriggers"
          @select="focus"
        />
      </main>
      <aside class="right-sidebar">
        <AudioPanel
          :enabled="a.enabled.value"
          :volume="a.volume.value"
          :dialogue="a.dialogue.value"
          :cue="cue"
          :error="a.error.value"
          :triggers="pageTriggers"
          :panel-id="at.panelId"
          :can-trigger="Boolean(currentPanel)"
          @toggle="a.toggle"
          @volume="a.volume.value = $event"
          @dialogue="a.dialogue.value = !a.dialogue.value"
          @trigger="toggleTrigger"
          @remove-trigger="p.removeTrigger"
          @save-dialogue="saveCueDialogue"
        /><ProgressPanel
          :bookmarks="bookmarks"
          :percent="metrics.percent"
          :status="status"
          @add="p.add"
          @remove="p.remove"
          @restore="r.dispatch({ type: 'restore', location: $event })"
        />
        <div class="reading-tip">
          <span>✦ 阅读小贴士</span>
          <p>试试逐格模式，让画面与声音<br />带你走进故事的深处。</p>
          <kbd>←</kbd><kbd>→</kbd> <small>切换画面</small><br /><kbd>Space</kbd>
          <small>播放 / 暂停声景</small>
        </div>
      </aside>
    </div>
    <footer class="app-footer">
      <span><i></i> 所有故事，都有回声。</span
      ><span>PANEL · 为每一格想象而生</span
      ><span>图片导入 · 本地存储 · 无需联网</span>
    </footer>
    <PanelReview
      v-if="d.reviewOpen.value && currentPage"
      :page="currentPage"
      :panels="d.panels.value"
      :selected="d.selected.value"
      :mode="d.mode.value"
      :phase="d.phase.value"
      :progress="d.progress.value"
      :error="d.error.value"
      :notice="d.notice.value"
      :stale="d.stale.value"
      :low-confidence="d.lowConfidence.value"
      :result="d.result.value"
      @start="d.start(d.pageId.value, $event)"
      @cancel="d.cancel()"
      @close="d.close()"
      @back="d.dismiss()"
      @keep-whole="d.keepWhole()"
      @select="d.toggleSelect"
      @merge="d.mergeSelected"
      @split="d.splitSelected"
      @add="d.addManual"
      @update="d.updateRect"
      @order="d.moveOrder"
      @auto-order="d.autoOrder"
      @dialogue="(id, value) => d.setDialogue(id, value)"
      @speaker="(id, value) => d.setSpeaker(id, value)"
      @confirm-panel="d.markReviewed"
      @remove="d.removeSelected"
      @apply="beginApply"
      @mode="d.setMode"
    />
    <ApplyDialog
      v-if="confirming && currentPage"
      :page="currentPage"
      :panels="d.panels.value"
      :bookmarks="bookmarkRows"
      :triggers="pageTriggers"
      :current-panel-id="at.panelId"
      :low-confidence="d.lowConfidence.value"
      :stats-text="
        d.result.value
          ? `建议 ${d.panels.value.length} 格，参考可信度 ${Math.round(d.result.value.confidence * 100)}%`
          : `手动布局 ${d.panels.value.length} 格`
      "
      @confirm="confirmApply"
      @cancel="cancelApply"
    />
  </div>
</template>
