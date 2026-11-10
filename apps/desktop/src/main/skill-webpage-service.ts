import path from "node:path";
import {
  IPC_CHANNELS,
  SKILL_CONTENT_MAX_BYTES,
  SKILL_FILE_NAME,
  composeSkillMd,
  marketTargetDir,
  skillDirNameOf,
  type WebpageSkillResult
} from "@mochen/contracts";
import { mkdir, writeFile, access } from "node:fs/promises";
import { webRead } from "./web-read.js";
import type { WebFetchLike } from "./web-search.js";
import { handleTrusted } from "./ipc-guard.js";

/**
 * 网页转技能的主进程真身（2026-11-10 用户裁定「任意网页当技能」）。
 *
 * 【它解决的是什么】
 * remote 三条装的是「上游本来就是一个技能」（SKILL.md）；这一条装的是
 * 「一篇网页文章，用户想让模型照着它做事」。正文不是技能格式，所以这里
 * 要**转写**：剥成纯文本、补上 name / description、末尾钉一行来源——
 * 装进技能库之后，模型经 use_skill 读到的是「这份做法 + 它出自哪」。
 *
 * 【抓取为什么不自己写】
 * web_read 那一套（URL 闸、超时、大小上限、非 HTML 拒读、错误全中文、
 * htmlToText 剥脚本杂讯）已经是唯一真身，直接复用——这里只做转写与落盘，
 * 不出现第二份「网页能不能抓」的判据。
 *
 * 【写盘三守卫，与市场/兑换码/remote 完全同一条】
 * 1. 只写**全局**技能目录，书目录不碰。
 * 2. 目录名一律过 `skillDirNameOf` + `marketTargetDir`。
 * 3. **绝不覆盖**：同名目录已在就拒——用户改过它是常事。
 *
 * 【正文上限的口径与 remote 不同，为什么】
 * remote 装的是上游原文，超限拒绝（改一个字都算改写）；网页转写本来就是
 * 提炼而非逐字，正文超过技能读取上限时**截到上限内**并在 notice 里如实说
 * 「装的是前段」——比起「转不成」直接把路堵死，装进来前段 + 来源链接更有用。
 * 抓取层 web_read 自带 6000 字上限（truncated 会如实带回来），通常先于 64 KB 触线。
 */
export interface SkillWebpageService {
  convert(url: string): Promise<WebpageSkillResult>;
}

/** 转写正文的后缀行：技能库里读到这段时，模型（和人）都知道出处。 */
function sourceLine(url: string): string {
  return `---\n\n（本技能转写自网页：${url}。正文若被截断，完整内容以这条链接为准。）`;
}

export function createSkillWebpageService(deps: {
  /** 借只读那套的 `dirOf`：`<appData>/skills` 只在一处拼。 */
  dirOf: (source: "global" | "book") => string | null;
  /** 与 web_read 同一个注入口：测试给假 fetch，不打真网。 */
  fetchImpl?: WebFetchLike;
}): SkillWebpageService {
  return {
    async convert(urlInput: string): Promise<WebpageSkillResult> {
      const url = urlInput.trim();
      let page;
      try {
        page = await webRead(url, { fetchImpl: deps.fetchImpl ?? fetch });
      } catch (err) {
        /* WebReadError 的 message 已经是面向人的中文（bad-url / fetch-failed / not-html /
           empty 四类都说清了「换一条试试」），原样带回去；不该把英文技术串透给用户。 */
        return {
          ok: false,
          notice: `转不成：${err instanceof Error ? err.message : String(err)}`,
          dirName: "",
          displayName: "",
          bytes: 0,
          truncated: false,
          sourceUrl: url
        };
      }
      if (page.text === "")
        return {
          ok: false,
          notice: "这一页剥不出正文，转不成技能。",
          dirName: "",
          displayName: "",
          bytes: 0,
          truncated: false,
          sourceUrl: page.url
        };

      const displayName = page.title;
      const dirName = skillDirNameOf(displayName);
      const description =
        page.text.replace(/\s+/g, " ").slice(0, 100) + (page.text.length > 100 ? "…" : "");
      const body = `${page.text}\n\n${sourceLine(page.url)}`;
      const skillMd = composeSkillMd({
        displayName,
        description,
        stages: [],
        appliesTo: [],
        body
      });

      const root = deps.dirOf("global");
      if (root === null)
        return {
          ok: false,
          notice: "转不成：全局技能目录还没配好。",
          dirName,
          displayName,
          bytes: 0,
          truncated: page.truncated,
          sourceUrl: page.url
        };
      const dir = marketTargetDir(root, dirName);
      if (dir === null)
        return {
          ok: false,
          notice: `转不成《${displayName}》：生成的目录名不合法。`,
          dirName,
          displayName,
          bytes: 0,
          truncated: page.truncated,
          sourceUrl: page.url
        };

      const bytes = Buffer.byteLength(skillMd, "utf8");
      if (bytes > SKILL_CONTENT_MAX_BYTES) {
        /* 理论上很难到（web_read 已把正文压在 6000 字内），但标题超长或正文超限时
           仍然会走到这里——如实拒绝比装一份读不全的强，这条路留给极端情况。 */
        return {
          ok: false,
          notice: `转出来的正文 ${Math.round(bytes / 1024)} KB，超过技能读取上限 ${Math.round(SKILL_CONTENT_MAX_BYTES / 1024)} KB，先不装。`,
          dirName,
          displayName,
          bytes,
          truncated: page.truncated,
          sourceUrl: page.url
        };
      }

      /* 绝不覆盖（守卫 ③）：同名目录里已有 SKILL.md 就拒——可能是上一回转的，也可能是用户改过的。 */
      try {
        await access(path.join(dir, SKILL_FILE_NAME));
        return {
          ok: false,
          notice: `《${displayName}》已经转过了（同名目录 ${dirName}），没有覆盖你已有的那份。想重转先删掉它。`,
          dirName,
          displayName,
          bytes,
          truncated: page.truncated,
          sourceUrl: page.url
        };
      } catch {
        // 不存在 → 下面落盘。
      }

      try {
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, SKILL_FILE_NAME), skillMd, "utf8");
      } catch (err) {
        return {
          ok: false,
          notice: `转不成《${displayName}》：${err instanceof Error ? err.message : String(err)}`,
          dirName,
          displayName,
          bytes,
          truncated: page.truncated,
          sourceUrl: page.url
        };
      }
      return {
        ok: true,
        notice:
          `转好了《${displayName}》（${dirName}${page.truncated ? "，正文过长只取了前段" : ""}）。` +
          "列表里点「挂入」才进这一轮上下文；打开自动技能的话，它会自己按需挂上。",
        dirName,
        displayName,
        bytes,
        truncated: page.truncated,
        sourceUrl: page.url
      };
    }
  };
}

/** 一条通道。渲染层只递一个网页 URL——抓什么、叫什么、写到哪全由主进程判。 */
export function registerSkillWebpageIpc(
  handle: (channel: string, fn: (...args: unknown[]) => unknown) => void,
  webpage: SkillWebpageService
): void {
  handleTrusted(handle, IPC_CHANNELS.skillsWebpageConvert, (_event, url) =>
    webpage.convert(String(url))
  );
}
