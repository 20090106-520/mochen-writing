import { PERMISSION_LABELS, type BookKind, type BookMeta, type DocRef } from "@mochen/contracts";
import { BOOK_KIND_LABELS, BOOK_KIND_ORDER } from "./book-kinds";

export interface DossierGroup {
  kind: BookKind;
  label: string;
  docs: DocRef[];
}

/**
 * 按固定 kind 顺序分组，空组直接不出现（W6 靶：删掉 length===0 过滤就会冒出一堆空标题）。
 * 不改分类：materials/ 下按 scanBook 既有归并仍算 material（附录 F-B「不改分类」）。
 */
export function groupDocsForDossier(docs: DocRef[]): DossierGroup[] {
  const groups: DossierGroup[] = [];
  for (const kind of BOOK_KIND_ORDER) {
    const inKind = docs.filter((doc) => doc.kind === kind);
    if (inKind.length === 0) continue;
    groups.push({ kind, label: BOOK_KIND_LABELS[kind], docs: inKind });
  }
  return groups;
}

export interface DossierSummary {
  title: string;
  stageName: string;
  permissionLabel: string;
  chapterCount: number;
}

/** 没开书 ⇒ null，不捏造书名/阶段/档位（缺陷②「无书时档位捏造」的同一条纪律）。 */
export function dossierSummary(meta: BookMeta | null, docs: DocRef[]): DossierSummary | null {
  if (!meta) return null;
  const stage = meta.stages.find((item) => item.id === meta.activeStage);
  return {
    title: meta.title,
    stageName: stage?.name ?? "无",
    permissionLabel: PERMISSION_LABELS[meta.permissionMode],
    chapterCount: docs.filter((doc) => doc.kind === "chapter").length
  };
}
