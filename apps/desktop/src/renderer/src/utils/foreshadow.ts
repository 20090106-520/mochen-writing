import {
  parseForeshadowMeta,
  resolveForeshadowStatus,
  splitFrontmatter,
  type DocRef,
  type ForeshadowStatus
} from "@mochen/contracts";

/**
 * 伏笔台账的**行组装与统计**（2026-10-05）。
 *
 * 解析与状态机在 `contracts/foreshadow.ts`（主进程写、渲染层读，必须同一份），这里只管
 * 「把一堆伏笔文稿摆成一张能一眼看懂的表」：排序、语气、脏数据提示、统计。
 *
 * 一条纪律贯穿全文件：**宁可让作者多看一眼，不替他下结论。**
 * 状态字段写错就说写错（`broken`），只填了回收章也不判死（仍算已埋），
 * 读不到原文的也照样列出来（`unknown`）——凭空消失的那一条才是真正会漏的伏笔。
 */

/** 一行在台账里的语气。`broken` / `unknown` 是两种「需要人看一眼」的异常态。 */
export type ForeshadowTone = "pending" | "paid" | "dropped" | "broken" | "unknown";

export interface ForeshadowRow {
  relPath: string;
  title: string;
  status: ForeshadowStatus;
  /** 屏显说法（来自 contracts 的穷尽表，这里不自抄）。 */
  statusLabel: string;
  /** 埋在哪、收在哪；作者没写就是空串，面板据此说「没写」而不是留白。 */
  plantedIn: string;
  paidIn: string;
  /** frontmatter 里 status 的原样取值；空串 = 没写这个键。 */
  rawStatus: string;
  /** 可选：作者声明能认出这条线的那几个词（C6 关键词回归用）；没写就是空表。 */
  keywords: string[];
  tone: ForeshadowTone;
}

function isKnownStatus(value: string): value is ForeshadowStatus {
  return value === "planted" || value === "paid" || value === "dropped";
}

/**
 * 把书里所有伏笔文稿的**原文**一次性读回来（2026-10-09 从 `useBookStore` 搬出来，
 * 让 store 只留「摆状态」那一格；并发与容错的判定本来就该和上面的行组装在同一处）。
 *
 * 用 `allSettled` 而不是 `all`：某一篇读不到（正在被占用、刚被外部删掉）时，
 * 其余的照旧列出来，那一条走 `unknown` 语气——从台账上凭空消失的那一条才是最需要被看见的。
 */
export async function readForeshadowRaws(
  docs: DocRef[],
  readDoc: (relPath: string) => Promise<{ content: string }>
): Promise<Map<string, string>> {
  const targets = docs.filter((d) => d.kind === "foreshadow");
  const raws = new Map<string, string>();
  const loaded = await Promise.allSettled(targets.map((d) => readDoc(d.relPath)));
  targets.forEach((d, i) => {
    const one = loaded[i];
    if (one?.status === "fulfilled") raws.set(d.relPath, one.value.content);
  });
  return raws;
}

/** 同状态内部的排序：异常与「还欠什么」排在最前，台账先说要紧的。 */
const TONE_ORDER: Record<ForeshadowTone, number> = {
  broken: 0,
  unknown: 1,
  pending: 2,
  paid: 3,
  dropped: 4
};

/**
 * 把书里的伏笔文稿摆成台账行。
 * `raws` 是 `relPath → 文稿原文`，由 store 一次性读回来；读不到的那条仍会列出来（unknown）。
 */
