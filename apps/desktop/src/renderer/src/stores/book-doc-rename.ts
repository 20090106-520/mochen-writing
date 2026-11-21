/**
 * 「改一篇文稿的名字」一族（2026-11-20 从 useBookStore 拆出：那份文件贴到 800 行预算）。
 *
 * 为什么这条边界成立：改标题（只动 frontmatter 的 title 行，relPath 不变）与改文件名
 * （真换 relPath，chapterOrder / recaps 由主进程一次迁移）是同一功能面的两条通路——
 * 都先守「有没有打开作品」，都只读写 store 的草稿四格（draft / savedFingerprint / dirty /
 * conflict）、draftsByPath 暂存与浏览标签镜像；改文件名还同批搬 agent store 那两张以
 * threadKey 为键的表（migrateAgentThreadKeys，2026-11-20 P0），落盘后都走同一次 refreshDocs 温和重扫；
 * 与书稿树、伏笔台账、改稿历史没有交集。宿主以第一参递进来，拿到的就是 store 那份
 * 响应式真身（写法同 book-change-history 的 ChangeHistoryHost）。
 */
import type { BookMeta, DocRef } from "@mochen/contracts";
import { renameTitleInContent } from "../utils/doc-title";
import { sortDocsByOrder } from "../utils/doc-order";
import type { DocState } from "../utils/draft-flush";
import { useAgentStore } from "./useAgentStore";

/** 宿主（useBookStore）里被这一族读写的那几格与方法：结构对得上就行，不另造第二份视图。 */
export interface DocRenameHost {
  /** T7-1「有没有打开作品」的单一真身（useBookStore 的 getter）。 */
  readonly hasBook: boolean;
  notice: string;
  meta: BookMeta | null;
  docs: DocRef[];
  docTabs: string[];
  activeDocTab: string | null;
  activeBrowse: string | null;
  browseTabs: DocRef[];
  draft: string;
  savedFingerprint: string;
  dirty: boolean;
  conflict: { currentFingerprint: string } | null;
  draftsByPath: Record<string, DocState>;
  refOf(relPath: string): DocRef | null;
  refreshDocs(): Promise<void>;
}

/**
 * 改标题真通路：读盘上最新版 → 纯函数只改 frontmatter 的 title 行 → 按指纹链写回 → 温和重扫。
 * relPath 与文件名一概不动（那要牵动 chapterOrder 与会话，是另一条通路的事）；
 * 树、面包屑、标签上的 title 都来自 docs，重扫后自然换新。
 * 右栏同步照 absorbAgentWrite 的镜像：干净草稿吸收盘上新内容，未保存的手改绝不覆盖，
 * 改成挂冲突由人决定重载还是覆盖——两边都不静默互踩。
 */
export async function renameDocTitle(
  host: DocRenameHost,
  relPath: string,
  nextTitle: string
): Promise<boolean> {
  if (!host.hasBook) {
    host.notice = "还没打开作品目录，改不了标题。";
    return false;
  }
  const trimmed = nextTitle.trim();
  const current = host.refOf(relPath);
  if (trimmed === "") {
    host.notice = "标题不能是空的。";
    return false;
  }
  if (current?.title === trimmed) {
    host.notice = "标题没变，不用改。";
    return false;
  }
  const loaded = await window.mochen.readDoc(relPath);
  const renamed = renameTitleInContent(loaded.content, trimmed);
  if (!renamed.ok) {
    host.notice =
      renamed.reason === "no-fence"
        ? "这篇开头没有 --- 元数据栏，标题改不了；直接在正文第一行改吧。"
        : "标题没改成：新名字不合法。";
    return false;
  }
  const result = await window.mochen.writeDoc(relPath, renamed.content, loaded.fingerprint);
  if (!result.ok) {
    host.notice =
      result.reason === "stale"
        ? "标题没改成：文件刚被别处改动，再试一次。"
        : `标题没改成：${result.message}`;
    return false;
  }
  const stashed = host.draftsByPath[relPath];
  if (stashed?.dirty) {
    host.draftsByPath[relPath] = {
      ...stashed,
      conflict: { currentFingerprint: result.fingerprint }
    };
    if (host.activeDocTab === relPath) host.conflict = { currentFingerprint: result.fingerprint };
  } else {
    // 干净的暂存副本已经过期（盘上换了 title 行）：作废，下次打开按盘上真身重读。
    delete host.draftsByPath[relPath];
    if (host.activeDocTab === relPath) {
      host.draft = renamed.content;
      host.savedFingerprint = result.fingerprint;
      host.dirty = false;
      host.conflict = null;
    }
  }
  await host.refreshDocs();
  // 浏览标签里存的是改名前的 DocRef 引用，从重扫后的 docs 里换新，右栏浏览态才不显示旧标题。
  host.browseTabs = host.browseTabs.map((doc) => host.refOf(doc.relPath) ?? doc);
  host.notice = `标题已改为「${trimmed}」`;
  return true;
}

