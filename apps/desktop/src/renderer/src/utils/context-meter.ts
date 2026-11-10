/**
 * 上下文占用条（spec §5「token 估算 + 已装配条目数」）的判定与文案层。
 *
 * 判定全在这里，.vue 只渲染：组件不进类型程序也不进单测，把 `empty` / 取整 / 截断
 * 写进模板就等于没有覆盖。同理，这里不许自己数一遍条目——条目与字数只有主进程
 * `agent:context-preview` 那一份（与 startTurn 走同一条 assembleFor），渲染层只是把它显示出来。
 */
import {
  contextKindLabel,
  type ContextPreview,
  type ContextPreviewItem,
  type ContextPreviewQuery
} from "@mochen/contracts";

/** 占用条的数据源：这几个事实变了才值得重问主进程一次。 */
export interface ContextMeterSource {
  docRelPath: string | null;
  profileId: string | null;
  pinned: readonly string[];
}

/**
 * 变更判定用的键。挂在 change 键上（不是挂值上）：档案的 context 变了、
 * 书里的文档多了少了，这些都不在这三个字段里，但一样要重问。
 * 组件拿它当 watch 的源，比 watch 三个字段更省事也更好测。
 */
export function contextMeterQueryKey(source: ContextMeterSource): string {
  return [source.docRelPath ?? "", source.profileId ?? "", ...source.pinned].join("\u0000");
}

export function contextMeterQuery(source: ContextMeterSource): ContextPreviewQuery {
  return {
    docRelPath: source.docRelPath,
    profileId: source.profileId,
    pinned: [...source.pinned]
  };
}

/** 折叠态那一行字。空的预览不显形，所以 visible 为假时 text 也一并给空串（模板不判空串以外的东西）。 */
export interface ContextMeterSummary {
  visible: boolean;
  /** 按钮上的短文案。 */
  text: string;
  /** 悬停/无障碍用的完整说明：这一轮真会发出去的是什么。 */
  title: string;
}

/** 展开态的一行。 */
export interface ContextMeterRow {
  key: string;
  label: string;
  title: string;
  chars: number;
  charsLabel: string;
  active: boolean;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * token 估算是主进程给的近似值（中文 1 字 1 token，其余 4 字符 1 token），
 * 所以这里只做**显示取整**：不到 1000 照原样，过千取一位小数，免得「1.2k tokens」
 * 这种带 k 的缩写和别的面板的写法对不上。
 */
export function formatApproxTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  return `${(tokens / 1000).toFixed(1)}k`;
}

/**
 * 折叠 chip 的总账（清单第 1 项，§22 那条口径分裂）。
 *
 * 口径：**装配条目 + 会话历史**，两路都是主进程报的数（`assembleFor` 给前者，
 * `historyStatFor` 给后者），这里只做一次相加——不重算阈值、不数条目、不碰正文，
 * 所以组件里不许出现第二份加法（钉在 `context-meter-wiring.test.ts`）。
 * 被窗口切掉的历史（`droppedCount`）本就不发出去，因此**不进合计**；那句「丢了什么」
 * 只由 `utils/history-window.ts` 说一遍，这里不重复那句话。
 */
/** 折叠条与压力行共用的总账：两路数字只有这一处相加（铁律 6，钉在 context-meter-wiring）。 */
interface MeterTotals {
  entries: number;
  chars: number;
  approxTokens: number;
  hasHistory: boolean;
  historyEntries: number;
  historyChars: number;
}

function meterTotals(preview: ContextPreview): MeterTotals {
  const history = preview.history;
  const historyEntries = history?.entries ?? 0;
  const historyChars = history?.chars ?? 0;
  const historyTokens = history?.approxTokens ?? 0;
  return {
    entries: preview.items.length + historyEntries,
    chars: preview.chars + historyChars,
    approxTokens: preview.approxTokens + historyTokens,
    hasHistory: historyEntries + historyChars + historyTokens > 0,
    historyEntries,
    historyChars
  };
}

