<script setup lang="ts">
import { ref } from "vue";
import {
  Headphones,
  Volume2,
  Play,
  Pause,
  MessageSquare,
  Plus,
  X,
  Pencil,
  Check,
} from "lucide-vue-next";
import type { SoundTrigger } from "../../../shared/document";
import { volumeLabel } from "../lib/cues";
const props = defineProps<{
  enabled: boolean;
  volume: number;
  dialogue: boolean;
  cue: { title: string; kind: string; speaker: string; text: string };
  error: string;
  triggers: SoundTrigger[];
  panelId: string;
  canTrigger: boolean;
}>();
const emit = defineEmits<{
  toggle: [];
  volume: [value: number];
  dialogue: [];
  trigger: [];
  removeTrigger: [id: string];
  saveDialogue: [text: string, speaker: string];
}>();
const editing = ref(false);
const draftText = ref("");
const draftSpeaker = ref("");
function beginEdit() {
  editing.value = true;
  draftText.value = props.cue.text;
  draftSpeaker.value = props.cue.speaker;
}
function commit() {
  editing.value = false;
  emit("saveDialogue", draftText.value, draftSpeaker.value);
}
function activeTrigger() {
  return props.triggers.find((trigger) => trigger.panelId === props.panelId);
}
</script>
<template>
  <section class="audio-panel">
    <div class="section-heading">
      <span><Headphones :size="15" /> 声音与对白</span
      ><span class="live-label">LIVE</span>
    </div>
    <div class="sound-card">
      <div class="sound-icon"><Headphones :size="27" /></div>
      <h3>让故事，在耳边发生</h3>
      <p>分镜推进时，声景会随画面变化</p>
      <div class="waveform" :class="{ playing: enabled }">
        <i
          v-for="i in 32"
          :key="i"
          :style="{
            height: `${8 + ((i * 13) % 29)}px`,
            animationDelay: `${i * 0.04}s`,
          }"
        ></i>
      </div>
      <div class="sound-track">
        <div>
          <strong>{{ cue.title }}</strong
          ><small>{{
            enabled ? "正在播放 · 循环声景" : "点击播放，进入故事"
          }}</small>
        </div>
        <button
          class="play-sound"
          :aria-label="enabled ? '暂停音效' : '播放音效'"
          @click="emit('toggle')"
        >
          <Pause v-if="enabled" :size="17" /><Play v-else :size="17" />
        </button>
      </div>
      <label class="volume"
        ><Volume2 :size="15" /><input
          aria-label="音量"
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="volume"
          @input="
            emit('volume', Number(($event.target as HTMLInputElement).value))
          "
        /><span>{{ volumeLabel(volume) }}</span></label
      >
    </div>
    <div class="dialogue-heading">
      <span><MessageSquare :size="14" /> 当前对白</span
      ><button
        class="toggle"
        :class="{ on: dialogue }"
        aria-label="显示对白"
        :aria-pressed="dialogue"
        @click="emit('dialogue')"
      >
        <i></i>
      </button>
    </div>
    <div v-if="dialogue" class="dialogue-card">
      <template v-if="editing">
        <input v-model="draftSpeaker" class="dialogue-speaker-input" aria-label="说话人" />
        <textarea v-model="draftText" rows="3" aria-label="对白" class="dialogue-input"></textarea>
        <div class="dialogue-actions">
          <button @click="editing = false">取消</button>
          <button @click="commit"><Check :size="11" /> 保存</button>
        </div>
      </template>
      <template v-else>
        <small>{{ cue.speaker }}</small>
        <p>“{{ cue.text }}”</p>
        <div class="dialogue-dots">● <span>● ●</span></div>
        <button class="dialogue-edit" @click="beginEdit">
          <Pencil :size="11" /> 改对白
        </button>
      </template>
    </div>
    <p v-else class="muted">对白已隐藏</p>
    <p v-if="error" role="alert">{{ error }}</p>

    <div class="trigger-heading">
      <span><Headphones :size="13" /> 本页声音触发点</span>
      <button
        :disabled="!canTrigger || Boolean(activeTrigger())"
        :title="
          activeTrigger()
            ? '当前分镜已有触发点，可在下方移除'
            : '在当前分镜添加触发点；布局确认后会随区域迁移'
        "
        @click="emit('trigger')"
      >
        <Plus :size="13" /> 添加
      </button>
    </div>
    <ul v-if="triggers.length" class="trigger-list">
      <li v-for="trigger in triggers" :key="trigger.id">
        <span :class="{ active: trigger.panelId === panelId }">{{ trigger.label }}</span>
        <button title="移除触发点" @click="emit('removeTrigger', trigger.id)">
          <X :size="11" />
        </button>
      </li>
    </ul>
    <p v-else class="muted trigger-empty">还没有触发点。识别或调整布局后，触发点会跟着区域走。</p>

    <div class="headphone-note">
      <Headphones :size="15" /><span
        >推荐佩戴耳机<br /><small>获得完整的沉浸阅读体验</small></span
      >
    </div>
  </section>
</template>