/**
 * 改名时跟键搬家的 agent store 两张表（都以 threadKey 为键，threadKey 恒等于 relPath）。
 * store 以首参递进来（与 DocRenameHost 同一范式），不在这一层里直接抓 useAgentStore 的类型。
 */
interface AgentThreadKeyHost {
  skillPathsByThread: Record<string, string[]>;
  composerDrafts: Record<string, string>;
}

/**
 * 迁移 agent store 那两张以 threadKey（＝relPath）为键的表（2026-11-20 P0）。
 *
 * 病灶：AI 会话的线程键恒等于 relPath（threadKeyFor 的裁定），技能覆盖与输入框草稿两张表
 * 都以它为键；文件名一改键不跟着换，这一章的技能覆盖与打了一半的输入字就成了孤儿。
 * 语义与上面的 draftsByPath 同一口：旧键删掉、值搬到新键；技能覆盖判「键在不在」——
 * 键不在＝继承书级默认，不能搬出一只空数组来冒充「本会话明确一个都不挂」。
 */
export function migrateAgentThreadKeys(
  agent: AgentThreadKeyHost,
  oldKey: string,
  newKey: string
): void {
  const override = agent.skillPathsByThread[oldKey];
  if (override !== undefined) {
    agent.skillPathsByThread[newKey] = override;
    delete agent.skillPathsByThread[oldKey];
  }
  const composer = agent.composerDrafts[oldKey];
  if (composer !== undefined) {
    agent.composerDrafts[newKey] = composer;
    delete agent.composerDrafts[oldKey];
  }
}

/**
 * 改文件名（2026-11-20）：文件真的改名，`chapterOrder` / `recaps` 由主进程一次迁移。
 *
 * 与「改标题」是两件事：那条只动 frontmatter，relPath 不变；这一条会换标签、换草稿键、
 * 换浏览引用——任何一处漏改，界面就指向一个盘上已经不存在的老路径。
 */
export async function renameDocFile(
  host: DocRenameHost,
  relPath: string,
  nextTitle: string
): Promise<boolean> {
  if (!host.hasBook) {
    host.notice = "还没打开作品目录，改不了文件名。";
    return false;
  }
  const trimmed = nextTitle.trim();
  if (trimmed === "") {
    host.notice = "名字不能是空的。";
    return false;
  }
  const result = await window.mochen.renameDoc(relPath, trimmed);
  if (!result.ok) {
    host.notice = result.message;
    return false;
  }
  const nextRelPath = result.relPath;
  // 迁移判据只在主进程那一份：这里直接换整份 meta，不在渲染层再抄一遍 chapterOrder/recaps 的搬家。
  host.meta = result.meta;
  const freshDoc = result.doc;
  if (freshDoc !== null) {
    host.docs = sortDocsByOrder(
      host.docs.map((doc) => (doc.relPath === relPath ? freshDoc : doc)),
      result.meta.chapterOrder ?? []
    );
  } else {
    // 主进程重扫也没找回来（盘被外部搅动）：退回整本温和重扫，别在界面上挂一根假稿件。
    await host.refreshDocs();
  }
  host.docTabs = host.docTabs.map((tab) => (tab === relPath ? nextRelPath : tab));
  if (host.activeDocTab === relPath) host.activeDocTab = nextRelPath;
  // 未保存的草稿以 relPath 为键暂存：键不跟着换，下次切回这一篇就会读成「没有草稿」。
  const stashed = host.draftsByPath[relPath];
  if (stashed !== undefined) {
    delete host.draftsByPath[relPath];
    host.draftsByPath[nextRelPath] = stashed;
  }
  // 2026-11-20 P0：agent 那两张以 threadKey（＝relPath）为键的表跟 draftsByPath 同批搬家，
  // 迁移判据只有 migrateAgentThreadKeys 那一份；不然技能覆盖与输入框草稿就断在旧键上。
  migrateAgentThreadKeys(useAgentStore(), relPath, nextRelPath);
  host.browseTabs = host.browseTabs.map((doc) =>
    doc.relPath === relPath ? (freshDoc ?? doc) : doc
  );
  if (host.activeBrowse === relPath) host.activeBrowse = nextRelPath;
  // 会话历史迁移失败不让改名回滚（主进程口径）：名字已经改了，只能把警告接着说清楚。
  host.notice =
    result.sessionWarning === null
      ? `文件名已改为 ${nextRelPath}`
      : `文件名已改为 ${nextRelPath}；${result.sessionWarning}`;
  return true;
}
