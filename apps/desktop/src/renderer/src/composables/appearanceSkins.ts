/**
 * 皮肤广场的**皮肤表**（2026-10-07 批次 5-㊴ 建，5-㊵ 按上游源码重做，5-㊷ 改成只收带画的）。
 *
 * 【批次号为什么是 ㊷ 而不是 ㊶】
 * 本批落笔时工作区里已有一条**未提交**的 5-㊶（中文输入法组合态，另一条线上正在做的活），
 * 台账里也写了它。同号会让两批人在同一份账上撞车，所以本批顺延为 5-㊷，
 * 并在 `docs/superpowers/plans/README.md` 里按 ㊷ 记账。
 *
 * 【5-㊷ 这一刀切掉了什么，以及为什么】
 * 用户看完 5-㊵ 那一版说：「那 15 套没有画的，给去除。加入能有画的和挂件。」
 * 这一句判的正是 5-㊵ 自己已经承认过的东西——四层全是 **CSS 质地**，
 * 换完了读起来仍然是「换了个色调」；真正被一眼认出来的是 `art` 那一层（整窗插画）。
 * ⇒ 广场上现在只有 `art !== "none"` 的皮肤。被下架的十五条分两处安置：
 *   ⚠️ 下面这三行是 **5-㊷ 的处置记录**，第二刀已经把它推翻（见紧接着的那一段）。
 *   留原文是为了「这条裁定是怎么走到今天的」，但其中两处**照读会读成假话**：
 *   · 十套出厂配色 → `appearanceTones.ts`（**那条文件已经整份删除，现在去读会扑空**）。
 *   · 五套改编皮 → 条目下架，但它们从上游搬来的**数值与出处全留着**
 *     （`appearanceSkinVisual.ts` 的 `UPSTREAM_*` 常量，每条都注着原文件与行号，
 *     对账守卫是 `appearance-skin-visual.test.ts`）。
 *     为什么不一起删：「老用户盘上存着 `glass: "standard"`、`grid: "industrial"` 的，
 *     运行时照样要按上游那一条值渲染」——**这一句在第二刀之后不再成立**（回落会覆写四层）；
 *     仍然成立的是后半句：枚举与数值一删，那些人什么也没点，整份设置却退回默认。
 *
 * 【第二刀：2026-10-08 同日，「下架但不销毁」这个处置被用户推翻】
 * 上一段那条「十套出厂配色搬进 `appearanceTones.ts` 继续当配色底版」的安排，
 * 用户的原话是：**「我没说明白吗，把没有皮肤没有图片的全删了，只保留有图片有皮肤的，
 * 然后再继续增加。」**
 * ⇒ `appearanceTones.ts` **整份删除**，连它派生的 `themePresets`（「主题配色」那一族投影）
 *   一起退役——那一族到当时为止仍然只有守卫在读，界面上没有一处入口，
 *   留着它只等于把「用户不要的那十套」换个名字继续摆在代码里。
 * ⇒ 五套改编皮那一半：**条目维持不在表里**，而上一段给这个安排的理由已经跟着第二刀变了，
 *   别照原文信它。原来写的是「它们的数值仍被老 JSON 消费，删掉就是改别人的界面」——
 *   那是 5-㊷ 的世界：那时只把条目从广场摘掉，盘上的 `glass: "standard"`、`grid: "industrial"`
 *   还会照原值刷上屏幕。第二刀的回落（见下面那条 `reconcileStoredSkin`）会把
 *   **四层连同一组三色整份覆写**成广场第一套，那些老层取值从此不再上屏。
 *   ⇒ 所以枚举与数值表留下来的**真实理由只剩一条**：过不了 zod 就整份退默认
 *     （`appearance-store.test.ts` 钉着「内容过不了 zod ⇒ 退默认值」），
 *     那些人什么也没点，却连「你原来那套已经删除」这句都听不到。
 *     这条理由由 `appearance-skins.test.ts` 的「老层取值仍解析得动」钉住；
 *     而它**不再是一句用户可以看见的话**——广场那段说明原先写着「运行时还得按原值渲染」，
 *     第二刀之后那是假话，已经删掉了。
 *   ⇒ 另外，上游那批档名里 `aurora` 是**活着的一条**：昼阁（`xi-day`）的背景层直接复用了它，
 *     所以那张表并不是纯粹的历史包袱。
 * ⇒ 老盘上存着已删除 id 的，由 `appearanceSkinPreview.reconcileStoredSkin` 在**读盘时**
 *   回落成 `defaultAppearanceSkin`（= 广场第一套），并把原 id 交给界面说实话；
 *   回落只改内存里那份，**不写盘**（把别人的文件改了是另一件事，要用户点一次才算）。
 *
 * 【5-㊴ 那一版为什么被用户否掉】
 * 那一版把上游的视觉语言**概括成四个离散档**（texture/radius/outline/glow 各三四档），
 * 等于自己发明了一套目录。用户看完说「跟他的那些不一样」——
 * 对的，因为丢的正是上游真正在做的事：
 *   · 端场的玻璃是 `blur 8 / 14 / 22px` **三档连续值**，还配 sheen 渐变与 accent 色的角落光
 *     （src/styles/theme.css:380-400）
 *   · 壁纸引擎的玻璃**分区域给参数**：侧栏 / 内容 / 设置窗 / 浮层 各有自己的 alpha 与 blur
 *     （lib/glass-presets/factory-*.json）
 *   · 梦境的背景是**四层 radial-gradient 逐条叠出来的弥散光**，每套都有各自的半径与落点
 *     （tests/fixtures/legacy_skin_glows_10_6_0.json）
 *   · 端场的图案是 `repeating-linear-gradient(0deg, rgba(255,255,255,.014) 0 1px, transparent 1px 4px)`
 *     叠一条 120px 间距的竖线（src/styles/theme.css:1669-1671）
 * 「四档离散值」表达不了上面任何一条。
 *
 * 【做法：数值从上游源码搬，不自己发明】
 * 每条皮肤上标注了**搬的是哪个文件的哪一段**，值本身逐字来自上游源码，
 * 只有「怎么落到墨宸 token 上」是墨宸自己的适配。取值由
 * `appearanceSkinVisual.ts` 里的 `UPSTREAM_*` 常量读出，那儿每条都有出处注释。
 *
 * 【改编自哪些上游，以及为什么是「改编」而不是「搬」】
 * 上游都是 DeepSeek Harness 的插件（`client.js` + Cordis），
 * 依赖 DSH 自己的 `--dsw-*` 令牌与 DOM 结构，在墨宸里**根本跑不起来**。
 * 所以搬的是它们的**视觉算法与参数**，重新实现成墨宸的 token：
 *   d-dev0101/open-sea-skin          公海皮    MIT
 *   RevolutionLA/dsh-dream-skin      梦境皮肤  MIT
 *   ymh0000123/dsh-theme-endfield    终末地    MIT（仅代码；视觉语言版权归鹰角）
 *   Ayase34/gal-view                 galgame   MIT
 *   elysia395/dsh-wallpaper-engine   壁纸引擎  MIT
 *
 * 【两条上游美术的许可结论，以及 5-㊷ 收到的裁定】
 * ① Small-tailqwq/dsh-deep-whale（鲸鱼娘，★2436）：仓库根 LICENSE 写明
 *    「Artwork … excluded from MIT」，美术按 CC BY-NC-SA 4.0、**禁止商业性使用**。
 * ② GGBond2424648901/deep-whale-day-night-theme：整仓 **CC BY-NC-SA 4.0**（不是 MIT），
 *    连代码都不在 MIT 范围内。
 * 这两条不是「没找到」，是核实过许可才暂缓的。
 * 原先这里写过一句「墨宸是能卖钱的写作软件，所以它的插画与壁纸一律不进来」——
 * 那句「要卖」是上一批**我编的**前提，用户 2026-10-08 明确否认过，已删。
 * ⇒ **5-㊷ 裁定到了**：同日问用户「新皮肤的插画素材从哪来」，他选的是
 *   「全部自绘 + 我自己提供图」，**没有选**「把那两套上游美术搬进来」。
 *   所以这两条继续不进表，理由从「等裁定」换成「裁定是走自绘与用户自有图」。
 *   `appearance-skins.test.ts` 里那条「被排除的两个非商用仓库不许出现」因此继续成立，不删。
 */
