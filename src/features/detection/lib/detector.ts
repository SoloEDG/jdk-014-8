import type { Rect } from "../../../shared/document";

export type DetectionMode = "fast" | "fine";

export interface DetectedBox {
  rect: Rect;
  confidence: number;
}

export interface DetectionResult {
  boxes: DetectedBox[];
  confidence: number;
  width: number;
  height: number;
  mode: DetectionMode;
  warnings: string[];
  stats: {
    splits: number;
    coverage: number;
    duration: number;
  };
}

export interface GrayImage {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

interface Region {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Separator {
  axis: "x" | "y";
  start: number;
  end: number;
  score: number;
  purity: number;
  kind: "white" | "black" | "flat";
}

interface Leaf extends Region {
  splitStrength: number;
}

interface Preset {
  maxSide: number;
  maxPixels: number;
  minPanelRatio: number;
  minPanelPx: number;
  maxDepth: number;
  maxBandRatio: number;
}

/**
 * 快速模式分辨率低、阈值保守，用于整页导入后的即时建议；
 * 精细模式提高分辨率并允许更窄的分格，但更耗时、更占内存。
 */
const PRESETS: Record<DetectionMode, Preset> = {
  fast: {
    maxSide: 900,
    maxPixels: 1_000_000,
    minPanelRatio: 0.036,
    minPanelPx: 12,
    maxDepth: 8,
    maxBandRatio: 0.2,
  },
  fine: {
    maxSide: 1500,
    maxPixels: 2_300_000,
    minPanelRatio: 0.014,
    minPanelPx: 8,
    maxDepth: 12,
    maxBandRatio: 0.26,
  },
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const round = (v: number) => Math.round(v * 1000) / 1000;

export function detectPanels(
  image: GrayImage,
  mode: DetectionMode = "fast",
  onProgress: (value: number) => void = () => {},
): DetectionResult {
  const started = Date.now();
  const preset = PRESETS[mode];
  const width = Math.max(1, Math.floor(image.width));
  const height = Math.max(1, Math.floor(image.height));
  const count = width * height;

  const luma = toLuma(image.data, count);
  onProgress(0.08);
  const smooth = blur3(luma, width, height);
  onProgress(0.2);

  const textureRaw = new Uint8Array(count);
  let textureSum = 0;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      const c = smooth[i]!;
      let d = 0;
      if (x > 0) d = Math.max(d, Math.abs(c - smooth[i - 1]!));
      if (x + 1 < width) d = Math.max(d, Math.abs(c - smooth[i + 1]!));
      if (y > 0) d = Math.max(d, Math.abs(c - smooth[i - width]!));
      if (y + 1 < height) d = Math.max(d, Math.abs(c - smooth[i + width]!));
      const range = max3(luma, width, height, x, y) - min3(luma, width, height, x, y);
      const t = Math.max(d, Math.round(range * 0.6));
      textureRaw[i] = Math.min(255, t);
      textureSum += t;
    }
  }
  onProgress(0.32);

  const meanTexture = textureSum / count;
  const textureThreshold = Math.max(8, Math.min(52, Math.round(meanTexture * 1.1 + 3)));
  const ink = new Uint8Array(count);
  let inkCount = 0;
  for (let i = 0; i < count; i++) {
    if (textureRaw[i]! > textureThreshold) { ink[i] = 1; inkCount++; }
  }
  const coverage = inkCount / count;

  const lumaHist = new Uint32Array(256);
  for (let i = 0; i < count; i++) lumaHist[luma[i]!] = lumaHist[luma[i]!]! + 1;
  const paperHigh = percentile(lumaHist, count, 0.95);
  const paperLow = percentile(lumaHist, count, 0.03);
  const whiteLevel = Math.max(196, paperHigh - 14);
  const blackLevel = Math.min(64, paperLow + 16);
  const brightLevel = Math.max(170, paperHigh - 32);
  const darkThreshold = medianDark(luma, count);
  onProgress(0.42);

  const minPanel = Math.max(
    preset.minPanelPx,
    Math.round(Math.min(width, height) * preset.minPanelRatio),
  );
  const minGutter = Math.max(1, Math.round(Math.min(width, height) * 0.0025));
  const maxBand = Math.max(
    minGutter + 2,
    Math.round(Math.min(width, height) * preset.maxBandRatio),
  );

