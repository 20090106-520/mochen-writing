# 皮肤「全部不一样」＋ 素材扩容（2026-10-17 第五刀 / 第六刀）

## 〇、用户原话（本文档的验收对象）

> 「你那个装扮就只换了图片，其他的没有更改。我要的是全部不一样的，每一个装扮，
> 而且里面图片装扮还有挂件其他东西都太少了。你都可以直接从网上搜索导入到这个里面，
> 开源项目也行，不用自己创建」

拆成三条可验收的：

1. **每一套要整体不一样**——上一版（第四刀）八套的 `glass` 全 `regions`、`surface` 全 `round-none`、
   `grid` 全 `none`，换到哪一套读起来都像「只换了一张画」。⇒ 三层必须**逐套两两不同**。
2. **素材太少**——画面 8 张、挂件 8 枚都要加量。
3. **素材可从网上/开源项目导入**，**不自绘、不自建**（与「不用自己创建」逐字对齐）。

沿用硬约束：不用外国相关图片、不用真人照片；画面用动漫二次元原创插画；不自绘。
许可「不编造」：拿不到再分发授权的就如实写「未获再分发授权」。

---

## 一、波6 · 挂件层（`ornament`）打通

用户第三句「图片装扮还有挂件其他东西都太少了」之前，运行时的视觉只有四层 + `art`，
**没有挂件这一层**。波6 把 `ornament` 作为**与 `art` 并列的第五层**接进来：

- `packages/contracts/src/appearance.ts`：`APPEARANCE_ORNAMENTS` 入枚举（含 `none` 给老 JSON），
  附中文名表 `APPEARANCE_ORNAMENT_LABELS`。
- `appearanceSkinVisual.ts`：`ORNAMENT_FILES` 档名 → `public/skins/ornaments/<id>.svg`，
  出 `--skin-ornament-image` / `--skin-ornament-size`（`min(18vmin, 184px)`）。
- `theme-runtime.css`：`.desktop-shell` 的 `background-image` 叠放顺序**挂件在最上、不被纱压**
  （挂件 → 纱 → 画 → 弥散光），落**右下角**（`right 28px bottom 28px`、`no-repeat`）。
- `appearanceSkinPreview.ts` / `appearanceThemeRuntime.ts`：`visual` 带上 `ornament`；
  `sanitizeEnum(candidate.ornament, APPEARANCE_ORNAMENTS, fallback.ornament)` 补回落。
- `useSkinBrowse.ts`：`SkinBrowseConditions` 加 `ornament`，筛选条加「挂件」一行。
- `appearanceSkinPreview` 与 `appearance-skin-visual.test.ts` 各补一条映射守卫。
- `preload/renderer-api.test.ts`：夹具补必填字段 `ornament: "none"`。

**为什么每套都要有、且两两不同**：挂件是「这套皮肤的一部分」，留空等于回到「只换画」；
两套挂同一枚，卡脚那两行标签又是一样的字。守卫逐条钉 `ornament !== "none"` 且集合去重等于条数。

## 二、波7 · 「全部不一样」＋ 素材扩容

### 1. 三层逐套两两不同

十六套的（`backdrop` 外层不算在内，看 `glass` / `surface` / `grid` 这三层）三元组**两两不同**，
且各层铺满：`glass` 5 档、`surface` 4 档、`grid` 3 档都在用（`appearance-skins.test.ts` 钉住）。
既有八套（第四刀那批）本批**就地拆开**：昼/夜各给一组不同的三元组，不是照抄。

### 2. 画面 8 → 16 张

新增 4 组母图 × 昼夜两版，**只加不换**（老 8 张与它们的 id / 枚举 / 中文名一个字未动——
id 是写进用户盘的值）：

| 母图 | Safebooru | 画师 | 原作 |
| --- | --- | --- | --- |
| `firefly-river` | 7193792 | kate_avery | `x.com/tagsalegirl/status/1527383672197771264` |
| `torii-path` | 7218130 | bamboo23091 | `x.com/bamboo23091/status/2108523586927595926` |
| `valley-cabin` | 6662785 | philipp_urlich | `artstation.com/artwork/lVn5dz` |
| `sakura-stop` | 6305210 | tanamachi_yoshihiro | `twitter.com/0zolvUt2323nYuS/status/1938109245687554269` |

