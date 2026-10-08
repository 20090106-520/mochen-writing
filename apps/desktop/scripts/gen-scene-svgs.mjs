/*
 * 波2a · 仓内自绘场景画的生成器 v2（2026-10-08）
 *
 * 【为什么要重做一版】
 * v1 六张真机目检（当时的一次性探针 tmp-look-art.mjs，脱离界面单铺一张看；
 * 那支没进仓，结论留在下面这几行字里）判下来的结论是**不合格**：
 *   · 明度层次不够——主体与背景只差十几个亮度点，缩到卡片预览那么大就整片消失，
 *     广场截图上「书舟·夜航」「灯楼·燃夜」「墨潭·沉雾」三张卡读起来就是「没有画」，
 *     而这正是用户连着两次否掉的那件事（「只改颜色和字体」「把没有图片的全删了」）。
 *   · 主体不认得出——鲸画成了一个穹顶加一片叶子；书架画成了一排横条（读成梯子）；
 *     稿纸读成一滩白斑。几何在，**指涉**不在。
 * ⇒ v2 的两条硬指标，都是可量的：
 *   ① **明度分层**：每张至少四层深度，相邻层的亮度差 ≥ 22（脚本末尾自己算并打印，
 *      不够就抛错——不许靠「看着还行」过关）。
 *   ② **缩略图读得出**：把主体所在的那块按 1/8 边长降采样后，主体与背景的亮度差
 *      仍 ≥ 18（卡片预览就是这么大一张缩略图）。
 * 两条都由**同目录的 `check-scene-art.mjs`** 在真机上复核，不在这里自说自话。
 *
 * 【构图硬规则（规格单 §2，与 v1 同）】
 * 视口 2560×1440：中间 x ∈ [700, 1860] 一整片低信息区；上下各 12% 不放关键元素；
 * 主体只在左右两缘；昼夜两版几何完全一致，只换色温与光源。
 *
 * 【为什么这份生成器要进仓（2026-10-08 收口时搬的）】
 * 它原先住在 `.superpowers/sdd/`，而那个目录在 `.gitignore` 里——于是远端仓库上
 * 只有六张**结果** SVG，没有画出它们的**来源**。改一张画的人只能重画，
 * 判「这张画合格吗」的人找不到那道像素门。搬进来后：
 *   · 输出目录按**本脚本所在位置**解析 ⇒ 从仓库根跑和从 apps/desktop 跑，落点同一处；
 *   · 跑法 `node apps/desktop/scripts/gen-scene-svgs.mjs`（也可 `corepack pnpm --filter
 *     @mochen/desktop gen:scene-svgs`）；
 *   · 重跑必须**逐字节复现**现有六张（搬完当场 `cmp` 过，见波2a 台账），
 *     复现不了就说明生成器与仓里的画已经分叉，那六张得重新过一遍像素门。
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const W = 2560;
const H = 1440;
/* 相对**本脚本**而不是相对 cwd：原先写 `path.join("apps","desktop",…)`，
   从仓库根跑得对，从 apps/desktop 跑就会在 `apps/desktop/apps/desktop/…` 造一棵假树。
   ESM 没有 `__dirname`，所以从 `import.meta.url` 现算一个——文件搬进 `scripts/` 之后
   这一行是整个脚本里唯一和"我在哪儿"有关的东西，别改成 cwd。 */
const outDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "renderer",
  "public",
  "skins"
);

