import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BUILTIN_SKILLS,
  LEGACY_SKILL_SHA,
  bodyShaOf,
  builtinActionOf,
  seedBuiltinSkills,
  type BuiltinSkill
} from "./builtin-skills.js";

/**
 * 出厂技能的落盘与升级（2026-11-12）。
 *
 * 这一层的风险不在「写不写得对」，在**什么时候会写**：一次误判就把用户手改过的技能冲掉。
 * 所以判定表这里逐条钉死，IO 那半边只测「三种动作各跑通一次」。
 *
 * 纯判定与 IO 分开测还有个原因：`builtinActionOf` 的迁移依据可以注进来（第四参数），
 * 否则要造「v0 出厂原文」就得把当年的正文抄进测试——那又是一份第二份真身。
 */

const STYLE = BUILTIN_SKILLS.find((skill) => skill.dirName === "check-style")!;

/** 造一个版本可控的假技能：目录名沿用 check-style，正文随版本变。 */
function fakeSkill(version: number, body = `正文 v${version}`): BuiltinSkill {
  return { dirName: "check-style", version, skillMd: `# 假技能\n\n${body}\n` };
}

describe("builtinActionOf · 该写、该升、还是别动", () => {
  it("盘上没有这一份 ⇒ 写", () => {
    expect(builtinActionOf(STYLE, null)).toBe("write");
  });

  it("元数据对得上、版本更旧 ⇒ 升级（用户没动过它，改的是我们自己的字）", () => {
    const old = fakeSkill(1);
    const state = {
      content: old.skillMd,
      meta: { dirName: "check-style", version: 1, sha: bodyShaOf(old.skillMd) }
    };
    expect(builtinActionOf(fakeSkill(2), state)).toBe("upgrade");
  });

  it("元数据对得上、版本相同 ⇒ 不动（每次启动都重写一遍是没必要的写盘）", () => {
    const now = fakeSkill(2);
    const state = {
      content: now.skillMd,
      meta: { dirName: "check-style", version: 2, sha: bodyShaOf(now.skillMd) }
    };
    expect(builtinActionOf(now, state)).toBe("keep");
  });

  /**
   * 这一条钉的是「改了正文忘了把 version 加一」（2026-11-12）。
   *
   * 旧判据是 `meta.version < skill.version`——版本号没加，正文改了也升级不了，
   * 老用户手上的技能静默停在旧版。这跟「只在文件不存在时写一次」是同一类病：
   * 把「该升级」寄托在一条人肉约定上。现在判据只看正文是不是出厂原文。
   */
  it("版本号没加、正文改了 ⇒ 照样升级（不再依赖「记得 bump version」）", () => {
    const old = fakeSkill(2, "旧正文");
    const state = {
      content: old.skillMd,
      meta: { dirName: "check-style", version: 2, sha: bodyShaOf(old.skillMd) }
    };
    expect(builtinActionOf(fakeSkill(2, "新正文"), state)).toBe("upgrade");
  });

  it("盘上比当前版本还新 ⇒ 不倒退（装了新版又回退旧安装包）", () => {
    const future = fakeSkill(5, "更晚的一版正文");
    const state = {
      content: future.skillMd,
      meta: { dirName: "check-style", version: 5, sha: bodyShaOf(future.skillMd) }
    };
    expect(builtinActionOf(fakeSkill(2), state)).toBe("keep");
  });

  it("正文与记录的指纹对不上 ⇒ 不动——那是用户改过的技能，不是我们的", () => {
    const now = fakeSkill(2);
    const state = {
      content: `${now.skillMd}\n用户加的一句。`,
      meta: { dirName: "check-style", version: 1, sha: bodyShaOf(now.skillMd) }
    };
    expect(builtinActionOf(now, state)).toBe("keep");
  });

  it("没有元数据，但正文逐字等于 v0 出厂原文 ⇒ 升级（老安装的迁移路径）", () => {
    const v0 = fakeSkill(1, "当年那版正文");
    const state = { content: v0.skillMd, meta: null };
    const legacy = { "check-style": [bodyShaOf(v0.skillMd)] };
    expect(builtinActionOf(fakeSkill(2), state, legacy)).toBe("upgrade");
  });

  it("没有元数据，正文也认不出 ⇒ 不当成出厂技能（用户自己写的同名技能）", () => {
    const state = { content: "# 我自己写的文风检查\n\n随便写写。\n", meta: null };
    const legacy = { "check-style": [bodyShaOf("当年那版正文")] };
    expect(builtinActionOf(fakeSkill(2), state, legacy)).toBe("keep");
  });

  it("迁移表只认「逐字相同」：多一个字都不升级", () => {
    const v0 = fakeSkill(1, "当年那版正文");
    const state = { content: `${v0.skillMd} `, meta: null };
    const legacy = { "check-style": [bodyShaOf(v0.skillMd)] };
    expect(builtinActionOf(fakeSkill(2), state, legacy)).toBe("keep");
  });
});

