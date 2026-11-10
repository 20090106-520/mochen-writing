import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSkillAuthorService } from "./skill-author-service.js";

/**
 * 「自己写技能」的写盘用例（2026-11-10）。
 *
 * 这一层是用户自己那份技能的唯一写入口，所以三条守卫必须逐条钉住：
 * 只写全局目录、默认不覆盖、删除要求目录里真有 SKILL.md。
 * 最后一条尤其要验：凭目录名就 rm 一个目录，能删掉用户放在那儿的任何东西。
 */

let root = "";

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "mochen-skill-author-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function service() {
  return createSkillAuthorService({ dirOf: (source) => (source === "global" ? root : null) });
}

const DRAFT = {
  dirName: "scene-smell",
  displayName: "场景里的气味",
  description: "检查场景有没有气味层",
  stages: ["正文"],
  appliesTo: ["chapter"],
  body: "先找五感缺失的段落，再补一处气味。",
  overwrite: false
};

describe("save：写出来的形状与手放/装进来的完全同形", () => {
  it("落成 <全局>/<dirName>/SKILL.md，frontmatter 与正文都在", async () => {
    const result = await service().save(DRAFT);
    expect(result.ok).toBe(true);
    const text = await readFile(path.join(root, "scene-smell", "SKILL.md"), "utf8");
    expect(text.startsWith("---\nname: 场景里的气味\n")).toBe(true);
    expect(text).toContain("description: 检查场景有没有气味层");
    expect(text).toContain("stage: 正文");
    expect(text.trimEnd().endsWith("先找五感缺失的段落，再补一处气味。")).toBe(true);
  });

  it("同名已存在时默认拒，且盘上那份一字不动", async () => {
    const dir = path.join(root, "scene-smell");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "SKILL.md"), "我手改过的", "utf8");

    const result = await service().save(DRAFT);
    expect(result.ok).toBe(false);
    expect(result.notice).toContain("已经有同名技能");
    expect(await readFile(path.join(dir, "SKILL.md"), "utf8")).toBe("我手改过的");
  });

  it("显式勾了覆盖才覆盖", async () => {
    const dir = path.join(root, "scene-smell");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "SKILL.md"), "旧的那份", "utf8");

    const result = await service().save({ ...DRAFT, overwrite: true });
    expect(result.ok).toBe(true);
    expect(await readFile(path.join(dir, "SKILL.md"), "utf8")).toContain("场景里的气味");
  });

  it("目录名不合法、正文为空都在边界上拒，并说人话", async () => {
    const bad = await service().save({ ...DRAFT, dirName: "../逃出去" });
    expect(bad.ok).toBe(false);
    const empty = await service().save({ ...DRAFT, body: "" });
    expect(empty.ok).toBe(false);
    expect(empty.notice).toContain("正文");
  });

  it("全局目录没配好时不写盘", async () => {
    const remote = createSkillAuthorService({ dirOf: () => null });
    const result = await remote.save(DRAFT);
    expect(result.ok).toBe(false);
  });
});

describe("remove：只删真的装着技能的目录", () => {
  it("有 SKILL.md 的那一层删得掉", async () => {
    await service().save(DRAFT);
    const result = await service().remove("scene-smell");
    expect(result.ok).toBe(true);
    await expect(stat(path.join(root, "scene-smell"))).rejects.toThrow();
  });

  it("目录里没有 SKILL.md 就拒——凭名字 rm 会连用户放在那儿的东西一起删", async () => {
    const dir = path.join(root, "not-a-skill");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "我的笔记.txt"), "别删我", "utf8");

    const result = await service().remove("not-a-skill");
    expect(result.ok).toBe(false);
    expect(result.notice).toContain("SKILL.md");
    expect(await readFile(path.join(dir, "我的笔记.txt"), "utf8")).toBe("别删我");
  });

  it("目录名不合法（带路径分隔符）直接拒", async () => {
    const result = await service().remove("../../etc");
    expect(result.ok).toBe(false);
  });
});
