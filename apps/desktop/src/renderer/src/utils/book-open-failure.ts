/**
 * 「打开这本书失败了」翻成人话（2026-11-12）。
 *
 * 【为什么需要翻】作品库点一条打不开，最常见的原因是**目录被移动 / 改名 / 删掉**：
 * 主进程 `readFile` 抛 ENOENT，经 Electron IPC 传回渲染层变成
 *
 *   Error invoking remote method 'book:open': Error: ENOENT: no such file or directory,
 *   open 'D:\旧盘\我的书\book.json'
 *
 * 一串英文、一段 IPC 前缀、一条用户根本不认识的绝对路径。而 `useBookStore.openBook`
 * 原先没有 catch —— 于是它连这句都没有：点了没反应，用户分不清是软件坏了还是书没了。
 *
 * 【为什么只翻三类】这三类是能给出「下一步怎么办」的：找不到（去确认目录还在不在）、
 * 没权限（去看文件夹权限）、book.json 坏了（主进程已经写了人话，原样用）。
 * 其余原样透出——编一句「未知错误」比真话更难查。
 */
const IPC_PREFIX = /^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/i;

export function openFailureText(error: unknown): string {
  const raw =
    error instanceof Error ? error.message : typeof error === "string" ? error : ("" as string);
  const message = raw.replace(IPC_PREFIX, "").trim();
  if (message === "") return "打不开这本书，也说不出为什么——重启一次再试。";
  if (/ENOENT|no such file or directory/i.test(message)) {
    return "找不到这本书的目录——可能被移动、改名或删掉了。";
  }
  if (/EACCES|EPERM|permission denied/i.test(message)) {
    return "没有权限读这个目录，看一下文件夹的访问权限。";
  }
  return message;
}
