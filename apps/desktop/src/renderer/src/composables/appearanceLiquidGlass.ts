/**
 * 液态玻璃材质的**唯一一份参数表**（2026-11-09）。
 *
 * 【它是什么，不是什么】
 * 它是一层可开关的材质：只给「浮在内容之上」的表面（输入卡、菜单、检查浮层、对话框、
 * 标题带、状态提示）加半透明底 + 模糊 + 内侧高光 + 外缘细描边 + 带强调色的折射阴影。
 * 它**不是**第 17 套皮肤，也**不碰**正文阅读区——长文压在玻璃上会掉对比度与清晰度。
 *
 * 【为什么值全在这里算，而不是散进各组件】
 * 十六套皮肤各有自己的背景/前景/强调色与玻璃档（`theme.glass`），
 * 同一个 `blur: 16px` 在素面浅皮与深色插画皮上不是一回事。
 * ⇒ 参数按「皮肤 × 明暗」现算：底色取该皮肤自己的背景混一点自己的强调色，
 *   阴影的彩色晕取强调色，模糊/不透明度取该皮肤的玻璃档。
 * ⇒ 组件里只消费 `--lg-*` 这一族 token（`styles/liquid-glass.css` 是唯一的应用点），
 *   不允许哪个组件自己再写一套 `backdrop-filter` 数值。
 *
 * 【深色的可读性怎么保证】
 * 暗色下把底色的**不透明度抬到 0.78–0.90**（浅色 0.68–0.84），并且底色里混的强调色
 * 只占 4%–5%。玻璃后面无论透出什么，压在最上面的文字仍然是 `--text-primary`，
 * 而它到这块底色的对比度守卫（`liquid-glass-guard.test.ts`）按每套皮肤逐条量过。
 */

import type { AppearanceGlass, AppearanceLiquidGlass } from "@mochen/contracts";
import { hexToRgb, mixRgba, rgba } from "./appearanceColor";

export interface LiquidGlassInput {
  /** 设置页那一档：跟随皮肤 / 强开 / 强关。 */
  setting: AppearanceLiquidGlass;
  /** 这套皮肤自己的玻璃档（`none` 表示它是素面）。 */
  glass: AppearanceGlass;
  accent: string;
  background: string;
  foreground: string;
}

export interface LiquidGlassMaterial {
  enabled: boolean;
  /** 半透明底：背景色混一点强调色，alpha 由玻璃档与明暗决定。 */
  fill: string;
  /** 叠在底色上的内侧高光 / 折射层（`background-image`，两层渐变）。 */
  sheen: string;
  /** 外缘 1px 细描边。 */
  ring: string;
  /** 内侧 1px 高光的颜色（写进 `box-shadow` 的 inset 那一段）。 */
  specular: string;
  blur: string;
  saturate: string;
  /** 静置时的柔和折射阴影（含 1px 内高光）。 */
  shadow: string;
  /** hover / 聚焦时抬一档的阴影。 */
  shadowHover: string;
  /** 按下时收一档的阴影：卡片被压向桌面，远景那一档几乎收干净。 */
  shadowPress: string;
  /**
   * 跟随指针的镜面高光（`radial-gradient`）。
   *
   * 中心读 `--lg-pointer-x` / `--lg-pointer-y`（组件在 pointermove 里逐帧写，
   * 根上那两个是静置默认值）。这是「液态」这一笔唯一的真身：
   * 光随指针走，玻璃才有厚度；固定不动的高光只是一张贴图。
   */
  pointer: string;
  /** 高光静置位置与 hover 位置（`background-position`：只挪光，不挪盒子）。 */
  sheenRest: string;
  sheenHover: string;
}

/**
 * 玻璃档 → 模糊 / 饱和 / 底色不透明度。
 *
 * 模糊上限压在 20px：再往上就要开始吃 GPU，而本层只用在少数几张浮层上，
 * 20px 已经能盖住背后的字迹轮廓。`none` 的值只是占位——`enabled` 为 false 时
 * 样式表整族规则不生效，但 token 仍要给出合法值，避免 `var()` 落空成透明。
 */