取图口径与第四刀**同一套**（Safebooru `original` 标签 + `no_humans`，全是风景 / 建筑插画，
不是任何游戏 / 番剧角色）；管线仍是**仓外临时件**（`%TEMP%\mochen-skinart2\build-anime2.ps1`，
未入仓，要复跑得重写）。**索引号是回填的**：取图时只落了图，本刀用**源文件 MD5 反查 Safebooru
`md5:` 接口**把 id / 画师 / source 逐条回捞。许可与第四刀同——**未获再分发授权**。

### 3. 挂件 8 → 16 枚

16 枚全部取自开源 emoji 项目 **Twemoji**（`jdecked/twemoji`，**CC-BY 4.0**），经
`fastly.jsdelivr.net` 导入为**仓内矢量 SVG**，与上游**逐字节一致**、本仓无任何重绘。
码位与署名清单见 `docs/ATTRIBUTION.md`「皮肤窗角挂件」一节（码位由源文件 SHA-256 反查上游得到）。
新增的八枚：`book`(1F4D6) / `brush`(1F58C) / `red-envelope`(1F9E7) / `mahjong`(1F004) /
`oil-lamp`(1FA94) / `compass`(1F9ED) / `teacup`(1F375) / `maple`(1F342)。

### 4. 判据与文档同批

- `appearance-theme-readability.test.ts`：昼夜场景 id 清单 8 → 16，逐条仍过可读性（正文 ≥7:1、
  按钮字 ≥4.5:1、accent ≥2.5:1）。**本刀唯一一次真红**：`sakura-stop-night` 的 light.accent
  `#C2568A` 对白字只有 4.21:1 ⇒ 调暗到 `#B24B78`（约 5.04:1）。
- `appearance-skins.test.ts` 加到 872 行、**越过 800 行硬线** ⇒ 按「不共享状态」把**出处与许可**那一段
  拆成新文件 `appearance-skins-license.test.ts`（只读皮肤表与三条本文件自声明的字面量，不碰四层与可读性）。
- `check-scene-art.mjs`：射程 8 张 → 16 张（判据本身仍只有 `G1` 分层 / `G2` 不空，与来源无关）。
- 文档：`README.md`（皮肤广场一段）、`docs/ATTRIBUTION.md`（画面扩容条 + 新开挂件节）、
  `docs/superpowers/specs/2026-10-08-skin-art-asset-spec.md`（§二 / §三 各追加一则就地更正）、
  本文件、台账 `2026-10-09-full-scan-report.md` 第一百二十三节。

---

## 三、门禁与收口

- **像素闸**：`node apps/desktop/scripts/check-scene-art.mjs`（连一台开着 `--remote-debugging-port=9234`
  的实例）⇒ **十六张全过**（`G1` 桶数 4～12、`G2` 跨度 32.9～232）＋ `PASS 反向用例：空渐变判红`，退出码 0。
  `valley-cabin-night` 的 `G1=4` 恰在阈值、属临界通过，照实记。
- **本机 `pnpm verify`**：`VERIFY_EXIT=0`，vitest `Test Files 363 passed (363)` /
  `Tests 4741 passed | 2 skipped (4743)`。
- **CI 与 README「## 门禁」节换绑**：读数由 `4732`（`3175f3d`）变到本刀，**读数变了就得换绑**，
  推送后回填（形状与第一百二十二节一致）。

## 四、明确不做

- **不自绘任何素材**（用户「不用自己创建」）。挂件走开源 Twemoji、画面走 Safebooru。
- **不改已有八套的 id / 枚举 / 三色**——那是用户盘上的值，动一次就是整份退回默认。
- **不搬那两条被排除的上游仓库**（CC BY-NC-SA，仍不进）。
- 挂位只落**右下角**一处；「侧栏底部」那一处在规格单里设想过，本刀**没做**。
