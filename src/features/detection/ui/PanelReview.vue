<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  ArrowLeftRight,
  ArrowUpDown,
  Check,
  Columns2,
  Loader2,
  Merge,
  RotateCcw,
  Rows2,
  ScanSearch,
  Sparkles,
  Undo2,
  X,
} from "lucide-vue-next";
import type { ComicPage, Rect } from "../../../shared/document";
import type { ReviewMode, ReviewPanel } from "../lib/types";
import type { DetectionResult } from "../lib/detector";
import { addPanel, movePanelRect, resizePanelRect } from "../lib/review";
import { compareLayouts } from "../lib/apply";
import PanelCrop from "../../../shared/ui/PanelCrop.vue";
import {
  boxPercent,
  confidenceTone,
  pagePointFromEvent,
  reviewStatus,
} from "./helpers";

const props = defineProps<{
  page: ComicPage;
  panels: ReviewPanel[];
  selected: string[];
  mode: ReviewMode;
  phase: "closed" | "loading" | "ready" | "review" | "error";
  progress: number;
  error: string;
  notice: string;
  stale: boolean;
  lowConfidence: boolean;
  result: DetectionResult | null;
}>();
const emit = defineEmits<{
  start: [mode: ReviewMode];
  cancel: [];
  close: [];
  back: [];
  keepWhole: [];
  select: [id: string, additive: boolean];
  merge: [];
  split: [axis: "x" | "y"];
  add: [rect: Rect];
  update: [id: string, rect: Rect];
  order: [id: string, to: number];
  autoOrder: [];
  dialogue: [id: string, value: string];
  speaker: [id: string, value: string];
  confirmPanel: [id: string];
  remove: [id: string];
  apply: [];
  mode: [mode: ReviewMode];
}>();

const frame = ref<HTMLElement>();
const showOriginal = ref(false);
const editing = ref("");
const draftText = ref("");
const draftSpeaker = ref("");
const announcer = ref("");

interface DragState {
  kind: "move" | "resize" | "draw";
  id: string;
  handle: string;
  startX: number;
  startY: number;
  origin: Rect;
  current: Rect;
}
const drag = ref<DragState | null>(null);
const drawing = computed(
  () => drag.value?.kind === "draw" && drag.value.current.width > 2,
);

const ordered = computed(() =>
  [...props.panels].sort((a, b) => a.order - b.order),
);
const active = computed(
  () => ordered.value.find((panel) => props.selected.includes(panel.id)) ?? null,
);
const comparison = computed(() =>
  compareLayouts(props.page, props.page.panels, ordered.value),
);
const lowCount = computed(
  () => ordered.value.filter((panel) => panel.confidence < 0.62).length,
);
const needsCount = computed(
  () => ordered.value.filter((panel) => panel.needsReview).length,
);
const confidenceLabel = computed(() => {
  const value = props.result?.confidence ?? 0;
  if (value >= 0.82) return "高";
  if (value >= 0.58) return "中";
  return "低";
});
const applied = computed(() => props.phase === "ready");

function begin(
  event: PointerEvent,
  panel: ReviewPanel,
  kind: "move" | "resize",
  handle = "",
) {
  if (event.button !== 0) return;
  event.stopPropagation();
  const target = frame.value;
  if (!target) return;
  const point = pagePointFromEvent(event, target, props.page);
  drag.value = {
    kind,
    id: panel.id,
    handle,
    startX: point.x,
    startY: point.y,
    origin: { ...panel.rect },
    current: { ...panel.rect },
  };
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  emit("select", panel.id, event.shiftKey || event.metaKey);
}

function canvasDown(event: PointerEvent) {
  if (drag.value) return;
  const target = frame.value;
  if (!target) return;
  if ((event.target as HTMLElement).closest(".review-box")) return;
  const point = pagePointFromEvent(event, target, props.page);
  drag.value = {
    kind: "draw",
    id: "",
    handle: "",
    startX: point.x,
    startY: point.y,
    origin: { x: point.x, y: point.y, width: 0, height: 0 },
    current: { x: point.x, y: point.y, width: 0, height: 0 },
  };
}

function pointerMove(event: PointerEvent) {
  const state = drag.value;
  const target = frame.value;
  if (!state || !target) return;
  const point = pagePointFromEvent(event, target, props.page);
  if (state.kind === "draw") {
    state.current = {
      x: Math.min(state.startX, point.x),
      y: Math.min(state.startY, point.y),
      width: Math.abs(point.x - state.startX),
      height: Math.abs(point.y - state.startY),
    };
    return;
  }
  const dx = point.x - state.startX;
  const dy = point.y - state.startY;
  state.current =
    state.kind === "move"
      ? movePanelRect(state.origin, dx, dy, props.page.width, props.page.height)
      : resizePanelRect(
          state.origin,
          state.handle,
          dx,
          dy,
          props.page.width,
          props.page.height,
        );
}

