import { z } from "zod";
import { BOOK_PROJECT_MAX_CHARS, type BookProject } from "./book-project.js";
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

/**
 * 新建作品的默认阶段（2026-11-12 从 book-service 收上来）。
 *
 * 【为什么必须只有一份】技能推荐比的是**阶段名**不是 id（`skillPickOf` 的
 * `candidate.stages.includes(scene.stageName)`），而技能的 frontmatter `stage` 写的也是名字。
 * 出厂四条技能原先写的是 `stage: review`（英文 id），市场技能写的是 `- 正文`（中文名）——
 * 于是出厂那四条在任何一本书里都**永不命中**阶段这一路 40 分，只剩「适用文稿」那 30 分，
 * 而同分的四条又按 id 字典序取前三条，`check-style`（最该自动挂上的那条）永远排第四。
 * 收成一处常量之后，新建书的阶段名与出厂技能的 `stage` 再没有走岔的余地。
 */
export const DEFAULT_BOOK_STAGES: readonly BookStage[] = [{ id: "draft", name: "正文" }];

/** 默认阶段名（`DEFAULT_BOOK_STAGES` 的第一枚）：出厂技能与新建书共用这一个字符串。 */
export const DEFAULT_STAGE_NAME = DEFAULT_BOOK_STAGES[0]!.name;

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
  /**
   * 书级技能策略（P0-4）：新会话继承这份设置；线程级挂入仍可临时覆盖、不写回。
   *
   * 老书没有这一格，一律按 `EMPTY_SKILL_POLICY`（两个空清单）解析——与升级前的行为一致：
   * 以前技能只活在渲染进程内存里，开书时本来就是「一个都没挂」。
   * 缺省值的**唯一**归一化入口是 `skillPolicyOf`（铁律 6），调用方不许各兜一份。
   */
  skillPolicy?: BookSkillPolicy | undefined;
  /**
   * 开书立项（W-07）：新建作品时可选填的六项创作约定（题材/平台/篇幅/节奏/雷点/卖点）。
   *
   * 老书没有这一格，解析必须照样过得去；跳过立项的新书也不写它。
   * 键名、标签与归一化只住在 `book-project.ts`（铁律 6）。
   */
  project?: BookProject | undefined;
}

/**
 * 书级技能策略：
 * - `enabled`：书级默认挂入的技能 id（新开会话继承）。
 * - `disabled`：全局停用的技能 id——不参与推荐排序，`use_skill` 也读不到。
 *
 * 两个清单互斥：同一 id 不会同时出现在两边（写入口 `useBookStore` 的两个动作各自保证）。
 */
export interface BookSkillPolicy {
  enabled: string[];
  disabled: string[];
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
  /**
   * 各章开头句的原料（2026-10-15 读放大刀）：剥掉 frontmatter 后正文的首个非空行原文，
   * 由 scan 顺路带出——与 `excerpt`/`chars` 共用那一次 readFile，零额外 IO。
   *
   * 加它的动机：`assembleContext` 的 `openings`（「别每章同一套起手式」的提示词原料）过去从
   * `contents` 取全文再 split 首行——这意味着 `assembleFor` 即使按预算只读 3 章全文，仍得为
   * 「其余章的首行」再读 997 次 `readDocFile`（每次还带一次 `realpath` 边界检查）。把这行原料
   * 顺路存在 DocRef 上，`assembleFor` 就能真正只读会被装进上下文的那几章，1000 章的书上
   * `readDocFile` 次数从 1004 降到个位数。口径与旧实现逐字一致——同一个 `body`、同一句
   * `split("\\n").find(l => l.trim() !== "")`，只是提取时机从「装配时」挪到「扫描时」。
   * 跨 IPC 消费处一律 `?? ""`，与 `excerpt` 同一档可选语义。
   */
  opening?: string;
  /**
   * 各章结尾句的原料（2026-11-15）：剥掉 frontmatter 后正文的**最后一个非空行**原文，
   * 与 `opening` 同一次 scan、同一次 readFile，零额外 IO。
   *
   * 动机与 `opening` 对称：`assembleContext` 的 `closings`（「别每章同一个收法」的提示词原料）
   * 若从 `contents` 取全文再取末行，`assembleFor` 就得为「其余章的末行」重新读盘；
   * 顺路存在 DocRef 上之后，仍然只读会被装进上下文的那几章。口径与 `closingLineOf` 逐字一致。
   * 跨 IPC 消费处一律 `?? ""`，与 `opening` 同一档可选语义。
   */
  closing?: string;
}

