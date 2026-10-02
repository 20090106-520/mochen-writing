/**
 * F-A 预填的唯一判定：输入框已有内容时绝不覆盖用户正在写的字（附录 §2.7「名字与动作不符也算摆设」的对偶——
 * 预填按钮按下去不能把人已打的字吞掉）。判定只这一处，store 与工作台卡都调它，不各写一份三元链（铁律 6）。
 * 语义按码点无关：只做「去空白后是否非空」的判断，返回原串，不 trim、不改写。
 */
export function prefillText(current: string, incoming: string): string {
  return current.trim() === "" ? incoming : current;
}
