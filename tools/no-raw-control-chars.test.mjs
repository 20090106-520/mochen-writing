/**
 * 文本源码里不许出现**裸控制字符**（当场抓到的那枚：`utils/context-meter.ts` 的
 * `contextMeterQueryKey` 用了裸 NUL 当键分隔符）。
 *
 * 为什么要立成闸：Git 看到文件前 8000 字节里有 0x00 就把它判成二进制，于是
 * ① `git diff` 只说「Bin 3727 -> 5087 bytes」，评审（在 GitHub 网页上看的）对这个文件
 * 是**全瞎**的；② `.gitattributes` 的 `text=auto / eol=lf` 归一化对它失效；
 * ③ `grep` 默认当二进制跳过，检索与统计都少算它。写转义 `"\u0000"` 得到的是同一个字符，
 * 文件却重新是文本——所以这不是风格问题，是「这一处改动别人看不看得见」的问题。
 *
 * 判据只认扩展名，不认 Git 的二进制探测（正因为那个探测会被一枚 NUL 骗过去）。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** 会被人和工具当文本读的那一类：里面出现控制字符就是事故，不是内容。 */
const TEXT_SOURCE =
  /\.(ts|tsx|js|mjs|cjs|vue|json|css|scss|less|html|md|mdx|yml|yaml|py|sh|ps1|bat|sql|toml|txt)$/i;

/** 允许出现在文本里的控制字符：只有换行与制表（0x09/0x0a/0x0d）。其余 C0 一律算裸控制字符。 */
function rawControlHits(buffer) {
  const hits = [];
  for (let i = 0; i < buffer.length; i += 1) {
    const byte = buffer[i];
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) {
      hits.push({ index: i, byte });
      if (hits.length >= 3) break;
    }
  }
  return hits;
}

describe("文本源码里不许有裸控制字符", () => {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT })
    .toString("utf8")
    .split("\0")
    .filter((rel) => rel !== "" && TEXT_SOURCE.test(rel));

  it("扫得到足够多的文件（扫到 0 个说明判据本身失效）", () => {
    expect(files.length).toBeGreaterThan(300);
  });

  it("逐个读字节：出现 0x00 一类裸控制字符就点名——一枚就够让整份文件在 diff 里隐身", () => {
    const offenders = [];
    for (const rel of files) {
      let buffer;
      try {
        buffer = fs.readFileSync(path.join(ROOT, rel));
      } catch {
        // 工作树里列着却读不到（别人正在改的临时态）：不是本闸要管的事。
        continue;
      }
      const hits = rawControlHits(buffer);
      if (hits.length > 0)
        offenders.push(`${rel} @ ${hits.map((h) => `0x${h.byte.toString(16)}`).join(",")}`);
    }
    expect(offenders).toEqual([]);
  });
});
