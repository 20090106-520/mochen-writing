import type { BookMeta } from "@mochen/contracts";
import { skillPolicyOf, skillPolicyWithDefault, skillPolicyWithDisabled } from "@mochen/contracts";

/** 写技能书级策略需要的最小宿主（`useBookStore` 满足它；测试里可以只给这三格）。 */
export interface SkillPolicyHost {
  meta: BookMeta | null;
  notice: string;
  persistMeta(patch: Partial<BookMeta>, failPrefix: string): Promise<boolean>;
}

/**
 * 「设为书级默认 / 取消默认」：判定在 contracts 的纯函数里，这里只负责走 `persistMeta`
 * 那一条唯一写通路（不碰 IPC、不自己拼 book.json）。老书第一次写时由 `skillPolicyOf` 补空清单。
 */
export async function applySkillDefault(
  host: SkillPolicyHost,
  id: string,
  on: boolean
): Promise<void> {
  const next = skillPolicyWithDefault(skillPolicyOf(host.meta), id, on);
  if (!(await host.persistMeta({ skillPolicy: next }, "技能的默认挂入没存住"))) return;
  host.notice = on ? `已把「${id}」设为这本书的默认挂入。` : `已取消「${id}」的默认挂入。`;
}

/** 「停用 / 启用」：停用的不进推荐、`use_skill` 也读不到；启用只摘标记，不自动挂回默认。 */
export async function applySkillDisabled(
  host: SkillPolicyHost,
  id: string,
  disabled: boolean
): Promise<void> {
  const next = skillPolicyWithDisabled(skillPolicyOf(host.meta), id, disabled);
  if (!(await host.persistMeta({ skillPolicy: next }, "技能的停用状态没存住"))) return;
  host.notice = disabled ? `已停用「${id}」：不进推荐，也不给本轮模型读。` : `已启用「${id}」。`;
}
