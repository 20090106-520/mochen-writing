import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SKILL_CONTENT_MAX_BYTES, SKILL_FILE_NAME } from "@mochen/contracts";
import { mergeSkillRefs, readSkillFile, scanSkills, type SkillRef } from "../src/skills.js";

const dirs: string[] = [];
async function tmp(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "mochen-skills-"));
  dirs.push(dir);
  return dir;
}

async function skill(
  root: string,
  dirName: string,
  front: string,
  body = "正文。\n"
): Promise<void> {
  const full = path.join(root, dirName);
  await mkdir(full, { recursive: true });
  await writeFile(path.join(full, SKILL_FILE_NAME), `---\n${front}\n---\n\n${body}`, "utf8");
}

afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

describe("scanSkills", () => {
  it("扫一层子目录，id 恒为 `${source}:${dirName}`，relPath 恒为 `<dirName>/SKILL.md`", async () => {
    const root = await tmp();
    await skill(root, "伏笔回收", "name: 伏笔回收术\ndescription: 提醒埋线与收线");
    const refs = await scanSkills(root, "global");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      id: "global:伏笔回收",
      source: "global",
      dirName: "伏笔回收",
      displayName: "伏笔回收术",
      description: "提醒埋线与收线",
      relPath: `伏笔回收/${SKILL_FILE_NAME}`
    });
  });

  it("stage / appliesTo 的列表形状：YAML 列表与单值都收成字符串数组", async () => {
    const root = await tmp();
    await skill(root, "a", "name: A\nstage:\n  - 构思\n  - 正文\nappliesTo: chapters");
    await skill(root, "b", "name: B\nstage: 大纲\nappliesTo:\n  - outline");
    const byDir = new Map((await scanSkills(root, "global")).map((r) => [r.dirName, r]));
    expect(byDir.get("a")?.stages).toEqual(["构思", "正文"]);
    expect(byDir.get("a")?.appliesTo).toEqual(["chapters"]);
    expect(byDir.get("b")?.stages).toEqual(["大纲"]);
    expect(byDir.get("b")?.appliesTo).toEqual(["outline"]);
  });

  it("没有 name / description 时退回目录名与正文首段，卡上不留空壳（标题行不算说明）", async () => {
    const root = await tmp();
    await skill(root, "无名氏", "", "## 标题行\n这一行是说明。\n- 这是要点。\n");
    const [ref] = await scanSkills(root, "global");
    expect(ref?.displayName).toBe("无名氏");
    expect(ref?.description).toBe("这一行是说明。 这是要点。");
  });

  it("坏技能只跳自己：没有 SKILL.md 的目录、点文件、隐藏目录都不进表", async () => {
    const root = await tmp();
    await skill(root, "好的", "name: 好的");
    await mkdir(path.join(root, "空的"), { recursive: true });
    await writeFile(path.join(root, "散file.md"), "x", "utf8");
    await mkdir(path.join(root, ".git"), { recursive: true });
    const refs = await scanSkills(root, "global");
    expect(refs.map((r) => r.dirName)).toEqual(["好的"]);
  });

  it("目录根本不存在 ⇒ 回空表，不抛：技能库空着是常态不是错误", async () => {
    const root = await tmp();
    await expect(scanSkills(path.join(root, "没有这个目录"), "global")).resolves.toEqual([]);
  });
});

describe("mergeSkillRefs", () => {
  const ref = (source: "global" | "book", dirName: string): SkillRef => ({
    id: `${source}:${dirName}`,
    source,
    dirName,
    displayName: dirName,
    description: "",
    stages: [],
    appliesTo: [],
    relPath: `${dirName}/${SKILL_FILE_NAME}`
  });

  it("同名时书内优先（用户在自己书里写的那份更贴这本书）", () => {
    const merged = mergeSkillRefs([ref("global", "伏笔")], [ref("book", "伏笔")]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.source).toBe("book");
  });

  it("不同名两份都在，且按目录名排序", () => {
    const merged = mergeSkillRefs([ref("global", "b")], [ref("book", "a")]);
    expect(merged.map((r) => r.dirName)).toEqual(["a", "b"]);
  });
});

describe("readSkillFile · 读取守卫三条", () => {
  it("形状对就读得到，truncated 为假", async () => {
    const root = await tmp();
    await skill(root, "伏笔", "name: 伏笔", "内容。\n");
    const got = await readSkillFile(root, `伏笔/${SKILL_FILE_NAME}`);
    expect(got.truncated).toBe(false);
    expect(got.content).toContain("内容。");
  });

  it("形状不对一律中文拒：多层目录 / 别的文件名 / 绝对路径 / ..", async () => {
    const root = await tmp();
    await skill(root, "伏笔", "name: 伏笔");
    const bad = [
      `a/b/${SKILL_FILE_NAME}`,
      "伏笔/readme.md",
      "伏笔/../伏笔/SKILL.md",
      `${SKILL_FILE_NAME}`,
      path.join(root, "伏笔", SKILL_FILE_NAME),
      "伏笔/"
    ];
    for (const relPath of bad) {
      await expect(readSkillFile(root, relPath)).rejects.toThrow(/技能路径/);
    }
  });

  it("符号链接把 SKILL.md 指到目录外 ⇒ 拒绝（形状对也不放行）", async () => {
    const root = await tmp();
    const outside = await tmp();
    await writeFile(path.join(outside, "secret.md"), "不该被读到", "utf8");
    const dir = path.join(root, "越界");
    await mkdir(dir, { recursive: true });
    try {
      await symlink(path.join(outside, "secret.md"), path.join(dir, SKILL_FILE_NAME));
    } catch {
      // Windows 未开开发者模式时建不了符号链接（EPERM）。守卫本身是 realpath 那一行，
      // 这里跳过的只是「造得出软链」这个前提，跳过要说清楚而不是静默通过。
      return;
    }
    // 沙箱里有软链 shim：symlink() 不报错但也**没真建出符号链接**（lstat 认不出 S_IFLNK）。
    // 那种环境下这条守卫读到的是书里的普通文件，「读得到」反而是对的——断言在这儿只会假红。
    // 真链在不在，lstat 一眼可辨：不在就说明这一条在本机没验到（与 ipc-guard 同款口径）。
    const { lstat } = await import("node:fs/promises");
    const st = await lstat(path.join(dir, SKILL_FILE_NAME));
    if (!st.isSymbolicLink()) {
      console.warn("[环境噪音] symlink() 静默没建出真软链（shim），软链越界那条没验到");
      return;
    }
    await expect(readSkillFile(root, `越界/${SKILL_FILE_NAME}`)).rejects.toThrow(/技能路径越界/);
  });

  it("超过 64 KB ⇒ 截断并标 truncated，且截在字符边界上不留半个字", async () => {
    const root = await tmp();
    const huge = "字".repeat(Math.ceil((SKILL_CONTENT_MAX_BYTES * 2) / 3));
    await skill(root, "大", "name: 大", huge);
    const got = await readSkillFile(root, `大/${SKILL_FILE_NAME}`);
    expect(got.truncated).toBe(true);
    expect(got.content).not.toContain("�");
    expect(Buffer.byteLength(got.content, "utf8")).toBeLessThanOrEqual(SKILL_CONTENT_MAX_BYTES);
  });

  it("读不到的文件给一句中文，不把 ENOENT 抛给渲染层", async () => {
    const root = await tmp();
    await expect(readSkillFile(root, `没有/${SKILL_FILE_NAME}`)).rejects.toThrow(
      `读不到这份技能：没有/${SKILL_FILE_NAME}`
    );
  });
});
