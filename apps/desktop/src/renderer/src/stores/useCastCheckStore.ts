/**
 * 人物设定核对（2026-10-22）。
 *
 * 与时间线核对、伏笔台账同一个位置：**另立一个 store**。useBookStore 是「当前打开的那一篇」，
 * 这里扫的是「全书人物卡 × 全书章节正文」，不随当前标签变；判定真身在 `contracts/character-card`
 * （纯函数、单测在那边），这里只负责读盘、组输入、存结果。
 *
 * 读盘两条纪律（与伏笔台账同款）：
 * - `allSettled`：一张卡或一章读不到不拖垮整张表；
 * - 读不到**不冒充没出现**：读失败的章节不参与 C2/C3，读失败的卡单列成数据缺口。
 */
import { defineStore } from "pinia";
import {
  castLevelLabel,
  checkCast,
  parseCharacterCard,
  splitFrontmatter,
  type CastChapterInput,
  type CastFinding,
  type CastCardInput
} from "@mochen/contracts";
import { useBookStore } from "./useBookStore";

export const useCastCheckStore = defineStore("castCheck", {
  state: () => ({
    /** 浮层是否开着。挂在那枚按钮上（与伏笔台账同一套路子）。 */
    open: false,
    /** 判定结果（已排好序：硬伤 → 疑似 → 数据缺口）。 */
    findings: [] as CastFinding[],
    /** 这次核对扫了多少张卡、多少章正文——头部要报得出「查过什么」。 */
    cardCount: 0,
    chapterCount: 0,
    busy: false,
    /** 读盘失败或部分章节没读到时的中文说明；空串 = 全都读到了。 */
    notice: "" as string
  }),

  getters: {
    defectCount(state): number {
      return state.findings.filter((one) => one.level === "defect").length;
    },
    suspectCount(state): number {
      return state.findings.filter((one) => one.level === "suspect").length;
    },
    gapCount(state): number {
      return state.findings.filter((one) => one.level === "gap").length;
    },
    /** 头部那句话：查过多少、报了几处，零告警也要说话。 */
    verdict(state): string {
      if (state.cardCount === 0) return "这本书还没有人物卡，没有可核对的约束。";
      const total = state.findings.length;
      if (total === 0) {
        return `查过 ${state.cardCount} 张人物卡、${state.chapterCount} 章正文，没有对不上的地方。`;
      }
      const count = (level: CastFinding["level"]): number =>
        state.findings.filter((one) => one.level === level).length;
      return (
        `查过 ${state.cardCount} 张人物卡、${state.chapterCount} 章正文，` +
        `硬伤 ${count("defect")} 处、疑似 ${count("suspect")} 处、数据缺口 ${count("gap")} 处。`
      );
    }
  },

  actions: {
    async load(): Promise<void> {
      const book = useBookStore();
      const cardDocs = book.docs.filter((doc) => doc.kind === "character");
      const chapterDocs = book.docs.filter((doc) => doc.kind === "chapter");
      this.cardCount = cardDocs.length;
      this.chapterCount = chapterDocs.length;
      this.notice = "";
      if (cardDocs.length === 0) {
        this.findings = [];
        return;
      }
      this.busy = true;
      try {
        const [cardRaws, chapterRaws] = await Promise.all([
          Promise.allSettled(cardDocs.map((doc) => window.mochen.readDoc(doc.relPath))),
          Promise.allSettled(chapterDocs.map((doc) => window.mochen.readDoc(doc.relPath)))
        ]);

        const cards: CastCardInput[] = [];
        const unreadable: CastFinding[] = [];
        cardDocs.forEach((doc, i) => {
          const one = cardRaws[i];
          if (one?.status !== "fulfilled") {
            unreadable.push({
              level: "gap",
              code: "C4",
              card: doc.title,
              cardPath: doc.relPath,
              message: "这张人物卡读不出来，它声明的约束这一轮没法核对。",
              chapter: "",
              line: 0,
              quote: ""
            });
            return;
          }
          cards.push({
            relPath: doc.relPath,
            title: doc.title,
            meta: parseCharacterCard(one.value.content)
          });
        });

        const chapters: CastChapterInput[] = [];
        let unreadChapters = 0;
        chapterDocs.forEach((doc, i) => {
          const one = chapterRaws[i];
          if (one?.status !== "fulfilled") {
            unreadChapters += 1;
            return;
          }
          // 判据只看正文：围栏里的 `title:` 不是作者写的字（口径同 page 脚与伏笔台账）。
          chapters.push({ relPath: doc.relPath, text: bodyOf(one.value.content) });
        });
        if (unreadChapters > 0) {
          this.notice = `有 ${unreadChapters} 章正文没读出来，那几章的口头禅与退场判定跳过了。`;
        }

        const known = book.docs.map((doc) => doc.relPath);
        this.findings = [...unreadable, ...checkCast(cards, chapters, known)].sort(
          (a, b) =>
            LEVEL_RANK[a.level] - LEVEL_RANK[b.level] ||
            a.card.localeCompare(b.card, "zh") ||
            a.chapter.localeCompare(b.chapter, "zh")
        );
      } catch (err) {
        this.notice = `人物卡没读回来：${
          err instanceof Error && err.message !== "" ? err.message : String(err)
        }`;
        this.findings = [];
      } finally {
        this.busy = false;
      }
    },

    async toggle(): Promise<void> {
      this.open = !this.open;
      if (this.open) await this.load();
    },

    close(): void {
      this.open = false;
    }
  }
});

const LEVEL_RANK = { defect: 0, suspect: 1, gap: 2 } as const;

/** 剥 frontmatter 取正文——切分真身在 contracts 的 splitFrontmatter（这里不另写一套围栏规则）。 */
function bodyOf(raw: string): string {
  return splitFrontmatter(raw).body;
}

/** 分组标题（面板按三层分块渲染）；穷尽表少一档编译不过。 */
export function castGroups(
  findings: readonly CastFinding[]
): { level: CastFinding["level"]; label: string; rows: CastFinding[] }[] {
  return (["defect", "suspect", "gap"] as const)
    .map((level) => ({
      level,
      label: castLevelLabel(level),
      rows: findings.filter((one) => one.level === level)
    }))
    .filter((group) => group.rows.length > 0);
}
