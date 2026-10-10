/*
 * 六张场景画的调色板（波2a，2026-10-08 定的色；2026-10-10 从 gen-scene-svgs.mjs 拆出来）。
 *
 * 【为什么拆】行数预算这道闸从 P2-10 起开始覆盖 `.mjs`，而生成器整个文件当时是 851 行——
 * 超的这 51 行几乎全是这里的色值表。把**数据**搬出去、把**画法**留在原地，是这次唯一动的东西：
 * 拆完必须逐字节复现那六张 SVG（生成器头注释里那条硬规矩），验收方法就是重跑 + `sha256sum -c`。
 *
 * 【这里的东西不许随手改】每个键都是生成器里按名字取的（`pal.whaleTop` 那种），改一个色就是改一张画；
 * 明度间隔的门槛由 `check-scene-art.mjs` 在真机像素上复核，不在这里自说自话。
 */

/* ══ 六张的调色板 ══════════════════════════════════════════════════════
   夜版与昼版共用同一份几何，只换色温与光源（规格单规则 4）。
   每版的 top/mid/bottom 对齐该套皮肤自己的 background。
   **明度是这里定的**：主体（whale / wall / roof / fore）与中段背景必须拉开 ≥ 22 个亮度点，
   末尾那段自检会逐张算，不够就抛错——上一版就是栽在「差十几个点，看着是同一层」。 */
export const PALETTES = {
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
