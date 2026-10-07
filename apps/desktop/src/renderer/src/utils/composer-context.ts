import type { BookMeta, BookStage } from "@mochen/contracts";
import type { IconName } from "../types/icons";

/**
 * 输入卡上方「书 / 阶段」绑定条（#113c，结构真身：deepwrite ComposerContextBar.vue）的判定层。
 *
 * 为什么阶段能对齐而书不能：
 * - 阶段有真契约——`BookMeta.stages` 是声明式列表、`activeStage` 可写回盘（bookSaveMeta 通道），
 *   所以那半截「列一个单、点一项、落一次盘」是真通路。
 * - 书没有——本仓全量 grep 无 recent-books / 资料库注册表，也没有 `book:list` 通道，
 *   拿不出任何一份可选书目。照参考图做一枚「点开是空列表」的弹层就是假控件，
 *   所以那一格退化成一个真动作：直接调 `book.pickAndOpen()`（与书架空态钮、Ctrl+O 同一真身）。
 */

/** 弹层/绑定条的一行。字段与 deepwrite ComposerContextOption 同名同义，便于后续继续对照移植。 */
export interface ContextOption {
  id: string;
  label: string;
  detail: string;
  icon: IconName;
  current: boolean;
  disabled: boolean;
}

/**
 * `meta.stages` 里找 `activeStage` 那一条——全仓唯一实现。
 * 这一句此前在 CenterColumn.vue 的 agentLabel 与 book-dossier.ts 的 stageName 各抄一遍，
 * #113c 加第三处（绑定条）之前先收口（铁律 6）。查不到返回 null，绝不退到「第一档」：
 * 盘上的书可以被人手改坏，宁可那一格显示「无」也不替用户编一个阶段。
 */
export function activeStageOf(meta: BookMeta | null): BookStage | null {
  if (!meta) return null;
  return meta.stages.find((stage) => stage.id === meta.activeStage) ?? null;
}

/** 阶段名那一格；与作品资料侧 `dossierSummary` 用同一个「无」，不留空白格。 */
export function stageLabelOf(meta: BookMeta | null): string {
  return activeStageOf(meta)?.name ?? "无";
}

/**
 * 中文档位名反查阶段：先按 name、再按 id 精确匹配（`/stage 正文` 与 `/stage draft` 都认）。
 * 查不到返回 null，由调用处回一句中文并列出可选值——项目律：拒绝一律回单句中文原因，不静默丢弃。
 * 与 matchPermissionMode（utils/slash-commands）同一条口径：一个中文字段反查枚举，查不到就报实话。
 */
export function matchStageName(meta: BookMeta | null, text: string): BookStage | null {
  if (!meta) return null;
  const trimmed = text.trim();
  if (trimmed === "") return null;
  return (
    meta.stages.find((stage) => stage.name === trimmed) ??
    meta.stages.find((s) => s.id === trimmed) ??
    null
  );
}

/**
 * 阶段弹层的列表：顺序 = book.json 的声明顺序，不做二次排序（用户在盘上写的那份顺序就是界面顺序）。
 * `busy` 只翻 disabled、不摘 current——落盘期间这一档仍然看得出自己在哪。
 * `detail` 恒为空串：本仓没有阶段级说明数据，参考稿那一行小字宁缺勿造（组件按空则不渲染）。
 */
export function stageContextOptions(meta: BookMeta | null, busy: boolean): ContextOption[] {
  if (!meta) return [];
  return meta.stages.map((stage) => ({
    id: stage.id,
    label: stage.name,
    detail: "",
    icon: "wand",
    current: stage.id === meta.activeStage,
    disabled: busy
  }));
}

/**
 * 绑定条只在「已绑定作品 + 这一格还没有消息」时显形（参考稿同样是 `v-if="messagesEmpty"`）。
 * 无书不显示：那时两格都是「无」，一条禁用的横条是装饰不是信息，且左栏已经给了打开作品的入口。
 */
export function showContextBar(input: { hasBook: boolean; threadEmpty: boolean }): boolean {
  return input.hasBook && input.threadEmpty;
}