export function foreshadowRows(docs: DocRef[], raws: Map<string, string>): ForeshadowRow[] {
  const rows: ForeshadowRow[] = [];
  for (const doc of docs) {
    if (doc.kind !== "foreshadow") continue;
    const raw = raws.get(doc.relPath);
    if (raw === undefined) {
      rows.push({
        relPath: doc.relPath,
        title: doc.title,
        status: "planted",
        statusLabel: resolveForeshadowStatus("planted"),
        plantedIn: "",
        paidIn: "",
        rawStatus: "",
        keywords: [],
        tone: "unknown"
      });
      continue;
    }
    const meta = parseForeshadowMeta(raw);
    // 写了但认不出：这是**数据坏了**，不是「还没写」——两者的下一步动作完全不同。
    const broken = meta.rawStatus !== "" && !isKnownStatus(meta.rawStatus);
    rows.push({
      relPath: doc.relPath,
      title: doc.title,
      status: meta.status,
      statusLabel: resolveForeshadowStatus(meta.status),
      plantedIn: meta.plantedIn,
      paidIn: meta.paidIn,
      rawStatus: meta.rawStatus,
      keywords: meta.keywords,
      tone: broken ? "broken" : meta.status === "planted" ? "pending" : meta.status
    });
  }
  return rows.sort((a, b) => {
    const byTone = TONE_ORDER[a.tone] - TONE_ORDER[b.tone];
    return byTone !== 0 ? byTone : a.relPath.localeCompare(b.relPath);
  });
}

export interface ForeshadowStats {
  total: number;
  pending: number;
  paid: number;
  dropped: number;
  /** 状态字段写坏了的条数——它们既不能算待回收也不能算已回收。 */
  broken: number;
}

export function foreshadowStats(rows: ForeshadowRow[]): ForeshadowStats {
  const stats: ForeshadowStats = { total: rows.length, pending: 0, paid: 0, dropped: 0, broken: 0 };
  for (const row of rows) {
    if (row.tone === "broken") stats.broken += 1;
    else if (row.tone === "unknown") stats.pending += 1;
    else if (row.tone === "pending") stats.pending += 1;
    else if (row.tone === "paid") stats.paid += 1;
    else stats.dropped += 1;
  }
  return stats;
}

/** 语气 → 给作者的下一步提示。穷尽表：加一种语气而不写这里，编译不过。 */
const PLANT_TONE_LABELS: Record<ForeshadowTone, string> = {
  pending: "还没回收——写到这里时它该有个交代",
  paid: "已回收",
  dropped: "已弃用（不再管它）",
  broken: "状态字段不是 planted/paid/dropped，改前它按「已埋」算",
  unknown: "读不到这篇原文，状态未知"
};

export function plantToneLabel(tone: ForeshadowTone): string {
  return PLANT_TONE_LABELS[tone];
}

/** 关键词最少两个字：一个字的关键词在正文里到处撞上，判不出「这一处算不算埋了」。 */
export const FORESHADOW_KEYWORD_MIN = 2;

/**
 * 把台账里登记过的**埋设章正文**读回来（2026-10-22，C6 关键词回归）。
 *
 * 只读「真被某条伏笔当成埋设章」的那几篇，不扫全书：台账打开时要的是「这几处还对不对」，
 * 不是又一次全文体检。读不到的章不进 map——调用方据此跳过，不拿「没读到」当「关键词不在」。
 * 与 `readForeshadowRaws` 同款纪律：`allSettled`，一篇读失败不拖垮整张表。
 */
export async function readPlantedChapters(
  docs: DocRef[],
  rows: ForeshadowRow[],
  readDoc: (relPath: string) => Promise<{ content: string }>
): Promise<Map<string, string>> {
  const known = new Set(docs.map((doc) => doc.relPath));
  const targets = [...new Set(rows.map((row) => row.plantedIn))].filter(
    (relPath) => relPath !== "" && known.has(relPath)
  );
  const loaded = await Promise.allSettled(targets.map((relPath) => readDoc(relPath)));
  const texts = new Map<string, string>();
  targets.forEach((relPath, i) => {
    const one = loaded[i];
    // 只判正文：围栏里的 `title:` / `status:` 不是作者写的字（口径同页脚计数）。
    if (one?.status === "fulfilled") texts.set(relPath, splitFrontmatter(one.value.content).body);
  });
  return texts;
}