import {
  APPEARANCE_ARTS,
  APPEARANCE_BACKDROPS,
  APPEARANCE_GLASSES,
  APPEARANCE_GRIDS,
  APPEARANCE_SURFACES,
  type AppearanceArt,
  type AppearanceBackdrop,
  type AppearanceGlass,
  type AppearanceGrid,
  type AppearanceSurface
} from "@mochen/contracts";
/* 2026-10-08 第二刀：`appearanceTones.ts`（十套素面配色底版）整份删除，
   于是这里只剩皮肤表自己。**三色的形状类型 `SkinTone` 搬进本文件**——
   它本来就是「一套配色的三色」，此前住在那份底版表里只是因为十条素面皮住在那儿。
   `OWN_SKIN_ORIGIN` / `OWN_SKIN_LICENSE` 那两句一起消失：它们说的是「出厂素面配色」，
   而那一族已经不存在了。留着两句没人引用的字符串，等于给下一个来人留一条回头路。 */

/** 一套配色底的三色：强调色、底色、前景色。`AppearanceSkin.light / dark` 各是一份。 */
export interface SkinTone {
  accent: string;
  background: string;
  foreground: string;
}

/**
 * 一条皮肤。`backdrop / glass / surface / grid` 四层质感 + `art` 一层画面，
 * 与 `AppearanceThemeConfig` 上同名的五个字段一一对应（铁律 6：名字不许分家）。
 *
 * **四层与一层不是一回事**（2026-10-08 记）：四层全是 CSS 质地，
 * 换完读起来仍然只是「换了个色调」——用户看皮肤广场时说的就是这一句。
 * `art` 才是被一眼认出来的那层：整窗插画。
 */
