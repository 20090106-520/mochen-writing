/// <reference types="node" />
/**
 * IPC 与窗口共用的「来源闸」（2026-10-10 全仓扫描 P1-7 / P1-8）。
 *
 * 【这一层存在的理由】修之前主进程的样子是：
 *   ① 所有 `ipcMain.handle` 入口一律把 `_event` 丢掉（`book-service.ts`、`agent-ipc.ts` 等十来处），
 *      于是「谁发的这条」从来没人问；
 *   ② `book:open` 把 renderer 递来的 string 直接当**绝对路径**去读 `book.json`，`book:create` 的
 *      directory 同样；`doc:*` 只有 fs-store 那层的**词法** `..` 检查——符号链接逐字都对；
 *   ③ 窗口侧没有 `will-navigate` / `setWindowOpenHandler`，preload 注的是整套 `window.mochen`。
 * 三件叠起来的后果写在扫描总单里：渲染层一旦能执行脚本，就能往 `<appData>/plugins/x/index.js` 写文件（`doc:write` 当时管不了写哪），再触发 `plugins:list` 的 `import()` ⇒ **主进程任意代码执行**。
 *
 * 【这一层挡得住什么】
 *   - 不是我们这个页面发来的指令（远程页面、被导航出去后的页面、iframe 子帧、已经销毁的帧）；
 *   - 参数形状不对的指令（非文本、空串、含 `\0`、超长），以及「渲染层递路径、主进程照单全收」；
 *   - `doc:*` 往当前那本书**外面**写（realpath 级，看得穿软链）；
 *   - 主窗口被导航走、被 `window.open` 开新窗口；打包版被 env 牵着去 load 远程 URL。
 *
 * 【这一层挡不住什么——别把下面这些当成已经解决了】
 *   - 我们自己的页面里被注入的脚本：那一帧的 URL 与来源完全合法，`isTrustedSender` 认它。真正拦这件事的是 CSP（`renderer-csp.ts`，vite 插件按开发/打包两态插进 html）与 fs-store 的写盘闸，不是这里。
 *   - 已经打开的书目录里本来就有的软链：`book:open` 收的是绝对路径，用户自己选的目录里有什么，这一层不猜（词法越界与 realpath 越界在 `doc:*` 上拒，但 `book:open` 没有「书内」可判）。
 *   - 能改 `<appData>` 或能改安装目录的进程＝已经拿到了这个用户的文件写权限，闸在它面前形同虚设；这里防的是「浏览器里跑起来的一段脚本」，不是「本机任意进程」。
 *   - `sandbox: false` 本轮没动：改掉它要先验证 preload 与插件挂载在沙箱里还起得来（见报告的真机复验清单）。
 *
 * 【为什么判据只有这一份】`isTrustedSender` / `isSameRendererOrigin` / `relPathStaysInsideRoot`
 * 都只在这里实现一次；通道侧只调 `handleTrusted`，窗口侧（`window-guards.ts`：第九十四节为行数
 * 预算把 `installWindowGuards` 搬了出去）只调这里的 `isSameRendererOrigin`。
 * 两份「什么叫我们自己的页面」迟早会不一样，那比没有闸更坏（铁律 6）。
 *
 * 【字段语义按 Electron 42 的类型定义核对过，不是猜的】
 *   - `IpcMainInvokeEvent.senderFrame: WebFrameMain | null`——官方注释：在帧已导航或被销毁之后取到 null；
 *   - `WebFrameMain.parent: WebFrameMain | null`——官方注释：top frame 时为 null ⇒ 子帧判据是 `parent !== null`；
 *   - `WebFrameMain.url: string`——这一帧当前 URL。
 *   42 的 invoke 事件**没有** `parentFrameId` 这枚字段（只有 `frameId` / `processId`），所以「非主帧」不能按 `parentFrameId !== -1` 判——那样写会永远判不出子帧，这里用 `parent`。
 */

import { realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { IPC_CHANNELS } from "@mochen/contracts";

/* ----------------------------------------------------------------------------------------------- */
/* 一、来源判定                                                                                      */
/* ----------------------------------------------------------------------------------------------- */

/** `WebFrameMain` 里这一层唯一需要的两枚字段（做成结构化最小形状，用例才不必造一个 electron 对象）。 */
export interface FrameLike {
  readonly url: string;
  readonly parent: FrameLike | null;
}

/** `IpcMainInvokeEvent` 里这一层唯一需要的字段。 */
export interface SenderEventLike {
  readonly senderFrame?: FrameLike | null;
}

/** 本 app 唯一允许的渲染层来源（打包态是 index.html 的 `file://`，开发态是 vite 那条 URL）。 */
export interface RendererTrust {
  readonly allowedUrl: string;
}

/**
 * 启动时装上去的那一份（`index.ts` 里 `installRendererTrust(rendererLoad.trust)`）。
 *
 * 做成模块级一份而不是每个注册点多传一份参数：装配点传漏一次＝那几条通道裸奔，
 * 而**没装上＝一律不信**（fail closed）比漏装一次全放行安全得多。
 */
let installedTrust: RendererTrust | null = null;

export function installRendererTrust(trust: RendererTrust | null): void {
  installedTrust = trust;
}

export function installedRendererTrust(): RendererTrust | null {
  return installedTrust;
}

// 通道级授权（台账第六十九节）：判据真身在 channel-trust.ts，这里只 import（铁律 6）。
import { channelTrustVerdict } from "./channel-trust.js";

function parseUrl(raw: unknown): URL | null {
  if (typeof raw !== "string" || raw === "") return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** Windows 上盘符大小写与斜杠方向都不固定（fs-store 的 changes.ts 为同一件事写过同款判据）。 */
function samePathText(a: string, b: string): boolean {
  const normalize = (value: string): string => value.replaceAll("\\", "/");
  return process.platform === "win32"
    ? normalize(a).toLowerCase() === normalize(b).toLowerCase()
    : normalize(a) === normalize(b);
}

/** `child` 的真实路径是否落在 `root` 之内（按分隔符对齐的前缀，不是字符串 startsWith 的近似）。 */
function isUnderReal(child: string, root: string): boolean {
  // 等值也是「在内」：回退链走到书根本身时（新分类目录还没建的第一篇），最近的已存在
  // 祖先就是书根。旧实现只认「严格长于书根」的前缀，child === root 会被判成书外。
  if (samePathText(child, root)) return true;
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return samePathText(child.slice(0, prefix.length), prefix);
}

/**
 * 「这一帧是不是我们那一份页面」。
 *
 * - `file://`：必须**同一个 html 文件**（同一块盘上的别的 html 也带着 preload，不能算自己人）；
 * - `http(s)://`：同一 origin 即可。开发态 vite 整页重载会改 query、客户端路由会改 hash，
 *   那是同一条页面而不是被导航走；要换 origin 就得让 vite 服务出去，本来就不是正常路径。
 *
 * 局限照写：同源之下的别的页面（未来若加第二份 html）也算自己人。「哪个页面能用哪条通道」由 channel-trust.ts 的 self 档收口（台账第六十九节）。
 */
export function isSameRendererOrigin(rawUrl: unknown, trust: RendererTrust): boolean {
  const allowed = parseUrl(trust.allowedUrl);
  const actual = parseUrl(rawUrl);
  if (allowed === null || actual === null) return false;
  if (allowed.protocol === "file:" || actual.protocol === "file:") {
    return allowed.protocol === actual.protocol && samePathText(allowed.pathname, actual.pathname);
  }
  return allowed.protocol === actual.protocol && allowed.host === actual.host;
}

function frameOf(event: unknown): FrameLike | null | undefined {
  if (typeof event !== "object" || event === null) return undefined;
  const raw = (event as { senderFrame?: unknown }).senderFrame;
  if (raw === null) return null;
  if (typeof raw !== "object") return undefined;
  return raw as FrameLike;
}

/**
 * 来源判定 + **说得出口的理由**（被拦时日志与回话都靠它，只给「不行」等于下次排查还是两眼一抹黑）。
 */
export function senderTrustVerdict(
  event: unknown,
  trust?: RendererTrust | null
): { trusted: boolean; reason: string } {
  const policy = trust === undefined ? installedTrust : trust;
  if (policy === null || policy === undefined) {
    return {
      trusted: false,
      reason: "来源判定还没装上（启动装配没跑到 installRendererTrust），这条指令按不可信处理。"
    };
  }
  const frame = frameOf(event);
  if (frame === null) {
    return {
      trusted: false,
      reason:
        "发这条指令的那一帧已经不在了（senderFrame 为 null：帧导航走了或被销毁），确认不了来源。"
    };
  }
  if (frame === undefined) {
    return {
      trusted: false,
      reason: "这条 IPC 事件里没有 senderFrame，形状不认识，按不可信处理。"
    };
  }
  if (frame.parent !== null && frame.parent !== undefined) {
    return {
      trusted: false,
      reason: `这条来自子帧（iframe）：${frame.url}。preload 注给主窗口的能力不该被子帧继承。`
    };
  }
  if (!isSameRendererOrigin(frame.url, policy)) {
    return {
      trusted: false,
      reason: `来源不是这个应用自己的窗口：这一帧是 ${frame.url}，本 app 只认 ${policy.allowedUrl}。`
    };
  }
  return { trusted: true, reason: frame.url };
}

export function isTrustedSender(event: unknown, trust?: RendererTrust | null): boolean {
  return senderTrustVerdict(event, trust).trusted;
}

/** 渲染层要加载哪一份页面（`index.ts` 唯一一次读 env 就在这里的入参里）。 */
export interface RendererLoadInput {
  isPackaged: boolean;
  envRendererUrl?: string | undefined;
  /** 打包态的入口文件（磁盘路径，不是 URL）。 */
  packagedIndex: string;
}

export interface RendererLoad {
  kind: "url" | "file";
  target: string;
  trust: RendererTrust;
}

/**
 * 「加载哪里」与「谁算自己人」是同一个问题的两面，所以放在一个函数里一次算完：
 * 分两处写就会出现「加载的是 env 那条、判据认的是 index.html」这种对不上的装配。
 *
 * 打包态**忽略** `ELECTRON_RENDERER_URL`：env 对同用户的任何本机进程都是可读可写的，
 * 而远程页面带着整套 `window.mochen`（P1-8 原文的那条路）。
 * 开发态只认 http/https 的 env 值——递进一个 `file://` 或 `data:` 不是 vite 该干的事。
 */
export function resolveRendererLoad(input: RendererLoadInput): RendererLoad {
  const env = typeof input.envRendererUrl === "string" ? input.envRendererUrl.trim() : "";
  if (!input.isPackaged && env !== "") {
    const parsed = parseUrl(env);
    if (parsed !== null && (parsed.protocol === "http:" || parsed.protocol === "https:")) {
      return { kind: "url", target: env, trust: { allowedUrl: parsed.href } };
    }
  }
  return {
    kind: "file",
    target: input.packagedIndex,
    trust: { allowedUrl: pathToFileURL(input.packagedIndex).href }
  };
}

/* ----------------------------------------------------------------------------------------------- */
/* 二、参数形状闸                                                                                     */
/* ----------------------------------------------------------------------------------------------- */

/**
 * 上限是「正常渲染层递得出来的东西」的量级，不是「攻击载荷」的量级：
 * 超了就说明确实不是这个 app 的界面递来的，直接拒。
 */
export const MAX_ABS_PATH_CHARS = 4096;
export const MAX_REL_PATH_CHARS = 1024;
export const MAX_ID_CHARS = 256;
/** 单篇正文上限：4M 字（约 12 MB utf-8）——比任何一本真实书都宽，窄到 1M 会把长文拦成「保存失败」。 */
export const MAX_BODY_CHARS = 4_000_000;
/** 素材库联网搜索的搜索词上限（2026-10-24）：够放一整句问句，又短到不会被拿来塞别的东西。 */
export const MAX_MATERIALS_SEARCH_CHARS = 120;
/**
 * 取全文那条通道的链接长度上限（2026-10-24）：搜索站给的跳转链实测能到 450 字符，
 * 2000 够装下最长的那种，又短到不会被拿来塞别的东西。
 */
export const MAX_MATERIALS_FETCH_URL_CHARS = 2000;

/** 被挡下的四种原因：来源不对 / 通道档位没满足 / 参数形状不对 / 追加检查没过。`guard` 档的判定住在 channel-trust.ts。 */
export type GuardDenyKind = "untrusted" | "arg" | "check" | "guard";
export interface DenyInfo {
  message: string;
  kind: GuardDenyKind;
}

/** 返回 null＝这一位参数认了；返回中文字符串＝挡下的理由。 */
export type ArgRule = (value: unknown, index: number) => string | null;

export interface TextRuleOptions {
  maxLength?: number;
  /** 「空串也算合法」只给正文这种**允许清空**的字段；路径与 id 一律不许空。 */
  allowEmpty?: boolean;
  label?: string;
}

export function textRule(options: TextRuleOptions = {}): ArgRule {
  const maxLength = options.maxLength ?? MAX_ID_CHARS;
  const label = options.label ?? "这条指令";
  return (value, index) => {
    if (typeof value !== "string") {
      return `${label}的第 ${index + 1} 个参数不是一段文本（收到 ${typeName(value)}），主进程不接。`;
    }
    // NUL 单独提出来：系统调用在 `\0` 处截断路径，于是「校验的串」与「真去打开的串」不是同一串。
    if (value.includes("\0")) {
      return `${label}的参数里含 \\0：路径会在它那儿被截断，这种串不是界面递出来的。`;
    }
    if (value.length > maxLength) {
      return `${label}的参数有 ${value.length} 个字符，超过上限 ${maxLength}。`;
    }
    if (!options.allowEmpty && value.trim() === "") {
      return `${label}的参数是空的。`;
    }
    return null;
  };
}

/** 可选文本（`string | undefined`）：不给＝不判，给了就按 textRule 判。 */
export function optionalTextRule(options: TextRuleOptions = {}): ArgRule {
  const inner = textRule(options);
  return (value, index) => (value === undefined ? null : inner(value, index));
}

export function objectRule(label = "这条指令"): ArgRule {
  return (value, index) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return `${label}的第 ${index + 1} 个参数不是一个对象（收到 ${typeName(value)}）。`;
    }
    return null;
  };
}

