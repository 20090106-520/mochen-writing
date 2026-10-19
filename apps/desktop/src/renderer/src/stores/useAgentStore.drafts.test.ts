/**
 * 多稿采样在渲染层的接线（P0-②）。
 *
 * 判据全落在**出站输入与候选集的进出**：档位循环 1→2→3→1、`send` 把当下档位原样塞进
 * `sampleCount`、`candidates` 入集而不污染转录、换轮清集、选稿成功清集 / 失败把主进程那句
 * 中文写进 notice。
 *
 * 面板与 chip 的句子不在这里：它们在 utils/draft-candidates.test.ts 与 utils/composer-chips.test.ts。
 */
import { describe, expect, it } from "vitest";
import { DRAFT_SET_FAIL_MESSAGES, type DraftCandidate } from "@mochen/contracts";
import { DRAFT_DISCARD_DONE } from "../utils/draft-candidates";
import {
  CH,
  discardDrafts,
  itemsOf,
  openChapter,
  pickDraft,
  push,
  setupAgentFixture,
  started,
  store
} from "./agent-store-fixture";

setupAgentFixture();

/** 一稿的读数底座：这里只关心候选集的进出，读数本身照最省的填。 */
function reading(index: number): DraftCandidate["reading"] {
  return {
    index,
    charCount: 100 + index,
    pass: true,
    hits: 0,
    perThousand: 0,
    topTerms: [],
    startRepeat: null,
    flatRhythm: null,
    structureOver: [],
    repeatOverCount: 0
  };
}

function candidate(index: number): DraftCandidate {
  return { index, text: `第 ${index + 1} 稿的正文`, reading: reading(index) };
}

function pushCandidates(turnId: string, drafts: DraftCandidate[], draftSetId = "set-1"): void {
  push({ type: "candidates", turnId, threadKey: CH, draftSetId, drafts });
}

/** 开书 + 挂监听 + 开一轮 + 推一份两稿的候选集：多数用例的共同起手式。 */
async function openWithCandidates(): Promise<void> {
  await openChapter();
  store().startListening();
  push({ type: "turn-start", turnId: "t1", threadKey: CH });
  pushCandidates("t1", [candidate(0), candidate(1)]);
}

describe("useAgentStore · 多稿档位（P0-②）", () => {
  it("默认是关（1）：它是 N 倍 token 成本的开关，刻意不跨重启记忆", () => {
    expect(store().sampleCount).toBe(1);
  });

  it("cycleDraftSample 走 1 → 2 → 3 → 1（次序从 DRAFT_SAMPLE_COUNTS 现拼）", () => {
    store().cycleDraftSample();
    expect(store().sampleCount).toBe(2);
    store().cycleDraftSample();
    expect(store().sampleCount).toBe(3);
    store().cycleDraftSample();
    expect(store().sampleCount).toBe(1);
  });

  it("send 把当下档位原样塞进出站输入（默认关就发 1，切到 ×2 就发 2）", async () => {
    await openChapter();
    store().send("出两稿看看");
    expect(started.at(-1)?.sampleCount).toBe(1);
    store().cycleDraftSample();
    store().send("再来一轮");
    expect(started.at(-1)?.sampleCount).toBe(2);
  });
});

describe("useAgentStore · 多稿候选集（P0-②）", () => {
  it("candidates 到达 ⇒ 按线程键入集（draftSetId 与那几稿原样收下），一个字都不进转录", async () => {
    await openWithCandidates();
    expect(store().draftSets[CH]?.draftSetId).toBe("set-1");
    expect(store().draftSets[CH]?.drafts.map((d) => d.index)).toEqual([0, 1]);
    // 候选集是**暂存态**：它不是转录里的消息，绝不能顺手塞进 items 冒充一轮输出。
    expect(itemsOf()).toEqual([]);
  });

  it("换轮即作废：新一轮的 turn-start 一到，上一轮的候选集当场清掉", async () => {
    await openWithCandidates();
    expect(store().draftSets[CH]).toBeDefined();
    push({ type: "turn-start", turnId: "t2", threadKey: CH });
    expect(store().draftSets[CH]).toBeUndefined();
  });

  it("迟到的旧轮候选集不进集（turnId 对不上就挡在归约之外）", async () => {
    await openWithCandidates();
    pushCandidates("t0", [candidate(0)], "set-old");
    expect(store().draftSets[CH]?.draftSetId).toBe("set-1");
  });

  it("pickDraft 成功 ⇒ 只递句柄与位次，集清掉、notice 不动（落的那一稿由随后的转录自己说话）", async () => {
    await openWithCandidates();
    await store().pickDraft(1);
    expect(pickDraft).toHaveBeenCalledWith({ draftSetId: "set-1", index: 1 });
    expect(store().draftSets[CH]).toBeUndefined();
    expect(store().notice).toBe("");
  });

  it("pickDraft 失败 ⇒ 主进程那句中文进 notice，集不动（用户还能再点别的稿）", async () => {
    await openWithCandidates();
    pickDraft.mockResolvedValueOnce({
      ok: false,
      reason: "gone",
      message: DRAFT_SET_FAIL_MESSAGES.gone
    });
    await store().pickDraft(0);
    expect(store().notice).toBe(DRAFT_SET_FAIL_MESSAGES.gone);
    expect(store().draftSets[CH]?.draftSetId).toBe("set-1");
  });

  it("pickDraft 跨 IPC 抛错 ⇒ 收成中文写进 notice（reasonOf 那条路），集照旧留着", async () => {
    await openWithCandidates();
    pickDraft.mockRejectedValueOnce(new Error("通道断了"));
    await store().pickDraft(0);
    expect(store().notice).toBe("通道断了");
    expect(store().draftSets[CH]?.draftSetId).toBe("set-1");
  });

  it("discardDrafts 成功 ⇒ 清集并回一句丢稿实话（没落盘就是没落盘）", async () => {
    await openWithCandidates();
    await store().discardDrafts();
    expect(discardDrafts).toHaveBeenCalledWith({ draftSetId: "set-1" });
    expect(store().draftSets[CH]).toBeUndefined();
    expect(store().notice).toBe(DRAFT_DISCARD_DONE);
  });

  it("集已经不在（换过轮 / 从没有过）⇒ 不发 IPC、不改 notice，一个字的副作用都不留", async () => {
    await openChapter();
    await store().pickDraft(0);
    await store().discardDrafts();
    expect(pickDraft).not.toHaveBeenCalled();
    expect(discardDrafts).not.toHaveBeenCalled();
    expect(store().notice).toBe("");
  });
});