/** 一处关键词没能在它登记的埋设章里找到。 */
export interface KeywordMiss {
  /** 哪一条伏笔（伏笔文稿的相对路径）。 */
  relPath: string;
  title: string;
  /** 登记的那篇埋设章。 */
  chapter: string;
  /** 作者声明、但正文里找不到的那个词。 */
  keyword: string;
}

/**
 * 跨章回归的另一半（2026-10-22，C6）：**作者声明的关键词**在不在它登记的埋设章里。
 *
 * 为什么这件事能确定性判：关键词是作者自己写在 `keywords:` 上的，不是从标题或正文里猜的。
 * 判据只做子串命中——找到了不报；找不到只报「这一处对不上」，不判「伏笔丢了」：
 * 同一件事完全可能换了说法埋下去，那要读语义，不在这一层判。
 *
 * 两条跳过，都是为了不冤枉：
 * - `tone === "unknown"`：这篇伏笔原文都没读到，它声明的关键词自然无从谈起；
 * - `chapterTexts` 里没有那篇：埋设章没读到（被占用、刚被删），不拿缺席当没写。
 * 没写 `keywords` 的条目不参与，也不从标题里替作者补一个。
 */
export function keywordMisses(
  rows: ForeshadowRow[],
  chapterTexts: Map<string, string>
): KeywordMiss[] {
  const misses: KeywordMiss[] = [];
  for (const row of rows) {
    if (row.tone === "unknown" || row.plantedIn === "") continue;
    const text = chapterTexts.get(row.plantedIn);
    if (text === undefined) continue;
    for (const keyword of new Set(row.keywords)) {
      if ([...keyword].length < FORESHADOW_KEYWORD_MIN) continue;
      if (text.includes(keyword)) continue;
      misses.push({ relPath: row.relPath, title: row.title, chapter: row.plantedIn, keyword });
    }
  }
  return misses;
}

/** 一处断掉的落点：台账写着「埋在哪 / 收在哪」，但那一篇在书里已经找不到了。 */
export interface BrokenPointer {
  /** 哪一条伏笔（伏笔文稿的相对路径）。 */
  relPath: string;
  title: string;
  /** 断的是哪一格入口。 */
  field: "planted" | "paid";
  /** frontmatter 里写的那个路径原样带回——拼错的也照原样摆出来，作者才看得出来错在哪。 */
  target: string;
}

/**
 * 跨章回归的**确定性**那一半（2026-10-22）：逐条核对伏笔的落点章还在不在。
 *
 * 为什么这件事值得一个独立判据：伏笔的落点是「书内相对路径」，不是行号也不是引用对象。
 * 改稿最常造成的间接伤害不是把那句话改坏了，而是**章节改名/改目录之后，落点悄悄指空**——
 * 台账照旧显示「埋于 chapters/03-旧闸.md」，那一章却已经不叫这个名字了，
 * 于是这条线从「有据可查」变成「查不到但没人知道」。改稿是局部的，这件事只能靠回归来发现。
 *
 * 判据只做存在性，不猜语义：路径在 `docs` 里就通过，不在就报断——不比较标题、
 * 不做模糊匹配。模糊匹配在这里会把「改过名的那一章」误判成「还连着」，那比不查更坏。
 *
 * 读不到原文的那条（`tone === "unknown"`）跳过：它的落点字段压根没解析出来，
 * 报「断」等于替一篇没读到的文稿下结论。
 */
export function brokenPointers(docs: DocRef[], rows: ForeshadowRow[]): BrokenPointer[] {
  const known = new Set(docs.map((doc) => doc.relPath));
  const broken: BrokenPointer[] = [];
  for (const row of rows) {
    if (row.tone === "unknown") continue;
    if (row.plantedIn !== "" && !known.has(row.plantedIn)) {
      broken.push({
        relPath: row.relPath,
        title: row.title,
        field: "planted",
        target: row.plantedIn
      });
    }
    if (row.paidIn !== "" && !known.has(row.paidIn)) {
      broken.push({ relPath: row.relPath, title: row.title, field: "paid", target: row.paidIn });
    }
  }
  return broken;
}
