/**
 * 图标体系契约测试（2026-10-05，用户反馈「有些图标它有时候不兼容」）。
 *
 * 本仓 `.vue` 不进类型程序（裸 tsc），于是 AppIcon 的三类「有时候才炸」只能钉在源码上：
 * ① IconName 联合类型的每一枚都必须在 AppIcon.vue 里有字形分支——漏一枚就是一枚
 *   「渲染出来是空的」图标（svg 空壳，屏上一个幽灵占位）；
 * ② 模板里写死的 `name="xxx"` 必须是合法成员——拼写错了 tsc 看不见（.vue 不查），只有这里能拦；
 * ③ `:name` 动态绑定不许传 `?.` 可空值——可空值进了必需 prop 就是运行时空壳
 *   （ComposerReferenceMenu 的 `menu.copy?.icon` 是实锤先例）。
 * 顺带钉质感统一的两条：AppIcon 小尺寸描边补偿、morphicons 两处对齐 1.8 描边语言。
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

/** 递归收集 components/ 下所有 .vue（含 canvasui/ 子目录）。 */
function vueFiles(dir: string): string[] {
  const base = fileURLToPath(new URL(dir, import.meta.url));
  return readdirSync(base, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? vueFiles(`${dir}${entry.name}/`)
      : entry.name.endsWith(".vue")
        ? [`${dir}${entry.name}`]
        : []
  );
}

const unionSource = read("../types/icons.ts");
const unionMembers = [...unionSource.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
const iconComponent = read("../components/AppIcon.vue");
const branchNames = [...iconComponent.matchAll(/name === ["']([a-z-]+)["']/g)].map((m) => m[1]);

const allVue = vueFiles("../components/");

describe("图标体系 · IconName 与 AppIcon 字形分支一一对应", () => {
  it("联合类型里每一枚都有字形分支，分支表里也没有类型外的野名字（双向都封死）", () => {
    expect(unionMembers.length).toBeGreaterThan(40); // 表在，别让正则空转成恒真
    expect([...new Set(branchNames)].sort()).toEqual([...new Set(unionMembers)].sort());
  });

  it('模板写死的 name="xxx" 全是合法成员（.vue 不过 tsc，拼错只能在这里拦）', () => {
    for (const file of allVue) {
      const source = read(file);
      for (const tag of source.matchAll(/<AppIcon\b[\s\S]*?>/g)) {
        const name = /\bname="([a-z-]+)"/.exec(tag[0]);
        if (name === null) continue; // 动态绑定归下一条用例管
        expect([file, name[1], unionMembers.includes(name[1])]).toEqual([file, name[1], true]);
      }
    }
  });

  it(":name 动态绑定不许传可空链（?. 进必需 prop = 运行时空壳图标）", () => {
    for (const file of allVue) {
      const source = read(file);
      const bad = [...source.matchAll(/<AppIcon\b[\s\S]*?>/g)]
        .map((tag) => /:name="([^"]*)"/.exec(tag[0])?.[1] ?? "")
        .filter((binding) => binding.includes("?."));
      expect([file, bad]).toEqual([file, []]);
    }
  });
});

describe("图标体系 · 描边质感统一（2026-10-05）", () => {
  it("AppIcon 小尺寸描边补偿：<16px 提到 2，其余维持 1.8（1.5 倍屏上小图标不发虚）", () => {
    expect(iconComponent).toContain("const box = computed(() => snapIconSize(props.size))");
    expect(iconComponent).toContain("const strokeWidth = computed");
    // 描边按吸附后的尺寸判：写 15 被吸到 16 时，线也该跟着按 16 算。
    expect(iconComponent).toContain("box.value >= 16 ? 1.8 : 2");
    expect(iconComponent).toContain(':stroke-width="strokeWidth"');
    // 写死的那份 1.8 不许再出现在 svg 开标签上（真身只有 computed 一份）。
    expect(iconComponent).not.toMatch(/<svg[^>]*stroke-width="1\.8"/);
  });

  it("morphicons 两处（树行菜单 / 外观显示模式）对齐全仓 1.8 描边语言（默认 2 会粗一档）", () => {
    const sidebar = read("../components/LeftSidebar.vue");
    const appearance = read("../components/AppearancePanel.vue");
    expect(sidebar).toMatch(/<MorphIcon\b[\s\S]*?:stroke-width="1\.8"/);
    expect(appearance).toMatch(/<MorphIcon\b[\s\S]*?:stroke-width="1\.8"/);
  });
});
