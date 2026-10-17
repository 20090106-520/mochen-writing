/**
 * 皮肤表的**出处与许可**那一半守卫（2026-10-17 第五刀从 appearance-skins.test.ts 拆出）。
 *
 * 【为什么拆】第六刀往 `appearance-skins.test.ts` 里加了「八套的质感三层两两不同」与
 * 「每一条都必须挂着一枚挂件」两条守卫之后，那份文件到了 872 行，**越过了本仓 800 行的硬线**。
 * 拆的口子按「不共享状态」找：这一份只读 `appearanceSkins` 与三条**本文件自己声明**的字面量
 * （许可值、改编前缀、上游白名单），不碰四层数值、可读性计算、筛选档——那些留在原处。
 *
 * 【为什么这三条字面量也搬过来，不在原文件里 export】
 * 它们是「守卫里另抄的一份」，**刻意不从被测代码 import**（理由见各自注释）：
 * 从被测代码 import 的话，它哪天改了判定，守卫会跟着改然后继续全绿。
 * 而它们在原文件里**只被这一份用例用到**（第五刀核过 12 处引用全在这两段里），
 * 所以整块搬走，不留在原处当一个没人读的常量。
 */
import { describe, expect, it } from "vitest";
import { appearanceSkins } from "./appearanceSkins";

/* 守卫里另写一份这个字面量，**不从被测代码 import**。
   从 appearanceSkins import 的话，它哪天把判定改成第三个值，守卫会跟着改然后继续全绿——
   那不是守卫，是一个会跟着被测对象一起改的摆设（批次 5-㊱ 记过这一族）。
   【2026-10-17 第三刀】值从「本仓自有」换成「Unsplash License」：
   八张画面当天由自绘/自出换成了 Unsplash 上的真人女性人像，许可义务换了家。
   【2026-10-17 第四刀】值再换成「未获再分发授权」：用户否掉了 Unsplash 那批西方人像
   （原话「不要外国的」），八张改为四张 **Pixiv 原创动漫插画 × 昼夜两版**——
   这些画**没有拿到任何再分发授权**，所以如实写「未获再分发授权」而不是含糊过去。
   逐张的作品号 / 画师 / 索引号见 `docs/ATTRIBUTION.md` 的皮肤段。 */
const ANIME_LICENSE_LITERAL = "未获再分发授权";
/** 改编皮出处的固定前缀。**声明在这里，不从 appearanceSkins import**——
 *  出处那句将来可能再拆（2026-10-08 已经从一种自有皮拆到两种），
 *  而守卫要的判据是**形状**（带不带这个前缀），不是某一句具体的话。
 *  刻意不写「必须等于某一句」：那会把「多加一种自有皮」变成一次红。 */
const ADAPTED_PREFIX = "改编自 ";

/* 上游仓库的许可结论（批次 5-㊴ 逐个用 GitHub API 查过 LICENSE 原文）：
     d-dev0101/open-sea-skin          MIT
     RevolutionLA/dsh-dream-skin      MIT
     ymh0000123/dsh-theme-endfield    MIT（仅代码；视觉语言版权归鹰角）
     Ayase34/gal-view                 MIT
     elysia395/dsh-wallpaper-engine   MIT */
const ALLOWED_UPSTREAM_REPOS = [
  "d-dev0101/open-sea-skin",
  "RevolutionLA/dsh-dream-skin",
  "ymh0000123/dsh-theme-endfield",
  "Ayase34/gal-view",
  "elysia395/dsh-wallpaper-engine"
];