/**
 * `DocRef` 的形状闸（2026-10-10 P1-4 后半）。存在的唯一理由：跨进程来的字段一律当不可信——
 * 渲染层过去从来没见过 `doc:create` 带回来的那一份，仓里同一条规矩的先例是 `main/quit-flush.ts`
 * （先认形状，认不出来就按没发生过处理）。
 *
 * 只认形状不认语义：`relPath` 指不指向这本书里面、这一篇盘上到底有没有，那些判定住在
 * 主进程的 realpath 闸与 fs-store 的扫描里，这里再判一遍就是第二份判据（铁律 6）。
 * `title` 允许空串、`excerpt`/`chars` 允许缺省——`DocRef` 的注释本来就写着消费处一律 `?? ""` / `?? 0`，
 * 这里如果把它们提成必填，反而会把「盘上真有这一篇」的正常回话拒成 null，界面退回整本重扫，白慢一次。
 */
export const docRefSchema = z.object({
  relPath: z.string().min(1),
  kind: z.enum(BOOK_KINDS),
  title: z.string(),
  excerpt: z.string().optional(),
  chars: z.number().int().min(0).optional(),
  opening: z.string().optional(),
  closing: z.string().optional()
});

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
    workMode: z.enum(WORK_MODES).optional(),
    // 两个清单各自缺省为空：只写了 `enabled` 的半份策略也能解析。
    skillPolicy: z
      .object({
        enabled: z.array(z.string().min(1)).default([]),
        disabled: z.array(z.string().min(1)).default([])
      })
      .optional(),
    // 立项六格的键名与 `book-project.ts` 的 BOOK_PROJECT_FIELDS 同步；
    // 上限也取那一处的常量，不在 schema 里另写一个数字。
    project: z
      .object({
        genre: z.string().max(BOOK_PROJECT_MAX_CHARS).optional(),
        platform: z.string().max(BOOK_PROJECT_MAX_CHARS).optional(),
        length: z.string().max(BOOK_PROJECT_MAX_CHARS).optional(),
        cadence: z.string().max(BOOK_PROJECT_MAX_CHARS).optional(),
        taboos: z.string().max(BOOK_PROJECT_MAX_CHARS).optional(),
        pitch: z.string().max(BOOK_PROJECT_MAX_CHARS).optional()
      })
      .optional()
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

/**
 * Windows 的**系统保留名**（扫描总单 P2-2 的后半，2026-10-10 补）。
 *
 * `CON` / `PRN` / `AUX` / `NUL` / `COM1`-`COM9` / `LPT1`-`LPT9` 既不能当文件名也不能当目录名，
 * 大小写无关，而且**带扩展名同样算**（`CON.txt` 在 Win32 眼里就是 CON 那台设备）——
 * 这是 Microsoft「Naming a File」文档里写着的真实规则，不是多虑。
 *
 * 为什么必须在这里拒、而不是指望写盘那层报错：本机 win32 + Node 24 实测 `fs.writeFile('nul.md')`
 * **不抛错**，文件真能落盘、Node 自己还读得回来。也就是说这条病全程零提示，
 * 稿子会以一个 Windows 命名规则不认的名字躺在书目录里，等资源管理器拷贝、别的程序打开时才炸。
 * 所以判定长在命名层，并且**跨平台一律拒**（同一本书迟早被拷回 Windows；CI 是 Linux 也得拒得过）。
 *
 * 判定只住这一处（铁律 6）：渲染层 `planDocRelPath` 先拒、主进程 `book-service.createDoc` 与
 * fs-store `assertSafeRelPath` 各引**这同一条**再兜一遍，两处闸吃的是同一句理由。
 */
const WINDOWS_RESERVED_NAMES = new Set<string>([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  ...["1", "2", "3", "4", "5", "6", "7", "8", "9"].flatMap((n) => [`COM${n}`, `LPT${n}`])
]);

/**
 * 「这一段名字是不是保留名」。口径照 Win32：先去掉**结尾**的空格与圆点（Windows 会把它们吃掉），
 * 再看**第一个圆点之前**的那一截——所以 `CON.`、`NUL `、`COM1.backup.log` 全算命中。
 */