/** `object | null`：导出那条桥上「这本书还没建」是真的合法状态。 */
export function objectOrNullRule(label = "这条指令"): ArgRule {
  return (value, index) => (value === null ? null : objectRule(label)(value, index));
}

export function arrayRule(label = "这条指令"): ArgRule {
  return (value, index) =>
    Array.isArray(value)
      ? null
      : `${label}的第 ${index + 1} 个参数不是一个列表（收到 ${typeName(value)}）。`;
}

export function booleanRule(label = "这条指令"): ArgRule {
  return (value, index) =>
    typeof value === "boolean" ? null : `${label}的第 ${index + 1} 个参数不是真/假。`;
}

/** 文本或字节串（导出那条桥两样都收）。 */
export function textOrBytesRule(label = "这条指令"): ArgRule {
  return (value, index) => {
    if (typeof value === "string") {
      return value.includes("\0") || value.length > MAX_BODY_CHARS
        ? `${label}的第 ${index + 1} 个参数不是能写盘的那段内容。`
        : null;
    }
    if (value instanceof Uint8Array) {
      return value.byteLength > MAX_BODY_CHARS ? `${label}的字节数超过上限。` : null;
    }
    return `${label}的第 ${index + 1} 个参数既不是文本也不是字节（收到 ${typeName(value)}）。`;
  };
}

