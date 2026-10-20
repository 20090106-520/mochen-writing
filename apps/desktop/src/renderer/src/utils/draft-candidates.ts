/**
 * 多稿候选的文案与判定层（P0-②，2026-10-19）。
 *
 * 与 agent-thread.ts 同一条理由（铁律 6）：同一件事的句子只有一份真身，
 * 组件与 store 只读结果、不自己拼字。所以「读数行怎么拼」「按钮叫什么」「丢稿回哪句话」全在这里。
 *
 * 这里另有两枚**非纯**的函数（`callDraftSet` / `resolveDraft`）：它们替 store 走一次 IPC
 * 并把 rejection 收成中文。搬进来的理由与 tick/queueText 那类不同——不是因为「纯」，
 * 而是因为这两个动作本身与候选集一一对应，句子与成败判定都长在这份文件里，
 * 留在 store 里就得多一份「哪句话给失败哪句话给成功」的判据（那正是要避免的第二份口径）。
 */

import {
  DRAFT_SAMPLE_COUNTS,
  degenerationOf,
  type DraftCandidate,
  type DraftReading,
  type DraftSampleCount,
  type DraftSetResult,
  vitalityOf
} from "@mochen/contracts";
import { reasonOf } from "./agent-thread";

/** 多稿档：关 → ×2 → ×3 → 关。次序从 contracts 的 DRAFT_SAMPLE_COUNTS 现拼，不留第二份档位表。 */
export function nextDraftSampleCount(current: DraftSampleCount): DraftSampleCount {
  const at = DRAFT_SAMPLE_COUNTS.indexOf(current);
  return DRAFT_SAMPLE_COUNTS[(at + 1) % DRAFT_SAMPLE_COUNTS.length]!;
}

/** 一集候选在渲染层的暂存形状：句柄 + 已按 rankDrafts 排好序的 N 稿。 */
export interface DraftSetState {
  draftSetId: string;
  drafts: DraftCandidate[];
}

/** 正文预览的码点上限：候选可能很长，面板只给一眼看得完的一段。 */
export const DRAFT_PREVIEW_MAX = 160;

/** 正文预览：先把空白折成单个空格，再按**码点**截断（`slice` 会把 emoji 的代理对劈成半个字）。 */
export function draftPreview(text: string): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  const points = [...flat];
  return points.length <= DRAFT_PREVIEW_MAX
    ? flat
    : `${points.slice(0, DRAFT_PREVIEW_MAX).join("")}…`;
}

/** 列表位次（1 起报）：稿序号在 contracts 里 0 起算，那是主进程认的位次，不是「第几稿」该给人的读法。 */
export function draftOrdinal(position: number): string {
  return `第 ${position + 1} 稿`;
}

/** 一稿的行头：位次 + 字数。 */
export function draftHeadline(position: number, reading: DraftReading): string {
  return `${draftOrdinal(position)} · ${reading.charCount} 字`;
}

/**
 * 一稿读数 → 一行中文。四条读数各出一句，**算不出的那条不硬凑**：
 * `startRepeat` / `flatRhythm` 为 null 时那半句直接不出现，不留「未触发 / 无」这类空话。
 */
export function draftReadingLine(reading: DraftReading): string {
  const parts = [
    reading.repeatOverCount === 0
      ? "没有反复打转的句子"
      : `同一句原样打转 ${reading.repeatOverCount} 处`,
    `重罪词命中 ${reading.hits} 处（每千字 ${reading.perThousand}）`
  ];
  if (reading.startRepeat !== null) {
    const { char, count, total } = reading.startRepeat;
    parts.push(`句首复读：${count}/${total} 句以「${char}」起头`);
  }
  if (reading.flatRhythm !== null) {
    parts.push(`句长偏匀：平均 ${reading.flatRhythm.mean} 字，波动 ${reading.flatRhythm.spread}`);
  }
  return parts.join(" · ");
}

/** 面板标题：摆的是「还没落盘」的东西，标题必须把这一点说在前面。 */
export const DRAFT_PANEL_TITLE = "这一轮跑出了几稿，挑一稿落盘——没挑的就丢在这里。";

/**
 * 活性读数（P1-⑥）的提示句：面板摆出一排数，最怕被当成第二条判退线。
 * 所以这里把三件事点名说清——① 三枚都**越大越像人写的**；② **熵与多样性随字数变化**，
 * 两稿字数差得多时这两项别硬比；③ 它**不是判据**，闸里一个字都不看它。
 */
export const DRAFT_VITALITY_NOTE =
  "活性读数是代理指标，只作相对参考：三项都越大越像人写的，但字串熵与字多样性会随字数变化——两稿字数差得多时这两项别硬比。它不是判据，闸里一个字都不看它。";

/** 三枚活性读数全算不出来时的那句话（短文：说不出来就说不出来，不硬报 0）。 */
export const DRAFT_VITALITY_UNKNOWN = "活性算不出来（这段太短）";