export interface AppearanceSkin {
  id: string;
  label: string;
  /** 一句话说清这套皮肤的气质——皮肤广场卡片上那一行。 */
  tagline: string;
  /** 灵感出处。写法与技能市场的 `UPSTREAM` 同一口径：`改编自 <owner>/<repo> 的 <那一套>`。 */
  origin: string;
  /** 许可。代码类上游一律 MIT；被排除的那两条在文件头说明，不在这里出现。 */
  license: string;
  light: SkinTone;
  dark: SkinTone;
  backdrop: AppearanceBackdrop;
  glass: AppearanceGlass;
  surface: AppearanceSurface;
  grid: AppearanceGrid;
  /**
   * 整窗画面。**广场的入场条件就是它不为 `"none"`**（5-㊷）。
   *
   * 这条判据由守卫直接钉在表上（逐条 `art !== "none"`）——因为它一旦松动，
   * 广场就悄悄退回「一堆只改颜色的卡片」，而那正是用户连着两次否掉的东西，
   * 第二次还专门说了「给去除」。
   */
  art: AppearanceArt;
}

/* ── 五层的取值表 ────────────────────────────────────────────────────────
   全部取自 contracts 的枚举，不在这里另写一份字面量——
   加一档时这张表会自己跟着长（铁律 6）。 */

/**
 * 墨宸**原创画面**的出处标记，也是广场里唯一允许出现的出处。
 *
 * 【为什么曾经有两句「自有」】
 * 5-㊷ 之前素面配色也在广场里，那时「墨宸自有」分成两族：只有三色的出厂配色
 * 与带整窗画面的原创皮，出处各一句（`OWN_SKIN_ORIGIN` / `OWN_ART_ORIGIN`）。
 * 给「汐」系列用过同一句出处的后果是真机红过一次：那一族投影（`themePresets`）
 * 按出处字符串筛，两条带画的皮被投影了进去，10 条变 12 条。
 *
 * 第二刀之后出厂配色那一族整个删掉，**广场上只剩这一句**。
 * 所以这里不再留第二个名字，而 `appearance-skins.test.ts` 把「出处只能是这一句」
 * 直接钉在表上——将来往里加第二种归属（例如又搬一条上游）时，
 * 要同时改这条守卫，而不是悄悄多出一句没人对照的字符串。
 */
