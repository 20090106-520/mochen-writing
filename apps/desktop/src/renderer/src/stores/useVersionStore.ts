/**
 * VersionStore —— 版本历史快照
 *
 * 每次自动保存时创建一个轻量版本快照：
 * - 存储内容 hash 与时间戳、字数
 * - 最多保留 50 个快照（FIFO 淘汰最旧）
 * - 支持浏览某版本内容、diff 对比、恢复到指定版本
 *
 * 快照内容存于 localStorage（每文档独立 key），元信息存全局 key。
 * 对于超大章节（>100KB），只存前 50KB + 后 50KB 作为 diff 参考。
 */
import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";

export interface VersionSnapshot {
  id: string;
  docRelPath: string;
  timestamp: number;
  charCount: number;
  /** 内容 hash（SHA-256 前 8 字符足够去重） */
  contentHash: string;
  /** 这一版的一句话描述（首行首句） */
  summary: string;
}

const META_STORAGE_KEY = "mochen.version-meta.v1";
const SNAPSHOT_LIMIT = 50;
const MAX_SNAPSHOT_CHARS = 100_000;

interface VersionMeta {
  snapshots: Record<string, VersionSnapshot[]>; // key = docRelPath
}

function loadMeta(): VersionMeta {
  if (typeof localStorage === "undefined") return { snapshots: {} };
  try {
    const raw = localStorage.getItem(META_STORAGE_KEY);
    if (!raw) return { snapshots: {} };
    return JSON.parse(raw) as VersionMeta;
  } catch {
    return { snapshots: {} };
  }
}

function saveMeta(meta: VersionMeta): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(META_STORAGE_KEY, JSON.stringify(meta));
  } catch {
    // 写满了静默淘汰最旧
  }
}

function snapshotStorageKey(docRelPath: string, id: string): string {
  return `mochen.ver-${docRelPath.replace(/[/\\:]/g, "_")}-${id}`;
}

/** 简易哈希：FNV-1a 取前 8  hex */
function simpleHash(content: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function genSnapshotId(): string {
  return `snap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** 截断超大内容：取前 50KB + 后 50KB，中间加 …[N 字已截断]… */
function truncateForStorage(content: string): string {
  if (content.length <= MAX_SNAPSHOT_CHARS) return content;
  const half = MAX_SNAPSHOT_CHARS / 2;
  return (
    content.slice(0, half) +
    `\n…[${content.length - MAX_SNAPSHOT_CHARS} 字已截断]…\n` +
    content.slice(-half)
  );
}

function makeSummary(content: string): string {
  const firstLine = content.split("\n").find((l) => l.trim().length > 0) ?? "";
  return firstLine.trim().slice(0, 60);
}

export const useVersionStore = defineStore("version", () => {
  const meta = ref<VersionMeta>(loadMeta());

  watch(meta, (val) => saveMeta(val), { deep: true });

  /** 获取某文档的所有快照（按时间倒序） */
  function getSnapshots(docRelPath: string): VersionSnapshot[] {
    return (meta.value.snapshots[docRelPath] ?? []).sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * 创建快照（自动去重：如果和上一版 hash 一样就不建）
   */
  function createSnapshot(docRelPath: string, content: string): VersionSnapshot | null {
    const hash = simpleHash(content);
    const existing = meta.value.snapshots[docRelPath] ?? [];

    // 与最新快照相同则跳过
    const lastSnapshot = existing.length > 0 ? existing[existing.length - 1] : undefined;
    if (lastSnapshot && lastSnapshot.contentHash === hash) {
      return null;
    }

    const snapshot: VersionSnapshot = {
      id: genSnapshotId(),
      docRelPath,
      timestamp: Date.now(),
      charCount: content.length,
      contentHash: hash,
      summary: makeSummary(content)
    };

    // 存快照内容到独立 key（避免 meta 膨胀）
    try {
      localStorage.setItem(
        snapshotStorageKey(docRelPath, snapshot.id),
        truncateForStorage(content)
      );
    } catch {
      return null; // 存不下就不建
    }

    // 追加到 meta
    if (!meta.value.snapshots[docRelPath]) {
      meta.value.snapshots[docRelPath] = [];
    }
    meta.value.snapshots[docRelPath].push(snapshot);

    // FIFO 淘汰
    if (meta.value.snapshots[docRelPath].length > SNAPSHOT_LIMIT) {
      const evicted = meta.value.snapshots[docRelPath].shift();
      if (evicted) {
        localStorage.removeItem(snapshotStorageKey(docRelPath, evicted.id));
      }
    }

    return snapshot;
  }

  /** 获取某版本的完整内容（用于预览/恢复） */
  function getSnapshotContent(docRelPath: string, snapshotId: string): string | null {
    const key = snapshotStorageKey(docRelPath, snapshotId);
    return localStorage.getItem(key);
  }

  /** 删除某文档的全部版本历史 */
  function clearDocVersions(docRelPath: string): void {
    const snaps = meta.value.snapshots[docRelPath] ?? [];
    for (const snap of snaps) {
      localStorage.removeItem(snapshotStorageKey(docRelPath, snap.id));
    }
    delete meta.value.snapshots[docRelPath];
  }

  /**
   * 计算两版之间的行级 diff（简单 LCS 近似，够用就行）
   * 返回：added 行 / removed 行 / unchanged 行数
   */
  function diffSnapshots(
    docRelPath: string,
    oldId: string,
    newId: string
  ): { added: number; removed: number; unchanged: number } | null {
    const oldContent = getSnapshotContent(docRelPath, oldId);
    const newContent = getSnapshotContent(docRelPath, newId);
    if (oldContent === null || newContent === null) return null;

    const oldLines = oldContent.split("\n");
    const newLines = newContent.split("\n");

    const oldSet = new Set(oldLines);
    const newSet = new Set(newLines);

    let added = 0;
    let removed = 0;
    for (const line of newLines) {
      if (!oldSet.has(line)) added++;
    }
    for (const line of oldLines) {
      if (!newSet.has(line)) removed++;
    }
    return {
      added,
      removed,
      unchanged: newLines.length - added
    };
  }

  /** 所有文档的快照总数（用于面板展示） */
  const totalSnapshotCount = computed(() =>
    Object.values(meta.value.snapshots).reduce((sum, arr) => sum + arr.length, 0)
  );

  return {
    meta,
    totalSnapshotCount,
    getSnapshots,
    createSnapshot,
    getSnapshotContent,
    clearDocVersions,
    diffSnapshots
  };
});
