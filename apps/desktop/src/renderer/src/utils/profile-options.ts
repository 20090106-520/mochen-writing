import {
  AGENT_PROFILES,
  findProfile,
  profilesForStage,
  resolveProfile,
  type AgentProfile
} from "@mochen/contracts";
import type { BookMeta } from "@mochen/contracts";
import type { IconName } from "../types/icons";

/**
 * 智能体档案选择器（spec §5.1）的判定层。
 *
 * 存在理由：六枚档案是数据，不接线就是摆设（§2.7）。这里把它们翻成 UI 认识的一行，
 * 组件只渲染与派发，不自己判断「哪一枚可选、哪一枚是当前」。
 *
 * 判定全部委托给 @mochen/contracts 的 resolveProfile / findProfile，
 * 本文件不复制一份优先级规则（铁律 6）。
 */

import type { ContextOption } from "./composer-context";

/** 档案选择器与阶段弹层共用一个 ContextOption 行形状，所以直接复用那个弹层，不造第二个。 */
export type ProfileOption = ContextOption;

/** 每枚档案配一枚图标；配不上的退回 bot，不给半张图标空着。 */
const PROFILE_ICONS: Record<string, IconName> = {
  world: "map",
  "chief-editor": "list",
  character: "user",
  "lead-writer": "pen",
  continuer: "edit",
  reviewer: "shield"
};

function iconOf(profile: AgentProfile): IconName {
  return PROFILE_ICONS[profile.id] ?? "bot";
}

/** 当前这本书正在用哪一枚档案。 */
export function activeProfileOf(meta: BookMeta | null): AgentProfile {
  return resolveProfile({
    activeProfile: meta?.activeProfile ?? null,
    stages: meta?.stages ?? [],
    activeStage: meta?.activeStage ?? null
  });
}

/** 屏显名：没书时也给一枚能看的（兜底档案名），不空着。 */
export function activeProfileLabel(meta: BookMeta | null): string {
  return activeProfileOf(meta).name;
}

/** 顶栏标题的「没有书」说法。与 useBookStore 的同义短语保持同一口径。 */
export const NO_BOOK_TITLE = "未选择作品";

/**
 * 中栏顶栏标题（2026-10-05 用户裁定）。
 *
 * 此前这里拼的是 `${stage.name}智能体`——「正文智能体」。那是**功能泛称**：
 * 无论当前是哪一枚档案在干活，顶栏都写着「正文智能体」，用户看不出现在是谁在写。
 * 改成报档案名（`墨宸 · 主笔` / `墨宸 · 审稿`…），标题才回答「谁在写」。
 *
 * 没书时仍然说「未选择作品」：没有书就没有正在写的 AI，报一枚兜底档案名是骗人
 * （`activeProfileLabel(null)` 会给兜底档案，那是给 chip 显示用的，不是给标题用的）。
 */
export function conversationTitleLabel(meta: BookMeta | null): string {
  return meta === null ? NO_BOOK_TITLE : activeProfileOf(meta).name;
}

/**
 * 档案选择器的行：**当前阶段可选的档案**（阶段自带 + 该阶段注册的默认，见 contracts 的
 * profilesForStage）。正文档因此是「主笔 / 续写」两枚可切，而不是只列出当前那一枚。
 * `busy` 只翻 disabled、不摘 current——落盘期间仍然看得出自己在哪（与阶段弹层同一条口径）。
 */
export function profileOptions(meta: BookMeta | null, busy: boolean): ProfileOption[] {
  if (!meta) return [];
  const current = activeProfileOf(meta);
  const allowed = profilesForStage(meta.stages, meta.activeStage);
  // 兜底：阶段表与兜底解析出的档案至少要出现在列表里，否则「当前这一枚」自己不在菜单里
  const list = allowed.some((p) => p.id === current.id) ? allowed : [current];
  return list.map((profile) => ({
    id: profile.id,
    label: profile.name,
    detail: `${profile.duty} · 可写：${writeScopeLabel(profile)}`,
    icon: iconOf(profile),
    current: profile.id === current.id,
    disabled: busy
  }));
}

/** 档案 id 反查；查不到返回 null，由调用处回一句中文（与 matchStageName 同一条口径）。 */
export function matchProfileId(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const byLabel = AGENT_PROFILES.find((p) => p.name === trimmed);
  if (byLabel) return byLabel.id;
  return findProfile(trimmed)?.id ?? null;
}
/**
 * 这一枚档案到底能写哪儿（给选择器的副标题用第二行）。
 * 写成中文是因为 spec §5.1 约束 3 要把「写入范围是上限不是授权」讲在明面上。
 */
export function writeScopeLabel(profile: AgentProfile): string {
  const scope = profile.writeScope;
  if (scope.kind === "none") return "只出批注式提案，不直接改正文";
  if (scope.kind === "current-chapter") {
    return scope.appendOnly === true ? "当前章（默认只在文末追加）" : "当前章";
  }
  return scope.kinds.map((kind) => KIND_LABELS[kind]).join(" / ");
}

const KIND_LABELS: Record<string, string> = {
  material: "素材库",
  outline: "大纲",
  plot: "剧情线",
  character: "人物卡",
  chapter: "当前章"
};