export const OWN_ART_ORIGIN = "墨宸原创画面";
export const OWN_ART_LICENSE = "本仓自有";

/**
 * 皮肤广场的全表：**只有带整窗画面的皮肤才进这里**。
 *
 * **顺序就是页面上的顺序**，同系列昼夜成对排（浅色版在前、深色版在后）——
 * 广场卡片按当前明暗渲染预览，同系列挨着才比得出「同一间阁子的白天与夜里」。
 */
export const appearanceSkins: AppearanceSkin[] = [
  /* ── 墨宸自有的「汐」系列（2026-10-08，批次 5-㊵） ──────────────────────
     【这一批为什么存在】
     用户看皮肤广场后说：「我想要的是 DSH 那个趣味换装一样的皮肤，
     而不是只改颜色和字体。」前五条改编皮搬的全是**参数**——玻璃 blur、网格间距、
     弥散光的 alpha。搬得再准，它仍然是 CSS 质地，读起来就是「换了个色调」。
     DSH 那边真正被一眼认出来的是**画**：整窗手绘场景 + 两侧立绘
     （原版 `Small-tailqwq/dsh-deep-whale` 的 `maid-atelier` 一套就带二十多个素材件）。
     ⇒ 这一批给皮肤表加了 `art`（位图），并且**画是墨宸自己设计的**。

     【概念：深渊 × 鲸鱼 × 深海写作阁】
     沉在海底的一间藏书室，两位蓝发鲸耳的姑娘——
     左侧那位站着递卷轴，右侧那位伏在书案前用羽毛笔写稿。
     道具全是**稿子**（卷轴、稿纸、羽毛笔、墨水瓶），不是代码：
     这一条就是「按我的软件设计」与「按那套工具软件设计」的分界。
     中间整片留空，是墨宸三栏（导航 / 对话 / 右栏）要落的位置——
     生图时就把这条写进了 prompt，否则立绘会被面板压掉。

     【为什么两张而不是一张】
     DSH 那套是 `day-night` 主题。昼与夜本来就是这套皮肤的一半，
     顺带把「同一套皮肤要配深浅两版」的老规矩也一并解决了：
     浅色版 = 浅海透光，深色版 = 深蓝压暗，同一套构图。

     【许可：本仓自有】
     画是原创设计，不搬任何上游的美术，
     所以 `origin` 走自家那一句、`license` 写「本仓自有」。 */

  {
    id: "xi-day",
    label: "汐 · 昼阁",
    tagline: "浅海透光的同一间阁子。与夜阁同一套构图，白天看着像晒着太阳的书房。",
    origin: OWN_ART_ORIGIN,
    license: OWN_ART_LICENSE,
    /* 浅色版 accent 取 #2A7699 而不是画里那块亮蓝（#2E7FA8）：
       它与白字只有 4.45:1，压在按钮上差一口气不到 4.5:1，
       而按钮上那行字的可读性是由计算说了算的（appearance-theme-readability.test.ts）。 */
    light: { accent: "#2A7699", background: "#E8F6FA", foreground: "#123243" },
    dark: { accent: "#57B7D6", background: "#0E2430", foreground: "#DCF1F8" },
    backdrop: "aurora",
    glass: "regions",
    surface: "round-none",
    grid: "none",
    art: "shallow-hall-day"
  },

  {
    id: "xi-night",
    label: "汐 · 夜阁",
    tagline: "深蓝压暗的海底藏书阁。两位鲸耳姑娘守着稿子，中间整片留给正文。",
    origin: OWN_ART_ORIGIN,
    license: OWN_ART_LICENSE,
    /* 「夜阁」的**浅色版底色本来就是深蓝**（那是一套画在夜里的皮肤）。
       所以画上面那层纱不能按当前是浅色还是深色模式给，要按这条皮肤自己的底色给——
       判据写在 `appearanceSkinVisual.ts` 的 `artVeil` 上，别再改回按 scheme 分支。 */
    light: { accent: "#4FA8C4", background: "#0B1A26", foreground: "#DCEEF5" },
    dark: { accent: "#5FD3EE", background: "#060F18", foreground: "#D6ECF5" },
    backdrop: "abyss",
    glass: "regions",
    surface: "round-none",
    grid: "none",
    art: "abyss-hall-night"
  },

  /* ── 波2a：三系列 × 昼夜（2026-10-08，素材通路断位图之后的矢量自绘） ─────
     【这一批为什么存在，以及为什么不是「换皮」】
     用户的原话是「只保留有图片有皮肤的，**然后再继续增加**」。增加的那一步卡在素材上：
     ImageGen 三次复测 403（配额），他答应的那批图也还没交。停在这里就等于
     把一句明确的指令交回给他排队——所以这一批改走**矢量场景画**：
     每张仍然是一整幅画（有主体、有光源、有左右两缘的叙事件、中间整片留给正文），
     只是笔从位图换成了路径。
     ⇒ 判据没变：广场的入场条件仍是「有画」，`art` 为 `none` 仍然进不来；
     ⇒ 规格没降：构图硬规则（中间暗区、上下 12% 不放关键元素、昼夜同一套几何）
       由 `apps/desktop/scripts/gen-scene-svgs.mjs` 按
       `docs/superpowers/specs/2026-10-08-skin-art-asset-spec.md` §2 逐条实现，
       单张 11.6–26.1KB，仍远低于那 900KB 的上限；
       而且是**两道闸自己盯着**：调色板级（主体↔中段感知亮度差 ≥22，生成时直接抛）
       + 像素级（320×180 光栅化后量分层桶数 / 两缘跨度 / 中段安静度，
       `apps/desktop/scripts/check-scene-art.mjs`，附一条"空渐变必须判红"的反向用例）；
     ⇒ 一处诚实账：**这一批没有人物立绘**。矢量画得出海、舟、灯、阁，
       画不出「蓝发鲸耳的汐」那种角色插画。所以名字里不再挂「汐」，
       等位图素材到手再出真正带人物的那一族。

     【2026-10-17 波2 更正（同一批 id，换了笔）】
     上面这段「改走矢量场景画」的账**已经过期**：配额恢复、出图通路打通，
     这六张已**逐张换成原创位图**（`.svg` → `.webp`，id 与皮肤表一处未动）。
     原文保留，因为它记的是那一批当时的真实原因（ImageGen 403、外部位图通路断着）。
     位图这一版的做法与三道闸读数见
     `docs/superpowers/plans/2026-10-17-skin-art-and-pane-toggle.md` 波2。
     `gen-scene-svgs.mjs` 与 `check-scene-art.mjs` 的分工没变：前者是**源头**那道
     （只服务波2a 那批矢量，已随 `.svg` 一并退役），后者是**终点**那道，与格式无关。
     ⚠️ 【2026-10-17 波2 就地更正】上一行括号里那句「已随 `.svg` 一并退役」**不成立**：
     `gen-scene-svgs.mjs` **本体仍在仓内**，且被 `apps/desktop/package.json` 的
     `gen:scene-svgs` 脚本、`README.md`、`tools/readme-claims.test.mjs`、
     `.archcore/architecture/entry-points.doc.md` 引用。真正退役的是它**产出的那六个 `.svg`**
     （已从 `public/skins/` 删除，`ART_FILES` 也不再指向它们）。这一波的落点写的是
     「删掉六个 `.svg`」，**生成器没删**——照 `docs/ATTRIBUTION.md` 那条同批更正读。

     【backdrop 为什么不跟着画换档】
     画是**不透明整幅**，而 `.desktop-shell` 那条 `background-image` 的顺序是
     纱在上、画在中、backdrop 在下 ⇒ 除非画没加载出来，`nebula / ember / midnight`
     换上去一个像素都看不见。所以这一批仍按「昼 aurora / 夜 abyss」给，
     **不为了让 contracts 每一档都有皮肤在用而分散铺**——
     拿看不见的差别当理由是假的，而 `appearance-skins.test.ts` 那条
     「这些上游档名没有皮肤在用」的断言也因此继续成立，不用为了加皮肤而改口。

     【为什么三色按画自己的底色定，而不是挑好看的颜色】
     每条皮肤的 `light/dark` 底色与对应那张画的 `top/mid/bottom` 同源
     （生成器里那份 PALETTES 与本表逐条对着写）。画与配色各说各话的时候，
     观感就是「一张不相干的壁纸压在别的颜色上」——这一批从源头把它锁在一起。 */

  {
    id: "voyage-day",
    label: "书舟 · 昼渡",
    tagline: "浅海里一叶装满稿纸的小舟，船头挂着灯。左侧是鲸背，中间整片留给正文。",
    origin: OWN_ART_ORIGIN,
    license: OWN_ART_LICENSE,
    light: { accent: "#256C86", background: "#EAF7FB", foreground: "#0F2E3E" },
    dark: { accent: "#5CC0DE", background: "#0B2233", foreground: "#D8EEF7" },
    backdrop: "aurora",
    glass: "regions",
    surface: "round-none",
    grid: "none",
    art: "book-boat-day"
  },

  {
    id: "voyage-night",
    label: "书舟 · 夜航",
    tagline: "同一叶舟，夜里只靠船头那盏灯。鲸的剪影退到左边，中段是空旷的水。",
    origin: OWN_ART_ORIGIN,
    license: OWN_ART_LICENSE,
    /* 夜景套的浅色版底色本来就该是夜（这条规则来自「汐 · 夜阁」那次纠正）：
       判据在 appearance-theme-readability.test.ts 的 NIGHT_SCENE_IDS，别把它调亮。 */
    light: { accent: "#4C9DBA", background: "#0A2130", foreground: "#D9EDF6" },
    dark: { accent: "#63CDE8", background: "#060F18", foreground: "#D2E9F4" },
    backdrop: "abyss",
    glass: "regions",
    surface: "round-none",
    grid: "none",
    art: "book-boat-night"
  },

  {
    id: "lamp-day",
    label: "灯楼 · 晴昼",
    tagline: "灯塔里的螺旋书架晒着白天的光。书格在左，摊开的稿纸与墨瓶在右下，中段留空。",
    origin: OWN_ART_ORIGIN,
    license: OWN_ART_LICENSE,
    light: { accent: "#9A6A1E", background: "#FAF4E6", foreground: "#2C2415" },
    dark: { accent: "#D9A64E", background: "#171208", foreground: "#F2E6CC" },
    backdrop: "aurora",
    glass: "regions",
    surface: "round-none",
    grid: "none",
    art: "lamp-tower-day"
  },

  {
    id: "lamp-night",
    label: "灯楼 · 燃夜",
    tagline: "同一座楼，只剩灯束斜着穿下来。左缘一层层书格退远，稿纸压在灯下的角落里。",
    origin: OWN_ART_ORIGIN,
    license: OWN_ART_LICENSE,
    light: { accent: "#D9B072", background: "#16273F", foreground: "#E9E1CE" },
    dark: { accent: "#F0C578", background: "#0A1220", foreground: "#EDE4D2" },
    backdrop: "abyss",
    glass: "regions",
    surface: "round-none",
    grid: "none",
    art: "lamp-tower-night"
  },

  {
    id: "pool-day",
    label: "墨潭 · 映日",
    tagline: "山间书亭晒着天光，潭面把光映成一段不成句的白。亭在左，雾在右，潭心留给正文。",
    origin: OWN_ART_ORIGIN,
    license: OWN_ART_LICENSE,
    light: { accent: "#25736E", background: "#EAF6F1", foreground: "#10302F" },
    dark: { accent: "#4FB3AA", background: "#0C2321", foreground: "#DFF2EC" },
    backdrop: "aurora",
    glass: "regions",
    surface: "round-none",
    grid: "none",
    art: "ink-pool-day"
  },

  {
    id: "pool-night",
    label: "墨潭 · 沉雾",
    tagline: "同一口潭起了夜雾。岸线只剩两道边，水纹在左右两角，中间整片是沉下去的墨色。",
    origin: OWN_ART_ORIGIN,
    license: OWN_ART_LICENSE,
    light: { accent: "#54A7A2", background: "#0A1D22", foreground: "#D6EDE8" },
    dark: { accent: "#72D2CB", background: "#050E12", foreground: "#CFEAE4" },
    backdrop: "abyss",
    glass: "regions",
    surface: "round-none",
    grid: "none",
    art: "ink-pool-night"
  }
];

