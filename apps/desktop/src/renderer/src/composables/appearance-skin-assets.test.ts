/**
 * 素材层守卫：**枚举里每一档画面，盘上都得真有一张画**（2026-10-08 波2a 建）。
 *
 * 【为什么单独一份】
 * 皮肤表、contracts 的 `APPEARANCE_ARTS`、中文档名表这三处的对照已经有守卫（同一份判定
 * 不留两处，见 `appearance-skins.test.ts`）。但那条只比**名字**：
 * 一个 id 可以三处齐全、编译全绿、门禁全绿，而 `public/skins/` 里那张图根本不存在——
 * 表现正是 5-㊵ 真机撞见过的那件事：token 写着 `url(...)`、DOM 里读得到，
 * 屏幕上却什么画都没有，**CSS 对加载失败的背景一律静默当透明**，控制台一个字都没有。
 * ⇒ 这一份负责「读盘」：文件名、字节数、尺寸、以及位图/矢量各自的形状。
 *
 * 【阈值从哪来】
 * `docs/superpowers/specs/2026-10-08-skin-art-asset-spec.md` §1 的三条硬指标
 * （最小 1440×960、比例、单张 ≤ 900KB）。规格单是给人看的，这里是让它**红得起来**的那一份。
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { APPEARANCE_ARTS, type AppearanceArt } from "@mochen/contracts";
import { APPEARANCE_ART_LABELS, appearanceSkins } from "./appearanceSkins";
import { skinStyleVariables } from "./appearanceSkinVisual";

/** 规格单 §1：单张不超过 900KB（每次开窗都要读它，太胖直接拖慢首屏）。 */
const MAX_ART_BYTES = 900 * 1024;
/** 规格单 §1：最小 1440×960。低于这条，`cover` 铺满 1920 宽时就是放大马赛克。 */
const MIN_ART_WIDTH = 1440;
const MIN_ART_HEIGHT = 960;

/**
 * 由**应用自己产出的那条 token** 反解文件路径，不在守卫里重抄一遍文件名。
 * 守卫若自己写死 `skins/x.svg`，将来 `ART_FILES` 改了目录而守卫还绿，
 * 那就是「守卫与代码各自成立」的第二份真相（铁律 6）。
 */
function artRelativePath(art: Exclude<AppearanceArt, "none">): string {
  const token = skinStyleVariables({
    backdrop: "aurora",
    glass: "regions",
    surface: "round-none",
    grid: "none",
    art,
    accent: "#2A7699",
    ink: "#123243",
    paper: "#E8F6FA",
    scheme: "light"
  })["--skin-art-image"] as string;
  const matched = /^url\("([^"]+)"\)$/.exec(token);
  expect(matched, `${art} 的画面 token 不是 url("…") 的形状：${token}`).not.toBeNull();
  return matched?.[1] as string;
}

function artAbsoluteFile(rel: string): string {
  /* 本文件在 `renderer/src/composables/`，而画在 **`renderer/public/`**（electron-vite
     把那里原样拷到产物根）。所以是 `../../`，不是 `../`——
     写成 `../public/` 会指到 `src/public/` 那个根本不存在的目录，
     而守卫的表现是「每条都 ENOENT」，第一次跑就撞出来了。 */
  return fileURLToPath(new URL(`../../public/${rel}`, import.meta.url));
}

/** JPEG：从 SOF 段读真实宽高（零依赖，够用；SOF1/SOF2 也一并认）。 */
function jpegSize(buffer: Buffer): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < buffer.length) {
    if (buffer[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buffer[i + 1] ?? 0x00;
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buffer.readUInt16BE(i + 5), width: buffer.readUInt16BE(i + 7) };
    }
    i += 2 + buffer.readUInt16BE(i + 2);
  }
  return null;
}

/** SVG：读 `viewBox` / `width` 拿比例。矢量没有像素，但**几何比例仍然决定会不会被裁**。 */
function svgSize(text: string): { width: number; height: number } | null {
  const box = /viewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)"/.exec(text);
  if (box) return { width: Number(box[1]), height: Number(box[2]) };
  const wh = /<svg[^>]*\swidth="([\d.]+)"[^>]*\sheight="([\d.]+)"/.exec(text);
  return wh ? { width: Number(wh[1]), height: Number(wh[2]) } : null;
}

