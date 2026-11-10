import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { scanBook } from "@mochen/fs-store";
import type { DocRef, EditProposal } from "@mochen/contracts";
import { createDocToolHost } from "./doc-tools-host.js";

/**
 * 腔调偏离接进退稿闸（2026-11-10）。
 *
 * 三件事各钉一条：
 * 1. 已经在退稿时，退稿信要把「这本书自己的常态」摆出来（否则模型只会把词换干净，
 *    写成一篇不像这本书的干净稿）；
 * 2. 词干净但腔调跑了，提案照生成——腔调距离不是拦的理由（打斗章本来就短），只报；
 * 3. 完稿不足 500 字时不许量：没有常态就没有「偏离」，报出来是拿噪声当结论。
 */

/** 基线章：短句 + 对白，50 行 = 600 字、100 句、对白占比 25%。 */
const BASELINE_LINE = "他说：「走吧。」她把碗放下。";
const BASELINE = Array.from({ length: 50 }, () => BASELINE_LINE).join("\n");

/** 干净但腔调完全不同的一稿：长短句落差极大、零对白。字数过 300 的样本线。 */
const CLEAN_OFF_VOICE = [
  "灯灭了。",
  "他没动。",
  "风小了些。",
  "桶是空的。",
  "狗不叫了。",
  "水还在涨。",
  "老陈把缆绳一圈一圈绕在木桩上，绕到第九圈的时候手停住，抬头看了一眼天。",
  "她把碗端到水槽边，拧开水龙头冲了三遍，水声盖住了楼上收音机的天气预报。",
  "钥匙插进锁孔之后转不动，他换了个角度再试，锁芯发出一点很轻的响声。",
  "潮水退下去以后滩上留下几条翻白肚的鱼，苍蝇已经在它们身上落了一层。",
  "窗玻璃上那道旧裂纹从左上角斜到右下角，把外面的灯塔切成两半。",
  "海边那条路的路灯只亮了两盏，其余几盏的灯罩里积着死掉的飞虫。",
  "他数着台阶往上走，走到第十一级停住，把耳朵贴在门上听了很久。",
  "远处有船鸣笛，一声长两声短，然后海面重新安静下来。",
  "门外传来拖鞋踩过水渍的声音，一下一下，在楼梯口停住又走远了。"
].join("\n");

let root = "";
let docs: DocRef[] = [];
let collected: EditProposal[] = [];
const TARGET = "chapters/02-新章.md";

/** 一本有常态的小书：两章基线 + 一章待写。 */
async function bookWithBaseline(): Promise<void> {
  await writeFile(path.join(root, "chapters", "01-旧章.md"), BASELINE, "utf8");
  await writeFile(path.join(root, "chapters", "02-旧章.md"), BASELINE, "utf8");
  await writeFile(path.join(root, "chapters", "03-旧章.md"), BASELINE, "utf8");
  docs = await scanBook(root);
}

function host(): ReturnType<typeof createDocToolHost> {
  return createDocToolHost({
    root: () => root,
    docs: () => docs,
    context: () => ({
      docRelPath: TARGET,
      permissionMode: "full-access",
      workMode: "act"
    }),
    onProposal: (proposal) => collected.push(proposal),
    newId: (() => {
      let n = 0;
      return () => `p${(n += 1)}`;
    })(),
    now: () => "2026-11-10T08:00:00.000Z",
    webSearch: async () => ({
      sourceId: "test",
      sourceLabel: "测试源",
      results: [],
      attempted: 1,
      skipped: [],
      deduped: 0
    }),
    webRead: async () => {
      throw new Error("这个用例不该出网");
    }
  });
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "mochen-drift-"));
  await mkdir(path.join(root, "chapters"), { recursive: true });
});

describe("腔调偏离（本书自己的常态）", () => {
  it("词干净但腔调跑了：提案照生成，回执附一句腔调提示", async () => {
    await bookWithBaseline();
    collected = [];
    const out = await host().call("write_doc", {
      doc: TARGET,
      content: CLEAN_OFF_VOICE,
      why: "写新章"
    });
    expect(out.ok).toBe(true);
    expect(out.proposals).toHaveLength(1);
    expect(out.text).toContain("腔调提示");
    expect(out.text).toContain("句长均值");
    expect(out.text).toContain("本书");
  });

  it("已经在退稿时，退稿信里要带上「不像你自己写的」那一句", async () => {
    await bookWithBaseline();
    collected = [];
    // 通用闸的门槛是「命中 5 处且每千字 5 处」，所以这里给足五处议论腔；腔调也偏，两条理由各说各的。
    const out = await host().call("write_doc", {
      doc: TARGET,
      content: `${CLEAN_OFF_VOICE}\n与此同时，海面上的灯一盏一盏灭下去。\n与此同时，风停了。\n与此同时，船走了。\n众所周知，海不会说话。\n众所周知，人也不会。`,
      why: "写新章"
    });
    expect(out.ok).toBe(false);
    expect(out.text).toContain("自动退稿");
    expect(out.text).toContain("不像你自己写的");
    expect(out.proposals).toEqual([]);
    expect(collected).toEqual([]);
  });

  it("完稿不足 500 字时不量腔调：不许拿噪声当结论", async () => {
    // 换一本只有一章 30 字的书：没有常态，回执里不该出现腔调那句。
    const tiny = await mkdtemp(path.join(tmpdir(), "mochen-drift-tiny-"));
    await mkdir(path.join(tiny, "chapters"), { recursive: true });
    await writeFile(path.join(tiny, "chapters", "01-短.md"), "雾从海面涌上来。\n", "utf8");
    const tinyDocs = await scanBook(tiny);
    const tinyHost = createDocToolHost({
      root: () => tiny,
      docs: () => tinyDocs,
      context: () => ({ docRelPath: TARGET, permissionMode: "full-access", workMode: "act" }),
      onProposal: () => undefined,
      newId: () => "p1",
      now: () => "2026-11-10T08:00:00.000Z",
      webSearch: async () => ({
        sourceId: "test",
        sourceLabel: "测试源",
        results: [],
        attempted: 1,
        skipped: [],
        deduped: 0
      }),
      webRead: async () => {
        throw new Error("这个用例不该出网");
      }
    });
    const out = await tinyHost.call("write_doc", {
      doc: TARGET,
      content: CLEAN_OFF_VOICE,
      why: "写新章"
    });
    expect(out.ok).toBe(true);
    expect(out.text).not.toContain("腔调提示");
  });
});
