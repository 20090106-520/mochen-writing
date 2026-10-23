import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { SKILL_FILE_NAME } from "@mochen/contracts";

/**
 * 内置技能（2026-10-23，用户裁定）：首次启动把这一批写成**全局技能**落盘到
 * `<appData>/…/skills/<dirName>/SKILL.md`，之后它们与用户自己放的技能、技能市场装的技能
 * 走完全同一套（技能库可浏览/挂入、`use_skill` 工具可自选、用户可删可改）。
 *
 * 【为什么不走内存内置】内存内置要给 `skillService.list/read` 加一条「不在盘上也读得到」的
 * 特例分支，等于在「技能都在盘上」这条既有契约上凿一个洞；落盘之后零特例。
 *
 * 【为什么是这四条】原来左栏「审核检查」组那四项（一致性/剧情/逻辑/文风）只是把一句话预填进
 * 对话框——用户裁定它应该归到「对话框的技能里面」。做成技能之后，模型可以在需要审校时
 * 经 `use_skill` 自己把对应那份载进来照着做，用户也可以在技能库手选挂入。
 *
 * 【与技能市场的关系】它们**不进** `SKILL_CATALOG`（那是「可安装」的目录）：这一批是
 * 「已经装好的」，落盘即出现在技能库里；摆进市场只会多一排「已装」的噪声。
 *
 * 【不覆盖】只写「文件不存在」的那些；用户改过或删过的，一律不动（删了下次也不再生成，
 * 因为删的是目录，`access` 判不存在会重写——故这里以**目录**为准，见下）。
 */

export interface BuiltinSkill {
  /** 目录名，与用户技能同形（单层目录 + SKILL.md）。 */
  dirName: string;
  /** SKILL.md 全文（frontmatter + 正文）。 */
  skillMd: string;
}

/** frontmatter 只用 skill.ts 认得的四个键：name / description / stage / appliesTo。 */
function skillDoc(input: {
  name: string;
  description: string;
  stage: string;
  body: string;
}): string {
  return [
    "---",
    `name: ${input.name}`,
    `description: ${input.description}`,
    `stage: ${input.stage}`,
    "appliesTo: chapter",
    "---",
    "",
    `# ${input.name}`,
    "",
    input.body.trim(),
    ""
  ].join("\n");
}

const PREAMBLE =
  "对**当前打开的章节**执行本项检查。先 read_doc 读当前章拿到逐字原文，" +
  "需要对照设定时再用 list_docs / search_docs 取相关人物卡与设定；" +
  "逐处列出问题，每处写清「原文位置 + 为什么是问题 + 怎么改」；" +
  "真要改就用 propose_patch 提交替换提案（我批准后才落盘），不要整段重写。";

export const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    dirName: "check-consistency",
    skillMd: skillDoc({
      name: "一致性检查",
      description: "对照人物、设定与剧情，指出当前章前后矛盾或与设定不符之处；没有就明说没有。",
      stage: "review",
      body:
        PREAMBLE +
        "\n\n本次只看**一致性**：找出与已有的人物卡、世界观、时间线、伏笔相矛盾或前后不一致的地方。" +
        "没有发现就明确说「没有发现不一致」，不要为凑数编问题。"
    })
  },
  {
    dirName: "check-plot",
    skillMd: skillDoc({
      name: "剧情审核",
      description: "评估当前章情节推进是否合理、节奏与冲突是否成立、伏笔与回收是否妥当。",
      stage: "review",
      body:
        PREAMBLE +
        "\n\n本次只看**剧情**：评估情节推进是否合理、节奏与冲突是否成立、伏笔埋设与回收是否妥帖，" +
        "并给出具体的修改建议（哪一段、改成什么方向）。"
    })
  },
  {
    dirName: "check-logic",
    skillMd: skillDoc({
      name: "逻辑检查",
      description: "找出当前章因果链断裂、动机不足、时间线对不上的地方；没有就明说没有。",
      stage: "review",
      body:
        PREAMBLE +
        "\n\n本次只看**逻辑**：找出因果链断裂、人物动机不足、时间线对不上的地方。" +
        "没有发现就明确说「没有发现逻辑问题」。"
    })
  },
  {
    dirName: "check-style",
    skillMd: skillDoc({
      name: "文风检查",
      description: "找出当前章的 AI 腔与套话句式，逐处给出更像人写的改法。",
      stage: "review",
      body:
        PREAMBLE +
        "\n\n本次只看**文风（去 AI 味）**：找出 AI 腔的套话与句式——如「嘴角勾起」「眼底闪过」" +
        "「勾起一抹」「深吸一口气」「空气仿佛凝固」「他知道，……」式开头、连续长短雷同的句子、" +
        "「缓缓 / 微微 / 不禁」堆叠。逐处指出原文并给出更像人写的改法；确要保留的写法在提案 why 里说明理由。"
    })
  }
];

/**
 * 把内置技能落到全局 skills 目录。只写**还没有**的那些——
 * 判据是「那份 `SKILL.md` 读得到吗」，与技能库那张表同源（目录空着也算没装）。
 * 返回本次真正写入的 dirName 列表（供测试与日志）。
 */
export async function seedBuiltinSkills(skillsDir: string): Promise<string[]> {
  const seeded: string[] = [];
  for (const skill of BUILTIN_SKILLS) {
    const dir = path.join(skillsDir, skill.dirName);
    const file = path.join(dir, SKILL_FILE_NAME);
    try {
      await access(file);
      continue; // 已经有一份（内置写的或用户改的）——不动它。
    } catch {
      // 不存在 → 下面写一份。
    }
    await mkdir(dir, { recursive: true });
    await writeFile(file, skill.skillMd, "utf8");
    seeded.push(skill.dirName);
  }
  return seeded;
}
