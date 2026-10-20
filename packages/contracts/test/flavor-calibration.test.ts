/**
 * 阈值校准基础设施的纯单测（P0-①，2026-10-20）——**不碰 fs**。
 *
 * 最要紧的一条是「不变量」：校准侧那份计数必须与 `aiFlavorGate` 同口径，
 * 否则等真语料到位那天出的是错表。这里拿构造语料逐段钉死。
 */
import { describe, expect, it } from "vitest";
import { AI_FLAVOR_COGNITIVE_LABEL, AI_FLAVOR_MIN_COUNT, aiFlavorGate } from "../src/ai-flavor.js";
import {
  FLAVOR_CORPUS_GAP,
  calibrateFlavor,
  flavorTermSamples,
  formatCalibrationTable,
  type CategoryCalibration
} from "../src/flavor-calibration.js";

/**
 * 构造语料（三篇，自己造的，不用现成夹具）——每篇塞进不同的条目：
 * - doc0：cliche（嘴角勾起 ×2 / 勾起一抹 / 眼底闪过 / 闪过一丝）＋ adverb（缓缓 ×2）；
 * - doc1：cognitive（他知道，/她明白，共 2 处）＋ 情绪直陈 ＋ 对话标签；
 * - doc2：议论腔词两项 ＋ cognitive 一处 ＋ 情绪直陈 ＋ 对话标签。
 * 两篇共享的认知标签（doc1 / doc2）用来验「同一条目跨篇各出一条样本」。
 */
const CORPUS: readonly string[] = [
  "他嘴角勾起一抹笑。\n她嘴角勾起，眼底闪过一丝惊讶。\n他缓缓地走过去，缓缓地坐下。\n",
  '他知道，这局棋没那么简单。\n她明白，事情已经无法回头。\n他感到一阵愤怒，攥紧了拳头。\n"你先喝。"她说。\n',
  '众所周知，他这么做是有道理的。\n与此同时，窗外下起了雨。\n他明白，这场雨不会停。\n"走吧。"他说。\n他感到一阵失落。\n'
];

/** 供不变量用的加料篇（升华对偶 / 反差模板 / 章末总结体各一处）。 */
const STRUCTURE_DOC =
  "不是他不想去，是他去不了。\n声音不大，却让人心头发紧。\n人生就是这样，谁也逃不过。\n";

const INVARIANT_TEXTS: readonly string[] = [...CORPUS, STRUCTURE_DOC];

function rowOf(rows: readonly CategoryCalibration[], category: CategoryCalibration["category"]) {
  const row = rows.find((item) => item.category === category);
  expect(row).toBeDefined();
  return row!;
}

describe("flavor-calibration · 不变量（与 aiFlavorGate 同口径）", () => {
  it("单篇：非副词样本的 count 总和恰好等于 gate 的 hits（≥3 段逐段断言）", () => {
    expect(INVARIANT_TEXTS.length).toBeGreaterThanOrEqual(3);
    for (const text of INVARIANT_TEXTS) {
      const nonAdverb = flavorTermSamples([text])
        .filter((sample) => sample.category !== "adverb")
        .reduce((sum, sample) => sum + sample.count, 0);
      expect(nonAdverb).toBe(aiFlavorGate(text).hits);
    }
  });

  it("多篇：全语料的非副词样本总和等于逐篇 gate 的 hits 之和", () => {
    const nonAdverb = flavorTermSamples(CORPUS)
      .filter((sample) => sample.category !== "adverb")
      .reduce((sum, sample) => sum + sample.count, 0);
    const gates = CORPUS.reduce((sum, text) => sum + aiFlavorGate(text).hits, 0);
    expect(nonAdverb).toBe(gates);
    // 加料篇也算上，免得只对上三篇这一个特例。
    expect(
      flavorTermSamples(INVARIANT_TEXTS)
        .filter((sample) => sample.category !== "adverb")
        .reduce((sum, sample) => sum + sample.count, 0)
    ).toBe(INVARIANT_TEXTS.reduce((sum, text) => sum + aiFlavorGate(text).hits, 0));
  });
});