/**
 * 「这一位不在这里判」的显式记号。
 *
 * 为什么要占一格而不是省略：形状表是**每条通道都有**的清单，空着写等于没登记过；
 * 而白名单类的判定（`book-data` 的键、provider 的草稿）住在各自的真身里，这里再判一遍就是第二份判据。
 */
export function uncheckedRule(reason: string): ArgRule {
  // 这句检查不参与跨进程判定，只是逼着登记的人在表里写清「那件事的判据住在哪儿」。
  if (reason === "") throw new Error("uncheckedRule 必须写明判定住在哪一处，否则等于偷偷放行");
  return () => null;
}

function typeName(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "数组";
  return typeof value;
}

/** 按位置校验的规则；`args[i]` 只有 `rules[i]` 存在时才判。 */
export interface GuardOptions {
  /** 通道自己的回话形状（照抄现有契约）；不传＝抛中文 Error。 */
  deny?: (info: DenyInfo) => unknown;
  /** 追加检查：返回 null 放行，返回字符串＝挡下并把这句递给渲染层。可以是 Promise。 */
  check?: (args: unknown[]) => string | null | Promise<string | null>;
  /** 覆盖默认形状表（个别通道要按当前书现判时用）。 */
  args?: ArgRule[];
}

const relPath = (label: string): ArgRule => textRule({ maxLength: MAX_REL_PATH_CHARS, label });
const id = (label: string): ArgRule => textRule({ maxLength: MAX_ID_CHARS, label });

/**
 * 通道 → 参数形状（**一份表**，新增通道先在这里点名）。
 *
 * 只验形状不验语义：`book:open` 是不是真目录、`book-data` 的键在不在白名单里，
 * 那些判定各自住在 fs-store / service 里，这里再抄一遍就是两份判据。
 */
