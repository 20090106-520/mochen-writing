/**
 * FindReplaceStore —— 文档内查找替换（Ctrl+F）
 *
 * 状态与匹配逻辑集中在这里：组件只消费结果、派发动作；
 * 正则构建、回转、容错全部落进同一份，不拆到 .vue 里靠 DOM 暗度陈仓。
 *
 * 文本真身由调用方在每次查询/选项变动时经 highlightPositions(text) 喂入，
 * replaceCurrent() / replaceAll() 在内部持有的这份文本上操作并返回新文本——
 * 调用方拿到后用 book.onEdit 写回，再重新调 highlightPositions 把高亮对齐到新文本。
 */
import { defineStore } from "pinia";
import { ref } from "vue";

export interface HighlightPosition {
  start: number;
  end: number;
}

// 上限：一次性匹配位置过多既不实用也吃性能；这边卡一条合理红线。
const MAX_POSITIONS = 10000;

export const useFindReplaceStore = defineStore("findReplace", () => {
  const visible = ref(false);
  const query = ref("");
  const replacement = ref("");
  const caseSensitive = ref(false);
  const useRegex = ref(false);
  const wholeWord = ref(false);
  const matchCount = ref(0);
  const currentIndex = ref(0);
  /** 最近一次经 highlightPositions 算起的位置序列——组件里的 mirror 直接读它，不再每帧重算。 */
  const positions = ref<HighlightPosition[]>([]);

  /** 最近一次经 highlightPositions 送入的文本真身——内部态，不暴露。 */
  let lastText = "";

  function open(): void {
    visible.value = true;
  }

  function close(): void {
    visible.value = false;
    query.value = "";
    replacement.value = "";
    currentIndex.value = 0;
    matchCount.value = 0;
    positions.value = [];
    lastText = "";
  }

  function toggleCaseSensitive(): void {
    caseSensitive.value = !caseSensitive.value;
  }

  function toggleUseRegex(): void {
    useRegex.value = !useRegex.value;
  }

  function toggleWholeWord(): void {
    wholeWord.value = !wholeWord.value;
  }

  function nextMatch(): void {
    if (matchCount.value === 0) return;
    currentIndex.value = (currentIndex.value + 1) % matchCount.value;
  }

  function prevMatch(): void {
    if (matchCount.value === 0) return;
    currentIndex.value = (currentIndex.value - 1 + matchCount.value) % matchCount.value;
  }

  /**
   * 按当前 options 构建用于「找全部」的全局正则。
   * 用正则非法：容错——退回纯文本（转义后）匹配。
   */
  function compileSearchRegex(): RegExp | null {
    const raw = query.value;
    if (raw === "") return null;

    let pattern: string;
    if (useRegex.value) {
      pattern = raw;
    } else {
      pattern = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    if (wholeWord.value) {
      pattern = `\\b${pattern}\\b`;
    }
    const flags = caseSensitive.value ? "g" : "gi";

    try {
      return new RegExp(pattern, flags);
    } catch {
      // 正则非法：容错，退回纯文本字面匹配。
      const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const fbPattern = wholeWord.value ? `\\b${escaped}\\b` : escaped;
      try {
        return new RegExp(fbPattern, flags);
      } catch {
        return null;
      }
    }
  }

  /**
   * 遍历文本算出所有起止位置；更新 matchCount / cachedPositions，
   * 并把 currentIndex 夹到合法范围内。
   */
  function highlightPositions(text: string): HighlightPosition[] {
    lastText = text;
    if (text === "" || query.value === "") {
      positions.value = [];
      matchCount.value = 0;
      currentIndex.value = 0;
      return positions.value;
    }

    const re = compileSearchRegex();
    if (re === null) {
      positions.value = [];
      matchCount.value = 0;
      currentIndex.value = 0;
      return positions.value;
    }

    const nextPositions: HighlightPosition[] = [];
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      nextPositions.push({ start: m.index, end: m.index + m[0].length });
      // 零宽匹配（如 \b 这类只断言不消耗的）：推进一位免得死循环。
      if (m[0].length === 0) re.lastIndex += 1;
      if (nextPositions.length >= MAX_POSITIONS) break;
    }

    positions.value = nextPositions;
    matchCount.value = nextPositions.length;
    if (currentIndex.value >= matchCount.value && matchCount.value > 0) {
      currentIndex.value = matchCount.value - 1;
    } else if (matchCount.value === 0) {
      currentIndex.value = 0;
    }
    return positions.value;
  }

  /**
   * 把「当前这一处」替换成 replacement：用非全局版的正则保留组引用（$1 等），
   * 选项为纯文本时再加一道「$ 字面化」免得 $ 被当成组引用吃掉。
   * 返回替换后的新文本；内部重算位置并把 currentIndex 对齐到下一处。
   */
  function replaceCurrent(): string {
    const cachedPositions = positions.value;
    if (cachedPositions.length === 0) return lastText;

    const idx = currentIndex.value;
    if (idx < 0 || idx >= cachedPositions.length) return lastText;

    const pos = cachedPositions[idx]!;
    const matchedText = lastText.slice(pos.start, pos.end);

    let repl: string;
    if (useRegex.value) {
      // 只取非全局版，让 $1/$& 这些组引用针对这一处生效。
      const re = compileSearchRegex();
      if (re !== null) {
        const single = new RegExp(re.source, re.flags.replace("g", ""));
        repl = matchedText.replace(single, replacement.value);
      } else {
        repl = replacement.value;
      }
    } else {
      // 纯文本：replacement 里的 $ 不被当成组引用，原样拼入。
      const re = compileSearchRegex();
      if (re !== null) {
        repl = matchedText.replace(re, () => replacement.value);
      } else {
        repl = replacement.value;
      }
    }

    const nextText = lastText.slice(0, pos.start) + repl + lastText.slice(pos.end);
    lastText = nextText;

    // 替换后重算——文本已变，位置序列失效。
    highlightPositions(nextText);
    // currentIndex 已被 clamp：若还有匹配，指向下一处（原逻辑下标不变即自然轮到下一处）；
    // 若无匹配则归零。
    return nextText;
  }

  /** 全部替换：用全局正则一次性搞定；currentIndex 归零。 */
  function replaceAll(): string {
    if (positions.value.length === 0 || lastText === "") return lastText;

    const re = compileSearchRegex();
    if (re === null) return lastText;

    const nextText = useRegex.value
      ? lastText.replace(re, replacement.value)
      : lastText.replace(re, () => replacement.value);

    lastText = nextText;
    highlightPositions(nextText);
    currentIndex.value = 0;
    return nextText;
  }

  return {
    visible,
    query,
    replacement,
    caseSensitive,
    useRegex,
    wholeWord,
    matchCount,
    currentIndex,
    positions,
    open,
    close,
    toggleCaseSensitive,
    toggleUseRegex,
    toggleWholeWord,
    nextMatch,
    prevMatch,
    replaceCurrent,
    replaceAll,
    highlightPositions
  };
});