describe("皮肤表 · 出处与许可", () => {
  it("画面皮许可是「未获再分发授权」，改编皮是 MIT，且两类互斥且都有归属", () => {
    /* 【为什么判据是「带不带改编前缀」而不是「等于某一句出处」】
       原写法是 `skin.origin === "墨宸出厂配色"`，它把「自有皮」等同于**那一句**。
       加上原创画面皮（出处是另一句）之后，那两条既不等于出厂那一句、
       也不带改编前缀，于是被夹在中间——一条断言要求它们 `license === "MIT"`，
       而它们的许可是「本仓自有」。红的位置离病因很远。

       ⇒ 改成**结构判据**：带「改编自 」前缀的是改编皮，其余都是自有皮。
         这样再加第几种自有皮都不用改守卫，而「两类互斥且都有归属」由下面两条守住。
       ⚠️【2026-10-17 第三刀就地更正】上面那句「它们的许可是【本仓自有】」
       与「其余都是自有皮」里的「自有」二字**已不成立**：画面当天换成 Unsplash 人像，
       许可随之变成「Unsplash License」（就是下面那个 `PHOTO_LICENSE_LITERAL`）。
       **判据的形状一个字没改**——它钉的一直是「带不带改编前缀」这个**结构**，
       这正是当初把它写成结构判据的好处：换一次素材来源不用动判据。
       → **第四刀又验了一次这句话**：素材从 Unsplash 人像换成 Pixiv 动漫插画、
         许可字面量从「Unsplash License」换成「未获再分发授权」，判据仍然一个字没动。 */
    let ownCount = 0;
    let adaptedCount = 0;
    for (const skin of appearanceSkins) {
      if (skin.origin.startsWith(ADAPTED_PREFIX)) {
        adaptedCount += 1;
        expect(skin.license, `${skin.id} 是改编皮（出处「${skin.origin}」），许可却不是 MIT`).toBe(
          "MIT"
        );
      } else {
        ownCount += 1;
        expect(
          skin.license,
          `${skin.id} 的出处「${skin.origin}」不带改编前缀，所以它是画面皮，许可必须是「${ANIME_LICENSE_LITERAL}」`
        ).toBe(ANIME_LICENSE_LITERAL);
      }
    }
    // 数字钉死：加皮肤时这里会红一次，逼着人回来看这一条判据还成不成立。
    // ⚠️【2026-10-17 第五刀就地更正】上面那句「四系列 × 昼夜共八条」记的是第四刀那一版的
    // 射程；当天又添四组插画 × 昼夜 ⇒ **现在是八系列 × 昼夜共十六条**。
    expect(ownCount, "广场上的画面皮应是八系列 × 昼夜共十六条").toBe(16);
    /* 5-㊷：五套改编皮从广场下架（它们没有整窗画面）。
       **条目下架，数值与出处留在 `appearanceSkinVisual.ts`**，
       所以下面那个「改编那五条的出处形状」describe 改成钉「形状判据仍然成立」，
       而许可白名单 `ALLOWED_UPSTREAM_REPOS` 一条都不许删短。 */
    expect(adaptedCount, "改编皮在 5-㊷ 已全部从广场下架，表里再出现就要重新核许可").toBe(0);
  });
});

/* 改编皮出处的**形状判据**：`改编自 <owner>/<repo> 的 <那一套>`，三段各自由人核对过许可。
   提成函数是因为 5-㊷ 之后表里一条改编皮都没有——
   原来那个 `for (const skin of adapted)` 会退化成**空遍历**（全绿而一条不测），
   所以下面拿合成用例把这条判据本身验一遍。 */
function checkAdaptedOrigin(id: string, origin: string): void {
  const PREFIX = ADAPTED_PREFIX;
  const SEPARATOR = " 的 ";
  expect(origin.startsWith(PREFIX), `${id} 缺少「${PREFIX}」前缀：${origin}`).toBe(true);
  const rest = origin.slice(PREFIX.length);
  const slash = rest.indexOf("/");
  const owner = slash < 0 ? "" : rest.slice(0, slash);
  const tail = slash < 0 ? "" : rest.slice(slash + 1);
  const sep = tail.indexOf(SEPARATOR);
  const repo = sep < 0 ? "" : tail.slice(0, sep);
  const what = sep < 0 ? "" : tail.slice(sep + SEPARATOR.length);
  expect(owner, `${id} 的 owner 段为空：${origin}`).toMatch(/^[\w-]+$/);
  expect(repo, `${id} 的 repo 段为空：${origin}`).toMatch(/^[\w-]+$/);
  expect(what.length, `${id} 缺少「的 <那一套>」：${origin}`).toBeGreaterThan(0);
  // **仓库名必须在许可清单里**：写对了格式还不够，还要知道抄的是谁。
  expect(
    ALLOWED_UPSTREAM_REPOS,
    `${id} 的出处指向 ${owner}/${repo}，不在核实过许可的上游清单里`
  ).toContain(`${owner}/${repo}`);
}