export const IPC_ARG_SHAPES: Record<string, ArgRule[]> = {
  [IPC_CHANNELS.bookOpen]: [textRule({ maxLength: MAX_ABS_PATH_CHARS, label: "打开作品目录" })],
  // 作品库（2026-10-21）：移除一条只递书根的绝对路径；「是不是真在清单里」由 store 自己判。
  [IPC_CHANNELS.bookForget]: [
    textRule({ maxLength: MAX_ABS_PATH_CHARS, label: "要从作品库移除的作品目录" })
  ],
  [IPC_CHANNELS.bookCreate]: [objectRule("新建作品")],
  [IPC_CHANNELS.bookSaveMeta]: [objectRule("保存作品设置")],
  [IPC_CHANNELS.bookDataRead]: [
    uncheckedRule("键的白名单判定住在 book-service 与 fs-store，抄第二份就是两份判据")
  ],
  [IPC_CHANNELS.bookDataWrite]: [
    uncheckedRule("键的白名单判定住在 book-service"),
    textRule({ maxLength: MAX_BODY_CHARS, allowEmpty: true, label: "要写的设定 JSON" })
  ],
  [IPC_CHANNELS.docRead]: [relPath("读文稿")],
  [IPC_CHANNELS.docWrite]: [
    relPath("存文稿"),
    // 正文允许空串：用户真的会把一篇稿子清空，那条路不能因为加固变成「存不下去」。
    textRule({ maxLength: MAX_BODY_CHARS, allowEmpty: true, label: "正文" }),
    id("期望指纹")
  ],
  [IPC_CHANNELS.docCreate]: [
    relPath("新建文稿"),
    textRule({ maxLength: MAX_REL_PATH_CHARS, label: "文稿标题" })
  ],
  // 只重算一篇（P1-4 后半，2026-10-10）：入参与 `doc:read` 同形，但它是这一批新开的通道，
  // 所以按最严的那条走——realpath 的「书内」判定也一并挂上（注册点那条 `check`），
  // 不继承 `doc:read` 当时的历史遗漏。`doc:read` 要不要补同一道，记在扫描总单 P1-7 的后续里。
  [IPC_CHANNELS.docRefresh]: [relPath("重算文稿")],
  // 回收站（2026-10-10）：删只递一篇的 relPath（realpath 闸在注册点那条 check，与 doc:* 同款）；
  // 还原只递条目名，盘上路径由主进程按当前书拼（与 market:install 同一条铁律）。
  [IPC_CHANNELS.docTrash]: [relPath("要移入回收站的文稿")],
  [IPC_CHANNELS.trashRestore]: [id("回收站条目名")],
  // 整书备份（2026-10-10）：create 递触发方式（非 "daily" 一律按 manual 处理，回退在 service）；
  // restore 只递备份目录名，盘上路径由主进程按当前书拼（与 trash:restore 同一条铁律）。
  [IPC_CHANNELS.bookBackupCreate]: [id("备份触发方式")],
  [IPC_CHANNELS.bookBackupRestore]: [id("备份条目名")],
  [IPC_CHANNELS.agentStartTurn]: [objectRule("这一轮对话")],
  [IPC_CHANNELS.agentInterrupt]: [id("打断的轮次")],
  [IPC_CHANNELS.agentDecide]: [objectRule("这条审批")],
  [IPC_CHANNELS.agentDiff]: [id("提案")],
  [IPC_CHANNELS.agentLoadSession]: [
    relPath("线程"),
    optionalTextRule({ maxLength: MAX_ID_CHARS, label: "会话 id" })
  ],
  [IPC_CHANNELS.agentContextPreview]: [objectRule("上下文预览的询问")],
  // 多稿择优（P0-②）：两条都收对象入参（集句柄 + 稿序号 / 只集句柄）。
  // 集在不在、稿序号指得到谁，判定住在 multi-sample 的取集那一步，这里再抄一遍就是第二份判据。
  [IPC_CHANNELS.agentPickDraft]: [objectRule("要选的那一稿")],
  [IPC_CHANNELS.agentDiscardDrafts]: [objectRule("要丢弃的那一集")],

  [IPC_CHANNELS.providerSave]: [objectRule("这条连接草稿")],
  [IPC_CHANNELS.providerConnectionRemove]: [id("要删的连接")],
  [IPC_CHANNELS.providerListModels]: [uncheckedRule("草稿可选，判定住在 provider-models")],
  [IPC_CHANNELS.providerVerify]: [id("要体检的连接")],
  [IPC_CHANNELS.providerProfileUpsert]: [objectRule("这份档案草稿")],
  [IPC_CHANNELS.providerProfileRemove]: [id("要删的档案")],
  [IPC_CHANNELS.providerProfileEnable]: [id("要启停的档案"), booleanRule("档案的启停")],
  [IPC_CHANNELS.appOpenExternal]: [id("这家服务商")],
  [IPC_CHANNELS.appOpenWebSource]: [
    textRule({ maxLength: MAX_ABS_PATH_CHARS, label: "要打开的链接" })
  ],

  [IPC_CHANNELS.skillsRead]: [id("技能来源"), relPath("技能文件")],
  [IPC_CHANNELS.marketInstall]: [id("要装的技能")],
  [IPC_CHANNELS.marketUninstall]: [id("要卸的技能")],
  [IPC_CHANNELS.pluginsToggle]: [id("插件目录名"), booleanRule("启用还是停用")],
  [IPC_CHANNELS.pluginsUninstall]: [id("要卸载的插件")],
  [IPC_CHANNELS.pluginsSource]: [id("要看源码的插件")],
  [IPC_CHANNELS.changesRead]: [relPath("那条备份")],
  [IPC_CHANNELS.changesDiff]: [relPath("那条备份"), relPath("要比的那一篇")],
  [IPC_CHANNELS.changesRestore]: [relPath("那条备份"), id("期望指纹")],
  [IPC_CHANNELS.changesRetentionSave]: [objectRule("保留上限")],
  [IPC_CHANNELS.appearanceSave]: [objectRule("外观设置")],
  [IPC_CHANNELS.buildExport]: [
    arrayRule("要导出的文稿列表"),
    objectOrNullRule("这本书的元信息"),
    objectRule("导出选项")
  ],
  [IPC_CHANNELS.saveFileExport]: [
    textOrBytesRule("要导出的内容"),
    textRule({ maxLength: MAX_REL_PATH_CHARS, label: "导出文件名" }),
    optionalTextRule({ maxLength: MAX_REL_PATH_CHARS, label: "保存对话框的标题" })
  ],
  [IPC_CHANNELS.appNotify]: [
    textRule({ maxLength: MAX_ID_CHARS, label: "通知标题" }),
    textRule({ maxLength: MAX_REL_PATH_CHARS, allowEmpty: true, label: "通知正文" })
  ],
  [IPC_CHANNELS.appFlushQuitDone]: [objectRule("落盘的回话")],
  // TXT 导入（2026-10-11）：预览无参；提交递一章目清单（对象），清单内部每章的标题/正文
  // 形状与总量判定住在 import-service 的 commit——这里再逐章判就是第二份判据。
  [IPC_CHANNELS.importCommit]: [objectRule("这一批导入的章节")],
  // 全书替换（2026-10-15）：递的是一个对象（要找的文本 + 换成什么）。
  // 那两段文本的语义（空查询一律拒）判定住在 `book-replace.ts`，这里再判一遍就是第二份判据；
  // 这条通道也没有 relPath 参数，所以注册点**不挂** insideCurrentBook（挂上会把空路径判成书外）。
  [IPC_CHANNELS.bookReplaceAll]: [objectRule("全书替换的输入")],
  // WebDAV 远程备份（2026-10-15）：config-save 递配置草稿（密钥三态见契约，语义判定住在
  // webdav-config-store.ts）；pull 只递一个远程备份目录名——盘上落点由主进程按当前书根拼。
  [IPC_CHANNELS.webdavConfigSave]: [objectRule("WebDAV 配置草稿")],
  [IPC_CHANNELS.webdavPull]: [id("远程备份条目名")],
  // 素材库联网搜索（2026-10-24）：只收一个搜索词，长度有上限。
  [IPC_CHANNELS.materialsSearch]: [
    textRule({ maxLength: MAX_MATERIALS_SEARCH_CHARS, label: "搜索词" })
  ],
  // 取全文（2026-10-24）：只收一条链接。协议白名单不在这里判——它住在 web-read.ts 那条链上
  // （与「点开来源」同源），这里只管形状与长度。
  [IPC_CHANNELS.materialsFetch]: [
    textRule({ maxLength: MAX_MATERIALS_FETCH_URL_CHARS, label: "网页链接" })
  ]
};