  let splits = 0;
  const leaves: Leaf[] = [];

  function splitRegion(region: Region, depth: number, inherited: number) {
    const rw = region.x1 - region.x0;
    const rh = region.y1 - region.y0;
    if (
      depth >= preset.maxDepth ||
      (rw < minPanel * 2 && rh < minPanel * 2)
    ) {
      leaves.push({ ...region, splitStrength: inherited });
      return;
    }
    const separator = findSeparator(region);
    if (!separator || separator.score < 0.5) {
      leaves.push({ ...region, splitStrength: inherited });
      return;
    }
    const origin = separator.axis === "y" ? region.y0 : region.x0;
    const center = origin + Math.round((separator.start + separator.end) / 2);
    const next = inherited > 0 ? Math.min(inherited, separator.score) : separator.score;
    splits++;
    if (separator.axis === "y") {
      splitRegion({ ...region, y1: center }, depth + 1, next);
      splitRegion({ ...region, y0: center }, depth + 1, next);
    } else {
      splitRegion({ ...region, x1: center }, depth + 1, next);
      splitRegion({ ...region, x0: center }, depth + 1, next);
    }
    onProgress(0.42 + Math.min(0.36, splits * 0.03));
  }

  interface AxisProfile {
    inkRatio: Float32Array;
    whiteRatio: Float32Array;
    darkRatio: Float32Array;
    brightRatio: Float32Array;
    meanLuma: Float32Array;
  }

  function profileOf(region: Region, axis: "x" | "y"): AxisProfile {
    const { x0, y0, x1, y1 } = region;
    const length = axis === "y" ? y1 - y0 : x1 - x0;
    const inkCounts = new Uint32Array(length);
    const whiteCounts = new Uint32Array(length);
    const darkCounts = new Uint32Array(length);
    const brightCounts = new Uint32Array(length);
    const lumaSums = new Float64Array(length);
    for (let y = y0; y < y1; y++) {
      const row = y * width;
      for (let x = x0; x < x1; x++) {
        const i = row + x;
        const k = axis === "y" ? y - y0 : x - x0;
        if (ink[i]) inkCounts[k] = inkCounts[k]! + 1;
        const l = luma[i]!;
        lumaSums[k] = lumaSums[k]! + l;
        if (l >= whiteLevel) whiteCounts[k] = whiteCounts[k]! + 1;
        if (l <= blackLevel) darkCounts[k] = darkCounts[k]! + 1;
        if (l >= brightLevel) brightCounts[k] = brightCounts[k]! + 1;
      }
    }
    const denominator = axis === "y" ? x1 - x0 : y1 - y0;
    const inkRatio = new Float32Array(length);
    const whiteRatio = new Float32Array(length);
    const darkRatio = new Float32Array(length);
    const brightRatio = new Float32Array(length);
    const meanLuma = new Float32Array(length);
    for (let k = 0; k < length; k++) {
      inkRatio[k] = inkCounts[k]! / Math.max(1, denominator);
      whiteRatio[k] = whiteCounts[k]! / Math.max(1, denominator);
      darkRatio[k] = darkCounts[k]! / Math.max(1, denominator);
      brightRatio[k] = brightCounts[k]! / Math.max(1, denominator);
      meanLuma[k] = lumaSums[k]! / Math.max(1, denominator);
    }
    return { inkRatio, whiteRatio, darkRatio, brightRatio, meanLuma };
  }

