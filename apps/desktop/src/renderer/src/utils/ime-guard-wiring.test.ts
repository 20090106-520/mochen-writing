/**
 * 批次 5-㊶ · IME 组合态闸门的族守卫。
 *
 * 【为什么这一族要有专属守卫，而不是就地改那五条旧断言就够了】
 * 真机 P536O 量到：查找框里拼音「yu」按回车选词，页面收到 isComposing=true 的 keydown，
 * 而冒泡阶段 defaultPrevented 从 false 翻成 true ⇒ 组件把输入法的选词键当自己的快捷键，
 * 候选被吃掉、拼音留在框里。同一测量在正文输入框上是 false——全局闸门是好的。
 * 也就是说：**这道闸在正文输入框上存在，在这十个弹层/输入框上根本没写**。
 *
 * 这一族有三个「差一点就复发」的地方，缺一个就还能再犯，所以三条都钉：
 *  ① 组合态的判据在全仓**只有一份**（imeOwnsKey）。散写成 `event.isComposing === true`
 *     就是在别处又埋一份，将来改判据（补 229 兜底、补别的输入法差异）必漏。
 *  ② 每个吃键的 handler 必须**在 preventDefault 之前**先问闸门。顺序反了等于没修——
 *     「先 preventDefault 再判组合态」看起来一样，实际那一键已经被吞了。
 *  ③ 输入框**不许再用模板修饰符 `.prevent`**：修饰符是无条件执行的，handler 里
 *     再怎么提前 return 也拦不住它（这正是本缺陷在四个输入框上的成因）。
 *
 * 【枚举按 role/契约，不按名单】下面「十个弹层」用的是名单，因为弹层这个角色在本仓
 * 没有单一 DOM 标记可枚举（上一批 5-㊵ 的教训：按根类名认族会漏掉整族）。
 * 但「判据唯一」与「模板修饰符不许出现在这几个输入框上」两条是**按目录枚举**的：
 * 名单只认名单里有的，目录不会——新增一个带 `.prevent` 回车的输入框必须立刻红。
 */
import { describe, expect, it } from "vitest";
import {
  listComponentFiles,
  scriptSource,
  templateSource,
  typeScriptSource
} from "../utils/vue-source-reader";

/** 十个吃 Esc 的弹层：判定必须走 popoverOwnsKey + imeOwnsKey，模板与函数体都不许写裸比较。 */
const POPOVERS = [
  "components/ComposerContextMenu.vue",
  "components/ContextMeterPanel.vue",
  "components/ModelSelect.vue",
  "components/PermissionMenu.vue",
  "components/ChangeHistoryPanel.vue",
  "components/ForeshadowPanel.vue",
  "components/ReviewScorePanel.vue",
  "components/SlopPanel.vue",
  "components/TimelineCheckPanel.vue",
  "components/VolumeOutlinePanel.vue"
];

/** 四个用户真会用中文打字的输入框：Enter/Esc 的裁决必须在同一个函数里与闸门待着。 */
const TEXT_FIELDS = [
  { file: "components/FindReplacePanel.vue", entry: ["onQueryKeydown", "onReplaceKeydown"] },
  { file: "components/SearchPanel.vue", entry: ["onKeydown"] },
  { file: "components/DocumentPane.vue", entry: ["onTitleKeydown"] },
  // 左栏那两个输入框的裁决在**同一个工厂**里（textRowKeydown，2026-10-10 起住
  // utils/text-row-keydown：LeftSidebar 只 import，工厂数 800 行预算搬出来的）——
  // 只有 confirm/cancel 不同，闸门与 preventDefault 的顺序完全一样 ——
  // 写两份就是同一判定的第二份实现。
  {
    file: "components/LeftSidebar.vue",
    entry: ["onRenameKeydown", "onAddKeydown"],
    shared:
      /export function textRowKeydown[\s\S]*?\n\}/.exec(
        typeScriptSource("utils/text-row-keydown.ts")
      )?.[0] ?? ""
  }
];

describe("IME 组合态闸门 · 判据唯一一份（5-㊶）", () => {
  const utils = typeScriptSource("utils/slash-commands.ts");

  it("真身在 utils/slash-commands.ts，判据含 isComposing 与老式 229", () => {
    expect(utils).toContain("export function imeOwnsKey(event: KeyboardEvent): boolean {");
    const body = /export function imeOwnsKey[\s\S]*?\n\}/.exec(utils)?.[0] ?? "";
    expect(body, "imeOwnsKey 读不到").not.toBe("");
    expect(body).toContain("event.isComposing === true");
    // 个别输入法/部分 Electron 组合只给 keyCode 229 而不把 isComposing 置真。
    expect(body).toContain("event.keyCode === 229");
  });

  it("全仓组件层不许散写组合态判据：只有 imeOwnsKey 这一处", () => {
    const offenders = listComponentFiles().filter((file) => {
      const s = scriptSource(file);
      return /event\.isComposing/.test(s) || /keyCode\s*===\s*229/.test(s);
    });
    expect(offenders, "这些文件自己判组合态了，判据必须调 imeOwnsKey").toEqual([]);
  });

  it("十个弹层全部把组合态判据交给真身（不接的弹层就一行都别碰）", () => {
    for (const file of POPOVERS) {
      const s = scriptSource(file);
      expect(s, `${file} 没调 imeOwnsKey`).toContain(
        "popoverOwnsKey(event.key, mods, imeOwnsKey(event))"
      );
      expect(s, `${file} 还留着散写的 isComposing`).not.toContain("event.isComposing === true");
    }
  });
});

