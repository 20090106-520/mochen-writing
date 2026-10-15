import { z } from "zod";

/**
 * WebDAV 远程备份的契约（2026-10-15）。
 *
 * 【为什么是契约层】
 * 与 `book-backup` 同一条铁律的延伸：远程备份是把**已经做好的本地整书备份**
 * （`<书>/.mochen/backups/book-<时间戳>/`）推一份到用户自己配的 WebDAV 服务器——
 * 备份本体不在这一层，远程这条通路**只是字节搬运**。
 * 渲染层只递配置草稿与档位，主进程按当前书的 meta.id 拼远程子目录——
 * 与 `market:install` / `plugins:toggle` / `book-backup:create` 同一条铁律：
 * 渲染层递不出任意远程 URL 或绝对路径，也就递不出去任意书。
 *
 * 【pull 为什么不在这一刀】
 * `push + list + verify` 这三条已经构成一条可证伪的备份通路（推、看到、自检）；
 * pull 是 `restoreBookBackup` 的远程镜像（MKCOL 书旁新目录 → 递归 GET），
 * 与本地 restore 同一条「绝不盖写已有内容」的口径，但 GET 整份的字节量是 PUT 的反向，
 * 单刀做完五条通道加单测加变异再加门禁，反而会拖到失败边界。这一刀做 5 条，pull 留下一刀。
 *
 * 【为什么 url 要 https，但 schema 不强约束】
 * `provider-fetch.ts` 的 `assertUpstreamUrlAllowed` 把「明文 http 出网」判死，
 * 理由是「API Key 与全文都走这一个地址」。WebDAV 配的是用户自己的 NAS，
 * 同一条铁律：只放行 https，本机回环的 http 例外（坚果云、Nextcloud 不在本机回环）。
 * 但 schema 收紧会让旧配置读不进来——这条先例在 `provider-fetch` 那段注释里钉死，
 * 这里照抄：schema 接收任意 URL，**真正出网那一刀**才判 https。
 */
export const WebdavConfigSchema = z.object({
  /** 远程仓库根 URL，如 `https://nas.local/dav/`。路径拼法与归一由主进程 webdav-client 决定。 */
  url: z.string().trim().min(1),
  /** 用户名。空串与配置一同视为「未配置」——空 username 在 Basic Auth 下毫无意义。 */
  username: z.string().trim().min(1)
});
export type WebdavConfig = z.infer<typeof WebdavConfigSchema>;

/**
 * 渲染层递的配置草稿。
 *
 * `password` 的三态刻意做出区分，与 `provider-save` 那条 `apiKey null = 保留、"" = 清空` 同口径：
 *   - `undefined`：保留现有密码（用户只改了 url / username）；
 *   - `""`：明确清空（用户删了密码那一栏）；
 *   - 非空：替换为新值。
 * 没有第四种「password 是 null」——`exactOptionalPropertyTypes` 下 `string | undefined` 不接 null。
 */
export interface WebdavConfigInput {
  url: string;
  username: string;
  password?: string;
}

/**
 * 主进程递回的配置快照。
 *
 * 【为什么 password 不回来】
 * 密钥走 `credential-store`（ref = `WEBDAV_CRED_REF`），加密分份存；渲染层只需要知道
 * 「有没有配过密码」来决定设置页那一栏是显示「已保存」还是要让用户填——
 * 把明文递回渲染层等于把已经加密存好的密钥再走一遍 IPC 暴露在结构化克隆与渲染进程内存里。
 */
export interface WebdavConfigSnapshot {
  persisted: boolean;
  url: string;
  username: string;
  hasPassword: boolean;
}

/**
 * `webdav:verify` 的返回：**只回答「现在连不连得上」**，不决定能不能存
 * （与 `provider:verify` 同一档口径，不是 `provider:save` 那条硬校验）。
 *
 * 五档如实分报：
 *   - `ok`：MKCOL 一个临时探活目录成功（随后立即 DELETE）；
 *   - `no-config`：没配过 url / username；
 *   - `auth-failed`：401 / 403——凭据不对；
 *   - `forbidden`：403 但不是凭据问题（如服务端只读）——分出来让用户知道是「连得上但不许写」；
 *   - `io-error`：网络/解析/PROPFIND 失败；
 *   - `no-book`：没开书时不做 verify（虽然 verify 不严格依赖书，但渲染层入口要求先开书，
 *     与 `book-backup` 同款）。
 */
export type WebdavVerifyResult =
  | { ok: true; server: string }
  | {
      ok: false;
      reason: "no-config" | "no-book" | "auth-failed" | "forbidden" | "io-error";
      message: string;
    };

/**
 * 远程备份里的一条：`name` 是远程目录名（沿用本地备份的 `book-yyyy-MM-dd-…` 形状），
 * `createdAt` 是从名字里解出的人话时间（与 `BookBackupEntry` 同一份 `backupCreatedAtLabel`）。
 */
export interface WebdavRemoteEntry {
  name: string;
  createdAt: string;
}

/**
 * `webdav:push` 的返回。
 *
 * `name: null` **不是**这一刀的合法结果（push 永远真做一份新备份再推——与 daily 档无关）；
 * 留出 `null` 是与 `BookBackupCreateResult` 形状一致的注释位，将来若加 daily 推送再用。
 */
export type WebdavPushResult =
  | { ok: true; name: string; fileCount: number; pushedFiles: number }
  | {
      ok: false;
      reason: "no-config" | "no-book" | "local-backup-failed" | "auth-failed" | "io-error";
      message: string;
    };

/** `webdav:list` 的返回：远程这本书已有的备份时间戳列表（新的在前）。 */
export type WebdavListResult =
  | { ok: true; entries: WebdavRemoteEntry[] }
  | {
      ok: false;
      reason: "no-config" | "no-book" | "auth-failed" | "forbidden" | "io-error";
      message: string;
    };
