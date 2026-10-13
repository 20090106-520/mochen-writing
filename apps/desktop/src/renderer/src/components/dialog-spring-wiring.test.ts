/**
 * 对话框出场（2026-10-11 批次 6-①）：弹簧从 CSS 搬进 GSAP 之后的一份守卫。
 *
 * **这份文件换过一次判据，但一条意图都没丢。** 原版四条，逐条对到新架构上：
 *
 * ① **不许再写一份弹簧曲线** → 变成「CSS 里一份都不许剩，弹簧只在 `utils/motion-spring.ts`」。
 *    换判据是因为**载体变了**，不是因为要求松了：原来钉的是「motion.css 里不许出现第二条 linear()」，
 *    现在弹簧根本不在 CSS 里，于是要求升级成「任何样式表里都不许再有曲线字面量」。
 * ② **不许把对话框留在共用那张浮层表里** → 变成「对话框整条 CSS 规则都没了」，
 *    交接给了 GSAP。顺带把当年那条「同权重规则并存 = 谁赢看源码顺序」的隐患彻底消掉。
 * ③ **反向钉：其余十四个浮层不许被顺手一起换成弹簧** → 原样保留，而且更硬：
 *    浮层表仍然是**一条**规则、走**软曲线**，对话框的类名不许出现在里面。
 * ④ **背板也得有入场，且与面板同一条曲线** → 保留。原先是「同一条 CSS 动画」，
 *    现在是「同一条 GSAP 时间轴、同一个 defaults（同一段时长 + 同一条 ease）」。
 *
 * 另外补三条**新架构才有的**判据：
 * ⑤ 开合判据只有一份：`useModalFocus` 与 `useDialogMotion` 必须读同一个具名 ref。
 * ⑥ 时长比浮层慢一档——原来比的是两个 CSS 变量，现在对话框那半个搬到了 TS，改跨载体比。
 * ⑦ 「减少动效」这一层自己认两档：CSS 总闸压的是 `animation-duration` / `transition-duration`，
 *    **管不到 JS 补间**，所以 GSAP 这条路必须自己判一次。
 */
import { describe, expect, it } from "vitest";
import {
  cssRules,
  MODAL_DIALOGS,
  popInSelectors,
  scriptSource,
  strippedStyleSource,
  typeScriptSource
} from "../utils/vue-source-reader";

// 一律读**剥掉注释**的源：注释里写着选择器/属性/曲线名，会把下面几条断言喂饱
// （motion.css 那段「对话框的出场不在本文件了」里就写着 linear()）。
const motionCss = strippedStyleSource("motion.css");
const viewCss = strippedStyleSource("view-transition.css");

const MOTION = typeScriptSource("composables/useDialogMotion.ts");
const SPRING = typeScriptSource("utils/motion-spring.ts");

/** 全仓样式表里都不许再有曲线字面量的那几张（对话框 / 视图过渡 / 思考态）。 */
const STYLE_SHEETS = ["motion.css", "view-transition.css", "thinking-window.css"] as const;

