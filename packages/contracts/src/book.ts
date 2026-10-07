import { z } from "zod";
import { PERMISSION_MODES, WORK_MODES, type PermissionMode, type WorkMode } from "./permission.js";

export const BOOK_KINDS = [
  "chapter",
  "outline",
  "character",
  "plot",
  "material",
  "worldview",
  "faction",
  "location",
  "timeline",
  "glossary",
  "volume",
  "foreshadow",
  "skill"
] as const;
export type BookKind = (typeof BOOK_KINDS)[number];

export interface BookStage {
  id: string;
  name: string;
  /**
   * 该阶段的默认智能体档案 id（spec §5.1）。可缺省：缺了就走 agent-profile.ts 的阶段默认表，
   * 表里也没有就落到全局兜底。老书一律没这个字段，所以它必须可选。
   */
  profile?: string | undefined;
}

export interface BookMeta {
  id: string;
  title: string;
  schemaVersion: 1;
  stages: BookStage[];
  activeStage: string;
  permissionMode: PermissionMode;
  chapterOrder: string[];
  /**
   * 书级当前档案（spec §5.1：中栏档案选择器切的那一枚）。
   * 可缺省；缺了就按 阶段自带 profile > 阶段默认表 > 全局兜底 解析，见 resolveProfile。
   */
  activeProfile?: string | undefined;
  /**
   * 书级工作模式（2026-10-05 批次 4）：`plan` = 先计划后动手，这一轮不落盘。
   *
   * 可选字段，理由与 `profile` 同款：老书没有它，解析必须照样过——它不是迁移门槛。
   * 缺省值只住在 `permission.ts` 的 `workModeOf`，不许在这里或调用方各兜一个（铁律 6）。
   */
  workMode?: WorkMode | undefined;
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

const stageSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  // 可选字段：老书没有它，解析必须照样过（spec §5.1 档案是增量接线，不是迁移门槛）
  profile: z.string().min(1).optional()
});

export const bookMetaSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    schemaVersion: z.literal(1),
    stages: z.array(stageSchema).min(1),
    activeStage: z.string().min(1),
    permissionMode: z.enum(PERMISSION_MODES),
    chapterOrder: z.array(z.string().min(1)),
    activeProfile: z.string().min(1).optional(),
    // 同 activeProfile：老书没这一格照样解析得过（迁移门槛不在这）。
    workMode: z.enum(WORK_MODES).optional()
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

/**
 * Windows 文件名禁用字符与结尾圆点/空格：这本书的文档名直接当文件名用，
 * 这些字符在 NTFS 上根本落不了盘，与其让主进程报一句 io-error，不如在起名时就说明白。
 * 非法字符一律换成「-」，控制字符直接删（按码点过滤，不用正则——控制字符进正则会撞 no-control-regex）——
 * 替换而不是拒绝，是因为书名里出现 `：` 冒号很正常。
 */
const FILE_NAME_FORBIDDEN = /[<>:"/\\|?*]/g;

export function sanitizeDocFileName(title: string): string | null {
  const cleaned = Array.from(title.replace(FILE_NAME_FORBIDDEN, "-"))
    .filter((ch) => ch.charCodeAt(0) > 0x1f)
    .join("")
    .replace(/[\s.]+$/g, "")
    .trim();
  return cleaned === "" ? null : cleaned;
}

/**
 * 由分组与标题规划新文档的书内相对路径（唯一实现：主进程写盘与渲染层预检共用这一份）。
 * 标题非法返回 null，调用方负责把它翻译成一句人话。
 */
export function planDocRelPath(kind: BookKind, title: string): string | null {
  const name = sanitizeDocFileName(title);
  if (name === null) return null;
  const dir = kind === "material" ? "materials" : DOC_DIRS_OF[kind];
  return `${dir}/${name}.md`;
}

/** kind → 顶层目录。contracts 侧只留这一份映射给 planDocRelPath 用；扫描表的真身在 fs-store。 */
const DOC_DIRS_OF: Record<Exclude<BookKind, "material">, string> = {
  chapter: "chapters",
  outline: "outline",
  character: "characters",
  plot: "plot",
  worldview: "worldview",
  faction: "factions",
  location: "locations",
  timeline: "timeline",
  glossary: "glossary",
  volume: "volumes",
  foreshadow: "foreshadow",
  skill: "skills"
};
