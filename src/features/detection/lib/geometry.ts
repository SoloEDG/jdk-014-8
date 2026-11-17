import type { Rect } from "../../../shared/document";

const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

export function clampRect(
  rect: Rect,
  pageWidth: number,
  pageHeight: number,
  minSize = 8,
): Rect {
  const width = clamp(rect.width, minSize, pageWidth);
  const height = clamp(rect.height, minSize, pageHeight);
  return {
    x: Math.round(clamp(rect.x, 0, pageWidth - width)),
    y: Math.round(clamp(rect.y, 0, pageHeight - height)),
    width: Math.round(width),
    height: Math.round(height),
  };
}

export function rectArea(rect: Rect) {
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

export function intersectionArea(a: Rect, b: Rect) {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return x * y;
}

/** b 的面积中有多少比例被 a 覆盖 */
export function overlapRatio(a: Rect, b: Rect) {
  const area = rectArea(b);
  return area <= 0 ? 0 : intersectionArea(a, b) / area;
}

/** 两个框的相似度：交集占较小框的比例；整页框与其中一格也能匹配。 */
export function matchScore(a: Rect, b: Rect) {
  const small = Math.min(rectArea(a), rectArea(b));
  return small <= 0 ? 0 : intersectionArea(a, b) / small;
}

export function unionRect(rects: Rect[]): Rect {
  if (!rects.length) return { x: 0, y: 0, width: 0, height: 0 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.width);
    y1 = Math.max(y1, r.y + r.height);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function centerOf(rect: Rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

export interface OrderedRect<T extends Rect> {
  item: T;
  index: number;
}

/**
 * 建议阅读顺序：先按横向“行带”分组，自上而下；每一行内按横坐标，
 * 右起阅读时行内反向。竖长格跨越两行时会与上一行共同分组，保持先左后右。
 */
/**
 * 缩略图裁剪。背景按百分比定位时，容器宽高比与裁剪框不一致会造成偏移，
 * 这里用“覆盖”方案：按裁剪框宽高比放大背景，再用百分比定位。
 */
export function rectFrameStyle(
  page: { width: number; height: number; image: string },
  rect: Rect,
) {
  const x = Math.max(0, Math.min(page.width, rect.x));
  const y = Math.max(0, Math.min(page.height, rect.y));
  const width = Math.max(1, Math.min(page.width - x, rect.width));
  const height = Math.max(1, Math.min(page.height - y, rect.height));
  return {
    aspectRatio: `${width}/${height}`,
    width: "100%",
    backgroundImage: `url("${page.image}")`,
    backgroundSize: `${(page.width / width) * 100}% ${(page.height / height) * 100}%`,
    backgroundPosition: `${page.width === width ? 0 : (x / (page.width - width)) * 100}% ${page.height === height ? 0 : (y / (page.height - height)) * 100}%`,
    backgroundRepeat: "no-repeat",
  };
}

export function unionOf(rects: Rect[]): Rect {
  return unionRect(rects);
}

