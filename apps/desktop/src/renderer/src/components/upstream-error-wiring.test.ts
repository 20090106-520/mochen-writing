/// <reference types="node" />
/**
 * 失败条上那句话的判据：**只有一份**（铁律 6）。
 *
 * ## 这条闸守的是什么
 *
 * 2026-10-25 用户在画布上批注：「不应该显示这个」——指的是对话时间线里那条红底失败条
 * 上面的原始英文异常（`***.BadRequestError: OpenAIException - {…}`）。
 *
 * 修法是「渲染时翻成人话」，而这条判据有**两个消费者**：
 * - 主进程：新失败发生时翻（2026-10-23 那刀，`provider-client.ts`）；
 * - 渲染层：盘上**早就落下来**的旧记录也得翻（那批是 2026-10-08 之前的主进程写的，
 *   原始英文异常原样存进了 jsonl，主进程已经改不动盘上的字，**显示**是渲染层的事）。
 *
 * 渲染层**禁止** import `@mochen/agent-runtime`（包边界闸），所以两边共用一份实现时，
 * 唯一能落的地方是 `@mochen/contracts`（agent-runtime 依赖它，渲染层也依赖它）。
 *
 * ## 为什么要扫全源码而不是只钉接线
 *
 * 「判据只有一份」最常见的破法是：有人在渲染层（或主进程）里**顺手再写一遍**翻译规则。
 * 那时接线照样是 contracts 的那份、屏上也照样是那句话——但两份判据已经开始漂。
 * 所以这里除了钉接线，还要**反向扫源码**：那几个判据关键词在
 * contracts 之外的地方一个都不许出现。
 *
 * 扫的语料与 `dead-css-guard.test.ts` 同一口径：所有 `.ts` / `.vue` 源文件，
 * 且**排除** `*.test.ts`（否则本文件自己提到的关键词会把判定喂饱）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { vueSource } from "../utils/vue-source-reader";

const SRC = fileURLToPath(new URL("../", import.meta.url));
/** 渲染层源码根：`apps/desktop/src/renderer/src`。 */
const RENDERER_SRC = SRC;
/** 仓库根：SRC 上溯五级（src → renderer → src → desktop → apps → 仓库根）。 */
const REPO = path.join(SRC, "..", "..", "..", "..", "..");

/**
 * 判据的**指纹**：那几个形状的**匹配式片段**（不是英文原句）。
 *
 * 为什么钉匹配式而不是原句：原句会被**引用**——`per-run-fields.ts` 的注释与
 * `ModelProfileDialog.vue` 的提示里都写着「Unexpected reasoning effort high. …」
 * 这句上游回执（那是给人看的说明与提示文案，不是一份实现）。
 * 照原句扫会把那两处**正当引用**判成「第二份判据」，闸就成了假红。
 * 而匹配式片段（正则的那一截）只可能出现在**真的在匹配**的地方。
 */
const JUDGMENT_FINGERPRINTS = [
  "Failed to deserialize[",
  "is an image model/i",
  "is a video model/i",
  "Unexpected reasoning effort\\s+"
];

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * 判据的**真身**住在 contracts 里；除此之外的源码都不许再出现那几个指纹。
 * （contracts 自己被排除在语料之外——那里正是它该在的地方。）
 */
function judgmentSourcesOutsideContracts(): { file: string; hit: string }[] {
  const roots = [
    RENDERER_SRC,
    path.join(REPO, "packages", "agent-runtime", "src"),
    path.join(REPO, "apps", "desktop", "src", "main")
  ];
  const out: { file: string; hit: string }[] = [];
  for (const root of roots) {
    for (const file of walk(root)) {
      if (!/\.(ts|vue)$/.test(file)) continue;
      if (file.endsWith(".test.ts")) continue;
      const source = fs.readFileSync(file, "utf8");
      for (const fingerprint of JUDGMENT_FINGERPRINTS) {
        if (source.includes(fingerprint)) {
          out.push({ file: path.relative(REPO, file).split(path.sep).join("/"), hit: fingerprint });
        }
      }
    }
  }
  return out;
}

describe("失败条那句话 · 判据只有一份（2026-10-25 用户批注「不应该显示这个」）", () => {
  it("时间线那条失败条用的是 contracts 的真身（不是渲染层自己的一份）", () => {
    const timeline = vueSource("utils/timeline.ts");
    expect(timeline).toContain("presentableFailureMessage");
    expect(timeline).toContain('from "@mochen/contracts"');
    // 钉**位置**：它落在错误块那一支上（不是文件里随便某处调一次）。
    expect(timeline).toMatch(
      /blocks\.push\(\{\s*kind: "error"[\s\S]{0,200}text: presentableFailureMessage\(event\.message\)/
    );
  });

  it("孤字那条（线程里没有对应时间线块时的那一行）也走同一个真身", () => {
    const center = vueSource("components/CenterColumn.vue");
    expect(center).toContain("presentableFailureMessage");
    expect(center).toContain('from "@mochen/contracts"');
  });

  it("主进程那侧引用的是同一份（判据搬进 contracts 之后不许留第二份实现）", () => {
    const client = fs.readFileSync(
      path.join(REPO, "packages", "agent-runtime", "src", "provider-client.ts"),
      "utf8"
    );
    expect(client).toContain('from "@mochen/contracts"');
    expect(client).toContain("upstreamFailureMessage");
  });

  it("反向扫源码：那几个判据指纹在 contracts 之外一个都不许出现", () => {
    expect(
      judgmentSourcesOutsideContracts(),
      "翻译规则在别处又写了一遍 —— 判据开始漂的那一步（铁律 6）"
    ).toEqual([]);
  });

  it("真身确实住在 contracts 里（这条扫描不许扫成空转）", () => {
    const truth = fs.readFileSync(
      path.join(REPO, "packages", "contracts", "src", "upstream-error.ts"),
      "utf8"
    );
    for (const fingerprint of JUDGMENT_FINGERPRINTS) {
      expect(truth, `真身里少了 ${fingerprint} 这条判据`).toContain(fingerprint);
    }
  });

  it("闸不是空转：把真身那份判据抄进渲染层，它当场判红（用真身自己的文件验）", () => {
    // 拿真身文件当"第二份实现"的样本：它的指纹必须在扫描语料里被认出来。
    const truth = fs.readFileSync(
      path.join(REPO, "packages", "contracts", "src", "upstream-error.ts"),
      "utf8"
    );
    const found = JUDGMENT_FINGERPRINTS.filter((fingerprint) => truth.includes(fingerprint));
    expect(found.length, "连真身都认不出来 ⇒ 这条扫描形同虚设").toBe(JUDGMENT_FINGERPRINTS.length);
  });
});
