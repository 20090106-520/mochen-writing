import { z } from "zod";
import { PERMISSION_MODES, type PermissionMode } from "./permission.js";

export const BOOK_KINDS = ["chapter", "outline", "character", "plot", "material"] as const;
export type BookKind = (typeof BOOK_KINDS)[number];

export interface BookStage {
  id: string;
  name: string;
}

export interface BookMeta {
  id: string;
  title: string;
  schemaVersion: 1;
  stages: BookStage[];
  activeStage: string;
  permissionMode: PermissionMode;
  chapterOrder: string[];
}

export interface DocRef {
  relPath: string;
  kind: BookKind;
  title: string;
  /** 正文第一段纯文本（≤80 码点），由 scan 顺路带出；跨 IPC 消费处一律 `?? ""`。 */
  excerpt?: string;
  /**
   * 正文字数（剥掉 frontmatter，按 `proseCharCount` 的非空白码点口径），同样由 scan 顺路带出——
   * 与 `excerpt` 共用那一次 readFile，不额外碰盘。消费处一律 `?? 0`。
   */
  chars?: number;
}

const stageSchema = z.object({ id: z.string().min(1), name: z.string().min(1) });

export const bookMetaSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    schemaVersion: z.literal(1),
    stages: z.array(stageSchema).min(1),
    activeStage: z.string().min(1),
    permissionMode: z.enum(PERMISSION_MODES),
    chapterOrder: z.array(z.string().min(1))
  })
  .superRefine((value, ctx) => {
    const ids = new Set<string>();
    for (const stage of value.stages) {
      if (ids.has(stage.id))
        ctx.addIssue({ code: "custom", message: `stage id 重复：${stage.id}`, path: ["stages"] });
      ids.add(stage.id);
    }
    if (!value.stages.some((stage) => stage.id === value.activeStage))
      ctx.addIssue({
        code: "custom",
        message: "activeStage 不在 stages 中",
        path: ["activeStage"]
      });
  });

export function parseBookMeta(raw: unknown): BookMeta {
  return structuredClone(bookMetaSchema.parse(raw));
}