describe("flavor-calibration · flavorTermSamples", () => {
  it("只收 count ≥ 1：没出现的条目一条样本都不给", () => {
    const samples = flavorTermSamples(["他嘴角勾起一抹笑。"]);
    expect(samples.every((sample) => sample.count >= 1)).toBe(true);
    expect(samples.some((sample) => sample.label === "眼底闪过")).toBe(false);
    // 完全干净的一段：零样本。
    expect(flavorTermSamples(["天气不错。"])).toEqual([]);
  });

  it("命中数按整篇累加（「缓缓」出现两次给 count 2，且归 adverb 类）", () => {
    const adverbSamples = flavorTermSamples(CORPUS).filter(
      (sample) => sample.category === "adverb"
    );
    expect(adverbSamples).toHaveLength(1);
    expect(adverbSamples[0]).toMatchObject({ docIndex: 0, label: "缓缓", count: 2 });
  });

  it("同一句式条目跨篇各出一条样本（docIndex 不同）", () => {
    const cognitiveSamples = flavorTermSamples(CORPUS).filter(
      (sample) => sample.category === "cognitive"
    );
    expect(cognitiveSamples).toHaveLength(2);
    expect(cognitiveSamples.map((sample) => sample.label)).toEqual([
      AI_FLAVOR_COGNITIVE_LABEL,
      AI_FLAVOR_COGNITIVE_LABEL
    ]);
    expect(cognitiveSamples.map((sample) => sample.docIndex).sort()).toEqual([1, 2]);
    // doc1 里两处认知转述合成一条样本（count 2），doc2 一处（count 1）。
    expect(cognitiveSamples.map((sample) => sample.count).sort()).toEqual([1, 2]);
  });

  it("对话标签经同一份归一后计入 essay：半角直引号的两篇各出一条", () => {
    const dialogueSamples = flavorTermSamples(CORPUS).filter((sample) =>
      sample.label.includes("对话标签")
    );
    expect(dialogueSamples.map((sample) => sample.docIndex)).toEqual([1, 2]);
    expect(dialogueSamples.every((sample) => sample.category === "essay")).toBe(true);
  });
});

describe("flavor-calibration · calibrateFlavor（构造语料手算对照）", () => {
  const rows = calibrateFlavor(CORPUS);

  it("四类各一行，现行阈值现取 AI_FLAVOR_MIN_COUNT", () => {
    expect(rows.map((row) => row.category)).toEqual(["cliche", "essay", "adverb", "cognitive"]);
    for (const row of rows) expect(row.current).toBe(AI_FLAVOR_MIN_COUNT[row.category]);
    expect(rows.map((row) => row.current)).toEqual([2, 1, 5, 3]);
  });

  it("样本数 = 该类别出现过的 (篇 × 条目) 对数", () => {
    expect(rows.map((row) => row.samples)).toEqual([4, 6, 1, 2]);
  });

  it("cliche：样本升序 [1,1,1,2] ⇒ p50=1、p90/p95/p99=2；误报率 1/4", () => {
    const cliche = rowOf(rows, "cliche");
    expect(cliche.quantiles).toEqual({ p50: 1, p90: 2, p95: 2, p99: 2 });
    expect(cliche.overShare).toBe(0.25);
  });

  it("essay：样本全 1 ⇒ 四个分位都是 1；误报率 1（阈值 1 全起报）", () => {
    const essay = rowOf(rows, "essay");
    expect(essay.quantiles).toEqual({ p50: 1, p90: 1, p95: 1, p99: 1 });
    expect(essay.overShare).toBe(1);
  });

  it("adverb：样本升序 [2] ⇒ 四个分位都是 2；误报率 0（阈值 5 无一命中）", () => {
    const adverb = rowOf(rows, "adverb");
    expect(adverb.quantiles).toEqual({ p50: 2, p90: 2, p95: 2, p99: 2 });
    expect(adverb.overShare).toBe(0);
  });

  it("cognitive：样本升序 [1,2] ⇒ p50=1、p90/p95/p99=2；误报率 0（阈值 3）", () => {
    const cognitive = rowOf(rows, "cognitive");
    expect(cognitive.quantiles).toEqual({ p50: 1, p90: 2, p95: 2, p99: 2 });
    expect(cognitive.overShare).toBe(0);
  });

  it("空语料：samples 全 0、分位全 null、误报率 null", () => {
    const empty = calibrateFlavor([]);
    expect(empty).toHaveLength(4);
    for (const row of empty) {
      expect(row.samples).toBe(0);
      expect(row.quantiles).toEqual({ p50: null, p90: null, p95: null, p99: null });
      expect(row.overShare).toBeNull();
    }
  });
});

describe("flavor-calibration · formatCalibrationTable", () => {
  it("表里含类别、现行阈值、p95 与误报率的数值文本", () => {
    const rows = calibrateFlavor(CORPUS);
    const table = formatCalibrationTable(rows);
    const cliche = rowOf(rows, "cliche");
    expect(table).toContain("cliche");
    expect(table).toContain(String(cliche.current));
    expect(table).toContain(String(cliche.quantiles.p95));
    expect(table).toContain(String(cliche.overShare));
    // 表头 + 四行数据。
    expect(table.split("\n")).toHaveLength(5);
  });

  it("空语料也排得出表（分位与误报率打「—」）", () => {
    const table = formatCalibrationTable(calibrateFlavor([]));
    expect(table).toContain("—");
    expect(table.split("\n")).toHaveLength(5);
  });
});

describe("flavor-calibration · 缺口语", () => {
  it("FLAVOR_CORPUS_GAP 非空且是中文（单真身）", () => {
    expect(FLAVOR_CORPUS_GAP.length).toBeGreaterThan(0);
    expect(FLAVOR_CORPUS_GAP).toMatch(/[\u4e00-\u9fff]/);
  });
});