describe("对话框 · 弹簧只剩一份，在 JS 侧", () => {
  it("面板走 springEase，不是浮层那条软曲线（判据落在 timeline 的 defaults 上）", () => {
    // 钉 defaults 而不是钉 `ease: springEase` 出现在哪：写进 defaults 才是「背板与面板同一条」，
    // 单独在某一条 tween 上写 ease 只会让背板走软曲线、面板走弹簧——正是最难看的那种分层。
    expect(MOTION).toMatch(
      /defaults:\s*\{\s*duration:\s*DIALOG_MOTION_SECONDS,\s*ease:\s*springEase\s*\}/
    );
  });

  it("物理参数一个没改：阻尼比 0.62、固有角频率 13（搬家途中不许顺手调手感）", () => {
    expect(SPRING).toContain("SPRING_DAMPING_RATIO = 0.62");
    expect(SPRING).toContain("SPRING_ANGULAR_FREQUENCY = 13");
    // 真正接上的是这个导出的 ease，不是某个就地重算的副本。
    expect(MOTION).toContain("springEase");
  });

  it("**反向钉**：样式表里一份弹簧都不许剩（那一族是本仓最贵的静默失效）", () => {
    for (const file of STYLE_SHEETS) {
      const css = strippedStyleSource(file);
      expect(css, `${file} 里又出现了 linear() 曲线`).not.toContain("linear(");
      expect(css, `${file} 还在引用那条已退役的曲线变量`).not.toContain("--ease-view");
    }
  });

  it("**反向钉**：缓动曲线全仓只有一条定义，不许有第二处", () => {
    // 注意：这里禁的不是「出现 cubic-bezier」，而是「出现**第二处**」。
    // 那一条定义就是 --ease-out-soft 本身——全仓唯一的一条 ease token，
    // 禁掉它等于禁掉全仓所有 CSS 动效的共同手感，那是另一回事。
    const sheets = STYLE_SHEETS.map((file) => [file, strippedStyleSource(file)] as const);
    const countLiteral = (css: string): number => css.split("cubic-bezier(").length - 1;
    const total = sheets.reduce((n, [, css]) => n + countLiteral(css), 0);
    expect(total, "cubic-bezier 字面量应当只有 --ease-out-soft 那一条定义").toBe(1);

    const owners = sheets.filter(([, css]) => countLiteral(css) > 0).map(([file]) => file);
    expect(owners, "那一条定义只该在 motion.css").toEqual(["motion.css"]);
    // 并且它是被 token 消费的那一条，不是就地贴在某条规则上的。
    const motion = sheets.find(([file]) => file === "motion.css")?.[1] ?? "";
    expect(motion).toContain("--ease-out-soft: cubic-bezier(");
  });

  it("**反向钉**：GSAP 这条路不许自己写一份「两档任一为真」（认档的真身只有 motion-preference）", () => {
    expect(MOTION).toContain('from "../utils/motion-preference"');
    // 媒体查询与属性名一旦在这里出现，就是第二份判定的开头。
    expect(MOTION, "OS 级那一档的判定不许在这里重写").not.toContain("prefers-reduced-motion");
    expect(MOTION, "应用内那一档的判定不许在这里重写").not.toContain("data-reduced-motion");
  });
});

