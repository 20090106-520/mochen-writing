/**
 * 技能兑换码（离线自包含）：一段码里就带着技能本身，谁拿到都能在本机兑出同一个技能。
 *
 * 为什么不做后端校验：本仓没有服务器，能兑换出什么的唯一依据只能是码里那一份字节。
 * 于是这里的校验码**不是**防伪造签名——算法公开、任何人都能重算，它只挡
 * 「抄漏一个字符 / 手改了一位」这类人祸。真正的边界是 decodeSkillRedeemCode 的
 * 字段形状守卫：目录名、各字段长度、正文上限一条都不少，否则一份能写盘的码
 * 就等于给了渲染层往全局技能目录里塞任意字节的路子。
 *
 * 为什么不用 Node Buffer：contracts 要同时跑在主进程（node）与渲染层（Chromium）。
 * btoa/atob 两边都只认 Latin-1，直接喂 UTF-8 的中文会炸；所以 base64url 自己实现，
 * TextEncoder/TextDecoder 负责 UTF-8 ↔ 字节，两边共用同一份判据（铁律 6）。
 */
import { MARKET_DIR_NAME_RE } from "./market.js";
import { SKILL_CONTENT_MAX_BYTES } from "./skill.js";

export const SKILL_REDEEM_PREFIX = "MOCHEN-SKILL-";
/** 兑换码整串的长度上限：先挡超长再解，免得一段没完没了的字符走进 base64/JSON。 */
export const SKILL_REDEEM_MAX_CHARS = 96000;

export interface SkillRedeemPayload {
  /** 目录名，必须过 marketTargetDir 的同款守卫（拼绝对路径前的安全线）。 */
  dirName: string;
  /** 上屏用的中文名，1..60 字。 */
  displayName: string;
  /** 一句话说明，1..240 字。 */
  description: string;
  /** SKILL.md 全文，1..64KB（字节口径复用 SKILL_CONTENT_MAX_BYTES）。 */
  skillMd: string;
}

export interface SkillRedeemResult {
  ok: boolean;
  /** 成功/失败都给一句中文，直接上屏；渲染层不自己编理由。 */
  notice: string;
  /** 成功时回填，失败时空串。 */
  dirName: string;
  /** 成功时回填，失败时空串。 */
  displayName: string;
}

/** base64url 的 64 个码字：与标准 base64 的差别只在末两个（+/ → -_），且不带 '=' 补位。 */
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** charAt 越界得到空串，而 indexOf("") 会误返回 0，所以显式把空串判成 -1。 */
function b64Val(body: string, index: number): number {
  const char = body.charAt(index);
  return char === "" ? -1 : B64.indexOf(char);
}

/** UTF-8 字节 → 无补位的 base64url：逐 3 字节一组，尾部不足只发该发的那几位。 */
function utf8ToBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64.charAt(b0 >> 2);
    out += B64.charAt(((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4));
    if (b1 === undefined) break;
    out += B64.charAt(((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6));
    if (b2 === undefined) break;
    out += B64.charAt(b2 & 0x3f);
  }
  return out;
}

/** base64url → UTF-8 文本：非法字符/半成品尾段/坏字节一律返回 null，绝不递半个字出去。 */
function base64UrlToUtf8(body: string): string | null {
  if (body.length === 0 || !/^[A-Za-z0-9_-]+$/.test(body)) return null;
  try {
    const bytes: number[] = [];
    for (let i = 0; i < body.length; i += 4) {
      const v0 = b64Val(body, i);
      const v1 = b64Val(body, i + 1);
      const v2 = b64Val(body, i + 2);
      const v3 = b64Val(body, i + 3);
      // 一组至少两个字符；长度 ≡ 1 (mod 4) 的尾巴解不出一个完整字节，一并拒。
      if (v0 < 0 || v1 < 0 || (v2 < 0 && v3 >= 0)) return null;
      bytes.push((v0 << 2) | (v1 >> 4));
      if (v2 >= 0) bytes.push(((v1 & 0x0f) << 4) | (v2 >> 2));
      if (v3 >= 0) bytes.push(((v2 & 0x03) << 6) | v3);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return null;
  }
}

/**
 * FNV-1a 32 位 → 36 进制，固定取末 4 位小写。公开算法，只求「同一 body 永远同一结果」，
 * 不充当密钥；取末 4 位是为了让校验段恒为 4 字符，解码才能按最后一个 '-' 稳定切开。
 */
export function redeemCodeChecksum(body: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < body.length; i += 1) {
    hash ^= body.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(4, "0").slice(-4).toLowerCase();
}

/** 把一份 SKILL.md 打包成完整码（生成端，纯函数：编码本身不判形状，判形状在解码端）。 */
export function encodeSkillRedeemCode(payload: SkillRedeemPayload): string {
  const body = utf8ToBase64Url(JSON.stringify(payload));
  return `${SKILL_REDEEM_PREFIX}${body}-${redeemCodeChecksum(body)}`;
}

/** 解出来的对象逐字段合法才算数：类型、目录名守卫、各字段长度、正文字节上限，一条都不少。 */
function shapeOk(value: unknown): value is SkillRedeemPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const { dirName, displayName, description, skillMd } = v;
  if (typeof dirName !== "string" || !MARKET_DIR_NAME_RE.test(dirName)) return false;
  if (typeof displayName !== "string" || displayName.length < 1 || displayName.length > 60)
    return false;
  if (typeof description !== "string" || description.length < 1 || description.length > 240)
    return false;
  if (typeof skillMd !== "string" || skillMd.length < 1) return false;
  // 64KB 说的是**字节**（与 SKILL_CONTENT_MAX_BYTES 同口径），中文按 UTF-8 计多字节。
  if (new TextEncoder().encode(skillMd).byteLength > SKILL_CONTENT_MAX_BYTES) return false;
  return true;
}

/**
 * 解码：前缀 / 长度 / 4 位校验 / base64url / JSON / 字段形状，逐关过，任一不过返回 null。
 * 全程 try/catch 兜底——兑换码来自人手粘贴，绝不能让一段坏串在主进程或渲染层抛异常。
 */
export function decodeSkillRedeemCode(code: string): SkillRedeemPayload | null {
  try {
    if (!code.startsWith(SKILL_REDEEM_PREFIX)) return null;
    if (code.length > SKILL_REDEEM_MAX_CHARS) return null;
    const tail = code.slice(SKILL_REDEEM_PREFIX.length);
    // body 自身可能含 '-'（base64url 的码字），所以按最后一个 '-' 切出校验段。
    const lastDash = tail.lastIndexOf("-");
    if (lastDash < 1) return null; // body 至少 1 字符，且必须有一个分隔校验段的 '-'
    const body = tail.slice(0, lastDash);
    const checksum = tail.slice(lastDash + 1);
    if (checksum.length !== 4 || redeemCodeChecksum(body) !== checksum) return null;
    const text = base64UrlToUtf8(body);
    if (text === null) return null;
    const payload: unknown = JSON.parse(text);
    return shapeOk(payload) ? payload : null;
  } catch {
    return null;
  }
}
