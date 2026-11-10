import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  IPC_CHANNELS,
  SKILL_FILE_NAME,
  encodeSkillRedeemCode,
  type SkillRedeemPayload
} from "@mochen/contracts";
import { createSkillRedeemService, registerSkillRedeemIpc } from "./skill-redeem-service.js";
// 来源闸（P1-7）：夹具只造事件形状，判据仍只在 ipc-guard 一份。
import { trustedRendererEvent } from "./ipc-trust-fixture.js";

/** 只用测试自己 mkdtemp 出来的 tmp 路径，afterAll 逐个 rm，绝不碰仓内目录。 */
const dirs: string[] = [];
async function tmp(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "mochen-redeem-"));
  dirs.push(dir);
  return dir;
}
afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

const PAYLOAD: SkillRedeemPayload = {
  dirName: "chapter-intent",
  displayName: "落笔前先问清楚",
  description: "动笔前把这一章要发生什么问清楚。",
  skillMd: "---\nname: 落笔前先问清楚\ndescription: 问清楚\n---\n\n正文甲\n"
};
const CODE = encodeSkillRedeemCode(PAYLOAD);

let globalDir = "";
function service(over: Partial<Parameters<typeof createSkillRedeemService>[0]> = {}) {
  return createSkillRedeemService({
    dirOf: (source) => (source === "global" ? globalDir : null),
    ...over
  });
}

async function planted(dirName: string): Promise<string> {
  return readFile(path.join(globalDir, dirName, SKILL_FILE_NAME), "utf8");
}

beforeEach(async () => {
  globalDir = await tmp();
});

describe("createSkillRedeemService · redeem", () => {
  it("①成功：盘上多一个目录，SKILL.md 与码里的正文逐字相同，回执回填目录名/显示名", async () => {
    const result = await service().redeem(CODE);
    expect(result.ok).toBe(true);
    expect(result.dirName).toBe(PAYLOAD.dirName);
    expect(result.displayName).toBe(PAYLOAD.displayName);
    expect(result.notice).toContain("兑换成功");
    expect(result.notice).toContain("挂入");
    expect(await planted(PAYLOAD.dirName)).toBe(PAYLOAD.skillMd);
  });

  it("②重复兑换不覆盖：先手写一份自定义 SKILL.md，兑换后一个字都不变", async () => {
    const dir = path.join(globalDir, PAYLOAD.dirName);
    await mkdir(dir, { recursive: true });
    const custom = "用户自己改过的正文，绝不能被一段码覆盖\n";
    await writeFile(path.join(dir, SKILL_FILE_NAME), custom, "utf8");

    const result = await service().redeem(CODE);
    expect(result.ok).toBe(false);
    expect(result.notice).toContain("已经装过了");
    expect(result.notice).toContain("没有覆盖");
    expect(await planted(PAYLOAD.dirName)).toBe(custom);
  });

  it("③坏码：回一句中文且盘上什么都不写", async () => {
    const result = await service().redeem("这不是一段兑换码");
    expect(result.ok).toBe(false);
    expect(result.notice).toContain("格式或校验没过");
    expect(result.dirName).toBe("");
    expect(result.displayName).toBe("");
    expect(await readdir(globalDir)).toEqual([]);
  });

  it("④目录名守卫：码里 dirName 含 ../ ⇒ 解码端就拒，盘上不落任何东西", async () => {
    const evil = encodeSkillRedeemCode({ ...PAYLOAD, dirName: "../escaped" });
    const result = await service().redeem(evil);
    expect(result.ok).toBe(false);
    expect(await readdir(globalDir)).toEqual([]);
    // 即便目录名能过解码端那道正则，主进程仍要借 marketTargetDir 自己再拦一次（见源码边界）。
  });

  it("⑤dirOf('global') 返回 null ⇒ 明确失败，不静默写去别处", async () => {
    const result = await service({ dirOf: () => null }).redeem(CODE);
    expect(result.ok).toBe(false);
    expect(result.notice).toContain("全局技能目录");
    expect(result.dirName).toBe("");
    expect(await readdir(globalDir)).toEqual([]);
  });
});

/**
 * 写通路的边界，钉在源码形状上（渲染层的读取器够不到 src/main，所以这些守卫住在这儿）。
 * 行为用例证明「运行时确实只写全局、且绝不覆盖」，这一批证明「代码里没有第二条写路径」。
 * 注释一律先剥掉再读：注释里写着的字不该混进字面量断言。
 */
describe("skill-redeem-service · 写通路的源码边界", () => {
  const SRC = readFileSync(new URL("./skill-redeem-service.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  it("目标路径必须过 marketTargetDir，判 null 后才写", () => {
    expect(SRC).toContain("marketTargetDir(root, payload.dirName)");
    expect(SRC).toContain("dir === null");
    expect(SRC).toContain("path.join(dir, SKILL_FILE_NAME)");
  });

  it("绝不覆盖靠 access 探存在：写盘只有一处 writeFile，且全文件不出现 rm(", () => {
    expect(SRC).toContain("await access(file)");
    expect(SRC).toContain("已经装过了，没有覆盖你已有的那份");
    expect(SRC.match(/\bwriteFile\(/g)).toHaveLength(1);
    expect(SRC).not.toContain("rm(");
  });
});

describe("registerSkillRedeemIpc", () => {
  it("⑥只注册一条通道，且只把一整串兑换码递进去（主进程不收路径/来源）", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    registerSkillRedeemIpc((channel, fn) => handlers.set(channel, fn), service());
    expect([...handlers.keys()]).toEqual([IPC_CHANNELS.skillsRedeem]);

    const result = await handlers.get(IPC_CHANNELS.skillsRedeem)?.(trustedRendererEvent(), CODE);
    expect(result).toMatchObject({ ok: true, dirName: PAYLOAD.dirName });
    expect(await planted(PAYLOAD.dirName)).toBe(PAYLOAD.skillMd);
  });
});
