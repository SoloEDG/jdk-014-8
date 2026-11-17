<script setup lang="ts">
import { computed } from "vue";
import type { ComicPage, Rect } from "../document";

/**
 * 把页面图片裁剪到指定区域。
 * - fit="slice"：铺满容器并裁切（缩略图用，不变形）；
 * - fit="meet"：完整显示裁剪区域并留白（逐格阅读用，避免拉伸画面）。
 */
const props = withDefaults(
  defineProps<{
    page: Pick<ComicPage, "image" | "width" | "height">;
    rect: Rect;
    fit?: "slice" | "meet";
  }>(),
  { fit: "slice" },
);
const viewBox = computed(() => {
  const page = props.page;
  const x = Math.max(0, Math.min(page.width, props.rect.x));
  const y = Math.max(0, Math.min(page.height, props.rect.y));
  const width = Math.max(1, Math.min(page.width - x, props.rect.width));
  const height = Math.max(1, Math.min(page.height - y, props.rect.height));
  return `${x} ${y} ${width} ${height}`;
});
const preserve = computed(() =>
  props.fit === "meet" ? "xMidYMid meet" : "xMidYMid slice",
);
</script>
<template>
  <svg
    class="panel-crop"
    :viewBox="viewBox"
    :preserveAspectRatio="preserve"
    role="presentation"
  >
    <image
      :href="page.image"
      x="0"
      y="0"
      :width="page.width"
      :height="page.height"
      preserveAspectRatio="none"
    />
  </svg>
</template>