describe("对话框 · CSS 那边已经交出去", () => {
  it("面板与背板都不再有 CSS 出场动画（两条动画与 GSAP 抢同一条 opacity/transform = 一次抖动）", () => {
    expect(motionCss).not.toMatch(/\.workspace-dialog[^{]*\{[^}]*animation:/);
    expect(motionCss).not.toMatch(/\.dialog-backdrop[^{]*\{[^}]*animation:/);
    // 对话框专属的那个时长变量也一并退役了。
    expect(motionCss, "--dur-dialog 已经没有消费者了").not.toContain("--dur-dialog");
  });

  it("对话框已经退出 CSS 出场表（它的存在性改由下面「接线」那组守卫管）", () => {
    // 原版这条是反着写的：「推导仍收得到对话框」。现在对话框不在那张表里了，
    // 于是口径翻转成「不该再收得到」——它已经不是 CSS 动画的消费者了。
    expect(popInSelectors(motionCss), "对话框的入场归 GSAP，不该再留在 CSS 那张表里").not.toContain(
      ".workspace-dialog"
    );
  });

  it("**反向钉**：其余十四个浮层一张没动，仍然是那一条规则走软曲线", () => {
    const table = popInSelectors(motionCss);
    expect(table.length, "这张表不该被顺手删空").toBeGreaterThan(8);
    for (const cls of [".model-select", ".tool-roster", ".change-history", ".foreshadow-ledger"]) {
      expect(table, `${cls} 从共用表里掉了`).toContain(cls);
    }
    // 按**整条规则**断言，不逐个类名去 ruleBlock：共用表里那些条目后面跟的是逗号不是 `{`。
    const popRules = cssRules(motionCss).filter((r) => /animation:\s*mochen-pop-in/.test(r.body));
    expect(popRules.length, "走软曲线的出场规则不该只剩一条").toBe(1);
    expect(popRules[0]?.body, "浮层那条必须是软曲线，别把全表一起换成弹簧").toContain(
      "--ease-out-soft"
    );
  });

  it("弹层出场关键帧仍然留着（浮层表还在用，不是死代码）", () => {
    expect(motionCss).toContain("@keyframes mochen-pop-in");
    // 视图过渡那两段纯淡入/淡出也还在被伪元素用着。
    expect(viewCss).toContain("@keyframes mochen-view-fade-in");
    expect(viewCss).toContain("@keyframes mochen-view-fade-out");
  });
});

describe("对话框 · 背板与面板同一条时间轴", () => {
  it("背板被一起收进来，且与面板都落在时间轴的 0 处（不许面板单独弹）", () => {
    expect(MOTION).toContain('const BACKDROP_CLASS = "dialog-backdrop"');
    // 背板靠「面板的直接父节点带那个类」认出来，不另写一份查找逻辑。
    expect(MOTION).toMatch(/classList\.contains\(BACKDROP_CLASS\)/);
    expect(MOTION, "背板没进时间轴").toMatch(/tl\.fromTo\(\s*backdrop,/);
    expect(MOTION, "面板没进时间轴").toMatch(/tl\.fromTo\(\s*el,\s*PANEL_FROM,/);
    // 两条都在位置 0 起步：写出来是为了「同起」，不靠追加顺序碰运气。
    const positions = [...MOTION.matchAll(/tl\.fromTo\([^;]*?,\s*0\s*\)/g)];
    expect(positions.length, "两条补间都要显式落在 0").toBe(2);
  });

  it("背板动的是透明度，不跟着缩放位移（它铺满整屏，动它等于动整个界面）", () => {
    expect(MOTION, "背板不该有 scale").not.toMatch(/backdrop,\s*\{[^}]*scale/);
    expect(MOTION, "背板不该有位移").not.toMatch(/backdrop,\s*\{[^}]*\by:/);
  });

  it("时长比浮层慢一档（过冲要跑得完，170ms 里它只落在头 50ms）", () => {
    // 原版比的是两个 CSS 变量；对话框那半个搬到 TS 之后，跨载体比同一个性质。
    const durPop = Number(/--dur-pop:\s*(\d+)ms/.exec(motionCss)?.[1]);
    const durDialog = Number(/DIALOG_MOTION_SECONDS\s*=\s*([\d.]+)/.exec(MOTION)?.[1]) * 1000;
    expect(durPop, "motion.css 里读不到 --dur-pop").toBeGreaterThan(0);
    expect(durDialog, "useDialogMotion.ts 里读不到 DIALOG_MOTION_SECONDS").toBeGreaterThan(0);
    expect(durDialog, "对话框时长必须大于浮层时长").toBeGreaterThan(durPop);
  });
});

describe("对话框 · 接线", () => {
  for (const dlg of MODAL_DIALOGS) {
    it(`${dlg.name}：入场由 useDialogMotion 接上，且与 useModalFocus 共用同一个根 ref`, () => {
      const script = scriptSource(dlg.file);
      expect(script, "没接 useDialogMotion").toContain('from "../composables/useDialogMotion"');
      // 根 ref 的名字跟着 useModalFocus 走，改名时这条跟着走，不写死 "dialogRoot"。
      const focusRoot = /useModalFocus\(\{[\s\S]*?root:\s*(\w+)/.exec(script)?.[1];
      expect(focusRoot, "读不到 useModalFocus 的根 ref").toBeTruthy();
      expect(script, "动效那一层得用同一个根 ref").toContain(
        `useDialogMotion({ root: ${focusRoot as string}`
      );
    });
  }

  it("开合判据只有一份：isOpen 是具名 const，Esc/焦点与动效读同一个", () => {
    for (const dlg of MODAL_DIALOGS) {
      const script = scriptSource(dlg.file);
      const focusIsOpen = /useModalFocus\(\{[\s\S]*?isOpen:\s*(\w+)\s*\}/.exec(script)?.[1];
      const motionIsOpen = /useDialogMotion\(\{[\s\S]*?isOpen:\s*(\w+)\s*\}/.exec(script)?.[1];

      if (dlg.mustPassIsOpen) {
        expect(focusIsOpen, `${dlg.name} 是自己 v-if 的，该传 isOpen`).toBeTruthy();
        expect(
          motionIsOpen,
          `${dlg.name} 的动效没跟着传 isOpen——它会一直等 watch，开场是硬的`
        ).toBe(focusIsOpen);
        // 具名 const，而不是就地再推一次：就地写第二遍就是同一判定的两份实现。
        expect(script, `${dlg.name} 的 isOpen 必须是具名 const`).toMatch(
          new RegExp(`const ${focusIsOpen as string}\\s*=\\s*toRef\\(`)
        );
      } else {
        expect(focusIsOpen, `${dlg.name} 由父组件 v-if 挂载，不该传 isOpen`).toBeUndefined();
        expect(motionIsOpen, `${dlg.name} 同上`).toBeUndefined();
      }
    }
  });
});

describe("对话框 · 入场时机（只钉得住接线那一半）", () => {
  /**
   * 「GSAP 的起始态赶在第一帧之前」这条**在本仓的单测里验不了**（environment 是 node，没有 DOM 环境），
   * 能钉的只有接线：两处时机都在同一拍，中间没有任何推迟。
   *
   * 它本身已经在真机上量过了（`.mochen-tmp/p542/dialog-motion-warm.mjs`，见 useDialogMotion.ts 的
   * 文件头）：第一帧实测就是起始态，不闪。所以这里钉的不是「还没验」，是**别把接线改坏**。
   *
   * 哪天真看见「闪一下」而这一条还是绿的，那**不要**再去怀疑 Vue 的调度顺序——
   * 要查的是有没有别的东西在 `play()` 与第一帧之间插了一拍。
   */
  it("两处时机都在同一拍：入场没被 setTimeout / rAF 推迟过", () => {
    expect(MOTION, "入场被推迟了一拍 —— 真机必然闪一下").not.toMatch(
      /setTimeout|requestAnimationFrame/
    );
    expect(MOTION, "父组件 v-if 挂载的那两个靠 mounted").toContain("onMounted(");
    expect(MOTION, "弹层自己 v-if 的两个靠 post 刷新").toMatch(/flush:\s*"post"/);
  });
});

describe("对话框 · 减少动效（JS 补间收不到 CSS 总闸）", () => {
  it("这一层自己认两档，认到就整个不建时间轴", () => {
    // 判据钉在「认到即 return」上：只认不 return 的话时间轴照建，
    // 症状是「关掉了动效，但那一下还是弹了一下」。
    expect(MOTION).toMatch(/reducedMotionActive\(currentReducedMotionHost\(\)\)\)\s*return/);
  });

  it("认档读的是同一个真身，不是 view-transition 那边的另一份", () => {
    expect(MOTION).toContain("currentReducedMotionHost");
    expect(MOTION).not.toContain("view-transition");
  });

  it("CSS 总闸仍在（它管的是浮层表那十四个，不是这条）", () => {
    expect(motionCss).toContain('html[data-reduced-motion="true"] *');
    const gate =
      /html\[data-reduced-motion="true"\][^{]*\{([\s\S]*?)\n\}/.exec(motionCss)?.[1] ?? "";
    expect(gate).toContain("animation-duration: 0.01ms !important");
  });
});