/**
 * 按 id 取一套皮肤。取不到返回 undefined（调用方自己决定退路，不在这里兜底成某一套）。
 *
 * 第二刀之后「取不到」**只剩一种含义**：盘上存的那一套已经被删掉了
 * （十套素面配色、五套改编皮条目，或一个从没存在过的 id）。
 * 退路只有一份实现：`appearanceSkinPreview.reconcileStoredSkin`（读盘时回落）。
 * 原先这里还有第二档「到 `appearanceTones` 去查，查到了说『下架但配色还在』」，
 * 那一档随那份表一起删了——**别再把它加回来**。
 */
export function findAppearanceSkin(id: string): AppearanceSkin | undefined {
  return appearanceSkins.find((skin) => skin.id === id);
}

/**
 * 回落与出厂默认都指向这一套：**广场的第一套**。
 *
 * 【为什么不写死 `"xi-day"` 这个字符串】
 * 写死就出现「表里第一套」与「代码里点名的那一套」两份真相：将来在表头插进一套新皮肤，
 * 广场顺序变了而回落还指着旧的那一套，而两边都不报错。
 * 取 `appearanceSkins[0]` 之后，「继续增加带画皮肤」这件事只改表，
 * 出厂默认、回落、以及 contracts 那份对照会由守卫逼着一起改。
 *
 * 【它与 contracts 的关系】
 * contracts 拿不到本文件（依赖方向 contracts ← renderer），所以那边另写了一份同值的默认值，
 * 对照由 `appearance-skins.test.ts` 的「出厂默认」那一组逐字段钉住。
 */