function pointerUp() {
  const state = drag.value;
  drag.value = null;
  if (!state) return;
  if (state.kind === "draw") {
    if (state.current.width >= 12 && state.current.height >= 12) {
      emit("add", state.current);
      announcer.value = "已添加一个阅读框";
    }
    return;
  }
  emit("update", state.id, state.current);
}

function addCentered() {
  const page = props.page;
  const width = Math.round(page.width * 0.42);
  const height = Math.round(page.height * 0.22);
  emit("add", {
    x: Math.round((page.width - width) / 2),
    y: Math.round((page.height - height) / 2),
    width,
    height,
  });
}

function edit(panel: ReviewPanel) {
  editing.value = panel.id;
  draftText.value = panel.dialogue;
  draftSpeaker.value = panel.speaker;
  void nextTick(() => {
    const input = document.querySelector<HTMLTextAreaElement>(
      `[data-edit="${panel.id}"]`,
    );
    input?.focus();
  });
}

function commit(panel: ReviewPanel) {
  if (editing.value !== panel.id) return;
  if (draftText.value !== panel.dialogue)
    emit("dialogue", panel.id, draftText.value);
  if (draftSpeaker.value !== panel.speaker)
    emit("speaker", panel.id, draftSpeaker.value);
  editing.value = "";
}

function cancelEdit(panel: ReviewPanel) {
  if (editing.value === panel.id) editing.value = "";
}

function dragOrderStart(event: DragEvent, panel: ReviewPanel) {
  event.dataTransfer?.setData("text/plain", String(panel.order));
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
}

function dropOrder(event: DragEvent, panel: ReviewPanel) {
  const raw = event.dataTransfer?.getData("text/plain");
  if (raw === undefined || raw === "") return;
  const from = Number(raw);
  if (!Number.isFinite(from) || from === panel.order) return;
  const source = ordered.value[from];
  if (source) emit("order", source.id, panel.order);
}

function onKey(event: KeyboardEvent) {
  if (editing.value) {
    if (event.key === "Escape") editing.value = "";
    return;
  }
  const target = event.target as HTMLElement;
  if (target.closest("input,textarea,select")) return;
  if (!active.value) return;
  if (event.key === "Escape") {
    emit("close");
    return;
  }
  const step = event.shiftKey ? 10 : 1;
  const deltas: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  };
  const delta = deltas[event.key];
  if (delta && (target.closest(".panel-review") || event.target === document.body)) {
    event.preventDefault();
    emit(
      "update",
      active.value.id,
      movePanelRect(
        active.value.rect,
        delta[0],
        delta[1],
        props.page.width,
        props.page.height,
      ),
    );
    return;
  }
  if ((event.key === "Delete" || event.key === "Backspace") && active.value) {
    event.preventDefault();
    emit("remove", active.value.id);
  }
}

onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));