const GLASS_TIERS: Record<
  AppearanceGlass,
  { blur: number; saturate: number; lightAlpha: number; darkAlpha: number }
> = {
  none: { blur: 0, saturate: 1, lightAlpha: 1, darkAlpha: 1 },
  subtle: { blur: 12, saturate: 1.2, lightAlpha: 0.68, darkAlpha: 0.78 },
  standard: { blur: 16, saturate: 1.3, lightAlpha: 0.76, darkAlpha: 0.85 },
  strong: { blur: 20, saturate: 1.38, lightAlpha: 0.84, darkAlpha: 0.9 },
  regions: { blur: 18, saturate: 1.32, lightAlpha: 0.8, darkAlpha: 0.87 }
};

/** 底色里混多少强调色。4% 足够让玻璃带一点这套皮肤的色相，又不会把底色推离背景。 */
const TINT_RATIO = { light: 0.04, deep: 0.05 } as const;

/**
 * 「深色底」按**这套皮肤自己的底色亮度**判，不按当前肤色模式。
 *
 * 真机撞过的坑：`xi-night`（绯青·夜影）与 `ye-lamp` 这类皮肤，**浅色模式下底色本来就是深蓝**。
 * 若按 `scheme === "dark"` 给不透明度，它们的浅色档只拿到 0.68——白字压在半透明的深玻璃上，
 * 后面的亮内容一透上来就糊。这里改看底色本身的相对亮度，夜皮在两种模式下都拿高不透明度。
 */
function isDeepTone(hex: string): boolean {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.18;
}

/**
 * 设置值 + 皮肤档 → 这一套皮肤在当下到底开不开玻璃。
 *
 * `auto` 读皮肤自己的档：`glass: "none"` 的素面皮保持关闭（`ci-*` 系列的日光/夜色都带档，
 * 只有 `lamp-day` 那类是素面）。设置里强开/强关直接覆盖皮肤判断。
 */
export function isLiquidGlassEnabled(
  setting: AppearanceLiquidGlass,
  glass: AppearanceGlass
): boolean {
  if (setting === "on") return true;
  if (setting === "off") return false;
  return glass !== "none";
}

