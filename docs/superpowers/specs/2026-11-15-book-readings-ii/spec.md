# 本书读数第二刀：段落节奏、叙述人称、章尾回声

- 日期：2026-11-15
- 来源：用户原话「看看还有什么地方可以叠加，多打增强，让 AI 写小说更真实。不是 AI，还有以往小说写作套路，
  这些模板。**不要模板，不要套路。要自己的。**」
- 状态：新增三段**生成端动态读数**（与既有十段同类同分工），全部从**这本书自己的已完稿正文**推导；
  不引外部套路清单、不引模板文本、不新增扫描判据、不进任何闸、不编质量阈值。
  唯一的门槛是**样本门槛**（样本不够就不报），不是质量线。

## 一、为什么是这三格

把生成端现有的动态段摊开数过：`bookFlavorSentence`（用滥的词）、`openingsSentence`（章首起手式）、
`dialogueBalanceSentence`（对白占比）、`styleProfileSentence`（句长/标点/对白比/段末收法）、
`voiceSampleSentence`／`dialogueSampleSentence`（原句）、`sentenceOpeningSentence`（句首）、
`senseChannelSentence`（五感）、`castConstraintSentence`（人物卡约束）。

还空着、且**能量得出来**的三格：

1. **每段一样长**：`styleProfileSentence` 报句长，不报段长。AI 文最显眼的骨架味之一是
   「每段都四五行、长度差不多」——不是句子匀，是段落匀。
2. **一章里悄悄换人称**：没有任何一段在读「叙述部分用第几人称」。第三人称的书里忽然整段用「我」
   讲，是最刺眼的一种断裂。
3. **每章同一个收法**：`openingsSentence` 只防章首，章尾没人管。AI 连写多章常把每章都收在
   「总结/感叹」上，与章首套路同源。

这三格都不需要外部知识，只需要这本书自己的正文——正合用户「要自己的」那一条。

## 二、本刀做什么（逐文件、逐函数）

### 2.1 段落节奏读数

`packages/contracts/src/style-profile.ts`（改）：

- 新增常量 `PARAGRAPH_SPREAD_MIN_PARAGRAPHS = 10`，注释写明是**样本门槛**（不足 10 段不报，
  不是「10 段才算好」）。
- `StyleProfile` 新增 `paragraph: { mean: number; spread: number } | null`：
  - `mean` = 非空段落（`trim` 后非空的行）的平均字数（1 位小数）；
  - `spread` = 段长方差的标准差 ÷ 均值（2 位小数，即变异系数）；
  - 段落数 < `PARAGRAPH_SPREAD_MIN_PARAGRAPHS` ⇒ `null`（**不报**，不是报 0）。
- `styleProfileOf` 复用已有的 `paragraphs`（不再另切一遍）。

`apps/desktop/src/main/prompt-assembly.ts`（改）`styleProfileSentence`：

- `paragraph !== null` 时追加一项读数：
  `段落平均 X 字、段长波动 Y（越大越参差；段落全一样长是机器味）`；
- `paragraph === null` 时这一项不出现在句子里（其余读数照旧）。

### 2.2 叙述人称粘性

`packages/contracts/src/dialogue.ts`（改）：

- `scanQuotes` 在**行间**补一次 `visit("\n", false)`（最后一行之后不补）。
  理由：`narrationOf` 要保住行界，而 `scanQuotes` 是唯一允许知道「引号内外」的地方。
  对现有两个消费者行为中性：`dialogueBalance` 对 `\s` 直接 return；`endsInsideQuote` 的入参
  是单行、根本不产生行间回调。
- 新增导出 `narrationOf(text): string`：只收 `inside === false` 的字符（引号字符本身不进回调），
  行间换行保留。供人称统计排除对话。

`packages/contracts/src/narration-person.ts`（新）：