function rgba(hex, a) {
  const h = hex.replace("#", "");
  const n =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
const lum = (hex) => {
  const h = hex.replace("#", "");
  const f = (i) => {
    const s = parseInt(h.slice(i, i + 2), 16) / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(0) + 0.7152 * f(2) + 0.0722 * f(4);
};
/** 亮度点（0-255 口径）：判「肉眼分不分得出来」用它，不用比值。 */
const luma255 = (hex) => Math.round(lum(hex) * 255);

function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

/** 一枚暖光池：defs 里一条 radialGradient + 一个圆。 */
function glow(id, color, alpha) {
  return {
    def: `    <radialGradient id="${id}" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${rgba(color, alpha)}"/>
      <stop offset="0.3" stop-color="${rgba(color, alpha * 0.42)}"/>
      <stop offset="1" stop-color="${rgba(color, 0)}"/>
    </radialGradient>`,
    at: (cx, cy, r) => `    <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id})"/>`
  };
}

/** 一排书脊：宽度与高矮不齐，颜色在两支之间跳。缩略图下读成「一片书」而不是「一条杠」。 */
function bookSpines(x, y, w, h, dark, light, seed) {
  const rand = rng(seed);
  const parts = [];
  let cursor = x;
  while (cursor < x + w - 8) {
    const bw = 9 + rand() * 16;
    const bh = h * (0.62 + rand() * 0.38);
    parts.push(
      `    <rect x="${cursor.toFixed(0)}" y="${(y + h - bh).toFixed(0)}" width="${bw.toFixed(0)}" height="${bh.toFixed(0)}" fill="${rand() > 0.42 ? dark : light}"/>`
    );
    cursor += bw + 3 + rand() * 5;
  }
  return parts.join("\n");
}

/** 水面：一条水平亮带 + 若干道涟漪弧。涟漪只在左右两缘画密，中段只留极淡的两道。 */
function water(y, pal, seed) {
  const rand = rng(seed);
  const arcs = [];
  for (let i = 0; i < 26; i += 1) {
    const left = i % 2 === 0;
    const cx = left ? 60 + rand() * 600 : 1900 + rand() * 600;
    const cy = y + 30 + rand() * (H - y - 90);
    const w = 60 + rand() * 190;
    arcs.push(
      `    <path d="M ${cx.toFixed(0)} ${cy.toFixed(0)} q ${(w / 2).toFixed(0)} ${(6 + rand() * 9).toFixed(0)} ${w.toFixed(0)} 0" ` +
        `stroke="${rgba(pal.ripple, (0.16 + rand() * 0.3).toFixed(2))}" stroke-width="${(2 + rand() * 3).toFixed(0)}" fill="none"/>`
    );
  }
  for (let i = 0; i < 5; i += 1) {
    const cx = 780 + rand() * 1000;
    const cy = y + 60 + rand() * (H - y - 120);
    arcs.push(
      `    <path d="M ${cx.toFixed(0)} ${cy.toFixed(0)} q 60 5 120 0" stroke="${rgba(pal.ripple, "0.10")}" stroke-width="2" fill="none"/>`
    );
  }
  return `  <rect x="0" y="${y}" width="${W}" height="${H - y}" fill="url(#water-band)"/>\n  <g>\n${arcs.join("\n")}\n  </g>`;
}

/** 悬浮粒子：只给左右两缘（中段一条都不给，规则 1）。 */
function particles(color, count, seed, alpha) {
  const rand = rng(seed);
  const circles = [];
  for (let i = 0; i < count; i += 1) {
    const left = i % 2 === 0;
    const x = left ? 40 + rand() * 560 : 1960 + rand() * 560;
    const y = 120 + rand() * 1200;
    const r = 1.6 + rand() * 5.6;
    const a = (alpha * (0.35 + rand() * 0.65)).toFixed(3);
    /* 字符串拼接而不是模板串：同形状在模板串里被 V8 判成 `missing ) after argument list`。 */
    circles.push(
      '    <circle cx="' +
        x.toFixed(0) +
        '" cy="' +
        y.toFixed(0) +
        '" r="' +
        r.toFixed(1) +
        '" fill="' +
        rgba(color, a) +
        '"/>'
    );
  }
  return `  <g>\n${circles.join("\n")}\n  </g>`;
}

/** 从上方斜下来的光柱：夜里两道淡的，昼间一道宽的。 */
function shafts(color, alpha) {
  const shaft = (x, w, skew) =>
    `    <path d="M ${x} 0 L ${x + w} 0 L ${x + w + skew} 1440 L ${x + skew} 1440 Z" fill="url(#shaft-${x})"/>`;
  const mk = (x) =>
    `    <linearGradient id="shaft-${x}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${rgba(color, alpha)}"/>
      <stop offset="0.62" stop-color="${rgba(color, alpha * 0.3)}"/>
      <stop offset="1" stop-color="${rgba(color, 0)}"/>
    </linearGradient>`;
  const xs = [380, 1920];
  return {
    defs: xs.map(mk).join("\n"),
    /* 两道光柱都收在左右两缘以内：原先左那道扫到 x=960、右那道扫到 x=1580，
       等于把两条硬边斜杠画在正文区上（规格单规则 1）。 */
    body: `  <g>\n${[shaft(380, 150, 120), shaft(1920, 110, -70)].join("\n")}\n  </g>`
  };
}

/**
 * 两缘的环境光垫（只对夜版开）：把左右两个三分之一整片抬亮一档，中段一条像素都不碰。
 * 【为什么需要这一件】夜版 v1/v2-a 都被同一件事绊倒：主体画得再亮，也是**小块**，
 * 整幅的面积仍然 80% 落在亮度 0–21 那一档里，缩略图看上去就是「一片黑，没有画」。
 * 抬亮中段是禁止的（规格单规则 1：正文要落在那片暗区），所以抬**两缘的大面积**，
 * 让「暗水 / 受光的第三 / 主体 / 灯光」四层各占得到面积。
 * 【为什么是一条横贯全幅的软渐变，而不是左右两块矩形】
 * 真机目检第一版：两块矩形在 x=700 / x=1860 处留下两条**硬直边**，
 * 看上去像界面里嵌了两块面板——正是「不许有界面元素」这条要避免的样子。
 * 改成单条水平渐变：0 与 1 处最亮，到 30%/70% 已经归零 ⇒ 中段分毫不动，边缘也没有切口。
 */
function ambientWash(color, alpha) {
  return {
    def: `    <linearGradient id="wash" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${rgba(color, alpha)}"/>
      <stop offset="0.14" stop-color="${rgba(color, alpha * 0.86)}"/>
      <stop offset="0.27" stop-color="${rgba(color, alpha * 0.4)}"/>
      <stop offset="0.32" stop-color="${rgba(color, 0)}"/>
      <stop offset="0.68" stop-color="${rgba(color, 0)}"/>
      <stop offset="0.73" stop-color="${rgba(color, alpha * 0.4)}"/>
      <stop offset="0.86" stop-color="${rgba(color, alpha * 0.86)}"/>
      <stop offset="1" stop-color="${rgba(color, alpha)}"/>
    </linearGradient>`,
    body: `  <rect width="${W}" height="${H}" fill="url(#wash)"/>`
  };
}

/* ══ 系列一：书舟 ══════════════════════════════════════════════════════   左缘 = 一头正缓缓游远的鲸（背朝上、尾在画外、头朝中间）；
   右缘 = 一叶满载稿纸的小舟，船头一盏灯；下方 = 海面压深的前景。
   v1 的鲸之所以读成穹顶：**只有背弧，没有尾鳍、胸鳍与下颌**。v2 补齐这四件。 */
function bookBoat(pal) {
  const lamp = glow("lamp", pal.lamp, 0.95);
  const moon = glow("moon", pal.light, 0.5);
  return {
    defsExtra: `    <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${rgba(pal.rim, 0.85)}"/>
      <stop offset="1" stop-color="${rgba(pal.rim, 0)}"/>
    </linearGradient>
    <linearGradient id="fore-fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${rgba(pal.fore, 0)}"/>
      <stop offset="0.38" stop-color="${rgba(pal.fore, 0.9)}"/>
      <stop offset="1" stop-color="${pal.fore}"/>
    </linearGradient>
    <linearGradient id="whale-body" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${pal.whaleTop}"/>
      <stop offset="0.55" stop-color="${pal.whale}"/>
      <stop offset="1" stop-color="${pal.whaleBelly}"/>
    </linearGradient>
    <linearGradient id="hull" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${pal.boatTop}"/>
      <stop offset="1" stop-color="${pal.boat}"/>
    </linearGradient>
${lamp.def}
${moon.def}`,
    body: `  <!-- 远处那层：海床上方一道极淡的雾脊，给画面一个「还有纵深」的读感。
       两端收成尖，不留竖直切口——原先那条 L 700 1140 的闭边在真机上读成一块面板。 -->
  <path d="M 0 1004 C 200 962, 430 1000, 640 1054 C 440 1104, 200 1112, 0 1082 Z" fill="${rgba(pal.far, 0.55)}"/>
  <path d="M 2560 1004 C 2360 962, 2130 1000, 1920 1054 C 2120 1104, 2360 1112, 2560 1082 Z" fill="${rgba(pal.far, 0.55)}"/>
  <!-- 鲸：左缘主体。背弧 → 头 → 下颌 → 腹 → 尾柄 → 两片尾鳍 -->
  <g>
    <path d="M 60 560 C 210 520, 400 552, 520 640 C 640 726, 700 826, 690 908
             C 676 1000, 560 1046, 430 1010 C 300 974, 190 880, 140 780
             C 110 720, 80 640, 60 560 Z" fill="url(#whale-body)"/>
    <!-- 尾鳍：从尾柄向左外翻的两片，画到画布外一半，读成「正在游远」 -->
    <path d="M 140 780 C 90 742, 40 690, 0 660 L 0 780 C 50 796, 100 812, 140 826 Z" fill="${pal.whale}"/>
    <path d="M 140 800 C 96 848, 54 906, 18 968 L 130 940 C 150 898, 156 848, 140 800 Z" fill="${pal.whale}"/>
    <!-- 胸鳍：腹下那一片，是「这是动物不是石头」的关键一件 -->
    <path d="M 430 1000 C 470 1046, 520 1082, 588 1100 C 540 1052, 500 1016, 470 984 Z" fill="${pal.whaleBelly}"/>
    <!-- 喉沟：鲸腹那几道纵纹，从下颌往后收 -->
    <g stroke="${rgba(pal.rim, 0.22)}" stroke-width="5" fill="none">
      <path d="M 250 900 C 340 962, 440 998, 560 1006"/>
      <path d="M 220 860 C 320 930, 430 968, 566 978"/>
      <path d="M 196 812 C 300 890, 420 934, 572 948"/>
    </g>
    <!-- 背脊高光：整条背一道渐隐的边光 -->
    <path d="M 70 574 C 220 534, 404 566, 524 652 C 636 734, 692 828, 684 902"
          fill="none" stroke="url(#rim)" stroke-width="9"/>
    <!-- 眼：头侧一枚，小但决定「认得出是活物」 -->
    <circle cx="596" cy="812" r="13" fill="${rgba(pal.rim, 0.9)}"/>
  </g>
  <!-- 小舟：右缘。船身月牙 + 舱里三摞稿纸 + 一根桅 + 船头那盏灯 -->
  <g>
    <path d="M 1900 1086 C 2010 1160, 2300 1164, 2470 1078 C 2400 1156, 2300 1194, 2180 1194
             C 2056 1194, 1952 1152, 1900 1086 Z" fill="url(#hull)"/>
    <path d="M 1900 1086 C 2020 1128, 2320 1128, 2470 1078" fill="none" stroke="${rgba(pal.rim, 0.5)}" stroke-width="6"/>
    <!-- 稿纸：三摞，每摞四张错开，边缘给一道亮边，读成纸而不是砖 -->
    <g fill="${pal.paperInScene}">
      <path d="M 2010 1074 L 2140 1050 L 2148 1072 L 2018 1096 Z"/>
      <path d="M 2016 1046 L 2146 1022 L 2154 1044 L 2024 1068 Z"/>
      <path d="M 2022 1018 L 2152 994 L 2160 1016 L 2030 1040 Z"/>
      <path d="M 2028 990 L 2158 966 L 2166 988 L 2036 1012 Z"/>
      <path d="M 2200 1070 L 2330 1052 L 2336 1074 L 2206 1092 Z"/>
      <path d="M 2206 1044 L 2336 1026 L 2342 1048 L 2212 1066 Z"/>
      <path d="M 2212 1018 L 2342 1000 L 2348 1022 L 2218 1040 Z"/>
    </g>
    <g stroke="${rgba(pal.rim, 0.34)}" stroke-width="3" fill="none">
      <path d="M 2018 1096 L 2148 1072"/><path d="M 2206 1066 L 2342 1048"/>
    </g>
    <!-- 桅与灯 -->
    <path d="M 2402 1082 L 2412 792 L 2426 792 L 2432 1082 Z" fill="${pal.boat}"/>
    <path d="M 2418 800 C 2330 830, 2296 892, 2318 950 C 2372 924, 2412 872, 2418 800 Z" fill="${rgba(pal.sail, 0.9)}"/>
    <path d="M 2418 800 C 2358 838, 2336 890, 2348 936" fill="none" stroke="${rgba(pal.rim, 0.45)}" stroke-width="5"/>
  </g>
  <circle cx="2412" cy="770" r="17" fill="${rgba(pal.lamp, 0.96)}"/>
${lamp.at(2412, 770, 470)}
${moon.at(240, 140, 460)}
  <!-- 前景压深：海面以下那一条，整幅最暗，给缩略图一个可抓的底。
       用渐变而不是硬边矩形——硬边在真机上是一条横贯全幅的「界面分割线」。 -->
  <rect x="0" y="1110" width="${W}" height="330" fill="url(#fore-fade)"/>
  <path d="M 0 1180 C 220 1152, 470 1204, 700 1180 L 700 1210 C 470 1234, 220 1182, 0 1210 Z" fill="${rgba(pal.ripple, 0.3)}"/>
  <path d="M 1860 1180 C 2090 1152, 2330 1204, 2560 1180 L 2560 1210 C 2330 1234, 2090 1182, 1860 1210 Z" fill="${rgba(pal.ripple, 0.3)}"/>
  <!-- 灯在水面那道倒影：一条断开的竖直亮带 -->
  <g fill="${rgba(pal.lamp, 0.3)}">
    <rect x="2398" y="1196" width="28" height="26" rx="13"/>
    <rect x="2404" y="1236" width="18" height="20" rx="10"/>
    <rect x="2396" y="1272" width="30" height="18" rx="9"/>
    <rect x="2408" y="1306" width="14" height="16" rx="8"/>
  </g>
${particles(pal.particle, 52, 7, 0.34)}`,
    /* 明度分层与缩略图判据要用的取样点：取的是**面向眼睛的那一面**——
       鲸背（受光面）、舷口上沿（被船头灯照到的那一条）、灯核、前景、中段背景。
       取背光面会比出更大的间隔，那是自己骗自己。 */
    samples: [
      { name: "鲸背", x: 380, y: 700, hex: "whale" },
      { name: "舷口", x: 2180, y: 1090, hex: "boatTop" },
      { name: "灯核", x: 2412, y: 770, hex: "lamp" },
      { name: "前景", x: 1280, y: 1330, hex: "fore" },
      { name: "中段", x: 1280, y: 640, hex: "mid" }
    ]
  };
}

/* ══ 系列二：灯楼 ══════════════════════════════════════════════════════
   左缘 = 一座**看得出是建筑**的藏书楼：收分的墙、一排排书脊、三扇亮着暖光的拱窗、
   楼顶那盏灯把光斜斜打到右下；右缘 = 案头（摊开的稿纸、墨瓶、羽毛笔）与一盏吊灯。
   v1 读成梯子的原因：只有一排排横条，没有墙的外轮廓、没有窗、书脊也不齐。 */
function lampTower(pal) {
  const lamp = glow("lamp", pal.lamp, 0.9);
  const beam = glow("beam", pal.lamp, 0.42);
  const rows = [];
  const shelves = [];
  for (let i = 0; i < 9; i += 1) {
    /* 顶层书格从 y=530 起：整摞楼原先往上顶到 y=120，压进了「上 12% 不放关键元素」
       那条硬规则（真机目检：楼顶那盏灯贴在画面上缘，像被裁掉）。往下挪 60px。 */
    const y = 530 + i * 88;
    /* 墙是收分的：越往上越窄，左右各往里让。这条外轮廓就是「塔」而不是「梯子」。 */
    const inset = i * 17;
    rows.push(
      `    <rect x="${120 + inset}" y="${y}" width="${520 - inset * 2}" height="16" fill="${pal.shelfPlank}"/>`
    );
    shelves.push(
      bookSpines(
        126 + inset,
        y - 62,
        508 - inset * 2,
        62,
        pal.booksDark,
        pal.booksLight,
        101 + i * 37
      )
    );
  }
  return {
    defsExtra: `    <linearGradient id="tower-wall" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${pal.wall}"/>
      <stop offset="0.62" stop-color="${pal.wallLit}"/>
      <stop offset="1" stop-color="${pal.wall}"/>
    </linearGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${rgba(pal.fore, 0)}"/>
      <stop offset="1" stop-color="${pal.fore}"/>
    </linearGradient>
${lamp.def}
${beam.def}`,
    body: `  <!-- 远景：右上一道屋脊线，压住「这是室内/山城」的读感 -->
  <path d="M 1904 560 L 1936 500 L 1990 430 L 2110 508 L 2260 400 L 2400 496 L 2560 404 L 2560 560 Z"
        fill="${rgba(pal.far, 0.72)}"/>
  <!-- 楼体：收分的外墙 + 檐 + 顶上的灯 -->
  <path d="M 96 1300 L 150 490 L 560 490 L 614 1300 Z" fill="url(#tower-wall)"/>
  <path d="M 118 490 L 156 390 L 552 390 L 590 490 Z" fill="${pal.wall}"/>
  <path d="M 132 390 L 190 318 L 520 318 L 576 390 Z" fill="${rgba(pal.wallLit, 0.9)}"/>
  <path d="M 190 318 L 356 236 L 520 318 Z" fill="${pal.roof}"/>
  <path d="M 150 490 L 560 490" stroke="${rgba(pal.rim, 0.5)}" stroke-width="7"/>
  <path d="M 156 390 L 552 390" stroke="${rgba(pal.rim, 0.42)}" stroke-width="6"/>
  <!-- 书：九层书脊，每层长短不齐 -->
  <g>${shelves.join("")}</g>
${rows.join("\n")}
  <!-- 三扇亮着的拱窗：暖光从楼里漏出来，是整张画的第二焦点 -->
  <g fill="${rgba(pal.lamp, 0.86)}">
    <path d="M 262 1046 L 262 1140 L 344 1140 L 344 1046 C 344 1010, 262 1010, 262 1046 Z"/>
    <path d="M 396 862 L 396 948 L 468 948 L 468 862 C 468 830, 396 830, 396 862 Z"/>
    <path d="M 236 640 L 236 726 L 308 726 L 308 640 C 308 608, 236 608, 236 640 Z"/>
  </g>
  <g fill="${rgba(pal.lamp, 0.2)}">
    <circle cx="303" cy="1090" r="150"/><circle cx="432" cy="905" r="130"/><circle cx="272" cy="683" r="130"/>
  </g>
  <!-- 楼门：底部一整片透出来的暖光。缩略图判据（G1 面积分层）靠的就是这种**大块**受光面，
       三扇小拱窗加起来不到画面 1%，再怎么提亮都填不进「主体层」那一档。 -->
  <path d="M 292 940 L 292 1176 L 468 1176 L 468 940 C 468 878, 292 878, 292 940 Z" fill="${rgba(pal.lamp, 0.82)}"/>
  <path d="M 316 964 L 316 1176 L 444 1176 L 444 964 C 444 916, 316 916, 316 964 Z" fill="${rgba(pal.paperInScene, 0.5)}"/>
  <g stroke="${rgba(pal.roof, 0.85)}" stroke-width="9" fill="none">
    <path d="M 380 892 L 380 1176"/><path d="M 316 1040 L 444 1040"/>
  </g>
${lamp.at(380, 1030, 380)}
  <!-- 楼顶那盏：灯核 + 一大片光池 + 一道斜下来的光束。
       光束**收在左三分之一里**（原先一路扫到 x=1560，一条硬边斜穿正文区，
       违反规格单规则 1「中段整片低信息」）。 -->
  <path d="M 356 236 L 462 262 L 720 1210 L 540 1258 Z" fill="url(#beam)" opacity="0.46"/>
  <rect x="342" y="186" width="30" height="46" fill="${pal.roof}"/>
  <circle cx="357" cy="216" r="26" fill="${rgba(pal.lamp, 0.98)}"/>
${lamp.at(357, 216, 420)}
  <!-- 右缘案头：一张案子、摊开的稿纸、墨瓶与羽毛笔、上方一盏吊灯 -->
  <g>
    <path d="M 1930 1120 L 2500 1120 L 2520 1160 L 1910 1160 Z" fill="${pal.desk}"/>
    <rect x="1980" y="1160" width="26" height="120" fill="${pal.desk}"/>
    <rect x="2420" y="1160" width="26" height="120" fill="${pal.desk}"/>
    <path d="M 2010 1104 C 2110 1076, 2260 1076, 2360 1104 C 2260 1128, 2110 1128, 2010 1104 Z" fill="${pal.paperInScene}"/>
    <path d="M 2050 1088 C 2130 1068, 2250 1068, 2330 1088" fill="none" stroke="${rgba(pal.rim, 0.5)}" stroke-width="4"/>
    <g stroke="${rgba(pal.ink, 0.7)}" stroke-width="4" fill="none">
      <path d="M 2080 1096 L 2290 1080"/><path d="M 2090 1108 L 2270 1094"/>
    </g>
    <path d="M 2392 1030 L 2440 1030 L 2450 1104 L 2382 1104 Z" fill="${pal.bottle}"/>
    <rect x="2404" y="1010" width="24" height="22" fill="${pal.bottle}"/>
    <path d="M 2424 1006 L 2522 880 L 2538 894 L 2440 1012 Z" fill="${pal.paperInScene}"/>
    <path d="M 2522 880 L 2538 894 L 2556 862 Z" fill="${rgba(pal.rim, 0.8)}"/>
    <rect x="2286" y="700" width="8" height="220" fill="${pal.wall}"/>
    <path d="M 2246 920 L 2334 920 L 2322 962 L 2258 962 Z" fill="${pal.bottle}"/>
    <circle cx="2290" cy="944" r="15" fill="${rgba(pal.lamp, 0.96)}"/>
${lamp.at(2290, 944, 240)}
  </g>
  <!-- 右缘的藏书格：两层歪斜的书脊。灯楼这一族在缩略图上的**边缘信息量**靠它——
       白天那版原先右三分之一只剩一张案子的轮廓，横向亮度梯度量出来 2.26，
       刚够不上「两缘带的信息是中段的两倍」这条（判据 G3）。 -->
  <g>
    <rect x="1946" y="560" width="614" height="18" fill="${pal.shelfPlank}"/>
    <rect x="1946" y="800" width="614" height="18" fill="${pal.shelfPlank}"/>
${bookSpines(1952, 476, 590, 84, pal.booksDark, pal.booksLight, 771)}
${bookSpines(1968, 708, 574, 92, pal.booksLight, pal.booksDark, 877)}
    <path d="M 1952 476 L 1930 560 L 1946 560 Z" fill="${pal.booksDark}"/>
  </g>
  <!-- 前景压深 + 地面 -->
  <rect x="0" y="1180" width="${W}" height="260" fill="url(#floor)"/>
  <path d="M 96 1300 L 614 1300 L 640 1330 L 70 1330 Z" fill="${pal.fore}"/>
${particles(pal.particle, 46, 23, 0.28)}`,
    samples: [
      { name: "楼体", x: 350, y: 900, hex: "wall" },
      { name: "拱窗", x: 303, y: 1090, hex: "lamp" },
      { name: "案头", x: 2215, y: 1100, hex: "paperInScene" },
      { name: "前景", x: 1280, y: 1360, hex: "fore" },
      { name: "中段", x: 1280, y: 620, hex: "mid" }
    ]
  };
}

/* ══ 系列三：墨潭 ══════════════════════════════════════════════════════
   左缘 = 山脊 + 一座**看得出是亭子**的书亭（翘檐、柱、栏、案）；
   右缘 = 近岸的巨石与一枝横出的松；下方 = 潭面，亭与灯在水里各有一道倒影；
   右上 = 月/日一枚 + 两条雾带。v1 读不出亭子：顶是一块平行四边形，没有翘檐也没有栏。 */
function inkPool(pal) {
  const lamp = glow("lamp", pal.lamp, 0.9);
  const orb = glow("orb", pal.orb, 0.92);
  /* 雾带：只铺左右两缘，而且**每一块自己就带四向衰减**。
     真机目检 v2-a：三条横贯全幅的硬边矩形，把中段抬亮了（违反规格单规则 1），
     还在 x=700/1860 留下竖直切口、把月盘横切成三节。
     真机目检 v2-b：改成 rect + objectBoundingBox 的 radialGradient 后，竖直切口没了，
     但**上下两条水平切口还在**——bbox 坐标下 r=0.88 是相对包围盒的，矩形又扁又宽，
     于是渐变在 y 方向根本没走完就撞上 rect 上沿，读成右半屏一块浅色的板。
     现在：每块雾自己就是一枚 ellipse，配 cx/cy=0.5 r=0.5 的径向渐变——
     椭圆边界处 alpha 恒为 0，几何上不可能再切出直边；靠中段那一头收在 x≤740。 */
  const mistBands = [
    { cx: 300, cy: 350, rx: 400, ry: 70, side: "l" },
    { cx: 320, cy: 528, rx: 420, ry: 86, side: "l" },
    { cx: 300, cy: 708, rx: 400, ry: 100, side: "l" },
    { cx: 2200, cy: 582, rx: 360, ry: 80, side: "r" },
    { cx: 2180, cy: 756, rx: 380, ry: 96, side: "r" }
  ]
    .map(
      (b) =>
        `    <ellipse cx="${b.cx}" cy="${b.cy}" rx="${b.rx}" ry="${b.ry}" fill="url(#mist-${b.side})"/>`
    )
    .join("\n");
  return {
    defsExtra: `    <linearGradient id="water-band" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${rgba(pal.waterTop, 0)}"/>
      <stop offset="0.3" stop-color="${rgba(pal.waterTop, 0.42)}"/>
      <stop offset="0.58" stop-color="${rgba(pal.waterMid, 0.62)}"/>
      <stop offset="1" stop-color="${pal.waterDeep}"/>
    </linearGradient>
    <radialGradient id="mist-l" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${rgba(pal.mist, 0.24)}"/>
      <stop offset="0.55" stop-color="${rgba(pal.mist, 0.1)}"/>
      <stop offset="1" stop-color="${rgba(pal.mist, 0)}"/>
    </radialGradient>
    <radialGradient id="mist-r" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${rgba(pal.mist, 0.22)}"/>
      <stop offset="0.55" stop-color="${rgba(pal.mist, 0.09)}"/>
      <stop offset="1" stop-color="${rgba(pal.mist, 0)}"/>
    </radialGradient>
    <linearGradient id="rock" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${pal.rockLit}"/>
      <stop offset="1" stop-color="${pal.rock}"/>
    </linearGradient>
${lamp.def}
${orb.def}`,
    body: `  <!-- 天体：右上那枚月/日，带一大圈光晕——缩略图下的第一读点 -->
${orb.at(2170, 300, 500)}
  <circle cx="2170" cy="300" r="92" fill="${rgba(pal.orb, 0.97)}"/>
  <circle cx="2170" cy="300" r="132" fill="${rgba(pal.orb, 0.22)}"/>
  <!-- 三重山脊：由远及近，一层比一层深，这是整张画的纵深骨架。
       每一条靠中段的那一头都**收进斜坡**：v2-a 用「L 700 760 L 0 760」这种
       直角闭边，在真机上读成山旁边立了一块板（x=700 / x=1860 两条竖直亮边）。 -->
  <path d="M 1900 700 L 1952 618 L 1990 520 L 2120 596 L 2280 470 L 2420 574 L 2560 470 L 2560 700 Z"
        fill="${rgba(pal.ridgeFar, 0.8)}"/>
  <path d="M 0 560 L 190 400 L 330 500 L 520 340 L 700 520 C 688 606, 660 690, 616 760 L 0 760 Z" fill="${pal.ridgeMid}"/>
  <path d="M 0 700 L 150 590 L 300 690 L 470 560 L 660 706 C 676 800, 660 902, 620 1000 L 0 1000 Z" fill="${pal.ridgeNear}"/>
  <path d="M 190 400 L 330 500 L 520 340 L 700 520" fill="none" stroke="${rgba(pal.rim, 0.34)}" stroke-width="6"/>
  <!-- 雾带：三条横的，压在山与亭之间 -->
  <g>
${mistBands}
  </g>
  <!-- 书亭：左缘。翘起的檐、四根柱、栏杆、案上摊开的稿纸、檐下那盏灯 -->
  <g>
    <path d="M 120 742 C 200 700, 560 700, 640 742 L 604 764 L 156 764 Z" fill="${pal.roof}"/>
    <path d="M 120 742 C 84 726, 56 692, 44 656 C 96 690, 132 712, 168 722 Z" fill="${pal.roof}"/>
    <path d="M 640 742 C 676 726, 704 692, 716 656 C 664 690, 628 712, 592 722 Z" fill="${pal.roof}"/>
    <path d="M 250 690 L 380 620 L 510 690 Z" fill="${pal.roof}"/>
    <path d="M 380 596 L 380 620" stroke="${pal.roof}" stroke-width="10"/>
    <circle cx="380" cy="590" r="13" fill="${rgba(pal.rim, 0.8)}"/>
    <g fill="${pal.wood}">
      <rect x="176" y="764" width="20" height="238"/>
      <rect x="560" y="764" width="20" height="238"/>
      <rect x="300" y="764" width="14" height="238" opacity="0.7"/>
      <rect x="452" y="764" width="14" height="238" opacity="0.7"/>
      <rect x="150" y="986" width="456" height="20"/>
    </g>
    <g fill="${rgba(pal.wood, 0.9)}">
      <rect x="164" y="900" width="432" height="12"/>
      <rect x="180" y="912" width="10" height="74"/><rect x="252" y="912" width="10" height="74"/>
      <rect x="324" y="912" width="10" height="74"/><rect x="396" y="912" width="10" height="74"/>
      <rect x="468" y="912" width="10" height="74"/><rect x="540" y="912" width="10" height="74"/>
    </g>
    <path d="M 232 962 L 520 962 L 536 986 L 216 986 Z" fill="${pal.desk}"/>
    <path d="M 268 946 C 330 932, 430 932, 492 946 C 430 958, 330 958, 268 946 Z" fill="${pal.paperInScene}"/>
    <path d="M 470 918 L 512 918 L 518 958 L 464 958 Z" fill="${pal.wood}"/>
  </g>
  <!-- 檐下那盏灯：暖光 + 光池，亭子内透出来的一片 -->
  <rect x="368" y="764" width="8" height="46" fill="${pal.wood}"/>
  <path d="M 344 810 L 400 810 L 392 856 L 352 856 Z" fill="${rgba(pal.lamp, 0.94)}"/>
${lamp.at(372, 832, 260)}
  <!-- 右缘：近岸巨石 + 一枝横出的松。松的读点是「层叠的扇形针叶团」 -->
  <g>
    /* 巨石：夜里的石头必须**比水暗**，只让月照到的那道棱亮。
       v2-b 是一枚圆润的鼓包 + 半透明亮面，真机无损图上看就是一块磨砂玻璃罩子；
       石头读不出石头，是因为它没有棱——改成多段折线的块面，受光只给棱线。 */
    <path d="M 1952 1058 L 2008 966 L 2096 908 L 2188 886 L 2296 906 L 2392 962 L 2470 1006 L 2560 1044 L 2560 1176 L 2400 1194 L 2246 1178 L 2100 1146 L 1990 1104 Z"
          fill="url(#rock)"/>
    <path d="M 2188 886 L 2296 906 L 2392 962 L 2470 1006 L 2560 1044" fill="none" stroke="${rgba(pal.rim, 0.4)}" stroke-width="7"/>
    <g fill="none" stroke="${rgba(pal.rockLit, 0.55)}" stroke-width="5">
      <path d="M 2188 886 L 2152 1046 L 2040 1090"/>
      <path d="M 2296 906 L 2322 1082 L 2440 1120"/>
    </g>
    <path d="M 2050 1080 L 2270 1010 L 2296 1042 C 2240 1076, 2130 1104, 2062 1112 Z" fill="${rgba(pal.rockLit, 0.5)}"/>
    <path d="M 2400 900 C 2350 830, 2280 792, 2180 780 C 2260 812, 2320 852, 2356 912 Z" fill="${pal.pine}"/>
    <g fill="${pal.pine}">
      <path d="M 2170 780 C 2100 742, 2010 736, 1940 762 C 2020 786, 2100 800, 2156 800 Z"/>
      <path d="M 2210 742 C 2150 700, 2060 690, 1986 708 C 2066 736, 2146 754, 2198 758 Z"/>
      <path d="M 2262 706 C 2214 660, 2136 646, 2064 660 C 2140 692, 2206 714, 2250 720 Z"/>
    </g>
  </g>
  <!-- 潭面：水平亮带 + 左右两缘的涟漪 + 亭与灯的两道倒影 -->
${water(1000, pal, 51)}
  <g fill="${rgba(pal.lamp, 0.26)}">
    <rect x="356" y="1016" width="30" height="26" rx="13"/><rect x="362" y="1058" width="20" height="20" rx="10"/>
    <rect x="352" y="1094" width="34" height="18" rx="9"/><rect x="366" y="1128" width="16" height="16" rx="8"/>
  </g>
  <g fill="${rgba(pal.wood, 0.34)}">
    <rect x="176" y="1020" width="22" height="120" rx="6"/><rect x="540" y="1020" width="22" height="120" rx="6"/>
    <rect x="216" y="1150" width="344" height="16" rx="8"/>
  </g>
  <g fill="${rgba(pal.orb, 0.22)}">
    <rect x="2136" y="1016" width="70" height="22" rx="11"/><rect x="2148" y="1056" width="46" height="18" rx="9"/>
    <rect x="2132" y="1090" width="76" height="16" rx="8"/>
  </g>
  <!-- 前景压深：左右两块近岸的暗色，把视线压向中间那片空水。
       轮廓必须是**岸石**的曲线：v2-a 那版两条竖直闭边让它们读成了两块黑矩形。 -->
  <path d="M 0 1176 C 150 1136, 330 1160, 470 1214 C 520 1236, 500 1300, 452 1344 C 410 1382, 392 1414, 396 1440 L 0 1440 Z" fill="${pal.fore}"/>
  <path d="M 0 1176 C 150 1136, 330 1160, 470 1214" fill="none" stroke="${rgba(pal.rim, 0.26)}" stroke-width="6"/>
  <path d="M 2560 1156 C 2410 1126, 2230 1160, 2100 1220 C 2052 1244, 2072 1304, 2116 1348 C 2156 1388, 2172 1414, 2168 1440 L 2560 1440 Z" fill="${pal.fore}"/>
  <path d="M 2560 1156 C 2410 1126, 2230 1160, 2100 1220" fill="none" stroke="${rgba(pal.rim, 0.22)}" stroke-width="6"/>
${particles(pal.particle, 40, 91, 0.26)}`,
    samples: [
      { name: "亭顶", x: 380, y: 700, hex: "roof" },
      { name: "近山", x: 300, y: 660, hex: "ridgeNear" },
      { name: "月/日", x: 2170, y: 300, hex: "orb" },
      { name: "前景", x: 200, y: 1360, hex: "fore" },
      { name: "中段", x: 1280, y: 640, hex: "waterMid" }
    ]
  };
}

/* ══ 六张的调色板 ══════════════════════════════════════════════════════
   夜版与昼版共用同一份几何，只换色温与光源（规格单规则 4）。
   每版的 top/mid/bottom 对齐该套皮肤自己的 background。
   **明度是这里定的**：主体（whale / wall / roof / fore）与中段背景必须拉开 ≥ 22 个亮度点，
   末尾那段自检会逐张算，不够就抛错——上一版就是栽在「差十几个点，看着是同一层」。 */
const PALETTES = {
  "book-boat-night": {
    /* 【夜版为什么把主体「提亮」而不是「压暗成剪影」】
       v1 的夜版整幅都挤在亮度 1–7：鲸 2、舟 1、水 5、天 16。相对亮度是
       gamma 校正过的量，暗端这几点的差别肉眼根本分不出来 ⇒ 缩略图上「没有画」。
       这一版按**月光照在物体上**来定值：迎光的鲸背 53、被船头灯照亮的舷口 66、
       帆 195、纸堆 232，而深水和前景仍然压到 1–5。剪影只留给前景那一条。
       `top` 抬高到 35 是「靠近水面的一层水透光」，不是页面底色——
       皮肤自己的 background 仍锁 `mid/bottom`（见 appearanceSkins.ts 那六条）。 */
    top: "#2C6E8C",
    mid: "#0D2839",
    bottom: "#060F18",
    light: "#A8E4F8",
    lightAlpha: 0.3,
    corridor: "#04090F",
    corridorAlpha: 0.42,
    corridorMidAlpha: 0.26,
    far: "#1B4A66",
    whaleTop: "#7CC4DE",
    whale: "#3E86A8",
    whaleBelly: "#16455E",
    rim: "#BDF0FF",
    boat: "#0A2233",
    boatTop: "#4E93B4",
    sail: "#C9E8F4",
    paperInScene: "#EAF7FC",
    lamp: "#FFCE86",
    particle: "#9FDCF2",
    ripple: "#5FB6D8",
    wash: "#5FA8C6",
    washAlpha: 0.3,
    fore: "#02080E",
    vignette: 0.22
  },
  "book-boat-day": {
    top: "#DFF4FB",
    mid: "#AFDDEC",
    bottom: "#7FBAD6",
    light: "#FFFFFF",
    lightAlpha: 0.5,
    corridor: "#EDF9FD",
    corridorAlpha: 0.66,
    corridorMidAlpha: 0.4,
    far: "#CBE8F3",
    whaleTop: "#4E8FAE",
    whale: "#2F6D8C",
    whaleBelly: "#6BA6C2",
    rim: "#FFFFFF",
    boat: "#1E4C63",
    boatTop: "#3E7E9C",
    sail: "#F2FAFD",
    paperInScene: "#FFFFFF",
    lamp: "#F0B863",
    particle: "#FFFFFF",
    ripple: "#FFFFFF",
    fore: "#1D4A61",
    vignette: 0.1
  },
  "lamp-tower-night": {
    /* 夜里这座楼是**自己把自己照亮**的：灯核在楼顶，暖光顺着墙爬下来，
       所以受光的墙（31）与书脊亮面（34）必须显著高于夜色背景（3）；
       背光侧与屋顶仍然是 4–7，靠这一明一暗把「建筑」的体积读出来。 */
    top: "#23405F",
    mid: "#0E1B2B",
    bottom: "#060C14",
    light: "#A8C4EE",
    lightAlpha: 0.26,
    corridor: "#050A12",
    corridorAlpha: 0.44,
    corridorMidAlpha: 0.26,
    far: "#16273F",
    wall: "#4E88AE",
    wallLit: "#8FC0DC",
    roof: "#0B1B2B",
    shelfPlank: "#152F46",
    booksDark: "#1A3548",
    booksLight: "#8FC0DC",
    desk: "#22415E",
    paperInScene: "#DCEAF3",
    ink: "#8FBCE0",
    bottle: "#0F3040",
    rim: "#BFD8F2",
    fore: "#040A11",
    wash: "#4E88AE",
    washAlpha: 0.24,
    lamp: "#FFD08A",
    particle: "#CBD9F0",
    vignette: 0.22
  },
  "lamp-tower-day": {
    top: "#FBF3E2",
    mid: "#EADFC6",
    bottom: "#C8B994",
    light: "#FFFFFF",
    lightAlpha: 0.46,
    corridor: "#FCF8EE",
    corridorAlpha: 0.62,
    corridorMidAlpha: 0.38,
    far: "#E3D6B8",
    wall: "#B79E71",
    wallLit: "#E7D6AE",
    roof: "#7C6540",
    shelfPlank: "#8E7750",
    booksDark: "#6E5A3A",
    booksLight: "#C9AE7C",
    desk: "#8B7047",
    paperInScene: "#FFFDF6",
    ink: "#5E4B2E",
    bottle: "#6C5B3C",
    rim: "#FFF7E4",
    fore: "#6B5433",
    lamp: "#F7C873",
    particle: "#FFFFFF",
    vignette: 0.12
  },
  "ink-pool-night": {
    /* 这一张的光源是右上那轮月：**越近的山脊被月亮照得越亮**（42 / 24 / 9 三层递进），
       亭顶受光 71 而柱与案沉到 12–22，潭面从水口的 25 一路沉到深处的 1。
       v1 这三层山是 9 / 5 / 3——三层压在同一个亮度上，所以读成一片糊。 */
    top: "#1E4A52",
    mid: "#0A1D22",
    bottom: "#040B0F",
    light: "#7CC4BC",
    lightAlpha: 0.24,
    corridor: "#03090C",
    corridorAlpha: 0.42,
    corridorMidAlpha: 0.24,
    orb: "#E8F6FA",
    ridgeFar: "#255E66",
    ridgeMid: "#3C7A80",
    ridgeNear: "#4E8A8E",
    mist: "#7FB8B0",
    roof: "#5E9AA0",
    wood: "#2A5A62",
    desk: "#3E7078",
    paperInScene: "#DCEFEA",
    rock: "#0E2A31",
    rockLit: "#2E5A63",
    pine: "#123A40",
    rim: "#7FC9D8",
    waterTop: "#3C7A80",
    waterMid: "#2A6068",
    waterDeep: "#0A2429",
    ripple: "#7CC4BC",
    lamp: "#FFCB84",
    particle: "#A8DCD6",
    wash: "#3C7A80",
    washAlpha: 0.34,
    fore: "#020809",
    vignette: 0.22
  },
  "ink-pool-day": {
    top: "#E8F5EE",
    mid: "#C6E0DC",
    bottom: "#9CC6C6",
    light: "#FFFFFF",
    lightAlpha: 0.46,
    corridor: "#F0F9F5",
    corridorAlpha: 0.6,
    corridorMidAlpha: 0.36,
    orb: "#FFF6D8",
    ridgeFar: "#B4D2CC",
    ridgeMid: "#7FA8A2",
    ridgeNear: "#4E7C78",
    mist: "#FFFFFF",
    roof: "#3C5F5C",
    wood: "#2E4F4C",
    desk: "#426763",
    paperInScene: "#FFFFFF",
    rock: "#3A5F5C",
    rockLit: "#6E918C",
    pine: "#25453F",
    rim: "#FFFFFF",
    waterTop: "#CFE8E4",
    waterMid: "#9CC8C8",
    waterDeep: "#5E8E8E",
    ripple: "#FFFFFF",
    lamp: "#F2B95E",
    particle: "#FFFFFF",
    fore: "#20403E",
    vignette: 0.12
  }
};

const SCENES = {
  "book-boat-night": bookBoat,
  "book-boat-day": bookBoat,
  "lamp-tower-night": lampTower,
  "lamp-tower-day": lampTower,
  "ink-pool-night": inkPool,
  "ink-pool-day": inkPool
};

function vignetteDef(strength) {
  return `    <radialGradient id="vignette" cx="0.5" cy="0.5" r="0.78">
      <stop offset="0.55" stop-color="rgba(0, 0, 0, 0)"/>
      <stop offset="1" stop-color="rgba(0, 0, 0, ${strength})"/>
    </radialGradient>`;
}

/**
 * 明度自检：把每张画自己的 samples（主体 / 焦点 / 前景 / 中段背景）两两比亮度差。
 * 判据取「主体 vs 中段背景」这一对——缩略图下能不能看出有个东西，就看这一对。
 */
function checkContrast(id, pal, samples) {
  const rows = samples.map((s) => {
    const hex = s.hex === "mid" ? pal.mid : pal[s.hex];
    if (!hex) throw new Error(`${id}: 取样点 ${s.name} 指向不存在的色值 ${s.hex}`);
    return { name: s.name, l: luma255(hex), hex };
  });
  const bg = rows.find((r) => r.name === "中段");
  const subjects = rows.filter((r) => r.name !== "中段" && r.name !== "前景");
  const gaps = subjects.map((r) => ({ pair: r.name + "↔中段", gap: Math.abs(r.l - bg.l) }));
  const worst = gaps.reduce((a, b) => (b.gap < a.gap ? b : a));
  return { rows, gaps, worst };
}

const written = [];
const report = [];
for (const [id, pal] of Object.entries(PALETTES)) {
  const scene = SCENES[id](pal);
  const sh = shafts(pal.particle, id.endsWith("-day") ? 0.14 : 0.08);
  const wash = pal.washAlpha ? ambientWash(pal.wash, pal.washAlpha) : { def: "", body: "" };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">
  <defs>
    <linearGradient id="column" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${pal.top}"/>
      <stop offset="0.42" stop-color="${pal.mid}"/>
      <stop offset="1" stop-color="${pal.bottom}"/>
    </linearGradient>
    <radialGradient id="ceiling-light" cx="0.5" cy="0" r="0.72">
      <stop offset="0" stop-color="${rgba(pal.light, pal.lightAlpha)}"/>
      <stop offset="1" stop-color="${rgba(pal.light, 0)}"/>
    </radialGradient>
    <radialGradient id="corridor" cx="0.5" cy="0.52" r="0.5">
      <stop offset="0" stop-color="${rgba(pal.corridor, pal.corridorAlpha)}"/>
      <stop offset="0.6" stop-color="${rgba(pal.corridor, pal.corridorMidAlpha)}"/>
      <stop offset="1" stop-color="${rgba(pal.corridor, 0)}"/>
    </radialGradient>
${[vignetteDef(pal.vignette), wash.def, sh.defs, scene.defsExtra].join("\n")}
  </defs>
  <rect width="${W}" height="${H}" fill="url(#column)"/>
  <rect width="${W}" height="${H}" fill="url(#ceiling-light)"/>
  <rect x="700" y="150" width="1160" height="1140" fill="url(#corridor)"/>
${wash.body}
${sh.body}
${scene.body}
  <rect width="${W}" height="${H}" fill="url(#vignette)"/>
</svg>
`;
  const c = checkContrast(id, pal, scene.samples);
  report.push(`${id} 最差间隔 ${c.worst.pair} = ${c.worst.gap}（阈值 22）`);
  if (c.worst.gap < 22) {
    throw new Error(
      `${id}: 主体与中段的亮度间隔只有 ${c.worst.gap}，缩略图下读不出来 —— ${JSON.stringify(c.gaps)}`
    );
  }
  const file = path.join(outDir, `${id}.svg`);
  fs.writeFileSync(file, svg, "utf8");
  written.push(`${id}.svg ${(fs.statSync(file).size / 1024).toFixed(1)}KB`);
}
console.log(written.join("\n"));
console.log(report.join("\n"));
