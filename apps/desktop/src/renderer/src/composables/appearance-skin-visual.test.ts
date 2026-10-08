/**
 * 视觉四层的数值守卫（2026-10-07 批次 5-㊵，从 appearance-skins.test.ts 拆出）。
 *
 * 【为什么单独一份】
 * 这一份钉的全是**上游那几个文件的原值**：梦境的弥散光渐变、端场的玻璃与工业网格、
 * 壁纸引擎的分区域参数、gal-view 的对话框底。
 * 5-㊴ 的守卫只钉「每一档都产出不同的值」——而自造的档位当然做得到，
 * 于是它全绿，却没发现用户要的根本不是「几个不同的档」。
 * ⇒ 这一份每一条都钉**具体数值**，注释里写明它来自哪个仓库哪个文件的哪一行。
 *
 * 【一条贯穿全篇的陷阱：静默失效】
 * CSS 遇到非法值是**整条声明被丢弃**、控制台零报错（5-㊴ 撞过 `rgb(#hex / a)`，
 * 5-㊵ 又差点用上 `rgb(from …)`）。所以凡是「搬上游的渐变」都钉**颜色段本身的形状**，
 * 只断言「有没有渐变」是不够的——一条颜色非法的渐变照样 contains("radial-gradient")。
 *
 * 【另一条：同选择器不许写两条规则】
 * `ruleBlock` 读的是**第一条**匹配。同一批 CSS 里若把新属性另起一条同选择器的规则，
 * 新写的那些在守卫眼里根本不存在——本文件里已有两条断言因此改过判据（见下面的注释）。
 */
import { describe, expect, it } from "vitest";
import { APPEARANCE_BACKDROPS } from "@mochen/contracts";
import { skinStyleVariables } from "./appearanceSkinVisual";

/** 换一套四层，量它产出的 token。颜色三色固定成中性的深浅两版，
 *  免得每条断言都要把 accent/ink/paper 再抄一遍（抄一遍就多一处会忘改的形状）。
 *
 *  **名字刻意不叫 vars**：下面几个 describe 各自有一个同名的薄封装（调用形状不一样）。
 *  共享 helper 若也叫 vars，薄封装就变成**自己调自己**——
 *  运行上直接是 `RangeError: Maximum call stack size exceeded`（实测撞过）。 */
function tokens(
  layers: { backdrop?: string; glass?: string; surface?: string; grid?: string; art?: string },
  scheme: "light" | "dark" = "dark"
) {
  return skinStyleVariables({
    backdrop: (layers.backdrop ?? "plain") as never,
    glass: (layers.glass ?? "none") as never,
    surface: (layers.surface ?? "plain") as never,
    grid: (layers.grid ?? "none") as never,
    art: (layers.art ?? "none") as never,
    accent: scheme === "dark" ? "#5EACFF" : "#6B5D00",
    ink: scheme === "dark" ? "#F3F4F6" : "#101110",
    paper: scheme === "dark" ? "#17191C" : "#E8E8E2",
    scheme
  });
}

