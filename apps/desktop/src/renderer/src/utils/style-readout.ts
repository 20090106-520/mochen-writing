/**
 * 「本书自己的读数」在界面上的呈现层（2026-11-16）。
 *
 * 数字真身全部在 `@mochen/contracts`：句长/段长/标点/段末在 `style-profile`，
 * 对白段落形态在 `dialogue-rhythm`，台词复读在 `dialogue-repeat`，叙述人称在
 * `narration-person`，句首榜在 `sentence-opening`，腔调偏离在 `style-drift`。这里只做两件事：
 *   ① 把五份扫描收成一份可渲染的读数（`bookStyleReadoutOf`）；
 *   ② 把读数说成卡片/胶囊要的短句（`readoutRowsOf` / `chapterChipsOf`）。
 *
 * 【只摆不判】不设阈值、不打分、不排序（复读榜沿用 contracts 的次数降序）。
 * 颜色与档位只区分「偏离大小」，那是 `styleDriftOf` 已经算好的既有档，不在这里新造。
 */
import {
  dialogueBalance,
  dialogueParagraphShapeOf,
  dialogueRepeatsOf,
  narrationPersonOf,
  sentenceOpeningsOf,
  styleDriftOf,
  styleProfileOf,
  STYLE_PROFILE_MIN_CHARS,
  STYLE_PROFILE_PUNCTUATION,
  type DialogueParagraphShape,
  type DialogueRepeat,
  type NarrationPerson,
  type ParagraphEndMark,
  type SentenceOpening,
  type StyleProfile
} from "@mochen/contracts";

/** 体检卡片的一行：左标签、右读数、悬停说明。 */
export interface ReadoutRow {
  label: string;
  value: string;
  hint: string;
}

/** 页脚/浮层的一枚胶囊。 */
export interface ReadoutChip {
  key: string;
  label: string;
  value: string;
  hint: string;
}

/** 章节列表上那枚「偏」标的档位与悬停说明。 */
export interface ChapterDriftMark {
  severity: "warn" | "off";
  title: string;
}

/** 一本书的五份读数：一次取齐，界面不再各扫一遍。 */
export interface BookStyleReadout {
  profile: StyleProfile | null;
  shape: DialogueParagraphShape | null;
  repeats: DialogueRepeat[];
  person: NarrationPerson | null;
  /** 句首榜（2026-11-17 下沉到 contracts 的那一份，prompt 与界面同源）。 */
  sentenceOpenings: SentenceOpening[];
}

/** 五份读数一次取齐。contents 是各篇正文（按文档顺序）。 */
export function bookStyleReadoutOf(contents: readonly string[]): BookStyleReadout {
  return {
    profile: styleProfileOf(contents),
    shape: dialogueParagraphShapeOf(contents),
    repeats: dialogueRepeatsOf(contents),
    person: narrationPersonOf(contents),
    sentenceOpenings: sentenceOpeningsOf(contents)
  };
}

/** 0–1 的比例 → `41.7%`（1 位小数，与体检报告同一套写法）。 */
function percentOf(ratio: number): string {
  return `${Math.round(ratio * 1000) / 10}%`;
}

/** 段末标点的展示名。顺序固定：句号 → 问号 → 感叹号 → 省略号 → 其他。 */
const END_MARK_ROWS: readonly { key: ParagraphEndMark; label: string }[] = [
  { key: "period", label: "句号" },
  { key: "question", label: "问号" },
  { key: "exclamation", label: "感叹号" },
  { key: "ellipsis", label: "省略号" },
  { key: "other", label: "其他" }
];

const SAMPLE_MISSING = "样本不足，不报";

/**
 * 全书读数卡的九行（顺序固定）。样本不足的那一格**明说「不报」**，不报 0、不猜——
 * 这与 `styleProfileOf` 返回 `null` 是同一条纪律。
 */