export function argRulesFor(channel: string): ArgRule[] {
  return IPC_ARG_SHAPES[channel] ?? [];
}

/**
 * 本来就没有参数的通道：渲染层递不进任何东西，所以形状表里没有它们的位置。
 *
 * 与 `IPC_ARG_SHAPES` 并起来必须覆盖全部「主进程收」的通道（`ipc-guard.test.ts` 钉着这条并集）。
 * 新增一条带参数的通道如果两边都不落，那位参数就等于从没验过——这正是 P1-7 的原病。
 */
export const IPC_NO_ARG_CHANNELS: readonly string[] = [
  IPC_CHANNELS.bookPick,
  // 作品库（2026-10-21）：读整份清单没有参数（书架内容全由主进程自己的落盘决定）。
  IPC_CHANNELS.bookRecent,
  IPC_CHANNELS.agentListSessions,
  IPC_CHANNELS.providerGet,
  IPC_CHANNELS.skillsList,
  IPC_CHANNELS.marketList,
  IPC_CHANNELS.pluginsList,
  IPC_CHANNELS.changesList,
  IPC_CHANNELS.changesRetentionGet,
  IPC_CHANNELS.changesPruneNow,
  IPC_CHANNELS.appearanceGet,
  IPC_CHANNELS.trashList,
  IPC_CHANNELS.bookBackupList,
  IPC_CHANNELS.importPreview,
  IPC_CHANNELS.updateCheck,
  // WebDAV 远程备份（2026-10-15）：config-get / verify / push / list 全部无参——
  // 要落到哪台服务器哪本书哪一份，全由主进程按配置与当前书根自己拼。
  IPC_CHANNELS.webdavConfigGet,
  IPC_CHANNELS.webdavVerify,
  IPC_CHANNELS.webdavPush,
  IPC_CHANNELS.webdavList
];

/**
 * WebDAV 那四条（verify / push / list / pull）被挡时的**同一份**回话：
 * `io-error` 是它们四份契约里的共同兜底档。抽出来是因为四条各写一段一模一样的闭包，
 * 等于在加固层里维持四份可能分家的形状，也在 800 行预算里白占十行。
 */
const webdavDenyIo = (info: DenyInfo): unknown => ({
  ok: false,
  reason: "io-error",
  message: info.message
});

/**
 * 通道 → 被挡时**照原契约**的回话形状。
 *
 * 为什么必须照抄：这些通道的渲染层调用点是按 `result.ok` / `result.reason` 解析的，
 * 加固如果改成抛错或回一个没写过的形状，轻则红色错误条、重则那一格永远空着（P1-9 那种病）。
 * 抛错类的通道（`book:open`、`doc:read`、两条 shell 桥…）本来就有抛错路径，用默认抛错。
 */
