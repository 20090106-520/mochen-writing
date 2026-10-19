import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { templateSource, typeScriptSource } from "../utils/vue-source-reader";
import { PROVIDER_PRESETS, type ProviderPreset } from "@mochen/contracts";

/**
 * 模型 chip 的地址从哪来（2026-10-06 真机逮到的假提示）。
 *
 * **原来的错**：`CenterColumn.vue` 传的是 `provider.view?.baseURL ?? ''`，
 * 而 `ProviderView` 只有 `connections` 与 `profiles`——**没有 `baseURL` 这个字段**。
 * 于是它恒为 `undefined`、恒变成空串，输入卡那枚模型 chip 于是**永远**显示
 * 「配置里还没有 API 地址，provider:list-models 此刻拉不到名单」——
 * 哪怕配置完全正确、模型名单能正常拉出来也一样。
 *
 * 病根是**取一个不存在的字段**：`?? ''` 把 `undefined` 悄悄吞成「没配」，
 * 界面上于是摆出一句自信的假话。这类错静态类型抓不到（`.vue` 不进类型程序），
 * 只能靠一条断言把「ProviderView 的字段清单」钉住。
 */
const PROVIDER_VIEW_FIELDS = ["connections", "profiles"] as const;

const centerColumn = templateSource("components/CenterColumn.vue");
const storeSrc = typeScriptSource("stores/useProviderStore.ts");

describe("模型 chip 的地址：走启用中那条模型自己那条连接", () => {
  it("模板传的是 activeBaseURL，不再是那个不存在的 view?.baseURL", () => {
    expect(centerColumn).toContain(':base-url="provider.activeBaseURL"');
    // 反向钉：`view?.baseURL` 这个取法永远读不出东西，不许回来
    expect(centerColumn).not.toContain("view?.baseURL");
  });

  it("activeBaseURL 真的从「启用中的档案 → 它那条连接」推出来，不是照抄某一条连接", () => {
    expect(storeSrc).toContain("const activeBaseURL = computed(");
    expect(storeSrc).toContain("profile.enabled");
    expect(storeSrc).toContain("connectionOf(enabled.connectionId)?.baseURL");
  });

  it("ProviderView 的字段清单只有 connections 与 profiles——这一条是本文件的全部由来", () => {
    // 真身在 contracts；这里照抄一份清单不是为了复制，是为了让「多了/少了字段」这件事
    // 在改 contracts 时被看见。真要用还得从 contracts 拿，这里只做形状对照。
    const contracts = readFileSync(
      // 从 components/ 退到仓根要 6 级：components → src → renderer → src → desktop → apps → 仓根
      fileURLToPath(
        new URL("../../../../../../packages/contracts/src/provider.ts", import.meta.url)
      ),
      "utf8"
    );
    const block = /export interface ProviderView \{([\s\S]*?)\}/.exec(contracts)?.[1] ?? "";
    expect(block).not.toBe("");
    const fields = [...block.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
    expect(fields).toEqual([...PROVIDER_VIEW_FIELDS]);
    // 这就是当初骗过人的那一条：它不在清单里
    expect(fields).not.toContain("baseURL");
  });

  it("一条都没启用时是空串（不是崩、也不是随便挑一条连接）", () => {
    // 哨兵值必须与 `enabledProfile` 的 `?? null` 对上：这里钉的是**成对**改，
    // 单边改（把 computed 换成 undefined 而这里的判断没跟）就会红——这正是想要的信号，
    // 因为 `if (enabled === null)` 遇 `undefined` 会漏过去，然后拿 undefined 去查连接。
    expect(storeSrc).toContain('if (enabled === null) return "";');
  });

  it("store 真的把 activeBaseURL 导出去了（定义了没导出 = 模板读不到，等于没改）", () => {
    const returned = /return \{([\s\S]*?)\};/.exec(storeSrc)?.[1] ?? "";
    expect(returned).toContain("activeBaseURL");
  });
});

/**
 * 模型 chip 的文案不许说谎（`utils/composer-chips.ts` 的 `modelChip`）。
 * 上一条钉的是「地址取对没取对」，这一条钉的是「取到之后说的那话对不对」。
 */
describe("modelChip 的提示不许自称配置好了", () => {
  it("地址读得到时，提示不能说「配置里还没有 API 地址」", async () => {
    const { composerChips } = await import("../utils/composer-chips");
    const withURL = composerChips({
      hasBook: true,
      mode: null,
      workMode: "act",
      saving: false,
      thinkingLevel: "off",
      thinkingWire: "standard" as const,
      webSearchEnabled: false,
      sampleCount: 1,
      modelLabel: "agnes-2.5-pro",
      baseURL: "https://apihub.agnes-ai.com/v1"
    });
    const model = withURL.find((chip) => chip.id === "model");
    expect(model?.title).not.toContain("还没有 API 地址");
    // 有地址就说得出真地址，指向的正是 provider:list-models 那一发
    expect(model?.title).toContain("https://apihub.agnes-ai.com/v1/models");
  });

  it("地址真的读不到时，那句「还没有 API 地址」必须出现（不许被上条改过头）", async () => {
    const { composerChips } = await import("../utils/composer-chips");
    const noURL = composerChips({
      hasBook: true,
      mode: null,
      workMode: "act",
      saving: false,
      thinkingLevel: "off",
      thinkingWire: "standard" as const,
      webSearchEnabled: false,
      sampleCount: 1,
      modelLabel: "",
      baseURL: ""
    });
    expect(noURL.find((chip) => chip.id === "model")?.title).toContain("还没有 API 地址");
  });
});

/**
 * 供应商预设表本身的形状（模型名那部分要照着它填，接入口径要一致）。
 */
describe("PROVIDER_PRESETS", () => {
  it("每一条都带齐界面要用到的四件：id / label / baseURL / 常用模型名", () => {
    for (const preset of PROVIDER_PRESETS as readonly ProviderPreset[]) {
      expect(preset.id.length).toBeGreaterThan(0);
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.baseURL).toMatch(/^https?:\/\//);
      expect(preset.models.length).toBeGreaterThan(0);
    }
  });
});
