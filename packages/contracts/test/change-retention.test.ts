/**
 * 保留上限的**跨包一致性**（2026-10-06 批次 5-⑧）。
 *
 * `fs-store` 不能依赖 `contracts` 的运行时代码（包边界检查会拦），所以默认档那两个数字
 * 必然在两个包里各有一份。跨包复制只能靠测试钉住——这一整份文件就是那个钉子。
 * 改了一处没改另一处，这里就红。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CHANGE_RETENTION_COUNT_MAX,
  CHANGE_RETENTION_COUNT_MIN,
  CHANGE_RETENTION_MB_MAX,
  CHANGE_RETENTION_MB_MIN,
  DEFAULT_CHANGE_RETENTION,
  changeRetentionCountOptions,
  changeRetentionMbOptions,
  changeRetentionNote,
  sanitizeChangeRetention
} from "@mochen/contracts";

/**
 * `fs-store` 的默认档**只能读源文件**比对，不许 import 它。
 *
 * 理由不是"怕循环依赖"：import 进来会在 contracts 的测试里拖进 fs-store 整个包，
 * 而 `tools/check-package-boundary.mjs` 正是要拦这种反向依赖。这里读源文件反而更直接——
 * **要看的就是那份源码里写没写对**。
 */
const fsStoreSource = readFileSync(
  fileURLToPath(new URL("../../fs-store/src/retention-defaults.ts", import.meta.url)),
  "utf8"
);
const contractsSource = readFileSync(
  fileURLToPath(new URL("../src/change-retention.ts", import.meta.url)),
  "utf8"
);

describe("默认档：两个包必须给同一个数", () => {
  /**
   * **这条断言的判据在 5-⑧ 换过一次。**
   *
   * 原来这里拿正则去源码里找 `DEFAULT_CHANGE_KEEP_BYTES_PER_DOC = <数字>`，
   * 但 fs-store 那行写的是 `32 * 1024 * 1024`——表达式，不是数字，于是永远匹配不上。
   * 写成 `32 * 1024 * 1024` 能过，可那就退化成「源码文本逐字比对」，prettier 折一次行就假红。
   *
   * **真正的比法在 `apps/desktop/src/main/change-retention-defaults.test.ts`**：
   * 主进程那两个包都能 import，于是直接 `expect(fsStoreDefault).toEqual(contractsDefault)`
   * 比运行期值。这里只钉「fs-store 那份确实是从常量算出来的、没有手抄字面量」——
   * 那是这段源码唯一值得管的事。
   */
  it("fs-store 那份的字面量由常量算出，不是又手抄了一遍数字", () => {
    // 手抄的话改常量时它不跟着变。
    expect(fsStoreSource).toContain("maxCount: DEFAULT_CHANGE_KEEP_PER_DOC");
    expect(fsStoreSource).toContain("maxBytes: DEFAULT_CHANGE_KEEP_BYTES_PER_DOC");
  });

  it("默认值与 5-⑦ 那个写死的值一字不差（没设置过的用户行为不变）", () => {
    expect(DEFAULT_CHANGE_RETENTION.maxCount).toBe(50);
    expect(DEFAULT_CHANGE_RETENTION.maxBytes).toBe(32 * 1024 * 1024);
    expect(contractsSource).toContain("maxCount: 50");
  });
});

