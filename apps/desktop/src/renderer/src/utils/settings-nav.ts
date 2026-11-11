/**
 * 设置页左栏的分组标题该不该画（2026-11-11）。
 *
 * 【病灶】「关于」既是分组名，又是它里面唯一那一项的名字。屏幕上于是出现
 * 「关于 / 关于」上下两行——读者第一反应是「这里是不是坏了，怎么有一条重复」。
 * 同类形状本仓已经出现过一次：左栏「我的作品 → 作品库」。
 *
 * 【判据】分组标题只在「它有多个子项」或「它和唯一子项不同名」时才有信息量。
 * 单子项且同名 ⇒ 那行标题一个字节的新信息都没有，只会把侧栏读成两层。
 *
 * 写成纯函数而不是模板里的三元表达式：这条判定要被守卫钉住，而 `.vue` 的模板
 * 表达式在测试里读不到求值结果，只能读到源码字符串。
 */
export interface LabeledSection {
  readonly label: string;
  readonly categories: readonly { readonly label: string }[];
}

export function showsSectionLabel(section: LabeledSection): boolean {
  if (section.categories.length !== 1) return true;
  return section.categories[0]!.label !== section.label;
}