watch(
  () => props.selected,
  () => {
    if (editing.value && !props.selected.includes(editing.value)) editing.value = "";
  },
  { deep: true },
);
</script>
<template>
  <Teleport to="body">
    <div class="review-overlay" role="dialog" aria-modal="true" aria-label="分镜框审阅">
      <section class="panel-review">
        <header class="review-bar">
          <div class="review-title">
            <ScanSearch :size="16" />
            <div>
              <strong>分镜框审阅</strong>
              <small>
                {{ page.title }} · {{ page.width }}×{{ page.height }} ·
                {{ applied ? "建议已应用，可继续微调" : "建议尚未应用" }}
              </small>
            </div>
          </div>
          <div class="review-modes" role="group" aria-label="识别精度">
            <button
              :class="{ active: mode === 'fast' }"
              :disabled="phase === 'loading'"
              title="降采样识别，速度更快，可能漏掉窄格"
              @click="emit('mode', 'fast')"
            >
              快速
            </button>
            <button
              :class="{ active: mode === 'fine' }"
              :disabled="phase === 'loading'"
              title="更高分辨率，能识别窄格，但耗时和内存更高"
              @click="emit('mode', 'fine')"
            >
              精细
            </button>
            <button
              class="rerun"
              :disabled="phase === 'loading'"
              @click="emit('start', mode)"
            >
              <Loader2 v-if="phase === 'loading'" class="spin" :size="13" />
              <Sparkles v-else :size="13" />
              {{ phase === "loading" ? `${Math.round(progress * 100)}%` : "重新识别" }}
            </button>
          </div>
          <div class="review-actions">
            <button
              title="在页面中央添加一个阅读框，可再拖动调整"
              @click="addCentered"
            >
              <Rows2 :size="13" /> 添加区域
            </button>
            <button @click="emit('keepWhole')">保留整页</button>
            <button @click="emit('back')" title="收起审阅，未应用的建议会保留">
              收起
            </button>
            <button title="放弃建议并关闭" @click="emit('close')"><X :size="15" /></button>
          </div>
        </header>

        <div v-if="phase === 'loading'" class="review-progress" role="status">
          <div><i :style="{ width: `${Math.round(progress * 100)}%` }"></i></div>
          <span>正在用{{ mode === "fine" ? "精细" : "快速" }}模式识别，期间可继续修改对白；结果不会自动应用。</span>
        </div>
        <p v-if="error" class="review-error" role="alert">{{ error }}</p>
        <p v-if="notice && phase !== 'loading'" class="review-notice" role="status">
          {{ notice }}
        </p>
        <p v-if="stale" class="review-stale" role="status">
          识别结果晚于你的修改到达：已编辑的框、对白和顺序都保留，仅补充了未处理区域。
        </p>

        <div class="review-body">
          <div class="review-canvas">
            <div class="review-toolbar">
              <div class="original-toggle" role="group" aria-label="布局比较">
                <button :class="{ active: !showOriginal }" @click="showOriginal = false">
                  建议布局
                </button>
                <button :class="{ active: showOriginal }" @click="showOriginal = true">
                  原布局
                </button>
              </div>
              <span class="comparison">
                原 {{ comparison.existingCount }} 格 →
                建议 {{ comparison.suggestedCount }} 格
                <template v-if="comparison.delta !== 0">
                  （{{ comparison.delta > 0 ? "+" : "" }}{{ comparison.delta }}）
                </template>
              </span>
              <span
                v-if="result"
                class="confidence"
                :class="confidenceTone(result.confidence)"
              >
                可信度 {{ confidenceLabel }}
                <template v-if="lowCount"> · {{ lowCount }} 格需核对</template>
              </span>
              <span v-else class="confidence">手动布局</span>
            </div>

            <div class="review-stage">
              <div
                ref="frame"
                class="review-frame"
                :class="{ drawing: drag?.kind === 'draw' }"
                :style="{ aspectRatio: `${page.width}/${page.height}` }"
                @pointerdown="canvasDown"
                @pointermove="pointerMove"
                @pointerup="pointerUp"
                @pointercancel="pointerUp"
              >
                <img :src="page.image" alt="" draggable="false" />
                <template v-if="showOriginal">
                  <div
                    v-for="(panel, index) in page.panels"
                    :key="panel.id"
                    class="original-box"
                    :style="boxPercent(panel.rect, page)"
                  >
                    <span>{{ String(index + 1).padStart(2, "0") }}</span>
                  </div>
                </template>
                <template v-else>
                  <div
                    v-for="(panel, index) in ordered"
                    :key="panel.id"
                    class="review-box"
                    :class="[
                      confidenceTone(panel.confidence),
                      {
                        selected: selected.includes(panel.id),
                        touched: panel.touched,
                        needs: panel.needsReview,
                      },
                    ]"
                    :style="
                      boxPercent(
                        drag?.id === panel.id ? drag.current : panel.rect,
                        page,
                      )
                    "
                    @pointerdown="begin($event, panel, 'move')"
                  >
                    <button
                      class="order-badge"
                      :title="`拖动调整阅读顺序，当前第 ${index + 1} 格`"
                      draggable="true"
                      @dragstart="dragOrderStart($event, panel)"
                      @dragover.prevent
                      @drop.prevent.stop="dropOrder($event, panel)"
                      @pointerdown.stop
                    >
                      {{ index + 1 }}
                    </button>
                    <div
                      v-for="handle in ['nw', 'ne', 'sw', 'se']"
                      :key="handle"
                      class="resize-handle"
                      :class="handle"
                      @pointerdown.stop="begin($event, panel, 'resize', handle)"
                    ></div>
                    <span v-if="reviewStatus(panel)" class="box-status">
                      {{ reviewStatus(panel) }}
                    </span>
                  </div>
                  <div
                    v-if="drawing"
                    class="draw-box"
                    :style="boxPercent(drag!.current, page)"
                  >
                    <span>新框</span>
                  </div>
                </template>
              </div>
            </div>
            <p class="review-hint">
              拖动框移动 · 四角缩放 · 空白处拖拽加框 · 方向键微调 · 数字徽标拖拽排序
            </p>
            <p class="sr-only" role="status">{{ announcer }}</p>
          </div>

          <aside class="review-list">
            <div class="list-heading">
              <span>阅读顺序</span>
              <button title="按横向行带重新建议顺序" @click="emit('autoOrder')">
                <RotateCcw :size="12" /> 重新建议
              </button>
            </div>
            <ol class="order-list">
              <li
                v-for="(panel, index) in ordered"
                :key="panel.id"
                :class="{
                  selected: selected.includes(panel.id),
                  needs: panel.needsReview,
                }"
                @click="emit('select', panel.id, $event.shiftKey || $event.metaKey)"
              >
                <div class="row-main">
                  <button
                    class="order-badge"
                    draggable="true"
                    :title="`拖动排序，当前第 ${index + 1} 格`"
                    @dragstart="dragOrderStart($event, panel)"
                    @dragover.prevent
                    @drop.prevent.stop="dropOrder($event, panel)"
                    @click.stop
                  >
                    {{ index + 1 }}
                  </button>
                  <PanelCrop class="row-thumb" :page="page" :rect="panel.rect" />
                  <div class="row-info">
                    <template v-if="editing === panel.id">
                      <input
                        v-model="draftSpeaker"
                        aria-label="说话人"
                        class="speaker-input"
                        @click.stop
                        @keydown.enter.prevent="commit(panel)"
                        @keydown.esc.prevent="cancelEdit(panel)"
                      />
                      <textarea
                        v-model="draftText"
                        :data-edit="panel.id"
                        aria-label="对白"
                        rows="2"
                        @click.stop
                        @keydown.esc.prevent="cancelEdit(panel)"
                        @blur="commit(panel)"
                      ></textarea>
                      <button class="save-edit" @click.stop="commit(panel)">保存</button>
                    </template>
                    <template v-else>
                      <strong>{{ panel.speaker }}</strong>
                      <small :title="panel.dialogue">{{ panel.dialogue || "（无对白）" }}</small>
                      <em v-if="panel.confidence < 0.62 || panel.needsReview">
                        <template v-if="panel.needsReview">待确认</template>
                        <template v-else>
                          可信度 {{ Math.round(panel.confidence * 100) }}%
                        </template>
                      </em>
                    </template>
                  </div>
                </div>
                <div class="row-tools" @click.stop>
                  <button
                    title="上移一格"
                    :disabled="index === 0"
                    @click="emit('order', panel.id, index - 1)"
                  >
                    ↑
                  </button>
                  <button
                    title="下移一格"
                    :disabled="index === ordered.length - 1"
                    @click="emit('order', panel.id, index + 1)"
                  >
                    ↓
                  </button>
                  <button title="编辑对白" @click="edit(panel)">改字</button>
                  <button
                    v-if="panel.needsReview"
                    title="确认对白归属"
                    @click="emit('confirmPanel', panel.id)"
                  >
                    确认
                  </button>
                  <button title="删除此框" @click="emit('remove', panel.id)">删</button>
                </div>
              </li>
            </ol>
            <div v-if="!ordered.length" class="list-empty">
              暂无阅读框。可点击“保留整页”，或在画面空白处拖拽加框。
            </div>
          </aside>
        </div>

        <footer class="review-footer">
          <div class="selection-info">
            <span>{{ ordered.length }} 个阅读区域</span>
            <span v-if="selected.length">已选 {{ selected.length }} 个</span>
            <span v-if="needsCount" class="warn">{{ needsCount }} 格对白待确认</span>
            <span v-if="lowConfidence" class="warn">建议可信度不高，应用后仍可再调整</span>
          </div>
          <div class="footer-actions">
            <button :disabled="selected.length < 2" @click="emit('merge')">
              <Merge :size="13" /> 合并
            </button>
            <button :disabled="!selected.length" @click="emit('split', 'y')">
              <Rows2 :size="13" /> 上下拆分
            </button>
            <button :disabled="!selected.length" @click="emit('split', 'x')">
              <Columns2 :size="13" /> 左右拆分
            </button>
            <button title="取消所有未应用的改动" @click="emit('back')">
              <Undo2 :size="13" /> 暂不应用
            </button>
            <button
              class="primary"
              :disabled="phase === 'loading' || !ordered.length"
              @click="emit('apply')"
            >
              <Check :size="14" /> 应用布局
            </button>
          </div>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
<style scoped>
.spin {
  animation: spin 1.1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