/* 表是 `as const` 写死的数据，空了就是源码写坏了；这里选择**当场抛错**而不是兜底成某个假对象，
   与本仓 `anchorSkin()`（预览/换上守卫）同一个口径：静默退化成「另一套」比红更难查。 */
const [firstSkin] = appearanceSkins;
if (firstSkin === undefined) {
  throw new Error("皮肤广场是空的：没有可当出厂默认与回落点的皮肤");
}
export const defaultAppearanceSkin: AppearanceSkin = firstSkin;

/* ── 筛选档：从**表里真实存在的值**派生 ─────────────────────────────────
   2026-10-08 批次 5-㊷ 改的这条，起因是一个真缺陷。

   【原来错在哪】
   这里原先写的是 `= APPEARANCE_BACKDROPS`（contracts 的全量枚举），
   而 `nebula / ember / midnight` 三档**没有任何皮肤在用**——
   点它必然得到空列表，页面老老实实显示「没有匹配的皮肤」。
   那句话是假象：真相是那枚按钮从一开始就不该在那里。

   ⇒ 判据换成「这一档至少有一条皮肤在用，才摆出来」；
     顺序仍按 contracts 枚举的键序（加一档时 contracts 与中文名表都要改，
     而按钮顺序跟着枚举走，不多一处要人记的地方）。
   ⇒ 守卫钉两件事：每个筛选档都能筛出**非空**结果；这五张表**必须是派生的**，
     不许写死成 contracts 的全量（appearance-skins.test.ts）。
   ⇒ contracts 的枚举与下面的中文名表**仍然是全量**：老 JSON 里存着未入档的合法值时，
     zod 要认、档名要查得到，只是广场不提供它。 */