export function contextMeterSummary(preview: ContextPreview | null): ContextMeterSummary {
  if (preview === null) return { visible: false, text: "", title: "" };
  const index = preview.skillIndex;
  const hasIndex = index !== undefined && index.shown > 0;
  // 条目为空且没有库索引才算「这一轮什么都不带」——只挂着二十条技能名也是一份占用。
  if (preview.empty || (preview.items.length === 0 && !hasIndex)) {
    return { visible: false, text: "", title: "" };
  }
  const totals = meterTotals(preview);
  const tokens = formatApproxTokens(totals.approxTokens);
  // 拆项先摆出来再给合计：一眼读到的那个数是总账，但「哪一路占多少」不能糊掉。
  // 索引那一段是主进程加进 `preview.chars` 的（它确实要发出去），所以第一段先把它减掉，
  // 两段相加正好等于总字数——不这么写就会把同一批字报两遍。
  const parts: string[] = [];
  if (preview.items.length > 0) {
    parts.push(`装配 ${preview.items.length} 条 ${preview.chars - (index?.chars ?? 0)} 字`);
  }
  if (hasIndex) parts.push(`技能库索引 ${index.shown}/${index.total} 条 ${index.chars} 字`);
  if (totals.hasHistory) {
    parts.push(`会话历史 ${totals.historyEntries} 条 ${totals.historyChars} 字`);
  }
  // 有历史才需要「上界」这句提醒：装配那一路与 startTurn 同源，历史这一路按预留为零算，
  // 真起一轮只会切得更狠（第二十一节查实），所以合计是**上界**，不许写成「就是发出去的」。
  const note = totals.hasHistory
    ? "逐条清单点开看；装配那一路与 startTurn 同源，历史按预留为零的上界报——真发出去的那一轮只会更少，不会更多"
    : "逐条清单点开看；条目与 startTurn 同源";

  return {
    visible: true,
    // 2026-10-23：chip 上**只留 tokens**，条数不进这一格。折叠条的横向额度是 12em（约 103px 文字），
    // 真机 1000 CSS 量到「23 条 · ≈989 tokens」被截成「23 条 · ≈989…」——中文界面里留一串
    // 没有单位的数字加省略号，比不报条数更糟。条数没丢：tooltip 首句就报「装配 N 条 …」，
    // 展开面板还逐条列着，所以这里让出前缀，把单位保住。
    text: `≈${tokens} tokens`,
    title:
      `这一轮会一起发给「${preview.profileName}」：${parts.join(" + ")}，` +
      (totals.hasHistory ? `共 ${totals.chars} 字，` : "") +
      `约 ${tokens} tokens（${note}）`
  };
}

/** 展开面板头部那一行「窗口压力」读数。 */
export interface ContextPressureReading {
  visible: boolean;
  /** 主读那一行：窗口百分比 + tokens。面板最窄 300px 里这一行**不许折**。 */
  text: string;
  /**
   * 分项明细（设定 / 已挂入 / 技能 / 库索引），空串＝这一轮没有可分的项。
   *
   * 2026-11-10 从 `text` 里拆出来：加了「库索引」之后那一行到 70 多个字符，
   * 460px 面板里必然折成两行，而且断在哪儿全看字数——「库索引 20/23 条」被拆成
   * 「库索引 20/23」和「条 1600 字」这种事真发生过。主读与分项分开，折行就只折分项。
   */
  detail: string;
  /** 这两个数各自从哪儿来、边界在哪儿——悬停/无障碍读这个。 */
  title: string;
}

/**
 * 「这一轮大概占掉上游窗口的多少」＋「显式挂入了几项」。
 *
 * 分子与折叠条**同一个数**（同一个 `meterTotals`，所以不许在这里再加一遍）；
 * 分母只有回包里的 `windowApproxTokens` 一份——它是主进程切历史用的那枚窗口，
 * P0-3 起来自模型配置的 `contextWindow`；没填过才回退到保守假设窗口
 * （`DEFAULT_CONTEXT_WINDOW_TOKENS`，经契约递过来，因为渲染层过不了包边界闸）。
 * 换句话说这一行报的是**真那个闸门的刻度**，不是模型真实上限；title 里必须把这句说明白，
 * 否则用户会以为 100% 等于模型拒绝服务。这里也绝不许再写一个 24000（铁律 6）。
 *
 * 三种不显形：没问过主进程、装不出东西、回包没给分母。最后一条是硬规矩——
 * 拿不到分母就宁可缺一行，也不许编一个数骗人。
 *
 * 两处刻意的不夹顶 / 不重复：
 * - 超过 100% 原样报（137% 比 100% 更要紧，夹顶等于把「已经超了」藏起来）；
 *   但 >0 又不足 1% 时报 ≈1% 而不是 ≈0%——0% 在屏上读起来像「没带东西」，那是另一种骗人。
 * - 被切掉的历史**这里不说**：那句「丢了什么」只由 `utils/history-window.ts` 讲一遍，
 *   面板底部那一行就是它；这里再点一次条数字就是第二套口径。
 */