  function findSeparator(region: Region): Separator | null {
    let best: Separator | null = null;
    for (const axis of ["y", "x"] as const) {
      const length = axis === "y" ? region.y1 - region.y0 : region.x1 - region.x0;
      const extent = axis === "y" ? region.x1 - region.x0 : region.y1 - region.y0;
      if (length < minPanel * 2 + minGutter || extent < minPanel) continue;
      const { inkRatio, whiteRatio, darkRatio, brightRatio, meanLuma } = profileOf(region, axis);

      const candidates: Separator[] = [];
      const from = Math.min(minPanel, length);
      const to = Math.max(from, length - minPanel);
      let runStart = -1;
      for (let k = from; k < to; k++) {
        const empty = inkRatio[k]! <= 0.14;
        if (empty && runStart < 0) runStart = k;
        if (!empty && runStart >= 0) {
          flushBand(runStart, k);
          runStart = -1;
        }
      }
      if (runStart >= 0) flushBand(runStart, to);

      function flushBand(start: number, end: number) {
        const band = end - start;
        if (band < minGutter || band > maxBand) return;
        if (start < minPanel || length - end < minPanel) return;
        // 分隔带必须比两侧分镜窄；否则更像画面里的大块留白或暗部。
        const side = Math.min(start, length - end);
        if (band > Math.max(minGutter + 2, side * 0.6)) return;
        let inkAvg = 0;
        let whiteAvg = 0;
        let darkAvg = 0;
        let meanSum = 0;
        for (let k = start; k < end; k++) {
          inkAvg += inkRatio[k]!;
          whiteAvg += whiteRatio[k]!;
          darkAvg += darkRatio[k]!;
          meanSum += meanLuma[k]!;
        }
        inkAvg /= band;
        whiteAvg /= band;
        darkAvg /= band;
        const bandMean = meanSum / band;
        let meanDev = 0;
        for (let k = start; k < end; k++) meanDev += Math.abs(meanLuma[k]! - bandMean);
        meanDev /= band;
        const uniform = inkAvg <= 0.14 && meanDev <= 3.2;
        // 紧邻分隔带的两侧应比带内更“有内容”；否则只是平坦画面里的暗部/留白。
        const near = (side: number) => {
          let sum = 0;
          let n = 0;
          for (let k = side; k < side + 4; k++) {
            if (k < 0 || k >= length) continue;
            sum += inkRatio[k]!;
            n++;
          }
          return n ? sum / n : 0;
        };
        const leftNear = near(start - 4);
        const rightNear = near(end);
        const edgeInk = Math.min(leftNear, rightNear);
        if (edgeInk < Math.max(0.1, inkAvg + 0.07)) return;
        // 分隔带还必须比紧邻两侧明显更暗或更亮；否则深色画面里的雨丝/暗部会被当成格线。
        const meanNear = (side: number) => {
          let sum = 0;
          let n = 0;
          for (let k = side; k < side + 6; k++) {
            if (k < 0 || k >= length) continue;
            sum += meanLuma[k]!;
            n++;
          }
          return n ? sum / n : bandMean;
        };
        const leftMean = meanNear(Math.max(0, start - 6));
        const rightMean = meanNear(end);
        const bandDelta = Math.min(
          Math.abs(bandMean - leftMean),
          Math.abs(bandMean - rightMean),
        );
        if (bandDelta < 7) return;
        let kind: "white" | "black" | "flat" | null = null;
        let purity = 0;
        if (uniform && whiteAvg >= 0.72) {
          kind = "white";
          purity = 1 - inkAvg / 0.14;
        } else if (uniform && darkAvg >= 0.7) {
          kind = "black";
          purity = Math.min(1, (darkAvg - 0.55) / 0.45);
        } else if (uniform) {
          kind = "flat";
          purity = 0.62;
        }
        if (!kind || purity < 0.2) return;
        const sides = sideStats(region, axis, start, end, bandMean);
        if (!sides.left || !sides.right) return;
        const borderSupport = borderLines(region, axis, start, end, darkRatio, brightRatio);
        if (kind === "white" && borderSupport < 1) return;
        if (kind === "flat" && borderSupport < 2) return;
        const bandScore = Math.min(1, band / (minGutter * 3));
        const score =
          purity * 0.58 +
          (borderSupport / 2) * 0.28 +
          bandScore * 0.08 +
          0.06;
        candidates.push({ axis, start, end, purity, score, kind });
      }

      for (const c of candidates) {
        const weighted = c.score * (0.75 + 0.25 * Math.log2(1 + extent / 120));
        if (!best || weighted > best.score) best = { ...c, score: weighted };
      }
    }
    return best;
  }