/** 表里出现过哪些值就只留哪些档；顺序取 `all`（= contracts 枚举）的键序。 */
function usedValues<T extends string>(
  all: readonly T[],
  pick: (skin: AppearanceSkin) => T
): readonly T[] {
  const present = new Set<string>(appearanceSkins.map(pick));
  return all.filter((value) => present.has(value));
}

export const SKIN_BACKDROP_FILTERS: readonly AppearanceBackdrop[] = usedValues(
  APPEARANCE_BACKDROPS,
  (skin) => skin.backdrop
);
export const SKIN_GLASS_FILTERS: readonly AppearanceGlass[] = usedValues(
  APPEARANCE_GLASSES,
  (skin) => skin.glass
);
export const SKIN_SURFACE_FILTERS: readonly AppearanceSurface[] = usedValues(
  APPEARANCE_SURFACES,
  (skin) => skin.surface
);
export const SKIN_GRID_FILTERS: readonly AppearanceGrid[] = usedValues(
  APPEARANCE_GRIDS,
  (skin) => skin.grid
);
/** 画面层这一维在 5-㊷ 之后只剩「有画」那几档：表里不许出现 `art: "none"` 的条目，
 *  所以这张表里要冒出 `none`，就等于上面的表写错了（守卫逐条钉 `art !== "none"`）。 */
