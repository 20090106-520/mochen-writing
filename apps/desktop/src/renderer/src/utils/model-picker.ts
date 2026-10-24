/**
 * 「填模型」那格的判定：名单怎么筛、怎么搜、怎么分「正在用」那一段。
 *
 * **为什么要有这一层**：名单是从 `{baseURL}/models` 拿的，形如
 * `["agnes-2.5-pro","agnes-image-2.1-flash","agnes-video-2.5",…]`——
 * 图像与视频模型和对话模型**平铺在同一列**，用户得自己认名字挑。
 * 而这些名字里没有任何类型字段可依（`/models` 回的只有
 * `id / object / created / owned_by / supported_endpoint_types`，
 * 后者一律是 `["openai"]`，区分不出模态），所以只能按名字给提示。
 *
 * 【2026-10-25 用户裁定：这是写小说的软件，模型选择器里只该有能写的模型】
 * 墨宸是**写作**软件，图像/视频模型在这里没有任何用途——它们既不生成图也不生成视频，
 * 选上去只会让下一句话被上游 400 顶回来（§167 真机事故：`agnes-image-2.1-flash` 就是这么来的）。
 * ⇒ **只列写作模型**，图像/视频一行都不画。
 * 这比 §167 当时的「分组 + 行尾标记」更彻底：标记只是提醒，藏掉才是根治。
 *
 * **诚实边界（这一刀唯一的代价，写在这里不藏着）**：判据是**按名字猜**的，
 * 而「只列写作模型」意味着**猜错就等于藏了一个能用的模型**。
 * ⇒ 猜的规矩是**宁可多列一个不能写的，也不要藏掉一个能写的**：
 * `modelKindOf` 猜不出的一律算写作（对话模型），危险的方向只剩「把能用的说成不能写」。
 * 这条判断与 §167 那条「不隐藏任何一个模型」并不矛盾——**用途不同**：
 * 那天是「标记出来让人别点错」，今天用户直接说「我这是写小说的，别的别给我看」。
 */

/** 模态种类：只有「能用来写」与「不能拿来写」两类（`other` 那一档是死的，已撤）。 */
export type ModelKind = "chat" | "image" | "video";

/**
 * 名字里**不含**上面那些通用词、但确实是图像/视频的知名家族。
 * 这是猜名单，不是权威表——加之前先确认真见过这种命名，否则是凭空扩表。
 */
const NAMED_IMAGE_FAMILIES = ["dall-e", "dalle", "midjourney", "stable-diffusion", "sdxl"];
const NAMED_VIDEO_FAMILIES = ["sora", "veo", "kling", "runway"];

/**
 * **名字里带「video」却是对话模型的家族**（先于视频判据查）。
 *
 * 为什么单开一张表：这两族是「能看视频」的对话模型，不是生成视频的。
 * 若让它们落进视频那一档，就会被 `writableModels` **藏掉**——
 * 而藏掉一个能用的模型正是上面「诚实边界」里说的**危险方向**
 * （能用的说成不能用，用户从此选不到它）。
 * ⇒ 名字见过才加：`video-llama` 与 `video-llava` 都是真有的对话/看视频模型。
 */
const NAMED_CHAT_FAMILIES = ["video-llama", "video-llava"];

/**
 * 按名字猜模态。命中关键词才算，猜不出就归 `chat`——
 * **宁可把图像模型猜成对话，也不要把能用的对话模型误判成图像**：
 * 前者顶多让人试一次，后者可能让人直接不选一个好模型。
 * （今天更进了一步：猜成「不能写」的那一枚会**从名单里消失**，
 *   所以这个默认值必须是「算能写」——见文件头「诚实边界」那一段。）
 */
export function modelKindOf(name: string): ModelKind {
  const id = name.toLowerCase();
  if (NAMED_CHAT_FAMILIES.some((family) => id.includes(family))) return "chat";
  if (NAMED_IMAGE_FAMILIES.some((family) => id.includes(family))) return "image";
  if (NAMED_VIDEO_FAMILIES.some((family) => id.includes(family))) return "video";
  if (/(^|[^a-z])(image|img|picture|draw|绘图|图像|绘画)([^a-z]|$)/.test(id)) return "image";
  if (/(^|[^a-z])(video|视频)([^a-z]|$)/.test(id)) return "video";
  // vision 是「能看图」而不是「生成图」，与图像生成要分开，不能一锅端。
  if (/(^|[^a-z])vision([^a-z]|$)/.test(id)) return "chat";
  return "chat";
}