export function contextPressureReading(preview: ContextPreview | null): ContextPressureReading {
  const windowTokens = preview?.windowApproxTokens ?? 0;
  const indexShown = preview?.skillIndex?.shown ?? 0;
  if (
    preview === null ||
    preview.empty ||
    (preview.items.length === 0 && indexShown === 0) ||
    windowTokens <= 0
  ) {
    return { visible: false, text: "", detail: "", title: "" };
  }
  const totals = meterTotals(preview);
  const ratio = (totals.approxTokens / windowTokens) * 100;
  const percent = totals.approxTokens === 0 ? 0 : Math.max(1, Math.round(ratio));
  const pinned = preview.items.filter((item) => item.kind === "pinned").length;
  // P0-2：技能不再混进「已挂入」——系统提示里只有清单，正文由 use_skill 按需读，
  // 两路占的额度完全不同，合成一行会让用户按正文的量去估预算。
  const skills = preview.items.filter((item) => item.kind === "skill").length;
  // 技能库索引（2026-11-10）：没挂入的那些也摆在提示词里（只有名字与一句说明）。
  // 单列一项而不是并进「技能」：那一格数是「挂入几项」，两者混在一行会让用户
  // 以为「挂了 20 项」，实际是「涨了 20 行名字」。
  const index = preview.skillIndex;
  // W-01：设定单独报一行，别让作者以为「设定」是装饰。这一族 = 世界观文稿 + 故事圣经里
  // 本轮真正装进来的条目（名字命中的、importance 高的），与正文/人物卡/大纲分开计量。
  const settings = preview.items.filter((item) => item.kind === "world");
  const settingsChars = settings.reduce((sum, item) => sum + item.chars, 0);

  // 主读一行只放「占了多少」：百分比与 tokens。分项另起一行——
  // 两批信息混在一行，窄面板里折行会断在数字中间（见接口注释里的现场）。
  const main = [
    `窗口 ≈${percent}%`,
    `${formatApproxTokens(totals.approxTokens)} / ${formatApproxTokens(windowTokens)} tokens`
  ];
  const details: string[] = [];
  if (settings.length > 0) details.push(`设定 ${settings.length} 项 ${settingsChars} 字`);
  if (pinned > 0) details.push(`已挂入 ${pinned} 项`);
  if (skills > 0) details.push(`技能 ${skills} 项`);
  if (index !== undefined && index.shown > 0)
    details.push(`库索引 ${index.shown}/${index.total} 条 ${index.chars} 字`);

  const ceiling =
    percent >= 100
      ? "已过保守窗口上界——更早的历史会被切掉，切了什么看下方那一行"
      : "到 100% 后更早的历史会被切掉";

  const hints: string[] = [];
  if (settings.length > 0)
    hints.push(
      "「设定」单独计量：世界观文稿 + 故事圣经里本轮真正装进来的条目（本章提到的、importance 高的），不含正文与人物卡。"
    );
  if (pinned > 0) hints.push("「已挂入」只数你显式挂进来的书内文稿（@ 引用 / 加入上下文）。");
  if (skills > 0) hints.push("「技能」单独计量：系统提示只带清单，正文由 use_skill 按需读取。");
  if (index !== undefined && index.shown > 0)
    hints.push(
      "「库索引」是技能库里没挂入的那些，只摆了名字与一句说明（不含正文），模型看中哪份会自己用 use_skill 去读。"
    );

  return {
    visible: true,
    text: main.join(" · "),
    detail: details.join(" · "),
    title:
      `分母 ${formatApproxTokens(windowTokens)} tokens 取自模型配置的上下文窗口（没填时回退到保守假设窗口），` +
      `不是模型真实上限；切历史时按 40% / 35% / 25% 分给系统提示 / 上下文包 / 历史。` +
      `分子与上方折叠条同一个数（装配 + 会话历史的上界）。${ceiling}。` +
      hints.join("")
  };
}

export function contextMeterRows(preview: ContextPreview | null): ContextMeterRow[] {
  if (preview === null) return [];
  return preview.items.map((item: ContextPreviewItem, index) => ({
    // relPath 可能重复（同一篇既是本章又是显式挂入），所以行键不能只拿 relPath。
    key: `${item.relPath}#${index}`,
    label: contextKindLabel(item.kind, item.active),
    title: clip(item.title, 28),
    chars: item.chars,
    charsLabel: `${item.chars} 字`,
    active: item.active
  }));
}
