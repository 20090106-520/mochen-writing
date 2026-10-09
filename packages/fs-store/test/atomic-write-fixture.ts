import { defaultAtomicFs, type AtomicWriteFs } from "../src/atomic-write.js";

/**
 * 原子写缝（seam）的测试夹具：一份**真** fs 实现，外加「只坏一步」的变体。
 *
 * 真实现直接复用产品默认那份（`defaultAtomicFs`）——在这里另抄一份 open/write/sync/close，
 * 就成了「测试测的那份写盘和跑在产品里的那份不是同一份」，正犯本仓铁律 6。
 *
 * 存在的理由：本体要防的失败是「某一次系统调用抛错」，真文件系统上复现不了。
 */
export const realAtomicFs: AtomicWriteFs = defaultAtomicFs;

export type BrokenStep = keyof AtomicWriteFs;

/** 只让某一步抛错，其余照旧走真 fs——这样断言的是盘上到底剩了什么。 */
export function fsBrokenAt(step: BrokenStep, message: string, code: string): AtomicWriteFs {
  return {
    ...realAtomicFs,
    [step]: async () => {
      throw Object.assign(new Error(message), { code });
    }
  } as AtomicWriteFs;
}
