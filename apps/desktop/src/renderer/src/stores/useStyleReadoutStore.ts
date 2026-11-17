/**
 * 全书腔调偏离标（2026-11-16）。
 *
 * 左栏章节列表要在**不打开体检**的情况下看见「哪几章不像同一个人写的」。
 * 标记本身不新算任何东西：`styleProfileOf` 量常态、`styleDriftOf` 逐章比，
 * 拼装与文案在 `utils/style-readout`，这里只负责读盘与缓存。
 *
 * 【为什么在这里缓存】每行挂一枚标，若每枚标各扫一遍全书，打开一本百章书会读一百遍。
 * 去重键 = 书根 + 各章 relPath：同一本书只扫一次，重复调用返回同一趟 Promise；
 * 换书或增删章时旧结果直接丢弃（回来后先对键）。
 *
 * 【失败静默】标注是锦上添花：读不到盘就整排不标，不弹错、不拦写作。
 */
import { defineStore } from "pinia";
import { ref } from "vue";
import { styleProfileOf, type BookKind } from "@mochen/contracts";
import { loadAllDocContents } from "../utils/doc-checkup";
import { chapterDriftMarksOf, type ChapterDriftMark } from "../utils/style-readout";

/** 只用到三格，不从 contracts 拖整份 DocRef（体检也只需要这三格）。 */
type DocMeta = { relPath: string; kind: BookKind; title: string };

export const useStyleReadoutStore = defineStore("style-readout", () => {
  /** relPath → 偏离档与悬停说明；没有键 = 这一章与本书常态一致（或太短没法比）。 */
  const marks = ref<Record<string, ChapterDriftMark>>({});
  let scannedKey = "";
  let inFlight: Promise<void> | null = null;

  /** 读到新书目时叫一次；同一本书重复叫不会重复读盘。 */
  function ensure(docs: readonly DocMeta[], rootPath: string | null): Promise<void> {
    const chapters = docs.filter((doc) => doc.kind === "chapter");
    // 一章谈不上「偏离本书」；太少时连常态都立不住，直接不扫。
    if (chapters.length < 2) {
      marks.value = {};
      scannedKey = `${rootPath ?? ""}\n`;
      return Promise.resolve();
    }
    const key = `${rootPath ?? ""}\n${chapters
      .map((doc) => `${doc.relPath}|${doc.title}`)
      .join("\n")}`;
    if (key === scannedKey) return inFlight ?? Promise.resolve();
    scannedKey = key;
    inFlight = scan(docs, key);
    return inFlight;
  }

  async function scan(docs: readonly DocMeta[], key: string): Promise<void> {
    try {
      const loaded = await loadAllDocContents(docs);
      // 换书/增删章之后才回来的旧结果直接扔：它描述的是上一本书的常态。
      if (key !== scannedKey) return;
      const chapters = loaded
        .filter((doc) => doc.kind === "chapter")
        .map((doc) => ({ relPath: doc.relPath, title: doc.title, content: doc.content }));
      // 样本口径与体检对话框同一份（全部文稿），不另立第二套「本书常态」。
      marks.value = chapterDriftMarksOf(styleProfileOf(loaded.map((doc) => doc.content)), chapters);
    } catch {
      if (key === scannedKey) marks.value = {};
    }
  }

  return { marks, ensure };
});
