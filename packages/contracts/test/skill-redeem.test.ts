import { describe, expect, it } from "vitest";
import { SKILL_CONTENT_MAX_BYTES } from "../src/skill.js";
import {
  SKILL_REDEEM_MAX_CHARS,
  SKILL_REDEEM_PREFIX,
  decodeSkillRedeemCode,
  encodeSkillRedeemCode,
  redeemCodeChecksum,
  type SkillRedeemPayload
} from "../src/skill-redeem.js";

const PAYLOAD: SkillRedeemPayload = {
  dirName: "chapter-intent",
  displayName: "落笔前先问清楚",
  description: "动笔前把这一章要发生什么问清楚。\n再补一句。",
  skillMd: "---\nname: 落笔前先问清楚\ndescription: 问清楚\n---\n\n正文甲\n换行乙\n"
};

/** 生成端本就不判形状，这里借它把「形状可疑」的载荷塞进码里，交给解码端那道守卫判。 */
function codeOf(payload: unknown): string {
  return encodeSkillRedeemCode(payload as SkillRedeemPayload);
}

describe("encodeSkillRedeemCode / decodeSkillRedeemCode · 往返", () => {
  it("含中文、换行、frontmatter 的 SKILL.md 逐字还原", () => {
    const code = encodeSkillRedeemCode(PAYLOAD);
    expect(code.startsWith(SKILL_REDEEM_PREFIX)).toBe(true);
    // base64url 不该出现标准 base64 的 + / =（否则过不了 URL/剪贴板那道肉眼核对）。
    expect(code).not.toMatch(/[+/=]/);
    expect(decodeSkillRedeemCode(code)).toEqual(PAYLOAD);
  });

  it("校验段恒为 4 位：编码端与 redeemCodeChecksum 用的是同一份判据", () => {
    const code = encodeSkillRedeemCode(PAYLOAD);
    const tail = code.slice(SKILL_REDEEM_PREFIX.length);
    const lastDash = tail.lastIndexOf("-");
    expect(tail.slice(lastDash + 1)).toHaveLength(4);
    expect(tail.slice(lastDash + 1)).toBe(redeemCodeChecksum(tail.slice(0, lastDash)));
  });
});

