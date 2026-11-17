import type { DetectionMode } from "./detector";
import { workSize } from "./detector";

export interface PreparedImage {
  bitmap: ImageBitmap;
  /** 工作图坐标 -> 页面坐标 */
  scaleX: number;
  scaleY: number;
  workWidth: number;
  workHeight: number;
  sourceWidth: number;
  sourceHeight: number;
}

function loadElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片无法解码，可能已损坏"));
    image.src = src;
  });
}

/**
 * 在识别前把图片绘制到工作分辨率的画布：
 * - 矢量图（如内置示例 SVG）固有尺寸可能很小，必须按页面尺寸放大绘制，否则细格线会被抹掉；
 * - 位图保留原有细节，再按快速/精细模式的预算缩放。
 */
export async function prepareImage(
  src: string,
  pageWidth: number,
  pageHeight: number,
  mode: DetectionMode,
): Promise<PreparedImage> {
  const image = await loadElement(src);
  const naturalWidth = image.naturalWidth || pageWidth;
  const naturalHeight = image.naturalHeight || pageHeight;
  const sourceWidth = Math.max(naturalWidth, Math.round(pageWidth));
  const sourceHeight = Math.max(naturalHeight, Math.round(pageHeight));
  const work = workSize(sourceWidth, sourceHeight, mode);
  const canvas = document.createElement("canvas");
  canvas.width = work.width;
  canvas.height = work.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("浏览器不支持画布读取");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  // 白底，避免透明 PNG 的边缘被识别成格线。
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, work.width, work.height);
  context.drawImage(image, 0, 0, work.width, work.height);
  const bitmap = await createImageBitmap(canvas);
  return {
    bitmap,
    scaleX: pageWidth / Math.max(1, work.width),
    scaleY: pageHeight / Math.max(1, work.height),
    workWidth: work.width,
    workHeight: work.height,
    sourceWidth: naturalWidth,
    sourceHeight: naturalHeight,
  };
}

export function scaleRects<T extends { rect: { x: number; y: number; width: number; height: number } }>(
  boxes: T[],
  prepared: PreparedImage,
  pageWidth: number,
  pageHeight: number,
): T[] {
  const sx = pageWidth / Math.max(1, prepared.workWidth);
  const sy = pageHeight / Math.max(1, prepared.workHeight);
  return boxes.map((box) => ({
    ...box,
    rect: {
      x: Math.round(box.rect.x * sx),
      y: Math.round(box.rect.y * sy),
      width: Math.max(1, Math.round(box.rect.width * sx)),
      height: Math.max(1, Math.round(box.rect.height * sy)),
    },
  }));
}
