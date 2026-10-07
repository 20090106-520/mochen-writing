import type { MarketSkill } from "@mochen/contracts";
import { IDEA_SKILLS } from "./skill-catalog-idea.js";
import { STRUCTURE_SKILLS } from "./skill-catalog-structure.js";
import { STYLE_SKILLS } from "./skill-catalog-style.js";
import { PROOF_SKILLS } from "./skill-catalog-proof.js";
import { RESEARCH_SKILLS } from "./skill-catalog-research.js";

/**
 * 技能市场的内置清单（2026-10-07 批次 5-㊱，从 5 条扩到 20 条，并按分类拆到五个文件）。
 *
 * 【为什么按分类拆文件】
 * 清单是**代码里的常量**，每条正文都是一段几十行的说明书。二十条写在一个文件里，
 * 单文件会顶破本仓 800 行的行数预算，而预算破了之后最容易被绕过的是「拆到别处」——
 * 拆成别处就会有人开始想「这几条是不是可以合并」。按 `MARKET_CATEGORIES` 的声明序
 * 拆成五份，分类与文件一一对应，加一条新技能时落哪个文件没有得选。
 * **排序不在这里做**：`catalogView` 按分类序排，本文件只负责把五份接起来。
 *
 * 【这一批的来路：用户裁定「去网上找所有开源的仓库，把合适的都加进来」】
 * 动手前先把能收的与不能收的分开，理由逐条写在这里（它们同时也是守卫的判据）：
 *
 * - **收得进来的前提是许可明确。** `skill-catalog-origins.ts` 的 `UPSTREAM` 只放
 *   已经核实过 LICENSE 的仓库。网上中文写作 skill 包不少，其中相当一部分没写许可，
 *   那种收不进来——不是不想收，是「照抄上游许可」这条要求在它们身上没法满足。
 * - **收到的是方法，不是原文。** 每一份只搬那几步追问、那几条检查项、那张表格的列，
 *   不搬上游的句子、不搬它的命令与工具名。墨宸没有那些运行通路，
 *   整段抄过来只会得到一份「照着做」却什么都做不了的说明书。
 * - **不收带运行时的。** 5-㊰ 收过一批带 Python 引擎的（gongwen-skill / ppt-studio），
 *   几万行脚本在本仓没有执行路径，与那一批是同一个理由。
 * - **上游的 hooks / agents / Dashboard 一律不收。** oh-story 那套靠 shell hook 与
 *   多 agent 协作守流程，本仓的流程在软件里，不在命令行上；收进来只会让技能文本
 *   描述一套这个软件里不存在的机制。
 *
 * 【分类只管筛选，不管内容边界】
 * 「构思」是动笔前要想清楚的事，「结构」是这本书由什么撑起来，
 * 「文风」是句子本身，「校对」是对不上的地方，「资料」是动笔前要弄准的真东西。
 * 一条技能放哪一类，按它治的是哪个问题来定，不按它抄自哪个仓库。
 *
 * 【改写规矩】抄来的只搬方法，出处写进 frontmatter 之外的正文第一句，
 * 用户在技能库里读到的是「谁写的」，不是一段认不出来源的文字。
 */

/**
 * 全部内置技能。**顺序无所谓**（`catalogView` 会按分类序重排），
 * 但五份的拼接顺序与 `MARKET_CATEGORIES` 保持一致，方便读代码的人对上号。
 */
export const SKILL_CATALOG: MarketSkill[] = [
  ...IDEA_SKILLS,
  ...STRUCTURE_SKILLS,
  ...STYLE_SKILLS,
  ...PROOF_SKILLS,
  ...RESEARCH_SKILLS
];
