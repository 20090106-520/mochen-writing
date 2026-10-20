/**
 * 多稿候选的文案层（P0-②）。这里钉的全是**句子**：档位循环、正文预览、位次、读数拼句，
 * 外加选稿 / 丢稿那一段共用的成败判定。
 *
 * 最要紧的一条边界是「算不出的读数不硬凑」：`startRepeat` / `flatRhythm` 为 null 时那半句
 * 整个不出现（不留「未触发 / 无」这类空话）。写歪这一档的后果是面板对每一稿都说同一串
 * 半真半假的话，而这串话本该是用户挑稿时唯一的依据。
 *
 * 本仓零 jsdom：`window` 由 `vi.stubGlobal` 造出来（与 agent-store-fixture 同一手法）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DraftReading } from "@mochen/contracts";
import {
  DRAFT_PREVIEW_MAX,
  DRAFT_VITALITY_NOTE,
  draftHeadline,
  draftOrdinal,
  draftPreview,
  draftReadingLine,
  draftVitalityLine,
  nextDraftSampleCount,
  resolveDraft,
  type DraftSetState
} from "./draft-candidates";

/** 读数底座：只关心拼句时把四条读数各填一个能读出数来的值。 */
function reading(over: Partial<DraftReading> = {}): DraftReading {
  return {
    index: 0,
    charCount: 812,
    pass: true,
    hits: 3,
    perThousand: 3.7,
    topTerms: ["仿佛", "不禁", "缓缓"],
    startRepeat: { char: "他", count: 7, total: 10, ratio: 0.7 },
    flatRhythm: { mean: 12, spread: 2 },
    structureOver: [],
    repeatOverCount: 2,
    ...over
  };
}

/** 把 `window.mochen` 铺成用例要的那两枚（本仓没有 jsdom，只有这一个入口）。 */
function stubMochen(mochen: Record<string, unknown>): void {
  vi.stubGlobal("window", { mochen });
}

describe("nextDraftSampleCount · 档位循环", () => {
  it("关 → ×2 → ×3 → 关（次序从 contracts 的 DRAFT_SAMPLE_COUNTS 现拼）", () => {
    expect(nextDraftSampleCount(1)).toBe(2);
    expect(nextDraftSampleCount(2)).toBe(3);
    expect(nextDraftSampleCount(3)).toBe(1);
  });
});

describe("draftPreview · 正文预览", () => {
  it("空白折成单个空格并去掉首尾（多行正文在一格里摊平）", () => {
    expect(draftPreview("夜色\n\n沉下去  了\t\n")).toBe("夜色 沉下去 了");
  });

  it("不超上限就原样给，一个省略号都不加", () => {
    expect(draftPreview("短")).toBe("短");
  });

  it("超上限按码点截断并补省略号；emoji 的代理对不许被劈成半个字", () => {
    const preview = draftPreview("🌊".repeat(DRAFT_PREVIEW_MAX + 5));
    expect(preview.endsWith("…")).toBe(true);
    // 160 个码点 + 一个省略号；劈开代理对时这里会量出 161 个「字符」而末位渲染成 �。
    expect([...preview].length).toBe(DRAFT_PREVIEW_MAX + 1);
    expect([...preview].at(-2)).toBe("🌊");
  });
});

describe("draftOrdinal / draftHeadline · 位次 1 起报", () => {
  it("位次 0 报「第 1 稿」（0 起算是主进程认的稿序号，不是给人看的读法）", () => {
    expect(draftOrdinal(0)).toBe("第 1 稿");
    expect(draftOrdinal(2)).toBe("第 3 稿");
  });

  it("行头带位次与字数", () => {
    expect(draftHeadline(0, reading({ charCount: 812 }))).toBe("第 1 稿 · 812 字");
  });
});

describe("draftReadingLine · 读数拼句", () => {
  it("四条读数齐 ⇒ 四句用「 · 」相接", () => {
    expect(draftReadingLine(reading())).toBe(
      "同一句原样打转 2 处 · 重罪词命中 3 处（每千字 3.7） · 句首复读：7/10 句以「他」起头 · 句长偏匀：平均 12 字，波动 2"
    );
  });

  it("没有打转的句子时说「没有反复打转的句子」，不报「0 处」", () => {
    expect(draftReadingLine(reading({ repeatOverCount: 0 }))).toContain("没有反复打转的句子");
  });

  it("startRepeat 为 null ⇒ 那半句整个不出现", () => {
    expect(draftReadingLine(reading({ startRepeat: null }))).not.toContain("句首复读");
  });

  it("flatRhythm 为 null ⇒ 那半句整个不出现", () => {
    expect(draftReadingLine(reading({ flatRhythm: null }))).not.toContain("句长偏匀");
  });

  it("两条读数都算不出 ⇒ 只剩前两句（不硬凑）", () => {
    const line = draftReadingLine(reading({ startRepeat: null, flatRhythm: null }));
    expect(line.split(" · ").length).toBe(2);
  });
});