```ts
export interface NarrationPerson {
  /** 叙述（引号外）里的第一人称代词字数：「我」「咱」（含「我们」「咱们」）。 */
  first: number;
  /** 叙述里的第三人称代词字数：「他」「她」「祂」「它」，排除「其他」「其它」。 */
  third: number;
  dominant: "first" | "third" | "tie" | "none";
}

export function narrationPersonOf(contents: readonly string[]): NarrationPerson | null;
```

- 先 `contents.join("\n")` → `narrationOf` → 去掉空白后数字数；
- 叙述非空白字数 < `STYLE_PROFILE_MIN_CHARS`（500）⇒ `null`（样本门槛，复用同一枚常量）；
- `first` 数「我」「咱」；`third` 用 `(?<!其)[他她祂它]` 计数——**人名会替代第三人称代词**，
  所以 `third` 是**下界**，注释里写明；
- `dominant`：两数都 0 ⇒ `"none"`；相等 ⇒ `"tie"`；否则大的一方。

`packages/contracts/src/index.ts`（改）：导出 `./narration-person.js`。

`apps/desktop/src/main/prompt-assembly.ts`（改）新增 `narrationPersonSentence(assembled)`：

- 取**已完稿**正文（复用 `finishedChaptersText`，当前章半截草稿不算，同 §一百四十一）；
- `null` 或 `dominant === "none"` ⇒ 空串（不注入空段）；
- `first === 0 && third > 0` ⇒
  「本书已完稿的叙述里一个『我』都没有（第三人称代词 N 处）：这是第三人称视角，
  新内容别忽然改成『我』来讲——人物说的话里的『我』不算，这里数的是引号外的叙述。」
- `first > 0` 时报告两数并给动作：以第一人称为主 ⇒「保持这个视角，别在同一章里滑成他/她」；
  否则 ⇒「前面各章以第三人称为主，新内容跟着走，别让叙述忽然用『我』开口」。

### 2.3 章尾回声

`packages/contracts/src/book.ts`（改）：

- `DocRef` 新增 `closing?: string;`（注释与 `opening` 同款：scan 顺路、零额外 IO、消费处 `?? ""`）；
- `docRefSchema` 增加 `closing: z.string().optional()`。

`packages/fs-store/src/scan.ts`（改）：

- 新增私有 `closingLineOf(body)`：正文**最后一个** `trim` 非空行原文，没有则 `""`；
- `docMetaOf` 的返回类型与两个返回点都带上 `closing`；
- `docRefOf` 把 `meta.closing` 放进 `DocRef`。

`packages/agent-runtime/src/context.ts`（改）：

- `AssembleContextInput.docs` 元素类型加 `closing?: string`；
- `AssembledContext` 新增 `closings?: string[]`（注释与 `openings` 对称：可选、老夹具按空清单）；
- 装配末尾与 `openings` 同构地算 `closings`：只取 `kind === "chapter"`，`closing ?? ""`，
  过滤空串，`clip(line, CHAPTER_OPENING_CHARS)`（同一枚**展示额度**，不是判据）。

`apps/desktop/src/main/prompt-assembly.ts`（改）新增 `closingsSentence(closings)`：

- 过滤纯标点/符号的行（复用 `SAMPLE_ONLY_MARKS`，如 `***`）后不足 2 条 ⇒ 空串；
- 取最后 5 条，拼成：
  「前面各章的结尾分别是：…。写新内容时**换一种收法**——有的收在动作、有的收在一句没说完的话、
  有的收在一件没接完的物件上；别每章都用同一种收尾（尤其别每章都收在总结或感叹上）。」

`defaultPromptFor`（改）：在 `openingsSentence` 那一条之后按「非空才加」注入，
并在函数顶部与其余动态段并列先算一次。

## 三、取舍（为什么这么切）

- **只摆读数，不判定**：三段都不说「这段太长/这人称错了/这个收尾不好」，只报这本书自己的数
  与「保持/换一种」的动作。没有真人语料分位，任何「多少算病」都是编数。