const IPC_DENY_REPLIES: Record<string, (info: DenyInfo) => unknown> = {
  [IPC_CHANNELS.bookCreate]: (info) => ({ ok: false, message: info.message }),
  // 作品库移除（2026-10-21）被挡时回空清单：调用点按 result.books 渲染，抛错会让那一行悬在 await 上。
  [IPC_CHANNELS.bookForget]: () => ({ books: [] }),
  [IPC_CHANNELS.docWrite]: (info) => ({
    ok: false,
    reason: info.kind === "check" ? "outside-book" : "invalid-path",
    message: info.message
  }),
  [IPC_CHANNELS.docCreate]: (info) => ({
    ok: false,
    reason: info.kind === "check" ? "outside-book" : "invalid-path",
    message: info.message
  }),
  // doc:refresh 被挡时回 DocRefreshResult 而不是抛错：调用点在 `syncDocRef` 里按 `result.ok` 分支，
  // 抛错会让「改名 / 吸收智能体写入」那条链红屏中断，而这条路本来就有整本温和重扫兜底。
  [IPC_CHANNELS.docRefresh]: (info) => ({
    ok: false,
    reason: info.kind === "check" ? "outside-book" : "invalid-path",
    message: info.message
  }),
  [IPC_CHANNELS.bookDataRead]: (info) => ({
    ok: false,
    reason: "invalid-key",
    message: info.message
  }),
  [IPC_CHANNELS.bookDataWrite]: (info) => ({
    ok: false,
    reason: info.kind === "arg" ? "not-json" : "write-failed",
    message: info.message
  }),
  // 回收站三条（2026-10-10）被挡时照各自契约的失败档回话：调用点都按 result.ok 分支。
  [IPC_CHANNELS.docTrash]: (info) => ({
    ok: false,
    reason: info.kind === "check" ? "outside-book" : "invalid-path",
    message: info.message
  }),
  [IPC_CHANNELS.trashList]: (info) => ({
    ok: false,
    reason: "no-book",
    message: info.message
  }),
  [IPC_CHANNELS.trashRestore]: (info) => ({
    ok: false,
    reason: "not-found",
    message: info.message
  }),
  // 检查更新被挡（只有形状闸一种：它没有参数）——按 UpdateCheckResult 的 error 档回，
  // 别让「关于」页那颗按钮在闸拦下时悬死在 await 上。
  [IPC_CHANNELS.updateCheck]: (info) => ({
    status: "error",
    version: "",
    latestVersion: null,
    note: info.message
  }),
  // TXT 导入两条（2026-10-11）被挡时照各自契约的失败档回话：对话框两条链都按 result.ok 分支，
  // 抛错会让「选文件」那颗按钮悬死在 await 上。
  [IPC_CHANNELS.importPreview]: (info) => ({
    ok: false,
    reason: "read-error",
    message: info.message
  }),
  [IPC_CHANNELS.importCommit]: (info) => ({
    ok: false,
    reason: "no-book",
    message: info.message
  }),
  // 全书替换（2026-10-15）被挡时照 BookReplaceResult 的失败档回话：调用点是 await 后按 result.ok
  // 分支的，抛错会让那颗按钮悬死在 await 上（回一个真实的失败比「什么都不回」好）。
  [IPC_CHANNELS.bookReplaceAll]: (info) => ({
    ok: false,
    reason: "invalid-input",
    message: info.message
  }),
  // WebDAV（2026-10-15）被挡时各照其契约的失败档回话：渲染层 await 后按 result.ok 或 persisted
  // 分支，抛错会让那几颗按钮悬死在 await 上。config-get 回空快照（与「未配置」同档）；
  // verify / push / list / pull 四条共用下面那份回话（被挡是来源问题，归类成 io 是诚实的）。
  [IPC_CHANNELS.webdavConfigGet]: () => ({
    persisted: false,
    url: "",
    username: "",
    hasPassword: false
  }),
  [IPC_CHANNELS.webdavVerify]: webdavDenyIo,
  [IPC_CHANNELS.webdavPush]: webdavDenyIo,
  [IPC_CHANNELS.webdavList]: webdavDenyIo,
  [IPC_CHANNELS.webdavPull]: webdavDenyIo,
  // 多稿择优（P0-②）被挡时照 DraftSetResult 的失败档回话：调用点 await 后按 result.ok 分支，
  // 抛错会让「用这一稿 / 丢掉这几稿」那颗按钮悬死在 await 上。`message` 已如实报出被挡的原因，
  // `reason` 取 gone（＝这几稿作废，重发一轮）是最贴近的失败档。
  [IPC_CHANNELS.agentPickDraft]: (info) => ({ ok: false, reason: "gone", message: info.message }),
  [IPC_CHANNELS.agentDiscardDrafts]: (info) => ({
    ok: false,
    reason: "gone",
    message: info.message
  }),
  // 素材库联网搜索（2026-10-24）被挡时照契约的失败档回话：面板那颗「搜」是 await 后按 result.ok
  // 分支的，抛错会让它悬死在 await 上。
  [IPC_CHANNELS.materialsSearch]: (info) => ({ ok: false, message: info.message }),
  // 取全文那条同理（2026-10-24）：面板那枚「加入素材库」也是 await 后按 result.ok 分支的。
  [IPC_CHANNELS.materialsFetch]: (info) => ({ ok: false, message: info.message })
};

/**
 * 注册点交给 electron 的那一份 handler 形状。
 *
 * 【为什么 event 是 unknown 而不是 SenderEventLike】各模块的注册表把 handler 声明成
 * `type Handler = (channel, fn: (...args: unknown[]) => unknown) => void`，装配处传真的 `ipcMain`、
 * 测试处传一张 Map。`strictFunctionTypes` 下函数参数是**逆变**比较：把 event 标成 `SenderEventLike`
 * 会让那份 `Handler` 与 `IpcRegistrar` 互不相容（`unknown` 不许当 `SenderEventLike`），
 * 于是每个注册点都得写 `as`——断言恰好会把「这条通道没走闸」一起吞掉，那是 P1-7 的原病。
 * event 的真实形状由 `senderTrustVerdict` 自己认（它收 unknown，认不出就按不可信处理），
 * 业务 handler 从来不用它，参数一律是 `unknown`：想当成 string 用就得自己验，验在形状表里。
 */
export type GuardedCall = (event: unknown, ...args: unknown[]) => unknown;
export type IpcRegistrar = (channel: string, fn: GuardedCall) => void;

/** handler 的参数标注形状（`A` 由调用点的实参标注推出来，见 `trustedHandler` 的注释）。 */
type IpcHandlerOf<A extends readonly unknown[]> = (event: unknown, ...args: A) => unknown;
function refuse(channel: string, options: GuardOptions, info: DenyInfo): unknown {
  const deny = options.deny ?? IPC_DENY_REPLIES[channel] ?? null;
  const message = info.kind === "untrusted" ? `被来源闸挡下：${info.message}` : info.message;
  const payload: DenyInfo = { message, kind: info.kind };
  if (deny !== null) return deny(payload);
  throw new Error(message);
}

/**
 * 把一条 handler 包成「先问来源、再问形状、然后才干活」。
 *
 * 单独导出这个（而不是只有 `handleTrusted`）是因为 `index.ts` 里那四条通道得写成
 * `ipcMain.handle(IPC_CHANNELS.x, trustedHandler(...))`——`export-dialog-wiring.test.ts` 钉着字面量，换注册会让那条测试假红。
 */
