<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { ChevronLeft, ChevronRight, Maximize2, Pencil, Check } from "lucide-vue-next";
import type {
  ComicPage,
  Panel,
  ReadingLocation,
  ReadingMode,
} from "../../../shared/document";
import PanelCrop from "../../../shared/ui/PanelCrop.vue";
const props = defineProps<{
  page: ComicPage;
  panel: Panel;
  location: ReadingLocation;
  mode: ReadingMode;
}>();
const emit = defineEmits<{
  move: [delta: number];
  pan: [x: number, y: number];
  panel: [id: string];
  dialogue: [id: string, value: string];
  speaker: [id: string, value: string];
}>();
const stage = ref<HTMLElement>();
const editing = ref(false);
const draftText = ref("");
const draftSpeaker = ref("");
const textarea = ref<HTMLTextAreaElement>();
let drag: { x: number; y: number; px: number; py: number } | null = null;
function down(e: PointerEvent) {
  if (props.location.zoom <= 1) return;
  drag = {
    x: e.clientX,
    y: e.clientY,
    px: props.location.x,
    py: props.location.y,
  };
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}
function move(e: PointerEvent) {
  if (drag)
    emit("pan", drag.px + e.clientX - drag.x, drag.py + e.clientY - drag.y);
}
function fullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void stage.value?.requestFullscreen();
}
function beginEdit() {
  editing.value = true;
  draftText.value = props.panel.dialogue;
  draftSpeaker.value = props.panel.speaker;
  void nextTick(() => textarea.value?.focus());
}
function commit() {
  if (!editing.value) return;
  if (draftText.value !== props.panel.dialogue)
    emit("dialogue", props.panel.id, draftText.value);
  if (draftSpeaker.value !== props.panel.speaker)
    emit("speaker", props.panel.id, draftSpeaker.value);
  editing.value = false;
}
watch(
  () => props.panel.id,
  () => {
    editing.value = false;
  },
);
</script>
<template>
  <section ref="stage" class="reader-stage">
    <div class="stage-grain"></div>
    <div class="stage-topline">
      <span><i></i> IMMERSIVE READING</span
      ><button title="全屏阅读" @click="fullscreen">
        <Maximize2 :size="16" />
      </button>
    </div>
    <button
      class="nav-arrow previous"
      aria-label="上一页或分镜"
      @click="emit('move', -1)"
    >
      <ChevronLeft :size="23" />
    </button>
    <div
      class="comic-frame"
      :class="{ focused: mode === 'panel' }"
      @pointerdown="down"
      @pointermove="move"
      @pointerup="drag = null"
      @pointercancel="drag = null"
    >
      <div
        class="comic-image"
        :style="{
          transform: `translate(${location.x}px, ${location.y}px) scale(${location.zoom})`,
        }"
      >
        <div
          class="comic-fit"
          :style="{
            aspectRatio:
              mode === 'page'
                ? `${page.width}/${page.height}`
                : `${panel.rect.width}/${panel.rect.height}`,
          }"
        >
          <PanelCrop
            v-if="mode === 'panel'"
            :page="page"
            :rect="panel.rect"
            fit="slice"
          />
          <img
            v-else
            class="page-image"
            :src="page.image"
            alt=""
            draggable="false"
          />
        </div>
        <div class="comic-overlay">
        <template v-if="mode === 'page'"
          ><button
            v-for="(p, i) in page.panels"
            :key="p.id"
            class="panel-hotspot"
            :class="{ edited: p.dialogueEdited, pending: p.needsReview }"
            :style="{
              left: `${(p.rect.x / page.width) * 100}%`,
              top: `${(p.rect.y / page.height) * 100}%`,
              width: `${(p.rect.width / page.width) * 100}%`,
              height: `${(p.rect.height / page.height) * 100}%`,
            }"
            :aria-label="`阅读分镜 ${i + 1}`"
            @dblclick="emit('panel', p.id)"
          >
            <span>{{ String(i + 1).padStart(2, "0") }}</span>
          </button></template
        >
        </div>
      </div>
    </div>
    <button
      class="nav-arrow next"
      aria-label="下一页或分镜"
      @click="emit('move', 1)"
    >
      <ChevronRight :size="23" />
    </button>
    <div class="stage-caption">
      <span
        >{{ mode === "page" ? "整页浏览" : "逐格沉浸" }} <b>·</b>
        {{ page.title }}</span
      ><span>← → 翻阅 <b>·</b> 双击分镜进入</span>
    </div>
    <div v-if="mode === 'panel'" class="stage-dialogue">
      <template v-if="editing">
        <input
          v-model="draftSpeaker"
          class="stage-speaker-input"
          aria-label="说话人"
          @keydown.enter.prevent="commit"
          @keydown.esc.prevent="editing = false"
        />
        <textarea
          ref="textarea"
          v-model="draftText"
          class="stage-dialogue-input"
          rows="2"
          aria-label="对白"
          @keydown.esc.prevent="editing = false"
          @blur="commit"
        ></textarea>
        <button class="stage-dialogue-save" @click="commit">
          <Check :size="12" /> 保存
        </button>
      </template>
      <template v-else>
        <p>“{{ panel.dialogue }}”</p>
        <button
          class="stage-dialogue-edit"
          title="修改这段对白；布局识别结果到达时会保留你的修改"
          @click="beginEdit"
        >
          <Pencil :size="12" /> 改对白
        </button>
      </template>
    </div>
  </section>
</template>