  /** 分隔带两侧是否都有可见内容（纹理或与分隔带不同的底色）。 */
  function sideStats(
    region: Region,
    axis: "x" | "y",
    start: number,
    end: number,
    bandMean: number,
  ) {
    const { x0, y0, x1, y1 } = region;
    const boxes: Array<[number, number, number, number]> =
      axis === "y"
        ? [
            [x0, y0, x1, y0 + start],
            [x0, y0 + end, x1, y1],
          ]
        : [
            [x0, y0, x0 + start, y1],
            [x0 + end, y0, x1, y1],
          ];
    return {
      left: hasDetail(boxes[0]!),
      right: hasDetail(boxes[1]!),
    };

    function hasDetail([ax0, ay0, ax1, ay1]: [number, number, number, number]) {
      const maxSamples = 4000;
      const area = Math.max(1, (ax1 - ax0) * (ay1 - ay0));
      const stride = Math.max(1, Math.floor(Math.sqrt(area / maxSamples)));
      let n = 0;
      let inkSum = 0;
      let lumaSum = 0;
      for (let y = ay0; y < ay1; y += stride) {
        const row = y * width;
        for (let x = ax0; x < ax1; x += stride) {
          n++;
          inkSum += textureRaw[row + x]!;
          lumaSum += luma[row + x]!;
        }
      }
      if (!n) return false;
      const detail = inkSum / n;
      const contrast = Math.abs(lumaSum / n - bandMean);
      return detail > 3 || contrast > 14;
    }
  }

  /** 分隔带两侧 1–3 像素内是否有深色或亮色框线。 */
  function borderLines(
    region: Region,
    axis: "x" | "y",
    start: number,
    end: number,
    darkRatio: Float32Array,
    brightRatio: Float32Array,
  ): number {
    const length = darkRatio.length;
    let support = 0;
    for (const side of [start, end]) {
      let peak = 0;
      for (let d = 1; d <= 3; d++) {
        const a = side - d;
        const b = side + d - 1;
        if (a >= 0 && a < length) {
          peak = Math.max(peak, darkRatio[a]!, brightRatio[a]!);
        }
        if (b >= 0 && b < length) {
          peak = Math.max(peak, darkRatio[b]!, brightRatio[b]!);
        }
      }
      if (peak > 0.45) support++;
    }
    return support;
  }

  splitRegion({ x0: 0, y0: 0, x1: width, y1: height }, 0, 0);
  onProgress(0.8);

  const trimmed = leaves
    .map((leaf) => trimToContent(leaf))
    .filter((leaf): leaf is Leaf & { content: number } => leaf !== null);

  const scored = dedupe(trimmed)
    .filter((box) => {
      const w = box.x1 - box.x0;
      const h = box.y1 - box.y0;
      return w >= 8 && h >= 8;
    })
    .map((box) => {
      const w = box.x1 - box.x0;
      const h = box.y1 - box.y0;
      const border = borderEvidence(box);
      const contentRatio = box.content / Math.max(1, w * h);
      const fill = Math.min(1, contentRatio / 0.05);
      const splitEvidence = clamp01((box.splitStrength - 0.45) / 0.35);
      const aspect = w / Math.max(1, h);
      const aspectPenalty =
        aspect < 0.055 || aspect > 18 ? 0.14 : aspect < 0.11 || aspect > 9 ? 0.06 : 0;
      const score = clamp01(
        0.24 + border * 0.34 + splitEvidence * 0.3 + fill * 0.12 - aspectPenalty,
      );
      return {
        rect: { x: Math.round(box.x0), y: Math.round(box.y0), width: Math.round(w), height: Math.round(h) },
        confidence: round(score),
        area: (w * h) / (width * height),
      };
    });

  const boxes = scored.length
    ? scored
    : [
        {
          rect: { x: 0, y: 0, width, height },
          confidence: 0.22,
          area: 1,
        },
      ];

  const areaTotal = boxes.reduce((sum, b) => sum + b.area, 0);
  const avgConfidence =
    boxes.reduce((sum, b) => sum + b.confidence * b.area, 0) /
    Math.max(0.0001, areaTotal);
  let confidence =
    boxes.length > 1 ? clamp01(avgConfidence * 0.92 + 0.1) : 0.33;
  if (coverage < 0.004 || coverage > 0.6) confidence *= 0.72;

