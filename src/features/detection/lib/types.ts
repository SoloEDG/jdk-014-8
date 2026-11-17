import type { Rect } from "../../../shared/document";

export interface ReviewPanel {
  id: string;
  /** 审阅编辑使用的临时 id；应用时尽量沿用旧分镜 id */
  rect: Rect;
  confidence: number;
  /** 框被拖动、缩放、手动添加或合并拆分过 */
  touched: boolean;
  order: number;
  /** 来自已有分镜：应用时保留 id、对白与书签等引用 */
  existingId?: string;
  dialogue: string;
  speaker: string;
  sound: "rain" | "pulse" | "wind";
  duration: number;
  dialogueEdited: boolean;
  frameEdited: boolean;
  /** 对白归属有歧义（合并或拆分产生），应用后仍需确认 */
  needsReview?: boolean;
  origin: "import" | "detected" | "manual";
  /** 从识别结果新提出的框，尚未对应到页面分镜 */
  fresh: boolean;
  /** 内容来自哪个旧分镜；合并/拆分后可能与 id 不同 */
  migratedFrom?: string;
}

export type ReviewMode = "fast" | "fine";