function isWindowsReservedNameSegment(segment: string): boolean {
  const base = segment.replace(/[ .]+$/g, "").split(".")[0] ?? "";
  return WINDOWS_RESERVED_NAMES.has(base.toUpperCase());
}

/**
 * 撞上保留名 ⇒ 那句人话（**这条口径唯一的文案真身**）；没撞上返回 null。
 * 入参可以是书名、章节标题，也可以是书内相对路径——逐段判，目录名同样是保留名。
 */
export function windowsReservedNameProblem(nameOrPath: string): string | null {
  for (const segment of nameOrPath.replaceAll("\\", "/").split("/")) {
    if (isWindowsReservedNameSegment(segment))
      return `「${segment}」撞上了 Windows 的系统保留名（CON、PRN、AUX、NUL、COM1-COM9、LPT1-LPT9，带扩展名也一样），这个名字在 Windows 上落不了盘，换一个。`;
  }
  return null;
}

export function sanitizeDocFileName(title: string): string | null {
  const cleaned = Array.from(title.replace(FILE_NAME_FORBIDDEN, "-"))
    .filter((ch) => ch.charCodeAt(0) > 0x1f)
    .join("")
    .replace(/[\s.]+$/g, "")
    .trim();
  if (cleaned === "") return null;
  // 保留名**拒绝**而不是替换：把 `CON` 悄悄改成 `CON-1` 会让用户找不到自己起的那个名字，
  // 而且改名后的文件照样可能撞别的稿子——起名这一步的失败必须让用户看得见、自己改。
  return windowsReservedNameProblem(cleaned) === null ? cleaned : null;
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

/**
 * 按 `chapterOrder` 给文稿排序：全仓**唯一的一份**章节次序判据（P1-4 后半，2026-10-10）。
 *
 * 【为什么这里必须只有一份】判据过去有两份，而且它们不等价：主进程 `fs-store` 的 `sortChapters`
 * 对「都不在 chapterOrder 里的两篇」按 `relPath` 名字排，渲染层 `utils/doc-order` 的
 * `sortDocsByOrder` 对同样两篇返回 0（保持传进来的相对次序）。只要这两份并存，
 * 「渲染层本地拼一根新 DocRef」与「整本重扫」就永远对不出同一个侧栏——而增量拼接正是省掉
 * 每次建章重读整本书（1000 章实测 99–136 ms）的唯一通路。
 *
 * 【为什么两边都能引这一份】渲染层不许 import fs-store（包边界守卫，那条理由是成立的），
 * 而 fs-store 不许被浏览器包拖进去；contracts 是两边唯一都进得来、又不带 Node 依赖的格子。
 * 所以 fs-store 与渲染层各自那份现在只是**转调**，本体住在这儿。
 *
 * 【取哪一份语义：主进程那份（名字序），不是"它先存在"】名字序**与输入顺序无关**，
 * 这是增量拼接能被证明等价的前提；「保持原相对次序」则让同一批文稿按来路不同给出两种顺序。
 * 未登记的一律排在已登记的后面（`ra !== undefined` / `rb !== undefined` 那两条），
 * 否则目录里刚出现的新稿会插到正文头上。
 *
 * 【zh-CN 不是随手写的】中文稿名按拼音排，不按码点排：`characters/阿雾.md`(U+963F) 与
 * `characters/李深.md`(U+674E) 用 `<` 比会得到「李深」在前，而作者在文件管理器里看到的是拼音序。
 * 换掉这句（比如图省事写成 `a.relPath < b.relPath`）会当场红，用例钉在
 * `test/sort-docs.test.ts`。
 *
 * 不改传入数组（返回新数组）：渲染层传进来的 `docs` 被 Vue 响应式包着，就地 `sort` 会绕过变更追踪。
 * `chapterOrder` 里登记了盘上没有的条目时不凭空造稿——次序表只是偏好，不是文稿清单。
 */
export function sortDocs(docs: DocRef[], chapterOrder: string[]): DocRef[] {
  const rank = new Map(chapterOrder.map((rel, index) => [rel, index]));
  return [...docs].sort((a, b) => {
    const ra = rank.get(a.relPath);
    const rb = rank.get(b.relPath);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return a.relPath.localeCompare(b.relPath, "zh-CN");
  });
}