- **样本门槛不是质量线**：500 字、10 段、2 章，三条都只为「没有样本可拆时不胡说」。
  开书第一轮自然不注入——这与 `openingsSentence`「一章谈不上套路」同一条纪律。
- **人称只数代词、不猜叙事视角**：真正的视角判定要读完整章的叙述距离与信息落差（§一百零五 取舍）；
  代词计数是**代理读数**，所以文案只说「叙述里第一人称出现 N 次」这种可核对的话，
  不写「本书是第一人称小说」这种判决。
- **章尾与章首对称**：同一个 scan 顺路、同一枚展示额度、同一条「少于两章不谈模式」，
  不另立第二套口径（铁律 6）。
- **不复述静态段**：`prompt-craft.ts` 已讲「视角不越界」「段落打散」，三段动态段只报本书数，
  不逐字复述纪律，避免同一句话说三遍反而被模型当套话跳过。
- **不新增文件就不新增文件**：段落读数进现有 `style-profile.ts`；人称是非 Electron 的纯函数、
  且要跨包被 `prompt-assembly` 引用，只能住 `contracts`——`ai-flavor.ts`（798 行）与
  `agent-service.ts`（799 行）都已贴顶，不能塞。

## 四、不变量（机器可判）

1. `paragraph.mean` / `spread` 与按同一份 `paragraphs` 手算逐位相等（1 位 / 2 位小数）；
2. 段落数 9 ⇒ `paragraph === null`；10 ⇒ 非 null；
3. `narrationOf` 的引号内字符一个不漏地排除，行界保留（`\n` 数量与输入一致）；
4. `narrationPersonOf` 对「其他/其它」不计 `third`，「我们/咱们」各计 1 次 `first`；
5. 叙述非空白字数 499 ⇒ `null`；500 ⇒ 非 null；
6. `DocRef.closing` 是该篇正文最后一个非空行的原文；空正文 ⇒ `""`；
7. `closings` 与 `openings` 同长度口径（只含 chapter、过滤空串），每条 ≤ `CHAPTER_OPENING_CHARS`；
8. 三段 sentence 在样本不足/无内容时返回空串，`defaultPromptFor` 不出现空段；
9. `prompt-assembly.ts` 行数 ≤ 800。

## 五、验收

1. 新增/补充用例全过：
   - `packages/contracts/test/style-profile.test.ts`：段落读数与 `null` 门槛；
   - `packages/contracts/test/dialogue.test.ts`：`narrationOf` 排除引号内、保留行界；
   - `packages/contracts/test/narration-person.test.ts`（新）：四类代词、样本门槛、`dominant`；
   - `packages/fs-store/test/scan-excerpt.test.ts`：`closing` 取最后非空行、空正文为空串；
   - `apps/desktop/src/main/prompt-narration-person.test.ts`（新）：三种文案分支、当前章不算、空样本不注入；
   - `apps/desktop/src/main/prompt-closings.test.ts`（新）：不足两章不注入、纯符号过滤、取最后 5 条、换收法叮嘱。
2. `corepack pnpm typecheck` 通过；
3. 相关包 vitest 通过；
4. `corepack pnpm verify` 输出 `VERIFY_EXIT=0`（Prettier / 6 份 tsc / ESLint / 包边界 / 行数预算 / 全量 vitest）。

## 六、本节收不掉的口子（如实）

- **段落长度按 `line.length`**：markdown 记号与缩进也算进段长；本仓产出的章节正文是纯行式段落，
  该偏差可接受，不为此剥记号（那会与 `endsOnQuote` 的段落口径分叉）。
- **人称是代词计数，不是视角判定**：第一人称书里「他/她」也可能多于「我」；文案因此只报数、
  不宣布「本书是什么人称」，并在 `first === 0` 这一最确定的信号上才说重话。
- **章尾取的是「最后一个非空行」**：若作者在章末放了分隔符或作者的话，它会被当成章尾。
  这是 scan 顺路的**原文**，不在这一刀里做语义清洗。