describe("IME 组合态闸门 · 顺序：闸门必须排在 preventDefault 之前", () => {
  it("六份「真身接上」的面板：第一支自己 close()，Esc 不再靠下面那份手抄比较兜", () => {
    // 这六份原来把 close 这个函数传进 isComposing 形参 ⇒ 真身恒返回 false ⇒ 第一支是死代码，
    // Esc 实际由紧跟着那份手抄的 `event.key === "Escape"` 兜住。判定因此被架空，
    // 而且「同一判定只留一份实现」被破了。现在真身接上、手抄那份删掉。
    const SIX = POPOVERS.slice(4);
    for (const file of SIX) {
      const s = scriptSource(file);
      const handler = /function keydown[\s\S]*?\n\}/.exec(s)?.[0] ?? "";
      expect(handler, `${file} 的 keydown 读不到`).not.toBe("");
      expect(handler, `${file} 的 Esc 分支没有真的 close`).toContain("close();");
      expect(handler, `${file} 把手抄的裸 Escape 比较留下了`).not.toContain(
        'event.key === "Escape"'
      );
    }
  });

  it("四个输入框的 handler：闸门在第一行判断，且排在 preventDefault 之前", () => {
    for (const { file, entry, shared } of TEXT_FIELDS) {
      const s = scriptSource(file);
      for (const name of entry) {
        // 同一份判定共用一个工厂时，形状钉在工厂本体上，并额外钉住「两个入口都由它生成」。
        const handler =
          shared || new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`).exec(s)?.[0] || "";
        expect(handler, `${file} 的 ${name} 读不到`).not.toBe("");
        // 判形状不判形参名：各文件的形参叫 event 还是叫 e 都不影响这条判定。
        const guard = handler.search(/\bimeOwnsKey\(/);
        const pd = handler.search(/preventDefault\(\)/);
        expect(guard, `${file} 的 ${name} 没问闸门`).toBeGreaterThan(-1);
        expect(pd, `${file} 的 ${name} 没有 preventDefault`).toBeGreaterThan(-1);
        // 顺序就是修复本身：反了的话那一键已经被吞掉，判不判组合态都来不及。
        expect(guard, `${file} 的 ${name}：闸门排在 preventDefault 之后 = 等于没修`).toBeLessThan(
          pd
        );
      }
      if (shared !== undefined) {
        expect(shared, `${file} 的共用工厂 textRowKeydown 读不到`).not.toBe("");
        for (const name of entry) {
          expect(s, `${file} 的 ${name} 不许绕过共用工厂`).toContain(
            `const ${name} = textRowKeydown(`
          );
        }
      }
    }
  });
});

describe("IME 组合态闸门 · 输入框不许再用模板修饰符 .prevent（按目录枚举）", () => {
  // 名单型判据的失效方向永远是「不认识的一律放过」，所以这里按**目录**枚举整个组件层：
  // 新增一个带 `.enter.prevent` 的输入框必须立刻红，而不是等有人记得把它加进名单。
  // 排除项要说清为什么：左栏「…」那一枚 Esc 挂在**按钮**上（按钮永远不会处于组合态）。
  const ALLOWED_BUTTON_ONLY = [
    { file: "components/LeftSidebar.vue", needle: '@keydown.esc.prevent="closeActionMenu"' }
  ];

  it("组件层里除了「按钮上的 Esc」之外，不许再出现 @keydown.*.prevent 修饰符", () => {
    const offenders: string[] = [];
    for (const file of listComponentFiles()) {
      const t = templateSource(file);
      for (const line of t.split("\n")) {
        if (!/@keydown[.:][\w.]*\.prevent/.test(line)) continue;
        if (ALLOWED_BUTTON_ONLY.some((a) => a.file === file && line.includes(a.needle))) continue;
        offenders.push(`${file} :: ${line.trim()}`);
      }
    }
    expect(
      offenders,
      "模板修饰符 .prevent 是无条件执行的，组合态那一键拦不住；请改成单一入口 @keydown 并把 preventDefault 写进 handler"
    ).toEqual([]);
  });

  it("四个输入框的模板上都换成了单一入口", () => {
    // 用容忍 $event 的正则而不是整串字面量：有的写 `@keydown="onX"`，有的写 `@keydown="onX($event)"`，
    // 拼写差异不是判定，钉死它只会让守卫在「格式变了」时假红。
    const expectEntry = (file: string, name: string) => {
      const t = templateSource(file);
      expect(t, `${file} 的 ${name} 没接上单一入口`).toMatch(
        // 字面量括号要一起匹配：模板上写的是 onX($event)，括号是文本的一部分。
        new RegExp(`@keydown="${name}(\\(\\$event\\))?"`)
      );
    };
    expectEntry("components/FindReplacePanel.vue", "onQueryKeydown");
    expectEntry("components/FindReplacePanel.vue", "onReplaceKeydown");
    expectEntry("components/SearchPanel.vue", "onKeydown");
    expectEntry("components/DocumentPane.vue", "onTitleKeydown");
    expectEntry("components/LeftSidebar.vue", "onRenameKeydown");
    expectEntry("components/LeftSidebar.vue", "onAddKeydown");
  });
});