export function liquidGlassMaterial(input: LiquidGlassInput): LiquidGlassMaterial {
  const deep = isDeepTone(input.background);
  const tone = deep ? "deep" : "light";
  const enabled = isLiquidGlassEnabled(input.setting, input.glass);
  /* 「强开」落到素面皮上时，`none` 档那组值只是关闸时的占位（blur 0 / 不透明）——
     照抄就是「设置里点了开，屏幕上什么都没变」。强开要真的给玻璃：落最轻的 subtle 档，
     底色不透明度仍由深浅色调决定。`auto` + 素面皮依旧是关的，走不到这里。 */
  const tier = GLASS_TIERS[input.glass === "none" && enabled ? "subtle" : input.glass];
  const alpha = deep ? tier.darkAlpha : tier.lightAlpha;
  const specular = deep ? "rgb(255 255 255 / 0.16)" : "rgb(255 255 255 / 0.72)";

  /**
   * 玻璃的**厚度**（2026-11-10）。
   *
   * 单层模糊 + 单色边读起来是一张「磨砂贴纸」：影子在卡外，卡面本身是平的。
   * 真正的玻璃板在边缘有一道收束——顶沿接光、底沿落影、四周一圈极淡的冷光。
   * 这三笔都写进 `box-shadow` 的 inset 段，不占额外图层也不改布局。
   */
  const depth = deep
    ? `inset 0 -1px 0 rgb(0 0 0 / 0.35), inset 0 0 0 1px rgb(255 255 255 / 0.05)`
    : `inset 0 -1px 0 rgb(0 0 0 / 0.05), inset 0 0 0 1px rgb(255 255 255 / 0.34)`;

  /**
   * 指针高光：只给**色标**（从中心到透明的三段），圆心与半径写在样式表那条规则里。
   *
   * 【为什么圆心不能写进这个值】(2026-11-10 真机撞的)
   * 这一族 token 全部落在 `:root` 上，而**自定义属性里的 `var()` 是在定义它的元素上
   * 就地求值的**：`--lg-pointer: radial-gradient(… at var(--lg-pointer-x) …)` 写在根上，
   * 根上那对指针变量是多少，它就被烤成多少（50% / 0%）。组件往卡片上写的 70% / 30%
   * 一点用没有——真机读数：变量写进去了，计算出来的 `background-image` 还是 `at 50% 0%`。
   * ⇒ 圆心必须留在**消费处**（`.composer-input-surface::after` 那条规则里），
   *   那里才是「哪个元素、哪一刻」的上下文。
   */
  const pointer = deep
    ? "rgb(255 255 255 / 0.14) 0%, rgb(255 255 255 / 0.04) 42%, rgb(255 255 255 / 0) 72%"
    : /* 浅色档这套色标是**冷调**的，不是白色（2026-11-10 真机量出来的）：
         纸色卡面本身已经接近 `#FDFBF6`，纯白高光叠上去只差 2–3 个亮度级——
         放大 4 倍看也「什么都没有」（试过 0.9 的白）。冷色才是这里唯一看得见的对比：
         玻璃把背后的暖光折成一束偏冷的高光，正是真玻璃在暖光下的样子。 */
      "rgb(228 240 255 / 0.5) 0%, rgb(240 247 255 / 0.2) 45%, rgb(240 247 255 / 0) 76%";

  const accentGlow = rgba(input.accent, deep ? 0.34 : 0.42);

  return {
    enabled,
    fill: mixRgba(input.background, input.accent, TINT_RATIO[tone], alpha),
    /* 高光两层：一条斜向的宽光带 + 左上角一小块镜面反光。大幅位移靠 background-position，
       位移不改布局、也不触发重排——hover 时只挪光。 */
    sheen: deep
      ? "linear-gradient(145deg, rgb(255 255 255 / 0.14) 0%, rgb(255 255 255 / 0.04) 32%, rgb(255 255 255 / 0) 58%), radial-gradient(120% 90% at 16% -12%, rgb(255 255 255 / 0.12), transparent 62%)"
      : "linear-gradient(145deg, rgb(255 255 255 / 0.4) 0%, rgb(255 255 255 / 0.12) 30%, rgb(255 255 255 / 0) 56%), radial-gradient(120% 90% at 16% -12%, rgb(255 255 255 / 0.34), transparent 62%)",
    ring: deep ? "rgb(255 255 255 / 0.14)" : rgba(input.foreground, 0.1),
    specular,
    blur: `${tier.blur}px`,
    saturate: String(tier.saturate),
    shadow: deep
      ? `0 1px 2px rgb(0 0 0 / 0.45), 0 16px 38px -16px ${rgba(input.accent, 0.34)}, inset 0 1px 0 ${specular}, ${depth}`
      : `0 1px 2px ${rgba(input.foreground, 0.1)}, 0 14px 34px -16px ${rgba(
          input.accent,
          0.42
        )}, inset 0 1px 0 ${specular}, ${depth}`,
    shadowHover: deep
      ? `0 2px 4px rgb(0 0 0 / 0.5), 0 22px 46px -16px ${rgba(input.accent, 0.46)}, inset 0 1px 0 rgb(255 255 255 / 0.22), ${depth}`
      : `0 2px 4px ${rgba(input.foreground, 0.12)}, 0 20px 44px -16px ${rgba(
          input.accent,
          0.54
        )}, inset 0 1px 0 rgb(255 255 255 / 0.9), ${depth}`,
    /* 按下：远景那一档收到 8px，卡像被指尖压向桌面。近档与内高光保留——
       全收掉会变成「卡沉进背景里」，那是下沉，不是按压。 */
    shadowPress: `0 1px 2px ${
      deep ? "rgb(0 0 0 / 0.5)" : rgba(input.foreground, 0.08)
    }, 0 4px 10px -8px ${accentGlow}, inset 0 1px 0 ${specular}, ${depth}`,
    pointer,
    sheenRest: "18% 0%",
    sheenHover: "34% 8%"
  };
}
