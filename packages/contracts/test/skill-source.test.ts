import { describe, expect, it } from "vitest";
import {
  SKILL_SOURCE_PRESETS,
  composeSkillMd,
  githubDirUrl,
  hasFrontmatter,
  presetUrl,
  skillDirNameOf,
  sourceUrlOf
} from "../src/skill-source.js";
import { parseSkillUrl } from "../src/skill-source.js";
import { MARKET_DIR_NAME_RE } from "../src/market.js";

/**
 * 在线技能源那层判据的用例（2026-11-10）。
 *
 * 这一层的每一条都直接连着一个写盘动作（拿解析结果拼目录、拼 API 地址），
 * 所以负面用例比正面用例更重要：`file://`、`http://`、`..`、`issues` 四条都是
 * 「放过去就会去写/去读不该碰的东西」，一条都不能只靠代码里那句注释担保。
 */

function targetOf(input: string) {
  const parsed = parseSkillUrl(input);
  if (!parsed.ok) throw new Error(`本该解析成功：${input} → ${parsed.notice}`);
  return parsed.target;
}

describe("parseSkillUrl：认得出该认的几种地址", () => {
  it("仓库首页 → 目录（ref 留空，交给仓库默认分支）", () => {
    const target = targetOf("https://github.com/anthropics/skills");
    expect(target).toMatchObject({
      kind: "dir",
      owner: "anthropics",
      repo: "skills",
      ref: "",
      path: ""
    });
  });

  it("tree 地址 → 目录 + 分支 + 路径", () => {
    const target = targetOf("https://github.com/anthropics/skills/tree/main/skills/docx");
    expect(target).toMatchObject({
      kind: "dir",
      owner: "anthropics",
      repo: "skills",
      ref: "main",
      path: "skills/docx"
    });
  });

  it("blob 地址 → 文件", () => {
    const target = targetOf("https://github.com/anthropics/skills/blob/main/skills/docx/SKILL.md");
    expect(target.kind).toBe("file");
    expect(target.path).toBe("skills/docx/SKILL.md");
  });

  it("raw 地址 → 文件（同一个形状，不另开一条通道）", () => {
    const target = targetOf("https://raw.githubusercontent.com/o/r/main/skills/x/SKILL.md");
    expect(target).toMatchObject({
      kind: "file",
      owner: "o",
      repo: "r",
      ref: "main",
      path: "skills/x/SKILL.md"
    });
  });

  it("ghproxy 镜像 → 剥回 raw 再解析（用户从镜像页面复制来的地址也能用）", () => {
    const target = targetOf(
      "https://ghproxy.net/https://raw.githubusercontent.com/o/r/main/s/SKILL.md"
    );
    expect(target).toMatchObject({ kind: "file", owner: "o", repo: "r", path: "s/SKILL.md" });
  });

  it("省掉域名的简写也认（owner/repo）", () => {
    const target = targetOf("obra/superpowers");
    expect(target).toMatchObject({ owner: "obra", repo: "superpowers", kind: "dir" });
  });

  it("别的站点只认指向 .md 的直链", () => {
    const target = targetOf("https://example.com/a/b/SKILL.md");
    expect(target.absolute).toBe("https://example.com/a/b/SKILL.md");
    expect(target.kind).toBe("file");
  });
});

describe("parseSkillUrl：这几种必须拒", () => {
  it("非 https 一律拒（file:// 能把本机文件当远端读）", () => {
    const parsed = parseSkillUrl("file:///C:/Users/x/SKILL.md");
    expect(parsed.ok).toBe(false);
  });

  it("http 也拒——降级成明文传输不是一个可以「大概接受」的选择", () => {
    expect(parseSkillUrl("http://github.com/o/r").ok).toBe(false);
  });

  it("路径里的 .. 拒（拼 API 地址与目录都要它）", () => {
    expect(parseSkillUrl("https://github.com/o/r/tree/main/../../etc").ok).toBe(false);
  });

  it("issues / pulls 这类地址拒，并说清它指向的不是代码目录", () => {
    const parsed = parseSkillUrl("https://github.com/o/r/issues/12");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.notice).toContain("issues");
  });

  it("blob 指向非 .md 拒", () => {
    expect(parseSkillUrl("https://github.com/o/r/blob/main/package.json").ok).toBe(false);
  });

  it("非 GitHub 的目录页拒（没有通用办法列内容，不许猜）", () => {
    expect(parseSkillUrl("https://example.com/skills/").ok).toBe(false);
  });

  it("空串与乱码给中文理由，不返回一个空目标", () => {
    expect(parseSkillUrl("   ").ok).toBe(false);
    expect(parseSkillUrl("不是链接").ok).toBe(false);
  });
});