/**
 * 一稿的活性读数 → 一行中文。三枚各出一句，**算不出的那枚整个不出现**（同 `draftReadingLine`
 * 的口径，不留「未触发 / 无」这类空话）；三枚全算不出时给一句实话。
 * 数字全部现取自 contracts 的 `vitalityOf`——判定、阈值、聚合一概不在这层（活性只作相对参考）。
 */
export function draftVitalityLine(text: string): string {
  const { ngramEntropy, burstiness, diversity } = vitalityOf(text);
  const parts: string[] = [];
  if (ngramEntropy !== null) parts.push(`字串熵 ${ngramEntropy} bits/字`);
  if (burstiness !== null) parts.push(`句长突发度 ${burstiness}`);
  if (diversity !== null) parts.push(`字多样性 ${diversity}`);
  return parts.length === 0 ? DRAFT_VITALITY_UNKNOWN : `活性：${parts.join(" · ")}`;
}

/**
 * 退化读数（P1-⑦）的提示句：与活性读数同一层「只摆数不作判据」，但**方向相反**——
 * 活性是越大越像人写的，退化是**虚词越少、句子越短越像被削平**（改稿删过头也会出机器味）。
 * 必须说清三件事：① 方向（这三项是「低了好」而不是「高了好」）；② 虚词清单是启发式的；
 * ③ **不是判据**，闸里一个字都不看它。
 */
export const DRAFT_DEGENERATION_NOTE =
  "退化读数是另一组代理指标，方向与活性相反：虚词密度越低、短句越多、平均句长越短，越像改稿时被削平（删过头也会出机器味）。虚词清单是启发式的，换个清单读数会变。它不是判据，闸里一个字都不看它。";

/** 三枚退化读数全算不出来时的那句话（短文：说不出来就说不出来，不硬报 0）。 */
export const DRAFT_DEGENERATION_UNKNOWN = "退化算不出来（这段太短）";

/**
 * 一稿的退化读数 → 一行中文。三枚各出一句，**算不出的那枚整个不出现**（同 `draftVitalityLine`
 * 的口径，不留「未触发 / 无」这类空话）；三枚全算不出时给一句实话。
 * 数字全部现取自 contracts 的 `degenerationOf`——判定、阈值、聚合一概不在这层。
 */
export function draftDegenerationLine(text: string): string {
  const { particlePerThousand, shortSentenceRatio, meanSentenceLength } = degenerationOf(text);
  const parts: string[] = [];
  if (particlePerThousand !== null) parts.push(`虚词密度 ${particlePerThousand}/千字`);
  if (shortSentenceRatio !== null) parts.push(`短句占比 ${shortSentenceRatio}`);
  if (meanSentenceLength !== null) parts.push(`平均句长 ${meanSentenceLength} 字`);
  return parts.length === 0 ? DRAFT_DEGENERATION_UNKNOWN : `退化：${parts.join(" · ")}`;
}

/** 排名最前那一稿的徽标。排名来自 contracts 的 rankDrafts，面板只标位次，不再自己算一份推荐度。 */
export const DRAFT_RECOMMENDED_LABEL = "推荐";

export const DRAFT_PICK_LABEL = "用这一稿";
export const DRAFT_DISCARD_LABEL = "丢弃全部";

/** 丢稿成功后的回执：丢弃也是要交代的事，静默会让人以为界面卡住了。 */
export const DRAFT_DISCARD_DONE = "这几稿都丢掉了，一个字都没落盘。";

/**
 * 选定 / 丢弃一次候选：成功回空串，失败回**主进程给的那句中文**（或跨 IPC 抛错收成的中文）。
 * 正文一个字都不递——落盘由主进程按集里存的原始事件回放（见 contracts 的 `pickDraftInputSchema`）。
 */
export async function callDraftSet(draftSetId: string, index: number | null): Promise<string> {
  let result: DraftSetResult;
  try {
    result =
      index === null
        ? await window.mochen.discardDrafts({ draftSetId })
        : await window.mochen.pickDraft({ draftSetId, index });
  } catch (err) {
    return reasonOf(err);
  }
  return result.ok ? "" : result.message;
}

/**
 * 选稿 / 丢稿共用的一段：回**该显示的那句话**（空串 = 什么都不用说）。
 * 失败时集不动（主进程那句中文原样转出）；成功即清掉这一集的候选，
 * 丢稿再补上回执句 `done`（选稿传空串——落的稿由随后的转录自己说话）。
 */
export async function resolveDraft(
  sets: Record<string, DraftSetState>,
  threadKey: string,
  index: number | null,
  done: string
): Promise<string> {
  const set = sets[threadKey];
  if (set === undefined) return "";
  const message = await callDraftSet(set.draftSetId, index);
  if (message !== "") return message;
  delete sets[threadKey];
  return done;
}
