/**
 * 进程级异常钩子（2026-10-09 全仓扫描 P0-6 的主进程那一半）。
 *
 * 修之前的样子：全仓 `uncaughtException` / `unhandledRejection` 零命中。启动装配
 * （`index.ts` 的 `app.whenReady().then(async …)`）里任何一处抛，都会变成一个没人接的
 * rejection：**窗口永不出现、也永不提示**，用户唯一能看到的现象是「双击没反应」。
 * 挂上钩子之后，这一类事故至少留下两样东西——盘上一行带栈的 crash 日志、屏上一句人话。
 *
 * 两条刻意的选择：
 * ① **记下来但继续跑**。Node 文档确实说 uncaughtException 之后状态不可信；但这里的默认分支
 *   是「进程当场没了」——那正好把可恢复的一次抛错升级成「用户正在写的字全没了」。
 *   写盘侧已经有原子写（P0-1：tmp→rename），崩在中途最多留一个临时文件，不会写成半截正文。
 * ② **钩子自己绝不再抛**。写日志失败（文件被占用、盘满）如果一路上抛，就是自己把故障
 *   升级成无声消失；所以 append 失败只意味着「改走通知」，不意味着结束。
 */

/** 钩子挂哪两条通道：与 Node 的同名事件一一对应，装配层 (`index.ts`) 直接递给 `process.on`。 */
export type CrashEvent = "uncaughtException" | "unhandledRejection";

export interface CrashGuardDeps {
  /** 注册通道。真身是 `process.on`；用例里把它换成一张表，好直接点火。 */
  on(event: CrashEvent, handler: (arg: unknown) => void): void;
  /** 追加一行 crash 日志。真身是 `appendFileSync`；不许抛，抛了也由本模块兜住。 */
  appendLine(line: string): void;
  /** 把话递到人面前（真身是系统对话框）。只在**第一次**崩的时候调用。 */
  notify(title: string, detail: string): void;
  /** 时间戳的取法：用例给定值，免得断言跟着时钟漂。 */
  now(): string;
}

/** 抛出来的东西不一定是 Error：字符串、undefined、裸对象都真实出现过。 */
function reasonTextOf(arg: unknown): string {
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  const text = arg === undefined ? "" : String(arg);
  return text === "" ? "（没有更多信息）" : text;
}

/** 一行日志的样子：`[时间] 通道: 理由` ＋（有栈就跟着）栈。 */
export function crashLineOf(event: CrashEvent, arg: unknown, now: string): string {
  const stack = arg instanceof Error && typeof arg.stack === "string" ? `\n${arg.stack}` : "";
  return `[${now}] ${event}: ${reasonTextOf(arg)}${stack}`;
}

/**
 * 装上钩子。返回值只是给装配层一个「装好了」的凭据（以及测试里手动点火的那两个 handler 的落点），
 * 产品侧不读它。
 */
export function installCrashGuard(deps: CrashGuardDeps): void {
  // 通知只发第一次：一次真崩溃往往带出一串后续抛错，弹十个框既不解决问题也拦不住用户干活。
  let notified = false;
  const handle =
    (event: CrashEvent) =>
    (arg: unknown): void => {
      const line = crashLineOf(event, arg, deps.now());
      try {
        deps.appendLine(line);
      } catch {
        // 盘上留不了痕（被占用、盘满）——那更要说话，只是绝不在这里再抛一次。
      }
      if (!notified) {
        notified = true;
        try {
          deps.notify(
            "墨宸 AI · 出了一次意外",
            "程序里有一处失败了，已经记进崩溃日志。窗口还在的话请先把稿子存一遍；" +
              "反复出现请把日志发出来。\n\n" +
              line
          );
        } catch {
          // 对话框也发不出去（窗口都没建起来）：日志那一行已经尽力了。
        }
      }
    };
  deps.on("uncaughtException", handle("uncaughtException"));
  deps.on("unhandledRejection", handle("unhandledRejection"));
}