/**
 * 这一枚能不能用来写这一轮对话（2026-10-25 用户裁定的那条判据）。
 *
 * 界面各处只引它，不自己判「是不是图像模型」——
 * 那是**判据**（决定什么能出现在名单里），不是样式，判据只有一份（铁律 6）。
 */
export function isWritableModel(name: string): boolean {
  return modelKindOf(name) === "chat";
}

/**
 * 名单里只留能用来写这一轮的模型；**同名只留一个**（有些 hub 会把同一模型列两遍）。
 *
 * 去重也放在这里：「造名单」只有这一处（搜索过滤 `filterModels` 只在这份名单上跑），
 * 放到过滤那一层就变成「搜的时候才去重」——搜之前那份名单仍是重的。
 */
export function writableModels(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const name of names) {
    // 空串丢掉（上游偶尔给占位项）：它既不是能写的模型，也不是一个名字。
    if (name.trim() === "") continue;
    if (!isWritableModel(name)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    kept.push(name);
  }
  return kept;
}

/**
 * 「图像 / 视频模型写不了对话」这句事实（只此一份，2026-10-25）。
 *
 * 界面各处要说的是**同一件事**：模型选择器空态、设置页的模型名单，各写一遍
 * 早晚会走偏（一个说「写不了对话」、一个说「不能用来写」）。⇒ 收成一句，
 * 两处都引它。
 */
export const MODEL_WRITABLE_ONLY_NOTE = "图像 / 视频模型写不了对话。";

/**
 * 行尾那枚模态标记的文案（对话模型不标——那是默认）。
 *
 * 【收口】原先这个映射在两处各写一遍：对话框的 `ModelSelect.vue`
 * 与设置页的 `ProviderSettings.vue`，两处都手写 `kind === "image" ? "图像" : …`。
 * 两份字面量迟早会走偏（改一处忘了另一处），而它**是判据**（标什么）不是样式。
 * ⇒ 收进这一份，两处都引它。
 *
 * **它现在只用在两处**：
 *   ① 设置页的「已存档案」上——那一列是用户自己存过的档案，
 *      里面可能有一条图像模型的档案（存都存了，得让人看见它不能用来写），
 *      而**上游名单**那边已经只留写作模型、不再需要逐行标记了；
 *   ② 模型选择器里「正在用」那一行——当前在用的那一枚**可能不是写作模型**
 *      （手填的模型名，或 §167 那次误切留下的图像模型），标出来是诚实的：
 *      用户一眼能看出「我现在用的这个写不了」。
 */
export function modalityLabelOf(name: string): string {
  const kind = modelKindOf(name);
  if (kind === "image") return "图像";
  if (kind === "video") return "视频";
  return "";
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
 * 下拉里「正在用」那一行与「其余」那一段的切分（2026-10-25）。
 *
 * 【为什么要单独一段「正在用」】原来当前模型**混在名单中间**（真机读数：它在第 4 行），
 * 用户打开面板第一眼看不到「我现在用的是哪个」——列表一长（几十个模型）它还会被挤到
 * 视口外。于是单开一段把它摆到最上面：Cursor / Claude Code 那一类切换器都是这么排的。
 *
 * 【为什么 `showCurrent` 是参数而不是在这里判断】「当前模型算不算这次搜索的结果」
 * 取决于**有没有在搜**（搜着的时候它多半不匹配，就不该占一行），
 * 而「当前模型在不在上游名单里」无关紧要——手填的模型名上游未必列得出来，
 * 但此刻确实在用，所以照样摆出来。这两条分别由调用方与本函数各管一半，
 * 合起来只有这一份判定。
 */
export function splitByCurrentModel(
  names: readonly string[],
  current: string,
  showCurrent: boolean
): { current: string[]; rest: string[] } {
  // 不摆「正在用」那一段时，名单**原样**交出去——一个模型都不许少。
  // （先前这版无条件把 current 从 rest 里剔掉，于是「不摆它」的时候那一枚就凭空消失了：
  //   组件里因为 current 本来就不在过滤后的名单里而没出事，可这份判据本身是藏模型的形状。）
  if (!showCurrent || current === "") return { current: [], rest: [...names] };
  return { current: [current], rest: names.filter((name) => name !== current) };
}