export function readoutRowsOf(readout: BookStyleReadout): ReadoutRow[] {
  const { profile, shape, repeats, person, sentenceOpenings } = readout;
  return [
    {
      label: "句长",
      value:
        profile === null
          ? SAMPLE_MISSING
          : profile.rhythm === null
            ? "句数不足 10 句，不报"
            : `平均 ${profile.rhythm.mean} 字 · 长短句落差 ${profile.rhythm.spread}`,
      hint: "平均句长与长短句落差（标准差 ÷ 均值）。只报这本书自己的数，不判定长短好坏。"
    },
    {
      label: "句首",
      value:
        sentenceOpenings.length === 0
          ? "没有出现 2 次以上的同一句首"
          : sentenceOpenings.map(({ opening, count }) => `「${opening}」×${count}`).join(" · "),
      hint: "句首＝剥掉前置标点／引号后的前 2 个实字；同一句首出现 ≥2 次才上榜，最多 5 条。"
    },
    {
      label: "段长",
      value:
        profile === null
          ? SAMPLE_MISSING
          : profile.paragraph === null
            ? "段落不足 10 段，不报"
            : `平均 ${profile.paragraph.mean} 字 · 段长波动 ${profile.paragraph.spread}`,
      hint: "非空段落的平均字数与段长波动（变异系数）：段段一样长时才接近 0。"
    },
    {
      label: "对白",
      value: profile === null ? SAMPLE_MISSING : percentOf(profile.dialogueRatio),
      hint: "引号内字数 ÷ 非空白字数。与体检「对话占比」同一份口径。"
    },
    {
      label: "段末收在台词",
      value:
        profile === null
          ? SAMPLE_MISSING
          : `${percentOf(
              profile.endsOnQuote.total === 0
                ? 0
                : profile.endsOnQuote.count / profile.endsOnQuote.total
            )}（${profile.endsOnQuote.count}/${profile.endsOnQuote.total} 段）`,
      hint: "以非空行切段，最后收在引号内台词上的段数 ÷ 总段数。"
    },
    {
      label: "段末标点",
      value:
        profile === null
          ? SAMPLE_MISSING
          : END_MARK_ROWS.filter(({ key }) => profile.endMarkShare[key] > 0)
              .map(({ key, label }) => `${label} ${percentOf(profile.endMarkShare[key])}`)
              .join(" · "),
      hint: "每段只归一类：看最后一个句末标点，忽略其后的收引号。"
    },
    {
      label: "标点脾气",
      value:
        profile === null
          ? SAMPLE_MISSING
          : STYLE_PROFILE_PUNCTUATION.map(
              ({ key, label }) => `${label} ${profile.punctuation[key]} 处/千字`
            ).join(" · "),
      hint: "每千字出现几处，与体检报告同一份算法（不是「多少算多」的判线）。"
    },
    {
      label: "对白段落形态",
      value:
        shape === null
          ? "含对白段落不足 10 段，不报"
          : `纯台词 ${shape.pure} 段 · 台词＋动作 ${shape.mixed} 段`,
      hint: "含对白的段落里，引号外只剩标点的算纯台词段，还有叙述的算台词＋动作。"
    },
    {
      label: "台词复读",
      value:
        repeats.length === 0
          ? "没有出现 2 次以上的同一句台词"
          : repeats
              .slice(0, 3)
              .map((repeat) => `「${repeat.line}」×${repeat.count}`)
              .join(" · "),
      hint: "同一句台词原话（≥3 个非标点字）出现 ≥2 次才上榜；有意复读还是手滑，交给你判断。"
    },
    {
      label: "叙述人称",
      value:
        person === null
          ? "叙述样本不足 500 字，不报"
          : `第一人称 ${person.first} 次 · 第三人称 ${person.third} 次（引号外；人名不计入第三人称）`,
      hint: "只数引号外的叙述代词。人名承担了多数第三人称指代，所以第三那个数是下界。"
    }
  ];
}

/** 卡片下面那句说明。样本不足时明说原因，不摆一排「不报」就完事。 */
export function readoutNoteOf(readout: BookStyleReadout): string {
  if (readout.profile === null) {
    return "完稿还不足 500 字，立不起这本书的腔调档案——开书前立手册，立出来的只会是别人的东西。";
  }
  return "这几行只摆本书自己的数：不设阈值、不判定；哪一条要不要改，交给你。";
}

/**
 * 页脚与「去 AI 味」浮层共用的三枚胶囊。样本不足时只给一枚「样本不足 500 字」——
 * 摆一串 `—` 只会让人以为量出来是 0。
 */
export function chapterChipsOf(content: string): ReadoutChip[] {
  const balance = dialogueBalance(content);
  if (balance.total < STYLE_PROFILE_MIN_CHARS) {
    return [
      {
        key: "sample",
        label: "腔调",
        value: `样本不足 ${STYLE_PROFILE_MIN_CHARS} 字`,
        hint: "正文还不够量腔调；再写一点，这里会摆出句长、对白比与对白段落形态。"
      }
    ];
  }
  // 复用这一趟已经算好的对白占比，不再逐字重扫一遍（styleProfileOf 的既有入参）。
  const profile = styleProfileOf([content], balance);
  const rhythm = profile?.rhythm ?? null;
  const shape = dialogueParagraphShapeOf([content]);
  return [
    {
      key: "rhythm",
      label: "句长",
      value: rhythm === null ? "样本不足" : `${rhythm.mean} 字`,
      hint: "平均句长（字）。只摆这一篇自己的数，不判定长短。"
    },
    {
      key: "dialogue",
      label: "对白",
      value: percentOf(profile?.dialogueRatio ?? balance.ratio),
      hint: "引号内字数 ÷ 非空白字数。"
    },
    {
      key: "pure",
      label: "纯台词段",
      value: shape === null ? "—" : `${shape.pure}/${shape.withDialogue} 段`,
      hint:
        shape === null
          ? "含对白的段落不足 10 段，形态先不报。"
          : "含对白的段落里，引号外只剩标点的纯台词段 ÷ 含对白段数。"
    }
  ];
}

/**
 * 章节列表的偏离标：只收 `warn` / `off`，一致与「太短没法比」都不产生键。
 * 档位与文案全部来自 `styleDriftOf`，这里只把它拼进悬停说明。
 */
export function chapterDriftMarksOf(
  profile: StyleProfile | null,
  chapters: readonly { relPath: string; title: string; content: string }[]
): Record<string, ChapterDriftMark> {
  const marks: Record<string, ChapterDriftMark> = {};
  for (const chapter of chapters) {
    const drift = styleDriftOf(profile, chapter.content);
    const worst = drift.worst;
    if (!drift.checked || worst === null) continue;
    marks[chapter.relPath] = {
      severity: worst.severity,
      title: `《${chapter.title}》${drift.note}${worst.label} ${worst.draft}（本书常态 ${worst.base}）。${worst.advice}`
    };
  }
  return marks;
}
