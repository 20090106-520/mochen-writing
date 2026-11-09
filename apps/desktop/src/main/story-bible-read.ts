import { normalizeBibleEntries, type BibleEntry } from "@mochen/contracts";
import { readBookData } from "@mochen/fs-store";

/**
 * 读出这本书的故事圣经（W-01：让设定真正进入 AI 上下文）。
 *
 * **三种"读不到"一律降级成空表，绝不让这一轮生成失败**：
 * - 没有文件（ENOENT）：作者还没建过设定，正常；
 * - 文件读不出来（EBUSY / EACCES / 是目录）：读不到就当没有，这一轮少装几条设定，
 *   比整个对话起不来强；
 * - JSON 损坏或形状不认（`normalizeBibleEntries` 返回 null）：同样当没有。
 *
 * 为什么"损坏就当空表"可以接受：面板那边遇到同一份坏文件会判读不懂并停止写盘
 * （`useBookFileData` 已经这么做），所以坏文件不会被二次覆盖；这里只是不去猜它的内容。
 *
 * 判据只有一份：形状校验住在 contracts，本函数不重写任何字段判断（铁律 6）。
 */
export async function readStoryBibleEntries(root: string): Promise<BibleEntry[]> {
  try {
    const stored = await readBookData(root, "story-bible");
    if (!stored.ok || stored.json === null) return [];
    return normalizeBibleEntries(JSON.parse(stored.json)) ?? [];
  } catch {
    // JSON.parse 抛错（半截文件、手工改坏）与磁盘抖动都走这一支
    return [];
  }
}
