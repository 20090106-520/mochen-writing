/// <reference types="node" />
/**
 * hotkey-guide 与判定层的一致性契约：指南表只是给屏幕读的摘要，
 * 判定真身在 utils/hotkeys.ts（键→动作）与 utils/escape-policy.ts（Esc 裁决链）。
 * 每一行 guide 的 needle 必须能在判定层源码里逐字找到——键名抄错、判定层改名没同步，这里红。
 * （源码读取方式同 vue-source-reader：node:fs 直读，无需 jsdom。）
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ESCAPE_POLICY_SUMMARY, HOTKEY_GUIDE } from "./hotkey-guide";

const UTILS_DIR = fileURLToPath(new URL("./", import.meta.url));
const hotkeysSource = readFileSync(join(UTILS_DIR, "hotkeys.ts"), "utf8");
const escapeSource = readFileSync(join(UTILS_DIR, "escape-policy.ts"), "utf8");

describe("hotkey-guide 每一行都能在判定层源码里找到锚点", () => {
  it("五个分组每行 needle 逐字命中 hotkeys.ts", () => {
    for (const group of HOTKEY_GUIDE) {
      for (const row of group.rows) {
        if (row.keys === "Esc") {
          // Esc 行的锚点在 escape-policy（裁决链真身），其余行在 hotkeys.ts。
          expect(escapeSource).toContain(row.needle);
        } else {
          expect(
            hotkeysSource,
            `指南「${group.title} · ${row.keys}」的锚点在 utils/hotkeys.ts 里找不到了`
          ).toContain(row.needle);
        }
      }
    }
  });

  it("Esc 裁决链摘要与 escape-policy 的优先级注释逐字同源", () => {
    // escape-policy.ts 头注写了同一句优先级：摘要抄错顺序这里红。
    expect(escapeSource).toContain(
      "说明框保字 > 取消该条 > 收行内引用菜单 > 收设置浮层 > 打断 > 无动作"
    );
    expect(ESCAPE_POLICY_SUMMARY).toBe(
      "说明框保字 > 取消该条 > 收行内引用菜单 > 收设置浮层 > 打断 > 无动作"
    );
  });

  it("屏显键名不许写「Ctrl+」形态（kbd 用空格分隔，与左栏 <kbd>Ctrl O</kbd> 同款）", () => {
    for (const group of HOTKEY_GUIDE) {
      for (const row of group.rows) {
        expect(row.keys).not.toContain("Ctrl+");
      }
    }
  });
});