describe("LEGACY_SKILL_SHA · 迁移表", () => {
  it("四枚出厂技能各有一条 v0 指纹", () => {
    for (const skill of BUILTIN_SKILLS) {
      expect(LEGACY_SKILL_SHA[skill.dirName]?.length, skill.dirName).toBeGreaterThan(0);
    }
  });

  it("指纹是 12 位十六进制（与 bodyShaOf 同一口径，抄错一位就永远升不了级）", () => {
    for (const list of Object.values(LEGACY_SKILL_SHA)) {
      for (const sha of list) expect(sha).toMatch(/^[0-9a-f]{12}$/);
    }
  });
});

describe("seedBuiltinSkills · 落盘", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  async function tempDir(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "mochen-builtin-"));
    dirs.push(dir);
    return dir;
  }

  it("空目录：四份全写，每份都带元数据", async () => {
    const root = await tempDir();
    const result = await seedBuiltinSkills(root);
    expect(result.written).toHaveLength(BUILTIN_SKILLS.length);
    expect(result.upgraded).toEqual([]);
    for (const skill of BUILTIN_SKILLS) {
      const md = await readFile(path.join(root, skill.dirName, "SKILL.md"), "utf8");
      expect(md).toBe(skill.skillMd);
      const meta = JSON.parse(
        await readFile(path.join(root, skill.dirName, ".mochen-builtin.json"), "utf8")
      );
      expect(meta).toEqual({ dirName: skill.dirName, version: skill.version, sha: bodyShaOf(md) });
    }
  });

  it("再跑一次：一份都不重写（启动时每次都会跑它）", async () => {
    const root = await tempDir();
    await seedBuiltinSkills(root);
    const again = await seedBuiltinSkills(root);
    expect(again).toEqual({ written: [], upgraded: [] });
  });

  it("元数据版本更旧 ⇒ 正文被换成新版，元数据跟着走到新版本", async () => {
    const root = await tempDir();
    const dir = path.join(root, STYLE.dirName);
    await seedBuiltinSkills(root);
    // 把 check-style 退回上一版：正文与指纹都改回 v1。
    const old = fakeSkill(1, "上一版正文");
    await writeFile(path.join(dir, "SKILL.md"), old.skillMd, "utf8");
    await writeFile(
      path.join(dir, ".mochen-builtin.json"),
      JSON.stringify({ dirName: STYLE.dirName, version: 1, sha: bodyShaOf(old.skillMd) }),
      "utf8"
    );
    const result = await seedBuiltinSkills(root);
    expect(result.upgraded).toEqual([STYLE.dirName]);
    expect(await readFile(path.join(dir, "SKILL.md"), "utf8")).toBe(STYLE.skillMd);
  });

  it("用户改过的正文一个字都不动（连元数据也不补）", async () => {
    const root = await tempDir();
    const dir = path.join(root, STYLE.dirName);
    await seedBuiltinSkills(root);
    const mine = "# 文风检查\n\n我自己那套办法，别动。\n";
    await writeFile(path.join(dir, "SKILL.md"), mine, "utf8");
    const result = await seedBuiltinSkills(root);
    expect(result.upgraded).not.toContain(STYLE.dirName);
    expect(await readFile(path.join(dir, "SKILL.md"), "utf8")).toBe(mine);
  });
});

describe("文风检查的正文（2026-11-12 重写）", () => {
  it("三层分开写：用词 / 句式 / 节奏", () => {
    for (const needle of ["用词层", "句式层", "节奏层"]) expect(STYLE.skillMd).toContain(needle);
  });

  it("句式上限的数字与退稿闸同源（不是手抄的「三处」）", () => {
    // 明喻上限 = 起报线 − 1；正文里点得出来说明它读的是同一张表。
    expect(STYLE.skillMd).toContain("明喻（像／仿佛／好像／宛如）最多 3 处");
    expect(STYLE.skillMd).toContain("「不是A，是B」式升华对偶一章最多 1 处");
  });

  it("不整章重写、不只换同义词——两条后果写在正文里", () => {
    expect(STYLE.skillMd).toContain("不许整章重写");
    expect(STYLE.skillMd).toContain("不许只换同义词");
  });

  it("不再手抄词表：句子里只留方法，词表留在系统提示那一份", () => {
    // 旧版正文照着清单列了一串例子（「嘴角勾起」「眼底闪过」「勾起一抹」「深吸一口气」）；
    // 现在只说「拿系统提示里那份禁用词表逐条对」。正文里唯一的套话是「改同义词等于没改」
    // 那条反例用的，它不是清单。
    expect(STYLE.skillMd).toContain("系统提示里那份禁用词表");
    expect(STYLE.skillMd).not.toContain("「眼底闪过」");
    expect(STYLE.skillMd).not.toContain("深吸一口气");
  });
});