/**
 * WebP：从 RIFF 的四个子块里量尺寸（2026-10-08 波2a 起，那两张位图入库时被仓内
 * 转码器压成 WebP——见 `appearanceSkinVisual.ts` 的 `ART_FILES` 与
 * `docs/superpowers/plans/2026-10-08-wave2a-vector-skins-report.md`）。
 * 认三种子块：`VP8 `（有损，尺寸在帧头后两个 14 位字段）、`VP8L`（无损，
 * 尺寸是签名后那 14+14 位）、`VP8X`（扩展头，24 位画布宽高）。
 * 认不出来就返回 null，让那条「量不出尺寸」的断言指名道姓地红——
 * 而不是悄悄跳过一条本该有尺寸的位图。
 *
 * ⚠️【2026-10-17 第三刀】盘上**已经一张 WebP 都没有了**（八张全换成 `.jpg`），
 * 所以这一支现在只在「有人把某张换回 webp」时才会走到。
 * **故意留着不删**：上面那条扩展名白名单仍然认 webp，删了这个读法，
 * 那一档就变成「白名单放行、却量不出尺寸」的沉默洞。
 */
function webpSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 30) return null;
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
    return null;
  }
  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8X") {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3)
    };
  }
  if (chunk === "VP8 ") {
    // 帧标签 3 字节 + 3 字节起始码 `0x9d 0x01 0x2a`，其后宽高各占 2 字节的低 14 位。
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff
    };
  }
  if (chunk === "VP8L") {
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

/** 按扩展名分发——「能不能量出尺寸」这件事按格式各自负责，不许用一种读法糊过去。 */
function imageSize(rel: string, file: string): { width: number; height: number } | null {
  if (/\.svg$/i.test(rel)) return svgSize(readFileSync(file, "utf8"));
  const bytes = readFileSync(file);
  if (/\.webp$/i.test(rel)) return webpSize(bytes);
  return jpegSize(bytes);
}

const artsWithFiles = APPEARANCE_ARTS.filter(
  (one): one is Exclude<AppearanceArt, "none"> => one !== "none"
);

describe("素材 · 每个画面档都得在盘上", () => {
  it("皮肤表非空（空了下面每条遍历全绿而一条不测）", () => {
    expect(appearanceSkins.length, "广场空了").toBeGreaterThan(0);
  });

  it("枚举里每一档（none 除外）都给一条 `skins/<文件>`，且路径不许跑出 public 目录", () => {
    for (const art of artsWithFiles) {
      const rel = artRelativePath(art);
      expect(rel, `${art} 的路径没落在 skins/ 下 —— 那一路径就是从数据里长出来的`).toMatch(
        /^skins\/[\w.-]+$/
      );
      expect(rel, `${art} 的路径想往外跑`).not.toContain("..");
    }
  });

  it("每一条路径指向的文件真实存在、非空，且扩展名在允许的四种格式里", () => {
    for (const art of artsWithFiles) {
      const rel = artRelativePath(art);
      const file = artAbsoluteFile(rel);
      expect(existsSync(file), `${art} 的画在盘上不存在：${file}`).toBe(true);
      const bytes = statSync(file).size;
      expect(bytes, `${art} 的画是 0 字节 —— 背景层会静默什么都不画`).toBeGreaterThan(0);
      expect(/\.(jpe?g|png|webp|svg)$/i.test(rel), `${art} 的画不是可交付格式：${rel}`).toBe(true);
    }
  });

  it("单张不超过 900KB（规格单 §1：每次开窗都要读它）", () => {
    for (const art of artsWithFiles) {
      const file = artAbsoluteFile(artRelativePath(art));
      const kb = statSync(file).size / 1024;
      expect(kb, `${art} 的画 ${kb.toFixed(0)}KB，超了那条 900KB 的首屏线`).toBeLessThanOrEqual(
        MAX_ART_BYTES / 1024
      );
    }
  });

  it("尺寸：位图按 SOF/WebP 子块量、矢量按 viewBox 量，都不许低于 1440×960 且必须是横幅", () => {
    for (const art of artsWithFiles) {
      const rel = artRelativePath(art);
      const file = artAbsoluteFile(rel);
      const size = imageSize(rel, file);
      expect(
        size,
        `${art} 量不出尺寸 —— 那张文件既不是可解析的 SVG，也不是可读的 JPEG/WebP`
      ).not.toBeNull();
      if (size === null) continue;
      expect(size.width, `${art} 宽 ${size.width}，低于 1440`).toBeGreaterThanOrEqual(
        MIN_ART_WIDTH
      );
      expect(size.height, `${art} 高 ${size.height}，低于 960`).toBeGreaterThanOrEqual(
        MIN_ART_HEIGHT
      );
      // 整窗是横的。竖幅（比例 < 1.2）铺满宽窗时会被 `cover` 裁掉上下，
      // 而上下正好是光源与暗角所在——裁完就成了「换了个色调」。
      expect(
        size.width / size.height,
        `${art} 的比例 ${size.width}×${size.height} 太方`
      ).toBeGreaterThanOrEqual(1.2);
    }
  });

  it("画面里不许有可读文字，也不许有远程引用（规格单 §2 第 5 条）", () => {
    for (const art of artsWithFiles) {
      const rel = artRelativePath(art);
      if (!/\.svg$/i.test(rel)) continue;
      const text = readFileSync(artAbsoluteFile(rel), "utf8");
      expect(text, `${art} 的画里有 <text> —— 界面之上再叠一层假字`).not.toMatch(/<text[\s>]/);
      expect(text, `${art} 的画里嵌了 <image> —— 那等于把远程图藏在「矢量」名义下`).not.toMatch(
        /<image[\s>]/
      );
      /* 【谓词自己先别撒谎】（2026-10-08 首轮就跑红过）
         这一条原先直接扫 `https?://`，结果**每张合法 SVG 都红**——
         因为 `xmlns="http://www.w3.org/2000/svg"` 是 SVG 的命名空间声明，
         它必须在那儿，而它不是「引用了远程资源」。
         ⇒ 只扫真正会发请求的两种写法：href/src 指向 http(s)。 */
      expect(text, `${art} 的画里有指向远程的 href/src —— 每次开窗都会发一个请求`).not.toMatch(
        /(?:href|src)\s*=\s*"https?:\/\//i
      );
    }
  });

  it("每张画都有中文档名，且没有一张画是没被任何皮肤用的死档", () => {
    for (const art of artsWithFiles) {
      expect(APPEARANCE_ART_LABELS[art], `${art} 没有中文档名`).toBeTruthy();
      expect(
        appearanceSkins.some((skin) => skin.art === art),
        `${art} 在枚举与盘上都齐了，却没有一条皮肤在用 —— 广场筛选条会多出一枚死档按钮`
      ).toBe(true);
    }
  });

  /**
   * 【昼夜成对为什么必须钉在「皮肤」而不是「画的 id」上】
   * 规格单 §2 第 4 条要求浅色版与深色版是同一套构图，也就是**成对**。
   * 但已入库的那一对名字并不同源（`shallow-hall-day` / `abyss-hall-night`，
   * 一个是「浅海阁」一个是「深海阁」），按 id 前缀配对当场就红而代码是对的。
   * ⇒ 判据落在皮肤 id 上：`*-day` 必须有一条同系列的 `*-night`，
   *   且白天那套用的画自己得是 `-day`（反过来也一样）——
   *   「白天用了夜里的画」这件事只有这一层看得出来。
   */
  it("白天与夜里必须成对，且哪一套用哪一版的画不许串", () => {
    const ids = appearanceSkins.map((skin) => skin.id);
    for (const skin of appearanceSkins) {
      const isDay = skin.id.endsWith("-day");
      const isNight = skin.id.endsWith("-night");
      expect(isDay || isNight, `${skin.id} 的 id 没按「-day / -night」成对命名`).toBe(true);
      const siblingId = isDay
        ? skin.id.replace(/-day$/, "-night")
        : skin.id.replace(/-night$/, "-day");
      expect(ids, `皮肤表里找不到 ${skin.id} 的另一版（${siblingId}）`).toContain(siblingId);
      expect(
        skin.art.endsWith(isDay ? "-day" : "-night"),
        `${skin.id} 用的是另一版的画（${skin.art}）—— 白天挂了夜里的图，等于昼夜串了`
      ).toBe(true);
    }
  });
});
