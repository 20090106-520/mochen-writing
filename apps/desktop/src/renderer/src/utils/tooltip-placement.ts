/**
 * 应用内 Tooltip 的判定与定位（2026-11-11）。
 *
 * 对标 macOS / Figma / Linear / Ant Design 那一族：提示是**应用自己的一层 UI**，
 * 不是浏览器那张 1 秒后才弹、圆角字色全跟系统走、深色皮肤下像贴了块白膏药的原生 title。
 * 本文件只回答两件能单测的事：
 *  ① 一个 `title` 属性该不该接管、要不要顺手补 aria-label；
 *  ② 提示框该落在锚点的哪一侧、横向夹到哪、箭头指回锚点哪个位置。
 * DOM 监听与装配归 components/TooltipLayer.vue，形状归 styles/tooltip.css。
 */

/** 提示框与锚点之间的呼吸距离。 */
export const TOOLTIP_GAP = 8;
/** 提示框离视口边缘至少留这么多，别贴到窗框上。 */
export const TOOLTIP_VIEWPORT_EDGE = 8;
/** 鼠标悬停的显示延迟。系统原生约 1000ms，大厂普遍 300~500ms；键盘聚焦不等。 */
export const TOOLTIP_HOVER_DELAY_MS = 320;
/** 箭头中心离提示框左右边缘的最小距离，免得夹到角上还指得出框外。 */
export const TOOLTIP_ARROW_INSET = 12;
/** 接管后 title 搬到这里存着；原生 title 必须删掉，否则两套提示会同时弹。 */
export const TOOLTIP_ATTR = "data-mochen-tip";

export interface TooltipAnchorRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TooltipBox {
  width: number;
  height: number;
}

export interface TooltipViewport {
  width: number;
  height: number;
}

export interface TooltipPlacement {
  side: "top" | "bottom";
  left: number;
  top: number;
  arrowLeft: number;
}

/**
 * 接管一个 title 属性的判定。
 *
 * - 空 / 纯空白 ⇒ 不接管（原生也不会弹，别为一个空串造一层 UI）；
 * - 元素已有 aria-label、或自己有可见文字 ⇒ 不动它的可访问名；
 * - 纯图标按钮（无 aria-label、无文字）⇒ 补一条 aria-label，用的是**第一行**：
 *   书架那枚提示是「打开《书名》\n完整路径」，拿整段当可访问名会把路径念一遍。
 *
 * 为什么补 aria-label：title 被搬走后，读屏器原本可能靠 title 拿名字的那个入口
 * 不能凭空消失。补上比留着 title 更可靠（title 作可访问名的回退顺序最低且各平台不一）。
 */
export interface TooltipAdoption {
  text: string;
  ariaLabel: string | null;
}

export function adoptTooltipTitle(
  title: string | null,
  hasAriaLabel: boolean,
  hasTextContent: boolean
): TooltipAdoption | null {
  if (title === null) return null;
  const text = title.trim();
  if (text.length === 0) return null;
  const firstLine = text.split("\n")[0]!.trim();
  return {
    text,
    ariaLabel: !hasAriaLabel && !hasTextContent && firstLine.length > 0 ? firstLine : null
  };
}

/**
 * 提示框定位：优先上方，上方不够且下方更宽就翻到下方；两侧都挤时仍选更宽的一侧，
 * 最后把 top / left 夹进视口。箭头始终回指锚点水平中心，夹在框内。
 *
 * 纯函数：不读 DOM、不读 window，视口与测量结果都是入参，边界档能逐条钉。
 */
export function placeTooltip(
  anchor: TooltipAnchorRect,
  box: TooltipBox,
  viewport: TooltipViewport,
  gap: number = TOOLTIP_GAP,
  edge: number = TOOLTIP_VIEWPORT_EDGE
): TooltipPlacement {
  const roomAbove = anchor.top - gap;
  const roomBelow = viewport.height - (anchor.top + anchor.height) - gap;
  const side: TooltipPlacement["side"] =
    roomAbove >= box.height || roomAbove >= roomBelow ? "top" : "bottom";
  const wantedTop =
    side === "top" ? anchor.top - box.height - gap : anchor.top + anchor.height + gap;
  const maxTop = Math.max(edge, viewport.height - box.height - edge);
  const top = Math.min(Math.max(wantedTop, edge), maxTop);

  const wantedLeft = anchor.left + anchor.width / 2 - box.width / 2;
  const maxLeft = Math.max(edge, viewport.width - box.width - edge);
  const left = Math.min(Math.max(wantedLeft, edge), maxLeft);

  const arrowCenter = anchor.left + anchor.width / 2 - left;
  const arrowMax = Math.max(TOOLTIP_ARROW_INSET, box.width - TOOLTIP_ARROW_INSET);
  const arrowLeft = Math.min(Math.max(arrowCenter, TOOLTIP_ARROW_INSET), arrowMax);

  return { side, left, top, arrowLeft };
}