  const warnings: string[] = [];
  if (boxes.length <= 1) {
    warnings.push(
      "未找到明确的分隔线，可能为无边框画面、整页跨页或斜切构图；可保留整页或手动加框。",
    );
  } else {
    if (boxes.some((b) => b.confidence < 0.45)) {
      warnings.push("部分格框边界不清晰，可能有斜线、跨格人物或较窄的格子。");
    }
    if (boxes.some((b) => b.area > 0.55)) {
      warnings.push("有大面积格框，画面可能跨格或留白较多，请确认是否需要拆分。");
    }
    if (boxes.length > 16) warnings.push("格框较多，请逐格确认是否有误分。");
    if (!hasBorderOnMost(boxes)) {
      warnings.push("多数格框未检测到完整边框，建议对照原图核对。");
    }
  }
  if (mode === "fast") {
    warnings.push("快速识别降低了分辨率，特别窄的格子可能漏掉；可改用精细识别重试。");
  }
  if (coverage > 0.52) warnings.push("画面细节密集，分隔线可能被误认为内容。");

  onProgress(1);
  return {
    boxes: boxes.map(({ rect, confidence: c }) => ({ rect, confidence: c })),
    confidence: round(confidence),
    width,
    height,
    mode,
    warnings,
    stats: { splits, coverage: round(coverage), duration: Date.now() - started },
  };

  function trimToContent(region: Leaf): (Leaf & { content: number }) | null {
    const { x0, y0, x1, y1 } = region;
    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0) return null;
    const rowCounts = new Uint32Array(h);
    const colCounts = new Uint32Array(w);
    let content = 0;
    for (let y = y0; y < y1; y++) {
      const row = y * width;
      for (let x = x0; x < x1; x++) {
        if (ink[row + x]) {
          rowCounts[y - y0] = rowCounts[y - y0]! + 1;
          colCounts[x - x0] = colCounts[x - x0]! + 1;
          content++;
        }
      }
    }
    if (content === 0) return { ...region, content, splitStrength: region.splitStrength };
    const rowNeed = Math.max(2, Math.round(w * 0.004));
    const colNeed = Math.max(2, Math.round(h * 0.004));
    let top = 0;
    while (top < h && rowCounts[top]! < rowNeed) top++;
    let bottom = h - 1;
    while (bottom > top && rowCounts[bottom]! < rowNeed) bottom--;
    let left = 0;
    while (left < w && colCounts[left]! < colNeed) left++;
    let right = w - 1;
    while (right > left && colCounts[right]! < colNeed) right--;
    const margin = Math.max(1, Math.round(Math.min(width, height) * 0.002));
    const nx0 = Math.max(0, x0 + left - margin);
    const ny0 = Math.max(0, y0 + top - margin);
    const nx1 = Math.min(width, x0 + right + 1 + margin);
    const ny1 = Math.min(height, y0 + bottom + 1 + margin);
    if (nx1 - nx0 < 6 || ny1 - ny0 < 6) {
      return { ...region, content, splitStrength: region.splitStrength };
    }
    return { x0: nx0, y0: ny0, x1: nx1, y1: ny1, content, splitStrength: region.splitStrength };
  }

  function dedupe(items: Array<Leaf & { content: number }>) {
    const kept: Array<Leaf & { content: number }> = [];
    const sorted = [...items].sort(
      (a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0),
    );
    for (const box of sorted) {
      let duplicate = false;
      for (const other of kept) {
        const ix = Math.max(0, Math.min(box.x1, other.x1) - Math.max(box.x0, other.x0));
        const iy = Math.max(0, Math.min(box.y1, other.y1) - Math.max(box.y0, other.y0));
        const small = Math.min(
          (box.x1 - box.x0) * (box.y1 - box.y0),
          (other.x1 - other.x0) * (other.y1 - other.y0),
        );
        if (small > 0 && (ix * iy) / small > 0.88) {
          duplicate = true;
          break;
        }
      }
      if (!duplicate) kept.push(box);
    }
    return kept;
  }