/**
 * `resolveDraft` 是选稿 / 丢稿共用的一段：失败时集不动、成功即清集。
 * 判据因此落在「集有没有被清」与「回了哪句话」两处。
 */
describe("resolveDraft · 成败判定与清集", () => {
  const KEY = "chapters/01-a.md";

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function withSet(): Record<string, DraftSetState> {
    return {
      [KEY]: { draftSetId: "set-1", drafts: [{ index: 0, text: "第一稿", reading: reading() }] }
    };
  }

  it("成功（丢稿）⇒ 清掉这一集并回那句回执；选稿传空串 ⇒ 话由转录自己说", async () => {
    const sets = withSet();
    stubMochen({ discardDrafts: async () => ({ ok: true }) });
    expect(await resolveDraft(sets, KEY, null, "丢掉了")).toBe("丢掉了");
    expect(sets[KEY]).toBeUndefined();
  });

  it("主进程回失败 ⇒ 原样转出它那句话，集**不动**（用户还能再点别的稿）", async () => {
    const sets = withSet();
    stubMochen({ pickDraft: async () => ({ ok: false, reason: "gone", message: "这一集没了" }) });
    expect(await resolveDraft(sets, KEY, 0, "")).toBe("这一集没了");
    expect(sets[KEY]?.draftSetId).toBe("set-1");
  });

  it("跨 IPC 抛错 ⇒ 收成中文（reasonOf 那条路），集同样不动", async () => {
    const sets = withSet();
    stubMochen({
      pickDraft: async () => {
        throw new Error("通道断了");
      }
    });
    expect(await resolveDraft(sets, KEY, 0, "")).toBe("通道断了");
    expect(sets[KEY]?.draftSetId).toBe("set-1");
  });

  it("集已经不在（换过轮）⇒ 什么都不做：空串出、不发 IPC", async () => {
    const sets: Record<string, DraftSetState> = {};
    let called = 0;
    stubMochen({
      pickDraft: async () => {
        called += 1;
        return { ok: true };
      }
    });
    expect(await resolveDraft(sets, KEY, 0, "")).toBe("");
    expect(called).toBe(0);
  });
});

/**
 * 活性读数行（P1-⑥）：三枚代理指标各出一句，**算不出的那项整个不出现**——与读数行同一条口径。
 * 这里钉的第二件事是提示句本身：它必须把「不是判据」与长度偏差两句话说到，
 * 否则面板摆出一排数就容易被当成第二条判退线。
 */
describe("draftVitalityLine · 活性读数拼句", () => {
  /** 十句、长短交替：三项都算得出来（2 字 / 10 字的句子轮着来）。 */
  const LONG_ENOUGH = Array.from({ length: 10 }, (_, i) =>
    i % 2 === 0 ? "他走。" : "他慢慢地走过来了。"
  ).join("\n");

  it("三项齐 ⇒ 三句用「 · 」相接，行首点明这是活性读数", () => {
    const line = draftVitalityLine(LONG_ENOUGH);
    expect(line.startsWith("活性：")).toBe(true);
    expect(line.split(" · ").length).toBe(3);
    expect(line).toContain("字串熵");
    expect(line).toContain("句长突发度");
    expect(line).toContain("字多样性");
  });

  it("突发度算不出（不足十句）⇒ 那半句整个不出现，其余两项照出", () => {
    const line = draftVitalityLine("他一走。");
    expect(line).not.toContain("句长突发度");
    expect(line).toContain("字串熵");
    expect(line).toContain("字多样性");
  });

  it("三枚全算不出 ⇒ 一句诚实的话，不硬报 0", () => {
    expect(draftVitalityLine("")).toBe("活性算不出来（这段太短）");
  });

  it("提示句把「不是判据」与长度偏差都说到了", () => {
    expect(DRAFT_VITALITY_NOTE).toContain("不是判据");
    expect(DRAFT_VITALITY_NOTE).toContain("字数");
  });
});