export function trustedHandler<A extends readonly unknown[]>(
  channel: string,
  fn: IpcHandlerOf<A>,
  options: GuardOptions = {}
): GuardedCall {
  return (event, ...args) => {
    const verdict = senderTrustVerdict(event);
    if (!verdict.trusted) {
      // 这一句必须进主进程日志：渲染层被劫持时，界面上什么都不会发生，只有这里有痕迹。
      console.warn(`[IPC 来源闸] ${channel} ← ${verdict.reason}`);
      return refuse(channel, options, { message: verdict.reason, kind: "untrusted" });
    }
    // 通道级授权：来源可信后再问"这条通道的档位要求满不满足"（真身在 channel-trust.ts）。
    const channelDeny = channelTrustVerdict(channel);
    if (channelDeny !== null) {
      console.warn(`[IPC 通道档] ${channel} ← ${channelDeny}`);
      return refuse(channel, options, { message: channelDeny, kind: "guard" });
    }
    const rules = options.args ?? argRulesFor(channel);
    for (let index = 0; index < rules.length; index += 1) {
      const rule = rules[index];
      if (rule === undefined) continue;
      const problem = rule(args[index], index);
      if (problem !== null) return refuse(channel, options, { message: problem, kind: "arg" });
    }
    // 全仓唯一一处 `as`：args 过了上面那道形状闸才允许按 handler 自己标注的类型递下去。
    // （`trustedHandler` 的泛型只服务于调用点的参数标注，运行时真正拦得住的是 `IPC_ARG_SHAPES`。）
    // 中间那一跳 `unknown` 不是偷懒：`(...args: A)` 与 `(...args: unknown[])` 在
    // `strictFunctionTypes` 下互不相容（参数逆变），直接 `as GuardedCall` 会被判成「转换写错了」。
    const call = () => (fn as unknown as GuardedCall)(event, ...args);
    const checked = options.check?.(args);
    if (checked === null || checked === undefined) return call();
    if (typeof checked === "string") {
      return refuse(channel, options, { message: checked, kind: "check" });
    }
    // realpath 是异步的：Promise 也必须照同一套回话形状挡回去，不能因为「来不及判」就放行。
    return Promise.resolve(checked).then((reason) =>
      reason === null ? call() : refuse(channel, options, { message: reason, kind: "check" })
    );
  };
}

export function handleTrusted<A extends readonly unknown[]>(
  register: IpcRegistrar,
  channel: string,
  fn: IpcHandlerOf<A>,
  options: GuardOptions = {}
): void {
  register(channel, trustedHandler(channel, fn, options));
}

/* ----------------------------------------------------------------------------------------------- */
/* 三、书根 realpath 判定（doc:* 的「只能写这一本书里面」）                                            */
/* ----------------------------------------------------------------------------------------------- */

export interface RealpathFsLike {
  realpath(target: string): Promise<string>;
}

/**
 * `relPath` 解出来的**真实**路径是否仍在 `root` 之内。
 *
 * 为什么 fs-store 那层词法检查不够：`chapters/01.md` 完全可能是个指向
 * `<appData>/plugins/x/index.js` 的软链——逐字形状检查全对，只有 realpath 看得穿。
 * fs-store 里同一条判据有**两份**内部实现（`changes.ts` 的 `isUnder`、`skills.ts` 的内联判法），
 * 但都没导出；本轮不动 `packages/**`（另有并行改动），所以在主进程侧补齐 doc:* 这一层，
 * **不改 fs-store 的导出语义**——它那道词法闸仍在原地继续生效。
 *
 * 目标还不存在（新建文档）时退到最近的已存在父目录判定：否则「新建一章」会被自己的 ENOENT 挡死。
 * 解不出真实路径一律当作不可用（与 fs-store 的 skills/changes 同一口径）。
 */
export async function relPathStaysInsideRoot(
  root: string,
  relPathText: string,
  fsLike: RealpathFsLike = { realpath }
): Promise<boolean> {
  const posix = typeof relPathText === "string" ? relPathText.replaceAll("\\", "/") : "";
  if (posix === "" || posix.startsWith("/")) return false;
  // 带盘符的绝对路径永远不是「书内的相对路径」。
  if (/^[a-zA-Z]:\//.test(posix)) return false;
  const segments = posix.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (segments.length === 0 || segments.some((segment) => segment === "..")) return false;

  let realRoot: string;
  try {
    realRoot = await fsLike.realpath(root);
  } catch {
    return false;
  }

  const joined = path.join(realRoot, ...segments);
  try {
    return isUnderReal(await fsLike.realpath(joined), realRoot);
  } catch {
    // 目标不存在：退到父目录，逐层往上找到第一个解得出来的祖先。
  }
  let current = path.dirname(joined);
  for (;;) {
    try {
      return isUnderReal(await fsLike.realpath(current), realRoot);
    } catch {
      const parent = path.dirname(current);
      // 只在真的走到盘根时才放弃。早先这里还有一条「parent 等于书根 ⇒ 判外」的捷径，
      // 那是错的：书根自己就是最近的已存在祖先（骨架只建 4 个分类目录，其余 8 类的
      // 第一篇文稿连分类目录都还没有），直接判外等于「新书永远建不出第一篇世界观」。
      // 书根在上面已经 realpath 成功，走到它必然返回 isUnderReal(root, root) = true。
      if (parent === current) return false;
      current = parent;
    }
  }
}