describe("skillDirNameOf：落盘目录名必须过守卫", () => {
  it("上游常见的 kebab-case 原样保留", () => {
    expect(skillDirNameOf("doc-coauthoring")).toBe("doc-coauthoring");
  });

  it("中文名转写成 ASCII 并补稳定哈希（同一个名字永远同一个目录）", () => {
    const first = skillDirNameOf("场景里的气味");
    expect(first).toBe(skillDirNameOf("场景里的气味"));
    expect(MARKET_DIR_NAME_RE.test(first)).toBe(true);
  });

  it("不同中文名不撞同一个目录", () => {
    expect(skillDirNameOf("甲")).not.toBe(skillDirNameOf("乙"));
  });
});

describe("composeSkillMd：写出来的形状与 scanSkills 真读的那几格对齐", () => {
  it("没有 frontmatter 时按名字/说明/阶段补一份", () => {
    const text = composeSkillMd({
      displayName: "场景里的气味",
      description: "检查场景有没有气味层",
      stages: ["正文"],
      appliesTo: ["chapter"],
      body: "先找五感缺失的段落。"
    });
    expect(hasFrontmatter(text)).toBe(true);
    expect(text).toContain("name: 场景里的气味");
    expect(text).toContain("stage: 正文");
    expect(text.endsWith("先找五感缺失的段落。\n")).toBe(true);
  });

  it("正文里已经有 frontmatter 就原样用，不叠第二层", () => {
    const raw = "---\nname: x\n---\n\n正文";
    const text = composeSkillMd({
      displayName: "y",
      description: "",
      stages: [],
      appliesTo: [],
      body: raw
    });
    expect(text.match(/^---$/gm)?.length).toBe(2);
  });

  it("说明为空时用名字顶上——description 空着的那张卡在界面里就是个空壳", () => {
    const text = composeSkillMd({
      displayName: "只有名字",
      description: "",
      stages: [],
      appliesTo: [],
      body: "正文"
    });
    expect(text).toContain("description: 只有名字");
  });
});

describe("内置源：只有坐标，没有正文", () => {
  it("每条源都能拼出可解析的地址", () => {
    for (const preset of SKILL_SOURCE_PRESETS) {
      const parsed = parseSkillUrl(presetUrl(preset));
      expect(parsed.ok, `${preset.id} 的地址解析不了`).toBe(true);
    }
  });

  it("源里不带 skillMd 这种正文格（那是内置清单的做法，正是这一版要避开的）", () => {
    for (const preset of SKILL_SOURCE_PRESETS) {
      expect(Object.keys(preset)).not.toContain("skillMd");
    }
  });

  it("sourceUrlOf 认 id，也放过地址原样", () => {
    expect(sourceUrlOf(SKILL_SOURCE_PRESETS[0]!.id)).toBe(presetUrl(SKILL_SOURCE_PRESETS[0]!));
    expect(sourceUrlOf("https://github.com/o/r")).toBe("https://github.com/o/r");
  });

  it("githubDirUrl 与解析互为逆：拼出来的地址解析回去还是同一个位置", () => {
    const url = githubDirUrl("anthropics", "skills", "main", "skills/docx");
    expect(targetOf(url)).toMatchObject({ owner: "anthropics", ref: "main", path: "skills/docx" });
  });
});