describe("改编皮出处的形状判据 · 表里没有也要能被验", () => {
  it("表里的改编皮（现在是零条）逐条走一遍判据", () => {
    const adapted = appearanceSkins.filter((one) => one.origin.startsWith(ADAPTED_PREFIX));
    // 条数在这里**不钉死**：上面那条 `adaptedCount === 0` 已经钉过一次，
    // 这里再钉一遍就成了同一条判据的两份真相。
    for (const skin of adapted) checkAdaptedOrigin(skin.id, skin.origin);
  });

  /**
   * **反向用例：证明这条判据真的能红**（2026-10-08 记的口径）。
   *
   * 表里改编皮降到零条之后，`for` 循环不跑，这条守卫就成了摆设。
   * 拿四种写法各喂一次，每种都必须被判红——四种全红才说明判据本身是活的，
   * 而它「今天筛不出东西」只是数据的事实，不是它失效的借口。
   */
  it("四种不合规的出处写法都必须红", () => {
    const bad = [
      ["缺前缀", "ymh0000123/dsh-theme-endfield 的 纸墨色板"],
      ["缺 owner 斜杠", "改编自 dsh-theme-endfield 的 纸墨色板"],
      ["缺「的 <那一套>」", "改编自 ymh0000123/dsh-theme-endfield"],
      ["上游不在许可清单里", "改编自 someOne/unknown-repo 的 某一套"]
    ] as const;
    for (const [why, origin] of bad) {
      expect(() => checkAdaptedOrigin(why, origin), `${why}：这条写法本该被判红`).toThrow();
    }
    // 正向对照：合规的那一条不许被误判。
    expect(() =>
      checkAdaptedOrigin("正例", "改编自 ymh0000123/dsh-theme-endfield 的 纸墨色板与玻璃网格")
    ).not.toThrow();
  });

  it("许可白名单一条都不许因为「改编皮全下架了」而删短", () => {
    /* 这五个上游的**数值**仍然活在 `appearanceSkinVisual.ts` 里（老用户盘上存着
       `glass: "standard"` 的，运行时照样要按上游值渲染），出处对账在
       `appearance-skin-visual.test.ts`。清单一删短，将来重新搬一条就要重新查许可，
       而「重新查」在实际执行里等于「没人查」。 */
    expect(ALLOWED_UPSTREAM_REPOS).toHaveLength(5);
    for (const repo of [
      "d-dev0101/open-sea-skin",
      "RevolutionLA/dsh-dream-skin",
      "ymh0000123/dsh-theme-endfield",
      "Ayase34/gal-view",
      "elysia395/dsh-wallpaper-engine"
    ]) {
      expect(ALLOWED_UPSTREAM_REPOS, `${repo} 被删出了许可清单`).toContain(repo);
    }
  });

  /* 许可这一条是**硬门槛**，但门槛的理由必须是真的。被暂缓的两个（核实过许可，不是没找到）：
       Small-tailqwq/dsh-deep-whale   MIT 代码 + 美术 CC BY-NC-SA 禁商用
       GGBond2424648901/deep-whale-day-night-theme  整仓 CC BY-NC-SA 4.0
     **2026-10-08 更正**：本守卫原先的理由是「墨宸是能卖钱的写作软件」——
     那是一句**我编的**前提，用户从没说过要商用，2026-10-08 明确否认过。
     **同日裁定到了**（批次 5-㊷）：问的是「新皮肤的插画素材从哪来」，
     用户选「全部自绘 + 我自己提供图」，没选「把那两套搬进来」。
     ⇒ 这条守卫继续成立，而它现在的理由是**用户选过的那一条**，不是编出来的商用前提。 */
  it("被排除的两个非商用仓库不许以任何形式出现在表里", () => {
    const banned = ["dsh-deep-whale", "deep-whale-day-night-theme", "maid-atelier", "orca-link"];
    for (const skin of appearanceSkins) {
      for (const needle of banned) {
        expect(
          skin.origin.includes(needle),
          `${skin.id} 的出处里出现了被排除的仓库 ${needle} —— 它的许可不允许进墨宸`
        ).toBe(false);
      }
      expect(skin.license).not.toMatch(/CC BY|NonCommercial|CC0|GPL|AGPL/i);
    }
    // **空表也算验过**：上面那个 for 在 0 条皮肤时不跑，所以这里补一条有鉴别力的断言。
    expect(appearanceSkins.length, "皮肤表空了 —— 上面那条排除判据没跑过任何一条").toBeGreaterThan(
      0
    );
  });
});
