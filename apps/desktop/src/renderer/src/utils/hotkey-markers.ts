/**
 * DOM 标记名与选择器：全仓唯一一份实现（评审 X4a，「枚举与映射只许一份实现」律）。
 *
 * 标记名是模板与键位层之间的接口：任一侧手抄/改名都不会有编译错误，也没有既有用例可红——
 * 这正是 Task 7 自己暴露过的失败模式。故：
 * ① JS 读方（useHotkeys.ts / hotkey-focus.ts）一律从这里 import，选择器由标记名推导，属性名只活在这里；
 * ② 两个 .vue 模板保持字面属性（不用 v-bind 对象展开去扭曲模板），
 *    它们与本模块的一致性由 hotkey-markers.test.ts 的源码契约用例（node:fs 读模板，无需 jsdom）钉死。
 */
export const COMPOSER_MARKER = "data-mochen-composer";
export const CARD_MARKER = "data-proposal-card";
export const CARD_ID_ATTR = "data-proposal-id";
export const CARD_STATUS_ATTR = "data-proposal-status";
export const GUIDANCE_MARKER = "data-guidance";

/** 选择器一律由标记名推导——改名自动传导，不留第二份字符串。 */
export const COMPOSER_SELECTOR = `[${COMPOSER_MARKER}]`;
export const CARD_SELECTOR = `[${CARD_MARKER}]`;
export const GUIDANCE_SELECTOR = `[${GUIDANCE_MARKER}]`;
