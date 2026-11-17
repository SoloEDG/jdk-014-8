export { useDetection } from "./model/detection";
export type { ApplyPayload, ReviewPhase } from "./model/detection";
export { default as DetectionBanner } from "./ui/DetectionBanner.vue";
export { default as PanelReview } from "./ui/PanelReview.vue";
export { default as ApplyDialog } from "./ui/ApplyDialog.vue";
export { detectPanels, workSize } from "./lib/detector";
export type { DetectionMode, DetectionResult } from "./lib/detector";
