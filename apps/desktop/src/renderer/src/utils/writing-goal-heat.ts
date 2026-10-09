/**
 * 写作目标面板的颜色判定（2026-10-09 扫描总单·假控件表最后一行）。
 *
 * 【病灶】热力格五档、进度圈那一枚 stroke、达成提示的字色，原先都是抄在组件里的十六进制字面量
 * （`#40845a / #3a7a50 / #2d6a44 / #52a56e / #e8923a / rgba(108,158,255,…)`）。
 * `--success / --accent / --warning` 由 `appearanceThemeRuntime` 按明暗重算，抄出来的那几支**永远不跟着变**：
 * 浅色主题下热力格仍是按暗色主题挑的深绿，对比度不由任何 token 保证。
 *
 * 【为什么抽到这里】"哪一档是哪支色"是可枚举的判定，纯字符串进可入类型程序、退可被 vitest 逐档钉；
 * 留在 `<script setup>` 里就两头都测不到（本仓 `.vue` 不进类型程序、又无 jsdom）。
 * 面板只剩两件事：把算出来的值挂进 `:style`，以及别再自己抄颜色。
 *
 * 【口径】深浅一律用 `color-mix(in srgb, <那支 token> N%, transparent)`：
 * 同一支 token、只变比例，这样换主题时整片热力格一起换，不会出现"五档里有两档跟着主题、三档不跟"。
 */

/** 达成（含超额）那一档就是 --success 本体，不做半透明——它是这面板唯一要"跳出来"的颜色。 */
export const HEAT_REACHED_FILL = "var(--success)";

/** 未达成的四档：绿色两支由 --success 分层，蓝色两支由 --accent 分层（档位越高越实）。 */
export function heatFill(pct: number, reached: boolean): string {
  if (pct <= 0) return "transparent";
  if (reached) return HEAT_REACHED_FILL;
  if (pct >= 75) return "color-mix(in srgb, var(--success) 82%, transparent)";
  if (pct >= 50) return "color-mix(in srgb, var(--success) 60%, transparent)";
  if (pct >= 25) return "color-mix(in srgb, var(--accent) 35%, transparent)";
  return "color-mix(in srgb, var(--accent) 16%, transparent)";
}

/**
 * 空格子那一圈描边。
 *
 * 旧写法带 `rgba(255,255,255,0.15)` 兜底——半透明白在浅色主题上等于没画（`--border` 是运行时
 * 一定设了的 token，见 theme-token-guard 那份名单，所以这里不需要兜底，也不许留兜底）。
 */
export function heatBorder(pct: number): string {
  return pct <= 0 ? "1px solid var(--border)" : "none";
}

/** 进度圈：达成用 --success，没达成用 --accent。模板里那一枚三元表达式只许读这两个值。 */
export function ringStroke(reached: boolean): string {
  return reached ? HEAT_REACHED_FILL : "var(--accent)";
}