  function borderEvidence(box: Region): number {
    const { x0, y0, x1, y1 } = box;
    const w = x1 - x0;
    const h = y1 - y0;
    if (w < 4 || h < 4) return 0;
    const inset = Math.min(2, Math.floor(Math.min(w, h) / 10));
    let total = 0;
    let found = 0;
    for (let x = x0 + inset; x < x1 - inset; x++) {
      total += 2;
      if (ink[(y0 + inset) * width + x]) found++;
      if (ink[(y1 - 1 - inset) * width + x]) found++;
    }
    for (let y = y0 + inset; y < y1 - inset; y++) {
      total += 2;
      if (ink[y * width + x0 + inset]) found++;
      if (ink[y * width + x1 - 1 - inset]) found++;
    }
    return total ? found / total : 0;
  }

  function hasBorderOnMost(items: Array<{ rect: Rect }>) {
    if (!items.length) return false;
    let withBorder = 0;
    for (const item of items) {
      const r = item.rect;
      if (borderEvidence({ x0: r.x, y0: r.y, x1: r.x + r.width, y1: r.y + r.height }) > 0.35)
        withBorder++;
    }
    return withBorder / items.length >= 0.5;
  }
}

function toLuma(data: Uint8ClampedArray | Uint8Array, count: number): Uint8Array {
  const out = new Uint8Array(count);
  if (data.length >= count * 4) {
    for (let i = 0, j = 0; i < count; i++, j += 4) {
      out[i] = (data[j]! * 0.299 + data[j + 1]! * 0.587 + data[j + 2]! * 0.114) | 0;
    }
  } else {
    for (let i = 0; i < count; i++) out[i] = data[i] ?? 0;
  }
  return out;
}

function percentile(histogram: Uint32Array, count: number, p: number) {
  const target = count * p;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += histogram[v]!;
    if (acc >= target) return v;
  }
  return 255;
}

function min3(src: Uint8Array, width: number, height: number, x: number, y: number) {
  let m = 255;
  for (let dy = -1; dy <= 1; dy++) {
    const yy = y + dy;
    if (yy < 0 || yy >= height) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx;
      if (xx < 0 || xx >= width) continue;
      const v = src[yy * width + xx]!;
      if (v < m) m = v;
    }
  }
  return m;
}

function max3(src: Uint8Array, width: number, height: number, x: number, y: number) {
  let m = 0;
  for (let dy = -1; dy <= 1; dy++) {
    const yy = y + dy;
    if (yy < 0 || yy >= height) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx;
      if (xx < 0 || xx >= width) continue;
      const v = src[yy * width + xx]!;
      if (v > m) m = v;
    }
  }
  return m;
}

function medianDark(luma: Uint8Array, count: number) {
  const histogram = new Uint32Array(256);
  for (let i = 0; i < count; i++) histogram[luma[i]!] = histogram[luma[i]!]! + 1;
  let acc = 0;
  let median = 128;
  for (let v = 0; v < 256; v++) {
    acc += histogram[v]!;
    if (acc >= count / 2) {
      median = v;
      break;
    }
  }
  return Math.max(18, Math.min(90, Math.round(median * 0.4)));
}

function blur3(src: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    const up = y > 0 ? row - width : row;
    const down = y + 1 < height ? row + width : row;
    for (let x = 0; x < width; x++) {
      const left = x > 0 ? x - 1 : x;
      const right = x + 1 < width ? x + 1 : x;
      out[row + x] =
        (src[up + left]! +
          src[up + x]! +
          src[up + right]! +
          src[row + left]! +
          src[row + x]! +
          src[row + right]! +
          src[down + left]! +
          src[down + x]! +
          src[down + right]!) /
        9;
    }
  }
  return out;
}

/** 计算检测使用的工作分辨率，兼顾耗时和内存。 */
export function workSize(
  width: number,
  height: number,
  mode: DetectionMode,
): { width: number; height: number } {
  const preset = PRESETS[mode];
  const factor = Math.min(
    1,
    preset.maxSide / Math.max(1, Math.max(width, height)),
    Math.sqrt(preset.maxPixels / Math.max(1, width * height)),
  );
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
  };
}