describe("decodeSkillRedeemCode · 一律拒坏的", () => {
  it("篡改一位（body 或校验段）⇒ 校验不过，返回 null", () => {
    const code = encodeSkillRedeemCode(PAYLOAD);
    // 改 body 的一个码字：校验段仍指向旧 body，FNV-1a 对不上。
    const at = SKILL_REDEEM_PREFIX.length + 3;
    const bodyTampered =
      code.slice(0, at) + (code.charAt(at) === "A" ? "B" : "A") + code.slice(at + 1);
    expect(decodeSkillRedeemCode(bodyTampered)).toBeNull();
    // 改校验段一位：body 没动，但存的那 4 位与重算结果不同。
    const last = code.charAt(code.length - 1);
    const ckTampered = code.slice(0, -1) + (last === "a" ? "b" : "a");
    expect(decodeSkillRedeemCode(ckTampered)).toBeNull();
  });

  it("前缀不对 ⇒ null", () => {
    const code = encodeSkillRedeemCode(PAYLOAD);
    expect(decodeSkillRedeemCode("X" + code.slice(1))).toBeNull();
    expect(
      decodeSkillRedeemCode("OTHER-PREFIX-" + code.slice(SKILL_REDEEM_PREFIX.length))
    ).toBeNull();
  });

  it("超过 SKILL_REDEEM_MAX_CHARS 的码直接拒（先挡超长再解）", () => {
    const over = SKILL_REDEEM_PREFIX + "A".repeat(SKILL_REDEEM_MAX_CHARS);
    expect(over.length).toBeGreaterThan(SKILL_REDEEM_MAX_CHARS);
    expect(decodeSkillRedeemCode(over)).toBeNull();
  });

  it("坏 base64：校验码对得上，但 body 不是合法 base64url ⇒ null", () => {
    const bad = "@@@@";
    expect(
      decodeSkillRedeemCode(`${SKILL_REDEEM_PREFIX}${bad}-${redeemCodeChecksum(bad)}`)
    ).toBeNull();
    // 长度 ≡ 1 (mod 4) 的尾段解不出一个完整字节，同样拒。
    const short = "A";
    expect(
      decodeSkillRedeemCode(`${SKILL_REDEEM_PREFIX}${short}-${redeemCodeChecksum(short)}`)
    ).toBeNull();
  });

  it("base64url 合法但解出来不是合法 JSON ⇒ null（绝不把异常抛过 IPC）", () => {
    const body = "AAAA"; // 解出三个 NUL 字节，不是 JSON
    expect(
      decodeSkillRedeemCode(`${SKILL_REDEEM_PREFIX}${body}-${redeemCodeChecksum(body)}`)
    ).toBeNull();
  });

  it("字段形状非法一律拒：类型、空字段、超长字段、缺字段都算", () => {
    const cases: unknown[] = [
      null,
      [],
      { ...PAYLOAD, dirName: 42 },
      { ...PAYLOAD, displayName: "" },
      { ...PAYLOAD, displayName: "字".repeat(61) },
      { ...PAYLOAD, description: "" },
      { ...PAYLOAD, description: "字".repeat(241) },
      { ...PAYLOAD, skillMd: "" },
      { ...PAYLOAD, skillMd: 123 },
      { dirName: "chapter-intent" }
    ];
    for (const one of cases) {
      expect(decodeSkillRedeemCode(codeOf(one)), `形状 ${JSON.stringify(one)} 不该过`).toBeNull();
    }
  });

  it("dirName 含 ../ 或路径分隔符一律拒（拼绝对路径前的安全线，复用 market 那份守卫）", () => {
    for (const bad of ["../escape", "a/b", "a\\b", "..", ".", "/abs", "-lead", "有中文"]) {
      expect(
        decodeSkillRedeemCode(codeOf({ ...PAYLOAD, dirName: bad })),
        `${bad} 不该过目录名守卫`
      ).toBeNull();
    }
  });

  it("skillMd 超过 64KB（字节口径）被拒，且正好 64KB 仍可往返", () => {
    const over = { ...PAYLOAD, skillMd: "a".repeat(SKILL_CONTENT_MAX_BYTES + 1) };
    const code = codeOf(over);
    // 码本身没超总长上限 ⇒ 能走到形状闸才被拒，证明拒的是 64KB 那条而不是总长那条。
    expect(code.length).toBeLessThanOrEqual(SKILL_REDEEM_MAX_CHARS);
    expect(decodeSkillRedeemCode(code)).toBeNull();

    const atLimit: SkillRedeemPayload = {
      ...PAYLOAD,
      skillMd: "a".repeat(SKILL_CONTENT_MAX_BYTES)
    };
    expect(decodeSkillRedeemCode(encodeSkillRedeemCode(atLimit))).toEqual(atLimit);
  });

  it("任何坏串都只返回 null，绝不抛异常（码来自人手粘贴）", () => {
    const bad: unknown[] = [
      "",
      "MOCHEN-SKILL-",
      "MOCHEN-SKILL--",
      "MOCHEN-SKILL-x",
      42,
      null,
      undefined
    ];
    for (const one of bad) {
      expect(() => decodeSkillRedeemCode(one as string), `${String(one)} 不该抛`).not.toThrow();
      expect(decodeSkillRedeemCode(one as string)).toBeNull();
    }
  });
});

describe("redeemCodeChecksum · 稳定可复现", () => {
  it("同一 body 永远同一 4 位小写结果（FNV-1a 32 位 → 36 进制末 4 位）", () => {
    expect(redeemCodeChecksum("abc")).toBe("igaz");
    expect(redeemCodeChecksum("MOCHEN")).toBe("a8e5");
    expect(redeemCodeChecksum("abc")).toBe(redeemCodeChecksum("abc"));
    for (const s of ["", "abc", "eyJhIjoxfQ", "hello-兑换码_123"]) {
      expect(redeemCodeChecksum(s)).toMatch(/^[0-9a-z]{4}$/);
    }
  });
});
