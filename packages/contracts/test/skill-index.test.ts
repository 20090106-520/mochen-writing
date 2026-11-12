import { describe, expect, it } from "vitest";
import {
  SKILL_INDEX_MAX_ITEMS,
  matchSkillRef,
  skillIndexBlock,
  type SkillRef
} from "../src/skill.js";

function refOf(id: string, description = "治什么", name = ""): SkillRef {
  const dirName = id.slice(id.indexOf(":") + 1);
  return {
    id,
    source: id.startsWith("global:") ? "global" : "book",
    dirName,
    displayName: name === "" ? dirName : name,
    description,
    stages: [],
    appliesTo: [],
    relPath: `${dirName}/SKILL.md`
  };
}

describe("技能库索引（skillIndexBlock）", () => {
  it("排除已挂入的：挂入的已在上下文里有一行清单，再列一遍就成两条", () => {
    const out = skillIndexBlock([refOf("global:a"), refOf("global:b")], ["global:a"]);
    expect(out.total).toBe(1);
    expect(out.shown).toBe(1);
    expect(out.text).toContain("global:b");
    expect(out.text).not.toContain("global:a");
  });

  it("按 id 排序：同一份技能库每轮拼出来必须逐字相同，否则前缀缓存轮轮失效", () => {
    const one = skillIndexBlock([refOf("global:z"), refOf("book:b"), refOf("global:m")]);
    const two = skillIndexBlock([refOf("global:m"), refOf("global:z"), refOf("book:b")]);
    expect(one.text).toBe(two.text);
    const order = ["book:b", "global:m", "global:z"].map((id) => one.text.indexOf(id));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("开头说清「没挂入、正文未载入」，并堵住「凭名字猜做法」这条退化路", () => {
    const { text } = skillIndexBlock([refOf("global:a")]);
    expect(text).toContain("没有挂入");
    expect(text).toContain('use_skill("<id>")');
    expect(text).toContain("不要凭名字猜");
  });

  it("条数有闸：超出部分不静默丢，末尾如实报总数与列全的办法", () => {
    const refs = Array.from({ length: SKILL_INDEX_MAX_ITEMS + 6 }, (_, i) =>
      refOf(`global:s${String(i).padStart(2, "0")}`)
    );
    const out = skillIndexBlock(refs);
    expect(out.total).toBe(SKILL_INDEX_MAX_ITEMS + 6);
    expect(out.shown).toBe(SKILL_INDEX_MAX_ITEMS);
    expect(out.text).toContain(`库里共 ${SKILL_INDEX_MAX_ITEMS + 6} 条`);
    expect(out.text).toContain("use_skill 不带参数");
    // 没列出来的那条不该偷偷混进去。
    expect(out.text).not.toContain("global:s24");
  });

  it("字数有闸：一份 description 写成长文，也不会把整段额度吃掉", () => {
    const long = "这一段说明写了非常多的字".repeat(40);
    const out = skillIndexBlock([refOf("global:long", long), refOf("global:short", "短说明")]);
    // 单条被截到 48 字 + 省略号，两条都还在。
    expect(out.shown).toBe(2);
    expect(out.text).toContain("…");
    expect(out.text).not.toContain(long);
  });

  it("额度调得极小、一条都塞不进时回空段：不硬塞半条", () => {
    const out = skillIndexBlock([refOf("global:a", "很长的一句说明")], [], { maxChars: 5 });
    expect(out.text).toBe("");
    expect(out.total).toBe(1);
    expect(out.shown).toBe(0);
  });

  it("空库 / 全挂入都回空串：调用方据此不写这一段", () => {
    expect(skillIndexBlock([]).text).toBe("");
    const all = skillIndexBlock([refOf("global:a")], ["global:a"]);
    expect(all).toEqual({ text: "", total: 0, shown: 0 });
  });

  it("已经挂了技能时说简版：读法刚在上面的清单里说过，不再整段复读（2026-11-12）", () => {
    const out = skillIndexBlock([refOf("global:a"), refOf("global:b")], ["global:a"]);
    expect(out.text).toContain("读法同上");
    expect(out.text).not.toContain("不要凭名字猜它的做法**（名字只说明");
  });

  it("一条都没挂时仍给完整读法：这时这一段是模型唯一的入口", () => {
    const out = skillIndexBlock([refOf("global:a"), refOf("global:b")], []);
    expect(out.text).toContain('use_skill("<id>")');
    expect(out.text).toContain("不要凭名字猜");
  });
});

/**
 * 技能 id 写错时的认人（2026-11-12）。
 *
 * `use_skill` 只认完整 id，而清单里同一份技能并排摆着三个字面量：显示名、目录名、完整 id。
 * 模型照着前两个调一次是常态，而每一次手误都是一轮工具往返 + 一句「抱歉，我先列出技能」。
 * 这里钉住「认得出」与「认不准就不猜」两侧——猜错比不猜更费一轮。
 */
describe("matchSkillRef · 模型写错 id 时认得出哪一份", () => {
  const refs = [
    refOf("global:check-style", "按用词、句式、节奏三层找 AI 腔", "文风检查"),
    refOf("book:foreshadow", "埋线收线", "伏笔"),
    refOf("global:check-plot", "剧情审核", "剧情检查")
  ];

  it("完整 id 原样命中，大小写不敏感", () => {
    expect(matchSkillRef("GLOBAL:Check-Style", refs)?.id).toBe("global:check-style");
  });

  it("只给目录名也认", () => {
    expect(matchSkillRef("check-style", refs)?.id).toBe("global:check-style");
  });

  it("给显示名也认，中间的空格不影响", () => {
    expect(matchSkillRef(" 文风 检查 ", refs)?.id).toBe("global:check-style");
  });

  it("不做前缀或包含匹配：认不准就不猜", () => {
    expect(matchSkillRef("文风", refs)).toBeNull();
    expect(matchSkillRef("check", refs)).toBeNull();
  });

  it("同档多个候选时认不出：两份同名技能里选谁都是随机", () => {
    expect(matchSkillRef("rhythm", [refOf("global:rhythm"), refOf("book:rhythm")])).toBeNull();
  });

  it("空库与空白串回 null", () => {
    expect(matchSkillRef("x", [])).toBeNull();
    expect(matchSkillRef("   ", refs)).toBeNull();
  });
});