describe("运行时 · 背景层搬的是上游那几条渐变", () => {
  const vars = (backdrop: string, scheme: "light" | "dark" = "dark") =>
    tokens({ backdrop }, scheme)["--skin-backdrop"]!;

  it("平涂就是 none（不给「淡纹理」留后门——平涂必须真的什么都没有）", () => {
    expect(vars("plain")).toBe("none");
  });

  /* 出处：RevolutionLA/dsh-dream-skin 的
     tests/fixtures/legacy_skin_glows_10_6_0.json —— 那 8 套内置皮肤出厂时的 glow 真身。
     该文件自己的注释写着：手抄常量曾让工厂壁纸迁移在每台机器上静默失效，
     所以测试要从真实字节重算指纹。这条守卫的作用相同：钉住真身，不许凭记忆重写。 */
  it("弥散光（aurora）：右上主光 1100×620 @84% -8%、左下副光 820×520 @8% 110%", () => {
    const image = vars("aurora");
    expect(image, "弥散光不是逐字搬上游那几条 radial-gradient").toContain(
      "radial-gradient(1100px 620px at 84% -8%"
    );
    expect(image).toContain("radial-gradient(820px 520px at 8% 110%");
    // 上游那 8 套的形状固定：三层 radial + 一条 linear 底。
    expect([...image.matchAll(/radial-gradient\(/g)]).toHaveLength(3);
    expect(image).toContain("linear-gradient(165deg");
    // 色值逐字：#2DD4BF / .30、#38BDF8 / .14、veil rgba(16,32,32,.5)、底 #0F151A。
    expect(image).toContain("rgb(45 212 191 / 0.3)");
    expect(image).toContain("rgb(56 189 248 / 0.14)");
    expect(image).toContain("rgb(16 32 32 / 0.5)");
    expect(image).toContain("#0F151A");
  });

  it("深渊光（abyss）与星云光（nebula）也各自是上游那一条，不是同一段换个色相", () => {
    // **必须逐条不同**：5-㊴ 的做法就是「一个形状 + 换色相」，
    // 而用户说的「跟他的那些不一样」正是这里——上游那 8 套的落点与 alpha 各不相同。
    const abyss = vars("abyss");
    const nebula = vars("nebula");
    expect(abyss).toContain("rgb(94 106 210 / 0.35)");
    expect(abyss).toContain("#121216");
    expect(nebula).toContain("rgb(139 124 246 / 0.32)");
    expect(nebula).toContain("radial-gradient(820px 520px at 12% 110%");
    expect(nebula).toContain("#18141F");
    expect(abyss).not.toBe(nebula);
  });

  it("午夜光（midnight）保留上游「只有两层」的事实（补第三层就等于没搬）", () => {
    const image = vars("midnight");
    expect([...image.matchAll(/radial-gradient\(/g)]).toHaveLength(2);
    expect(image).toContain("radial-gradient(1000px 600px at 82% -8%");
    expect(image).toContain("rgb(124 140 255 / 0.2)");
    // 上游那一层是 800px 且收在 74%，不是 820px/72%。
    expect(image).toContain("1300px 800px at 48% 44%");
    expect(image).toContain("transparent 74%");
  });

  it("每条弥散光深浅两版都存在，且浅色版把「压暗层」翻成「提亮层」", () => {
    // 上游那份 fixture 里浅色三套（ivory/mist/rose）的第三层就是 rgba(255,255,255,.9)。
    // 墨宸每套皮肤必须配深浅两版，而上游那 5 套是纯暗色的 ⇒ 浅色版必须翻这一层，
    // 否则纸底上会压着一块半透明的黑。
    for (const backdrop of ["aurora", "abyss", "nebula", "ember", "midnight"]) {
      expect(vars(backdrop, "light"), `${backdrop} 的浅色版没有单独一套`).not.toBe(
        vars(backdrop, "dark")
      );
      expect(vars(backdrop, "light"), `${backdrop} 的浅色版第三层没翻成提亮`).toContain(
        "rgb(255 255 255 / 0.9)"
      );
    }
  });

  /* 2026-10-07 批次 5-㊴ 真机撞出来的**静默失效**，5-㊵ 搬渐变时同一个坑会再遇到一次。
     我第一版把颜色写成 `rgb(#101110 / 0.06)` —— CSS 的 rgb() 要的是三个通道数，不是 hex。
     浏览器遇到非法颜色值会**丢掉整条声明**，表现是「换了皮肤但没变」，控制台一个错都没有。
     ⇒ 守卫量**颜色段本身**：必须是 `rgb(r g b / a)` 或 `rgb(r,g,b,a)`，绝不能是 `rgb(#…)`。
       只断言「有没有渐变」是不够的——一条非法颜色的渐变照样 contains("radial-gradient")。 */
  it("所有背景渐变里的颜色段都是合法通道值，不是 rgb(#hex)（后者被浏览器静默丢弃）", () => {
    for (const backdrop of APPEARANCE_BACKDROPS) {
      for (const scheme of ["light", "dark"] as const) {
        const image = vars(backdrop, scheme);
        if (image === "none") continue;
        expect(image, `${backdrop}/${scheme} 出现了 rgb(#…)`).not.toMatch(/rgb\(\s*#/);
        const colors = [...image.matchAll(/rgba?\(([^)]*)\)/g)].map((m) => m[1]!.trim());
        expect(colors.length, `${backdrop}/${scheme} 的渐变里没有颜色段`).toBeGreaterThan(0);
        for (const one of colors) {
          expect(one, `${backdrop}/${scheme} 的颜色段「${one}」不是 rgb(r g b / a) 形状`).toMatch(
            /^\d+\s*[,\s]\s*\d+\s*[,\s]\s*\d+(\s*\/\s*0?\.\d+)?$/
          );
        }
      }
    }
  });
});

describe("运行时 · 玻璃层的数值来自上游，不是本仓自造的档", () => {
  const vars = (glass: string) => tokens({ glass });

  /* 出处一：ymh0000123/dsh-theme-endfield/src/styles/theme.css:382-383 与 docs/glass.md。
     上游那三档的 blur 是 8 / 14 / 22px。 */
  it("轻/标准/厚三档的 blur 是上游的 8 / 14 / 24px", () => {
    // 上游 strong 是 22px；墨宸的 strong 用了 24px —— 那是公海皮
    // shared/styles.css:100 那句 `blur(24px) saturate(140%)` 的原值，
    // 记在这里是因为它比上游大 2px，不注明会被当成抄错。
    expect(vars("subtle")["--skin-glass-blur"]).toBe("8px");
    expect(vars("standard")["--skin-glass-blur"]).toBe("14px");
    expect(vars("strong")["--skin-glass-blur"]).toBe("24px");
  });

  it("三档的 saturate 各不相同，且最强那档是公海皮的 140%（1.4）", () => {
    // 出处：d-dev0101/open-sea-skin/shared/styles.css:100 `blur(24px) saturate(140%)`。
    expect(vars("strong")["--skin-glass-saturate"]).toBe("1.4");
    const sat = ["subtle", "standard", "strong"].map((g) => vars(g)["--skin-glass-saturate"]);
    expect(new Set(sat).size, "三档 saturate 相同 = 换档没生效").toBe(3);
  });

  /* 出处二：elysia395/dsh-wallpaper-engine/lib/glass-presets/factory-readable.json
     与 factory-frosted.json。上游的玻璃**分区域**给参数，不是整页一个值：
       sidebarAlpha 55 / sidebarBlur 20、sidebarContentAlpha 30、
       floatersTransparency 100 / floatersBlur 60；frosted 那套的 capsuleBlur 是 16。
     「分区域」这一档就是从这里来的。 */
  it("分区域档：侧栏、内容、浮层、胶囊各自的值都不相同（上游就是分区域给的）", () => {
    const v = vars("regions");
    expect(v["--skin-glass-sidebar-alpha"], "上游 readable 的 sidebarAlpha 是 55").toBe("0.3");
    expect(v["--skin-glass-sidebar-blur"], "上游 readable 的 sidebarBlur 是 20").toBe("20px");
    expect(
      v["--skin-glass-sidebar-content-alpha"],
      "上游 readable 的 sidebarContentAlpha 是 30"
    ).toBe("0.55");
    expect(v["--skin-glass-floater-blur"], "上游 readable 的 floatersBlur 是 60").toBe("60px");
    expect(v["--skin-glass-capsule-blur"], "上游 frosted 的 capsuleBlur 是 16").toBe("16px");
    // 四个区域必须真的各不相同——全返回同一个值等于「分区域」这三个字是假的。
    const perRegion = [
      v["--skin-glass-sidebar-alpha"],
      v["--skin-glass-sidebar-content-alpha"],
      v["--skin-glass-floater-alpha"]
    ];
    expect(new Set(perRegion).size).toBe(3);
  });

  it("无玻璃那一档：blur 全 0、sheen 为 none、半透底色退回不透明", () => {
    const v = vars("none");
    expect(v["--skin-glass-blur"]).toBe("0px");
    expect(v["--skin-glass-sheen"], "无玻璃也画 sheen = 看着像有玻璃").toBe("none");
    // 底色退回**不透明**（alpha 1）：写成 0 会让卡片整个透明，底下的正文透上来。
    expect(v["--skin-glass-sidebar-fill"]).toMatch(/\/ 1\)$/);
    expect(v["--skin-glass-card-fill"]).toMatch(/\/ 1\)$/);
  });

  it("有玻璃的那几档，sheen 是上游那两道（145° 线性 + 左上角 accent 椭圆光）", () => {
    // 出处：端场 theme.css:395-396 `linear-gradient(145deg, …, transparent 58%)`
    // 与 `radial-gradient(ellipse at 0% 0%, color-mix(accent 10%), transparent 75%)`。
    for (const glass of ["subtle", "standard", "strong", "regions"]) {
      const sheen = vars(glass)["--skin-glass-sheen"]!;
      expect(sheen, `${glass} 的 sheen 缺 145° 那道线性`).toContain(
        "linear-gradient(145deg, rgb(255 255 255 / 0.07), transparent 58%)"
      );
      expect(sheen, `${glass} 的 sheen 缺左上角椭圆光`).toContain(
        "radial-gradient(ellipse at 0% 0%"
      );
    }
  });

  it("玻璃层不许用 CSS 相对颜色语法（rgb(from …) 在目标 Electron 上不保证成立）", () => {
    // 它失败的方式是**整条声明被静默丢弃** ⇒ 界面退回不透明 ⇒ 玻璃像没生效，
    // 控制台一个字都没有（与 5-㊴ 那个 `rgb(#hex)` 同一族）。
    // 所以两块半透底色必须在运行时算成完整 rgba()。
    // alpha 允许 `1`：无玻璃那档给的是不透明底色（写成 0 会让卡片整个透掉）。
    for (const glass of ["none", "subtle", "standard", "strong", "regions"]) {
      for (const name of ["--skin-glass-sidebar-fill", "--skin-glass-card-fill"]) {
        const value = vars(glass)[name]!;
        expect(value, `${glass} 的 ${name} 不是完整 rgba()`).toMatch(
          /^rgb\(\d+ \d+ \d+ \/ (0?\.\d+|1)\)$/
        );
        // 反向：绝不能是 rgb(from …) 那种相对颜色，也绝不能是 rgb(#hex)。
        expect(value).not.toMatch(/rgb\(\s*(from|#)/);
      }
    }
  });

  /**
   * 「半透明侧栏」那个用户开关折进 token（5-㊵ 真机撞出来的，见 appearance-skins.test.ts
   * 那条「侧栏的模糊只有一个真身」）。这一组钉它的**数值效果**。
   */
  it("关掉「半透明侧栏」时侧栏既不糊也不透（blur 0、实底）", () => {
    const off = skinStyleVariables({
      backdrop: "plain",
      glass: "standard",
      surface: "plain",
      grid: "none",
      art: "none",
      accent: "#5EACFF",
      ink: "#F3F4F6",
      paper: "#17191C",
      scheme: "dark",
      translucentSidebar: false
    });
    expect(off["--skin-glass-sidebar-blur"], "关掉半透明却还在糊").toBe("0px");
    // 实底：alpha 必须是 1。写成 0 会让侧栏整个透掉，底下的正文直接透上来。
    expect(off["--skin-glass-sidebar-fill"], "关掉半透明却还是半透").toMatch(/\/ 1\)$/);
    // 默认（不传这个形参）是开着，仍走上游那档。
    const on = skinStyleVariables({
      backdrop: "plain",
      glass: "standard",
      surface: "plain",
      grid: "none",
      art: "none",
      accent: "#5EACFF",
      ink: "#F3F4F6",
      paper: "#17191C",
      scheme: "dark"
    });
    expect(on["--skin-glass-sidebar-blur"], "默认应当是半透明（走上游 sidebarBlur 20px）").toBe(
      "20px"
    );
  });

  it("玻璃整档为 none 时侧栏也必须是实底（alpha 0 会让侧栏整个透掉）", () => {
    const none = vars("none");
    expect(none["--skin-glass-sidebar-blur"]).toBe("0px");
    expect(none["--skin-glass-sidebar-fill"]).toMatch(/\/ 1\)$/);
    expect(none["--skin-glass-card-fill"]).toMatch(/\/ 1\)$/);
  });
});

describe("运行时 · 表面与图案搬的是上游那几处", () => {
  const vars = (surface: string, grid: string) => tokens({ surface, grid }, "light");

  it("四档圆角各不相同，且全直角那档真的是 0px（端场 theme.css:423-438）", () => {
    const radii = ["plain", "square", "round-none", "dialogue"].map(
      (s) => vars(s, "none")["--skin-radius-md"]
    );
    expect(new Set(radii).size, "四档圆角有重复 = 换表面没生效").toBe(4);
    expect(vars("square", "none")["--skin-radius-sm"]).toBe("0px");
    expect(vars("square", "none")["--skin-radius-md"]).toBe("0px");
    expect(vars("square", "none")["--skin-radius-lg"]).toBe("0px");
  });

  it("胶囊那档的圆角是公海皮 styles.css:77/96 的 26 / 20", () => {
    expect(vars("round-none", "none")["--skin-radius-lg"]).toBe("26px");
    expect(vars("round-none", "none")["--skin-radius-md"]).toBe("20px");
  });

  it("对话框那档：底是 180° 的分层渐变，压边是 inset 0 -4px（gal-view styles.mjs:54/416）", () => {
    const v = vars("dialogue", "none");
    expect(v["--skin-dialogue-gradient"]).toContain("linear-gradient(180deg");
    expect(v["--skin-dialogue-gradient"]).toContain("rgb(16 17 16 / 0.42)");
    expect(v["--skin-dialogue-underline"], "上游是 inset 0 -4px 0").toBe(
      "inset 0 -4px 0 rgb(107 93 0 / 0.55)"
    );
  });

  it("不是对话框那档时，这两项都必须是 none（否则每个表面都顶着一条压边）", () => {
    for (const surface of ["plain", "square", "round-none"]) {
      expect(vars(surface, "none")["--skin-dialogue-gradient"]).toBe("none");
      expect(vars(surface, "none")["--skin-dialogue-underline"]).toBe("none");
    }
  });

  /* 出处：端场 src/styles/theme.css:1669-1671。
     横线 1px 密排（4px）、竖线 1px 疏排（120px）——这个不对称正是它的味道，
     两边都写成同一个间距就等于只搬了一半。 */
  it("工业网格是上游那两条：横 1px@4px、竖 1px@120px（端场 theme.css:1669-1671）", () => {
    const image = vars("plain", "industrial")["--skin-grid-image"]!;
    expect(image).toContain(
      "repeating-linear-gradient(0deg, rgb(255 255 255 / 0.014) 0 1px, transparent 1px 4px)"
    );
    expect(image).toContain(
      "repeating-linear-gradient(90deg, rgb(255 255 255 / 0.01) 0 1px, transparent 1px 120px)"
    );
    // 反向：间距不许被「顺手改成一致」。
    expect(image).not.toContain(
      "1px 120px), repeating-linear-gradient(90deg, rgb(255 255 255 / 0.014) 0 1px, transparent 1px 4px"
    );
  });

  /* 出处：gal-view .dsh-plugin/client/styles.mjs:123-124，两条都是 1px、透明度 .10。 */
  it("舞台网格是上游那两条 1px 线（gal-view styles.mjs:123-124）", () => {
    const image = vars("plain", "stage")["--skin-grid-image"]!;
    expect(image).toContain("linear-gradient(rgb(143 123 255 / 0.1) 1px, transparent 1px)");
    expect(image).toContain("linear-gradient(90deg, rgb(143 123 255 / 0.1) 1px, transparent 1px)");
    expect(image).not.toContain("repeating-linear-gradient");
  });

  it("网格的混合模式按明暗分家（端场那两条白线在纸底上等于没画）", () => {
    expect(vars("plain", "industrial")["--skin-grid-blend"]).toBe("multiply");
    const dark = skinStyleVariables({
      backdrop: "plain",
      glass: "none",
      surface: "plain",
      grid: "industrial",
      art: "none",
      accent: "#FFF500",
      ink: "#F5F5F0",
      paper: "#101110",
      scheme: "dark"
    });
    expect(dark["--skin-grid-blend"]).toBe("screen");
    // 无图案那档不许留一个 screen/multiply 上去（那是白铺一层或压一层）。
    expect(vars("plain", "none")["--skin-grid-blend"]).toBe("normal");
    expect(vars("plain", "none")["--skin-grid-image"]).toBe("none");
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   画面层（2026-10-08）：位图，不是渐变。
   这一层的存在理由就是「前四层换完仍然只是换了个色调」，
   所以它的守卫要钉的是**它真的换了东西**，而不是「它有产出」。
   ───────────────────────────────────────────────────────────────────────── */
describe("运行时 · 画面层", () => {
  it("无画面这一档必须真的什么都没有：图给 none、纱给 transparent", () => {
    /* 两条都钉。
       `url()` 给空串的话，CSS 那条 `background-image` 语法不成立、**整条被丢弃**——
       而丢弃的表现是「那层没生效」，控制台一个字都没有。
       纱若给了真渐变，默认皮肤也会被压暗一层：一次升级就把所有用户的界面改了。 */
    const v = tokens({ art: "none" });
    expect(v["--skin-art-image"], "无画面却给了图").toBe("none");
    expect(v["--skin-art-veil"], "无画面却压了一层纱").toBe("transparent");
  });

  it("两个画档各给一张自己的图，且路径是渲染层根的相对路径", () => {
    const night = tokens({ art: "abyss-hall-night" })["--skin-art-image"]!;
    const day = tokens({ art: "shallow-hall-day" })["--skin-art-image"]!;
    expect(night).toContain('url("skins/abyss-hall-night.webp")');
    expect(day).toContain('url("skins/shallow-hall-day.webp")');
    // 不许出现绝对路径 / file:// / 远程域名：路径是数据能碰到的唯一出口，
    // 枚举就是把它关在「只有这三档」里。带画的东西跑远程 URL 等于每次开窗发一个请求。
    for (const value of [night, day]) {
      expect(value, "路径跑出去了").not.toMatch(/file:|https?:|\.\.|[A-Z]:\\/i);
    }
  });

  it("有画时纱是实打实的一层，不是 transparent（压不住正文就等于没画）", () => {
    for (const scheme of ["light", "dark"] as const) {
      expect(tokens({ art: "abyss-hall-night" }, scheme)["--skin-art-veil"]).not.toBe(
        "transparent"
      );
    }
  });
});