export const SKIN_ART_FILTERS: readonly AppearanceArt[] = usedValues(
  APPEARANCE_ARTS,
  (skin) => skin.art
);

/* ── 中文档名 ────────────────────────────────────────────────────────────
   筛选按钮上摆的是这几个词。**真身在这一份**，皮肤广场的模板只 v-for 引用，
   不在模板里写第二遍（写了就会有一处改了另一处没改）。
   键集必须与 contracts 的枚举**一一对应**（守卫钉着）：这里给的是「这一档叫什么」，
   不是「广场上有哪几档」——后者是上面那五张派生表的事。 */

export const APPEARANCE_BACKDROP_LABELS: Record<AppearanceBackdrop, string> = {
  plain: "平涂",
  abyss: "深渊光",
  aurora: "弥散光",
  nebula: "星云光",
  ember: "余烬光",
  midnight: "午夜光"
};

export const APPEARANCE_GLASS_LABELS: Record<AppearanceGlass, string> = {
  none: "无玻璃",
  subtle: "轻磨砂",
  standard: "磨砂",
  strong: "厚玻璃",
  regions: "分区域"
};

export const APPEARANCE_SURFACE_LABELS: Record<AppearanceSurface, string> = {
  plain: "常规",
  square: "全直角",
  "round-none": "胶囊圆角",
  dialogue: "对话框"
};

export const APPEARANCE_GRID_LABELS: Record<AppearanceGrid, string> = {
  none: "无网格",
  industrial: "工业网格",
  stage: "舞台网格"
};

/** 画面层的中文档名。`none` 这一档写「无画面」而不是「无插画」——
 *  它挡掉的是**整窗背景位图**，而 backdrop 那层 CSS 弥散光不受它影响。 */
export const APPEARANCE_ART_LABELS: Record<AppearanceArt, string> = {
  none: "无画面",
  "abyss-hall-night": "深海夜阁",
  "shallow-hall-day": "浅海昼阁",
  "book-boat-night": "书舟夜航",
  "book-boat-day": "书舟昼渡",
  "lamp-tower-night": "灯楼燃夜",
  "lamp-tower-day": "灯楼晴昼",
  "ink-pool-night": "墨潭沉雾",
  "ink-pool-day": "墨潭映日"
};
