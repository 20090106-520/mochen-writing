import { defaultAtomicFs, type AtomicWriteFs } from "@mochen/fs-store";

/**
 * 「只坏一步」的原子写 fs（测试夹具，2026-10-09 全仓扫描 P0-1/P0-5 那条线）。
 *
 * 【为什么存在】这几份配置落盘（模型 config.json / 外观 appearance.json / 保留上限
 * change-retention.json / 密钥 `<连接id>.enc`）要防的失败恰好是「写盘写到一半抛错」，
 * 而真文件系统上没法稳定制造 ENOSPC。夹具的做法是**在 `defaultAtomicFs` 之上只换掉一步**：
 * 其余步骤仍走真 fs，于是断言的是「盘上到底剩了什么」，不是「有没有按顺序调过几个假函数」。
 *
 * 【为什么不各写一份】这份写法在 `packages/fs-store/test/atomic-write-fixture.ts` 已经有了，
 * 但那是别的包的 test 目录，主进程的用例不能跨包去拿（越界）；而 provider-settings /
 * appearance-store / change-retention-store / credential-store 四份用例都要用它，
 * 各家抄一份就是铁律 6 反对的那种「四处口径」。
 *
 * 【两个记录数组的用途】`writeTargets` 钉「有没有直接写过目标文件」——
 * 裸 `writeFile(configFile, …)` 的第一次写目标就是 configFile 本身，这一条当场把它抓出来；
 * `renameTargets` 钉「临时文件确实改成了目标」，也就是原子通路真的走完了。
 */
export type BrokenAtomicFs = {
  fs: AtomicWriteFs;
  /** 每一次「写某个文件」的目标路径，按发生顺序。 */
  writeTargets: string[];
  /** 每一次「写某个文件」的**内容**，与 `writeTargets` 同序（密钥那份用例要钉临时件里也没有明文）。 */
  writeData: string[];
  /** 每一次改名的源路径，按发生顺序。 */
  renameFrom: string[];
};

export type AtomicFsStep = keyof AtomicWriteFs;

/** 只让 `step` 那一步抛错，其余照旧走真 fs（`defaultAtomicFs` 那一份，不是另抄的）。 */
export function atomicFsBrokenAt(
  step: AtomicFsStep,
  message: string,
  code = "ENOSPC"
): BrokenAtomicFs {
  const writeTargets: string[] = [];
  const writeData: string[] = [];
  const renameFrom: string[] = [];
  const broken = {
    ...defaultAtomicFs,
    writeFile: async (target: string, data: string) => {
      writeTargets.push(target);
      writeData.push(data);
      if (step === "writeFile") throw Object.assign(new Error(message), { code });
      return defaultAtomicFs.writeFile(target, data);
    },
    rename: async (from: string, to: string) => {
      renameFrom.push(from);
      if (step === "rename") throw Object.assign(new Error(message), { code });
      return defaultAtomicFs.rename(from, to);
    },
    mkdir: async (dir: string) => {
      if (step === "mkdir") throw Object.assign(new Error(message), { code });
      return defaultAtomicFs.mkdir(dir);
    },
    unlink: async (target: string) => {
      if (step === "unlink") throw Object.assign(new Error(message), { code });
      return defaultAtomicFs.unlink(target);
    }
  };
  return { fs: broken as AtomicWriteFs, writeTargets, writeData, renameFrom };
}
