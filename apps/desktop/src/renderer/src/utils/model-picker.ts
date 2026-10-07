/**
 * 「填模型」那格的判定：名单怎么分组、怎么搜、怎么挑默认值。
 *
 * **为什么要有这一层**：名单是从 `{baseURL}/models` 拿的，形如
 * `["agnes-2.5-pro","agnes-image-2.1-flash","agnes-video-2.5",…]`——
 * 图像与视频模型和对话模型**平铺在同一列**，用户得自己认名字挑。
 * 而这些名字里没有任何类型字段可依（`/models` 回的只有
 * `id / object / created / owned_by / supported_endpoint_types`，
 * 后者一律是 `["openai"]`，区分不出模态），所以只能按名字给提示。
 *
 * **诚实边界**：分组是**按名字猜的**，不是权威判定。所以它只影响「排在哪一组、
 * 组标题怎么写」，不隐藏、不禁用任何一个模型——猜错了顶多挪一格，
 * 而隐藏一个能用的模型会直接让人以为这服务不支持它。
 */

export type ModelGroupKind = "chat" | "image" | "video" | "other";

export interface ModelGroup {
  kind: ModelGroupKind;
  label: string;
  items: string[];
}

/** 组标题。措辞一律带「像是」，不把猜测说成事实。 */
export const MODEL_GROUP_LABELS: Record<ModelGroupKind, string> = {
  chat: "对话 / 写作（名字像是）",
  image: "图像（名字像是）",
  video: "视频（名字像是）",
  other: "其它"
};

/** 展示顺序：能用来看稿的那组永远排第一。 */
const GROUP_ORDER: ModelGroupKind[] = ["chat", "image", "video", "other"];

/**
 * 名字里**不含**上面那些通用词、但确实是图像/视频的知名家族。
 * 这是猜名单，不是权威表——加之前先确认真见过这种命名，否则是凭空扩表。
 */
const NAMED_IMAGE_FAMILIES = ["dall-e", "dalle", "midjourney", "stable-diffusion", "sdxl"];
const NAMED_VIDEO_FAMILIES = ["sora", "veo", "kling", "runway"];

/**
 * 按名字猜模态。命中关键词才算，猜不出就归 `chat`——
 * **宁可把图像模型猜成对话，也不要把能用的对话模型误判成图像**：
 * 前者顶多让人试一次，后者可能让人直接不选一个好模型。
 */
export function modelKindOf(name: string): ModelGroupKind {
  const id = name.toLowerCase();
  if (NAMED_IMAGE_FAMILIES.some((family) => id.includes(family))) return "image";
  if (NAMED_VIDEO_FAMILIES.some((family) => id.includes(family))) return "video";
  if (/(^|[^a-z])(image|img|picture|draw|绘图|图像|绘画)([^a-z]|$)/.test(id)) return "image";
  if (/(^|[^a-z])(video|视频)([^a-z]|$)/.test(id)) return "video";
  // vision 是「能看图」而不是「生成图」，与图像生成要分开，不能一锅端。
  if (/(^|[^a-z])vision([^a-z]|$)/.test(id)) return "chat";
  return "chat";
}

/**
 * 把名单分组。组内按原样保留上游顺序（不擅自排序：上游的排列可能带推荐序），
 * 但同名去重——有的 hub 会把同一模型列两遍。
 */
export function groupModels(names: readonly string[]): ModelGroup[] {
  const buckets = new Map<ModelGroupKind, string[]>();
  for (const raw of names) {
    const name = raw.trim();
    if (name === "") continue;
    const kind = modelKindOf(name);
    const bucket = buckets.get(kind);
    if (bucket === undefined) buckets.set(kind, [name]);
    else if (!bucket.includes(name)) bucket.push(name);
  }
  return GROUP_ORDER.filter((kind) => (buckets.get(kind)?.length ?? 0) > 0).map((kind) => ({
    kind,
    label: MODEL_GROUP_LABELS[kind],
    items: buckets.get(kind)!
  }));
}

/** 搜模型名：忽略大小写与首尾空白；空查询等于不过滤。 */
export function filterModels(names: readonly string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (q === "") return names.filter((n) => n.trim() !== "");
  return names.filter((name) => name.toLowerCase().includes(q));
}

/**
 * 名单太长时，列表默认只铺开这么多条，其余滚动。
 * 12 个模型全铺开还行，几百个（有些 hub 就是几百）会把对话框撑到要滚动页面。
 */
export const MODEL_PICKER_LIST_LIMIT = 120;

/**
 * 列表顶部那一条「选中」要滚进视野吗？——用户选了之后列表还在，
 * 看不见自己选的是哪个就等于没选。
 */
export function shouldRevealSelected(
  selected: string,
  visible: readonly string[],
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number
): boolean {
  if (selected === "" || visible.length === 0 || rowHeight <= 0) return false;
  const index = visible.indexOf(selected);
  if (index < 0) return false;
  const top = index * rowHeight;
  const bottom = top + rowHeight;
  return top < scrollTop || bottom > scrollTop + viewportHeight;
}
