<script setup lang="ts">
import { ArrowRight, Check, Loader2, ScanSearch, SlidersHorizontal, X } from "lucide-vue-next";
import type { DetectionResult } from "../lib/detector";

defineProps<{
  phase: "closed" | "loading" | "ready" | "review" | "error";
  progress: number;
  mode: "fast" | "fine";
  result: DetectionResult | null;
  pageCount: number;
  panelCount: number;
  lowConfidence: boolean;
  stale: boolean;
  error: string;
}>();
const emit = defineEmits<{
  review: [];
  cancel: [];
  retry: [mode: "fast" | "fine"];
}>();
</script>
<template>
  <div v-if="phase !== 'closed' && phase !== 'review'" class="detect-banner">
    <div class="banner-state">
      <Loader2 v-if="phase === 'loading'" class="spin" :size="17" />
      <ScanSearch v-else :size="17" />
      <div>
        <strong v-if="phase === 'loading'">
          正在本机识别分镜框 · {{ Math.round(progress * 100) }}%
        </strong>
        <strong v-else-if="phase === 'ready'">识别建议已就绪</strong>
        <strong v-else-if="phase === 'error'">识别未完成</strong>
        <small v-if="phase === 'loading'">
          可继续翻阅和修改对白；结果不会自动覆盖现有布局
        </small>
        <small v-else-if="phase === 'ready'">
          {{ result?.boxes.length ?? 0 }} 个框 ·
          可信度 {{ Math.round((result?.confidence ?? 0) * 100) }}%
          <template v-if="lowConfidence"> · 建议逐格核对</template>
          <template v-if="stale"> · 已避开你编辑过的区域</template>
        </small>
        <small v-else-if="phase === 'error'">{{ error }}</small>
      </div>
    </div>
    <div class="banner-actions">
      <template v-if="phase === 'loading'">
        <button @click="emit('cancel')"><X :size="13" /> 取消识别</button>
      </template>
      <template v-else-if="phase === 'ready'">
        <button @click="emit('retry', mode === 'fast' ? 'fine' : 'fast')">
          {{ mode === "fast" ? "改用精细识别" : "改用快速识别" }}
        </button>
        <button @click="emit('cancel')"><X :size="13" /> 放弃建议</button>
        <button class="primary" @click="emit('review')">
          <SlidersHorizontal :size="13" /> 对照并调整
          <ArrowRight :size="13" />
        </button>
      </template>
      <template v-else>
        <button @click="emit('retry', mode)"><Check :size="13" /> 重试</button>
        <button @click="emit('cancel')"><X :size="13" /> 关闭</button>
      </template>
    </div>
  </div>
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
