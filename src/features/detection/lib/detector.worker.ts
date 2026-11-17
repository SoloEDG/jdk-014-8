import { detectPanels } from "./detector";

interface DetectRequest {
  type: "detect";
  jobId: string;
  bitmap: ImageBitmap;
  mode: "fast" | "fine";
}

interface CancelRequest {
  type: "cancel";
  jobId: string;
}

export type DetectorRequest = DetectRequest | CancelRequest;

const cancelled = new Set<string>();

self.onmessage = (event: MessageEvent<DetectorRequest>) => {
  const message = event.data;
  if (message.type === "cancel") {
    cancelled.add(message.jobId);
    return;
  }
  const { jobId, bitmap, mode } = message;
  (async () => {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("无法创建图像上下文");
    context.drawImage(bitmap, 0, 0);
    const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
    bitmap.close();
    if (cancelled.has(jobId)) return;
    const progress = (value: number) => {
      if (cancelled.has(jobId)) return;
      self.postMessage({ type: "progress", jobId, value });
    };
    try {
      const result = detectPanels(
        { data: image.data, width: image.width, height: image.height },
        mode,
        progress,
      );
      if (cancelled.has(jobId)) return;
      self.postMessage({ type: "done", jobId, result });
    } catch (error) {
      if (cancelled.has(jobId)) return;
      self.postMessage({
        type: "error",
        jobId,
        message: error instanceof Error ? error.message : "识别失败",
      });
    }
  })().catch((error: unknown) => {
    self.postMessage({
      type: "error",
      jobId,
      message: error instanceof Error ? error.message : "识别失败",
    });
  });
};
