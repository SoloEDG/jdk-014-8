export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type PanelSound = "rain" | "pulse" | "wind";
export type PanelOrigin = "import" | "detected" | "manual";
export interface Panel {
  id: string;
  rect: Rect;
  dialogue: string;
  speaker: string;
  sound: PanelSound;
  duration: number;
  /** 分镜框的来源，旧数据可能没有该字段。 */
  origin?: PanelOrigin;
  /** 用户手动改过对白。 */
  dialogueEdited?: boolean;
  /** 用户手动拖过框线；重新识别时默认保留这些框。 */
  frameEdited?: boolean;
  /** 对白归属存在歧义（合并、拆分或整页文本迁移），需人工确认。 */
  needsReview?: boolean;
}
export interface PageLayout {
  source: "whole" | "detected" | "manual";
  revision: number;
  updated: number;
}
export interface ComicPage {
  id: string;
  title: string;
  image: string;
  width: number;
  height: number;
  panels: Panel[];
  layout?: PageLayout;
}
export interface Chapter {
  id: string;
  title: string;
  subtitle: string;
  pages: ComicPage[];
}
export interface ComicDocument {
  version: 1;
  id: string;
  title: string;
  author: string;
  chapters: Chapter[];
}
export interface ReadingLocation {
  chapterId: string;
  pageId: string;
  panelId: string;
  zoom: number;
  x: number;
  y: number;
}
export interface Bookmark {
  id: string;
  label: string;
  location: ReadingLocation;
  created: number;
}
/** 每页的声音触发点，与分镜 id 绑定；布局确认后按区域迁移。 */
export interface SoundTrigger {
  id: string;
  pageId: string;
  panelId: string;
  label: string;
  sound: "rain" | "pulse" | "wind";
  created: number;
}
export type ReadingMode = "page" | "panel";

/** 导入页与空分镜使用的占位对白；它不是用户写的内容，不应参与迁移判定。 */
export const DEFAULT_DIALOGUE = "在这一页，留下属于你的故事。";