describe("fs-store 的 resolveRetention（读源文件断言，不 import）", () => {
  it("坏值退回默认档，**绝不返回 0**（返回 0 会让淘汰判定「全删光」）", () => {
    // 它的实现全文在这儿：默认档来自常量、正数判断、取整，三样都必须有。
    expect(fsStoreSource).toContain("DEFAULT_CHANGE_KEEP_PER_DOC");
    expect(fsStoreSource).toContain("DEFAULT_CHANGE_KEEP_BYTES_PER_DOC");
    expect(fsStoreSource).toContain("Number.isFinite");
    // 取整方向必须是 round 而不是 floor：对一个要删东西的操作，floor 只可能少留。
    // （与 contracts 的 sanitizeChangeRetention 同向，两边才对得上——跨包比对见
    // apps/desktop/src/main/change-retention-defaults.test.ts）
    expect(fsStoreSource).toContain("Math.round");
    // 带括号才排掉注释里那句「而不是 Math.floor」：匹配裸标识符会把说明文字也当成实现。
    expect(fsStoreSource).not.toContain("Math.floor(");
  });

  it("fs-store 那侧也夹范围，且下界与 contracts 一致（下界才是危险的那一侧）", () => {
    // 只判 `> 0` 的写法会让 `maxCount: 1` 照办，把这一篇砍到只剩 1 份——
    // 而用户那边被夹在 5 份。这条守卫钉的是「两边下界是同一个数」。
    expect(fsStoreSource).toContain("CHANGE_KEEP_COUNT_MIN");
    expect(fsStoreSource).toContain("CHANGE_KEEP_COUNT_MAX");
    expect(fsStoreSource).toContain("CHANGE_KEEP_BYTES_MIN");
    expect(fsStoreSource).toContain("CHANGE_KEEP_BYTES_MAX");
    expect(fsStoreSource).toMatch(/Math\.min\(max,\s*Math\.max\(min,/);
  });
});

describe("sanitizeChangeRetention · 设置页那一层", () => {
  it("越界的值夹回范围内，不拒（用户从旧版升上来时可能是更大的数）", () => {
    expect(sanitizeChangeRetention({ maxCount: 99999, maxBytes: 10 }).maxCount).toBe(
      CHANGE_RETENTION_COUNT_MAX
    );
    expect(sanitizeChangeRetention({ maxCount: 0, maxBytes: 10 }).maxCount).toBe(
      CHANGE_RETENTION_COUNT_MIN
    );
  });

  it("字节上限按 MB 的上下限夹", () => {
    expect(sanitizeChangeRetention({ maxCount: 50, maxBytes: 1 }).maxBytes).toBe(
      CHANGE_RETENTION_MB_MIN * 1024 * 1024
    );
    expect(sanitizeChangeRetention({ maxCount: 50, maxBytes: 1e12 }).maxBytes).toBe(
      CHANGE_RETENTION_MB_MAX * 1024 * 1024
    );
  });

  it("非对象 / null / undefined ⇒ 默认档", () => {
    for (const bad of [null, undefined, 0, "", "abc", [], true]) {
      expect(sanitizeChangeRetention(bad)).toEqual(DEFAULT_CHANGE_RETENTION);
    }
  });

  it("合法值原样透过去（别过度清洗）", () => {
    expect(sanitizeChangeRetention({ maxCount: 100, maxBytes: 100 * 1024 * 1024 })).toEqual({
      maxCount: 100,
      maxBytes: 100 * 1024 * 1024
    });
  });
});

describe("档位表与那句写给用户看的话", () => {
  it("份数档位每一档都有 label 与 note，且都在允许范围内", () => {
    const options = changeRetentionCountOptions();
    expect(options.length).toBeGreaterThanOrEqual(4);
    for (const option of options) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.note.length).toBeGreaterThan(0);
      expect(option.value).toBeGreaterThanOrEqual(CHANGE_RETENTION_COUNT_MIN);
      expect(option.value).toBeLessThanOrEqual(CHANGE_RETENTION_COUNT_MAX);
    }
  });

  it("note 里要给出**大概占多少盘**（用户靠这个判断该选哪一档）", () => {
    for (const option of changeRetentionCountOptions()) {
      expect(option.note).toMatch(/MB|GB/);
    }
  });

  it("字节档位每一档都有 label 与 note", () => {
    for (const option of changeRetentionMbOptions()) {
      expect(option.label).toMatch(/MB/);
      expect(option.note.length).toBeGreaterThan(0);
    }
  });

  it("那句说明把两个数字都报出来，且与传入的一致", () => {
    const note = changeRetentionNote({ maxCount: 120, maxBytes: 100 * 1024 * 1024 });
    expect(note).toContain("120");
    expect(note).toContain("100 MB");
    // 默认档那句也要有同样的信息量
    expect(changeRetentionNote(DEFAULT_CHANGE_RETENTION)).toContain("50");
  });

  it("默认档在份数档位表里（设置页要能直接选中当前值）", () => {
    expect(changeRetentionCountOptions().map((o) => o.value)).toContain(
      DEFAULT_CHANGE_RETENTION.maxCount
    );
    expect(changeRetentionMbOptions().map((o) => o.value * 1024 * 1024)).toContain(
      DEFAULT_CHANGE_RETENTION.maxBytes
    );
  });
});
