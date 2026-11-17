<script setup lang="ts">
import { Bookmark } from "lucide-vue-next";
import type { ComicPage, SoundTrigger } from "../../../shared/document";
import PanelCrop from "../../../shared/ui/PanelCrop.vue";
defineProps<{ page: ComicPage; active: string; triggers: SoundTrigger[] }>();
const emit = defineEmits<{ select: [id: string] }>();
</script>
<template>
  <section class="panel-strip">
    <div class="section-heading">
      <span>分镜导航 <small>STORYBOARD</small></span
      ><span class="muted">{{ page.panels.length }} 个镜头</span>
    </div>
    <div class="panel-thumbs">
      <button
        v-for="(panel, i) in page.panels"
        :key="panel.id"
        :class="{ selected: active === panel.id }"
        @click="emit('select', panel.id)"
      >
        <PanelCrop class="strip-thumb" :page="page" :rect="panel.rect" />
        <span
          ><b>{{ String(i + 1).padStart(2, "0") }}</b> {{ panel.speaker }}
          <small>{{ panel.duration }}s</small>
          <Bookmark v-if="panel.dialogueEdited" :size="9" class="panel-mark" />
        </span>
        <span
          v-if="panel.needsReview"
          class="panel-needs"
          title="对白归属待确认"
          >待确认</span
        >
        <span
          v-if="triggers.some((t) => t.panelId === panel.id)"
          class="panel-cue"
          title="这个分镜有声音触发点"
        >
          ♪
        </span>
      </button>
    </div>
  </section>
</template>
