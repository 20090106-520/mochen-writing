/**
 * 内置写作插件（2026-10-07 批次 5-㉙；5-㊱ 加了第三个：roster）。
 *
 * 【为什么 5-㊱ 要再加一个，而用户说的是「插件太少，去网上找」】
 * 网上能找到的是别人写的**技能**（SKILL.md），没有哪一个开源仓库会写本仓的插件格式
 * （一个目录 + 一份 client.js + 走 Cordis 兼容内核）。所以「从网上收插件」这条路眼下**不成立**，
 * 能收的只有技能——那一半在 skill-catalog-manifest.ts 与 skill-catalog-data/ 里，如今 24 条。
 * 插件这一半能做的，是把用户确实缺的那几件事补成内置插件。
 * 补的判据是**模型自己做不到、而插件能把全书过一遍**的那类活：
 * rhythm 量节奏、outline 列骨架、roster 数出场。
 * roster 补的是 5-㊱ 那一批技能反复提到、而模型又看不见的那件事：谁很久没出场了。
 *
 * 【这些不是「写死在主进程里的功能」】
 * 它们是**真正的插件源码**：按 DeepSeek Harness 官方文档的写法写成 JS 字符串，
 * 启动时落到 `<appData>/plugins/<名字>/client.js`，再走**与用户插件完全同一条路**
 * （import 改写 → 内核挂载 → 工具叠加）。因此它们同时是两样东西：
 * 用户开箱就有的写作能力，以及「按官方写法写的插件真能跑」的活证明。
 * 若哪天兼容层坏了，内置插件会跟着一起坏——这正是我们要的：兼容层不许悄悄退化。
 *
 * 【为什么是「落盘再装」而不是直接在内存里 mount】
 * 内存里 mount 会留一条**只在测试里走**的旁路，而旁路是不受守卫覆盖的：
 * 用户插件走改写、内置插件不走，那么「改写对不对」这件事只由用户的插件来承担。
 * 统一走落盘，内置插件就成了每天开机都在跑的回归测试。
 *
 * 【为什么它们值得存在，而不是「模型自己也能量」】
 * `read_doc` 一章就是 6000 字进上下文。整本书的节奏、章节骨架这种活，
 * 让模型自己读十几万字去数段落，既慢又贵还容易算错。
 * 插件在**插件这一侧**把全书过一遍，只把汇总结论（几百字）交回模型——
 * 这才是这套 API 存在的意义，也是官方那句「插件能挂到 ctx 上」的实际价值。
 *
 * 【不写死任何一条产品判定】
 * 段落怎么切、对白怎么认，都在这一份源码里，且**只有这一份**：
 * 同一个口径不许在两处各算一次（铁律 6），所以它们没有被搬进任何共享模块。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface BuiltinPlugin {
  /** 落盘目录名（也是 `mountAll` 看到的安装名）。 */
  dir: string;
  /**
   * 内置版本号。**变插件源码就要变它**。
   *
   * 【为什么需要它，以及为什么它不是「每次都覆盖」】
   * 上一版的规矩是「目录已在就不碰」，它护住了用户对 `rhythm/client.js` 的修改，
   * 代价是**已有的安装永远拿不到内置插件的修复**——实测就是这样：
   * 修好「开头第一句取到了 Markdown 标题」之后，磁盘上那份仍旧是旧的，
   * 真机怎么重开都跑的是坏的那版。
   *
   * 于是改成：目录里放一个 `.mochen-builtin.json` 记着当时种下的版本。
   * 盘上版本**等于**内置版本 ⇒ 用户的，没碰；盘上版本**低于**内置版本 ⇒
   * 是我们旧的没跟上覆盖，而**覆盖前先看一眼用户改没改**：
   * 内容与上一版发布的逐字相同才盖；用户改过就只升版本号、不动内容。
   *
   * ⇒ 用户改过的永远不会被改回去（规矩没变小），而没改过的能拿到修复。
   */
  version: number;
  /** 插件源码本身。按官方文档写，装的时候照用户插件那样改写 import。 */
  source: string;
}

/** 内置插件目录里那个版本戳的文件名。 */
export const VERSION_STAMP = ".mochen-builtin.json";

/** 内置插件清单。顺序即挂载顺序——工具重名时报错会指到前一个，所以别在这里排同名。 */
export const BUILTIN_PLUGINS: readonly BuiltinPlugin[] = [
  {
    dir: "rhythm",
    // v2：加上「某一篇读不到时点名并声明数字不含它」（静默跳过却装作量了全书，比报错更坏）。
    //   v1：初版。
    version: 2,
    source: `// 墨宸内置插件：全书节奏体检。
// 与用户插件同款写法（import 改写 + ctx.tools + ctx.get）。
import { defineTool } from "@deepseek-ai/cordis";

export const name = "rhythm";
export const inject = ["tools", "docs"];

/** 空白与标点都不算「字」——中文小说的节奏看的是实词，不是格子数。 */
function proseChars(text) {
  return text.replace(/\\s+/g, "").length;
}

/** 一段 = 空行分隔的块。 */
function paragraphsOf(text) {
  return text
    .split(/\\n\\s*\\n/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
}

/** 对白：中文小说里成对出现的引号，以及破折号引出的台词。 */
function dialogueChars(text) {
  const quoted = text.match(/[“"][^”"]*[”"]/g) || [];
  const corner = text.match(/「[^」]*」/g) || [];
  return [...quoted, ...corner].reduce((sum, one) => sum + proseChars(one), 0);
}

export function apply(ctx) {
  const docs = ctx.get("docs");

  ctx.tools.register(
    defineTool({
      name: "rhythm_check",
      description:
        "量一本书（或某一章）的写作节奏：字数、段落数、平均段长、最长段、对白占比。" +
        "不传 doc 就量全书。用于判断「这段是不是太密/太碎/对白太少」这类问题。",
      parameters: {
        type: "object",
        properties: {
          doc: {
            type: "string",
            description: "书内相对路径（如 chapters/01.md）。留空则量全书。"
          }
        }
      },
      async execute(args) {
        const title = docs.bookTitle();
        if (title === null) {
          return { ok: true, text: "还没打开作品，量不了节奏。" };
        }
        const wanted = String(args.doc ?? "").trim();
        // 全书与单章走**同一条**统计口径：都是先拿到一篇篇正文，再算。
        // 早先写成两套（单章直接数、全书循环数），于是两边的「平均段长」口径悄悄差了一点，
        // 而模型会把两个数放在一起比较。
        const targets = wanted === "" ? docs.list() : [{ relPath: wanted, title: "", kind: "" }];
        if (targets.length === 0) {
          return { ok: true, text: "这本书还没有文稿。" };
        }

        let chars = 0;
        let paragraphs = 0;
        let dialogue = 0;
        let longest = 0;
        let longestOf = "";
        const unread = [];
        for (const one of targets) {
          const body = await docs.read(one.relPath);
          // 读不到的那篇要**说出来**：跳过它却不提，结论就会显得覆盖了全书，
          // 而实际少算了一篇——那是比报错更坏的一种撒谎。
          if (body === null) {
            unread.push(one.relPath);
            continue;
          }
          const paras = paragraphsOf(body);
          chars += proseChars(body);
          paragraphs += paras.length;
          dialogue += dialogueChars(body);
          for (const para of paras) {
            const size = proseChars(para);
            if (size > longest) {
              longest = size;
              longestOf = one.relPath;
            }
          }
        }

        if (chars === 0) {
          return {
            ok: true,
            text: unread.length > 0 ? \`没读到任何文稿：\${unread.join("、")}。\` : "这几篇里没有正文。"
          };
        }

        const average = paragraphs > 0 ? Math.round(chars / paragraphs) : 0;
        const ratio = Math.round((dialogue / chars) * 100);
        const scope = wanted === "" ? \`全书《\${title}》\` : \`《\${title}》的 \${wanted}\`;
        const lines = [
          \`\${scope}：\${chars} 字，\${paragraphs} 段\`,
          \`平均段长 \${average} 字，最长段 \${longest} 字（\${longestOf || "无"}）\`,
          \`对白约占 \${ratio}%\`
        ];
        if (unread.length > 0) {
          lines.push(\`注意：\${unread.length} 篇没读到（\${unread.join("、")}），以上数字不含它们。\`);
        }
        return { ok: true, text: lines.join("\\n") };
      }
    })
  );
}
`
  },
  {
    dir: "outline",
    // v2：剥掉 frontmatter 与 Markdown 标题行再取「开头第一句」——
    //   真机实测第一版的回执是「47 字：# 第一章 潮汛」，而标题已经单列成一栏了。
    //   v1：初版。
    version: 2,
    source: `// 墨宸内置插件：全书骨架速览。
import { defineTool } from "@deepseek-ai/cordis";

export const name = "outline";
export const inject = ["tools", "docs"];

function proseChars(text) {
  return text.replace(/\\s+/g, "").length;
}

/** 剥掉 YAML frontmatter 与开头的 Markdown 标题行——它们都不是正文。 */
function stripFrontmatter(text) {
  const noFm = text.startsWith("---\\n")
    ? text.slice(text.indexOf("\\n---", 3) + 4)
    : text;
  return noFm.replace(/^#{1,6}[^\\n]*\\n?/, "");
}

export function apply(ctx) {
  const docs = ctx.get("docs");

  ctx.tools.register(
    defineTool({
      name: "book_outline",
      description:
        "列出全书每一章的标题、字数与开头第一句，并指出明显偏短/偏长的章节。" +
        "用于开写前扫一眼结构、改完中段检查节奏是否失衡。",
      parameters: { type: "object", properties: {} },
      async execute() {
        const title = docs.bookTitle();
        if (title === null) {
          return { ok: true, text: "还没打开作品，看不了骨架。" };
        }
        const all = docs.list();
        if (all.length === 0) {
          return { ok: true, text: "这本书还没有文稿。" };
        }

        const rows = [];
        const unread = [];
        for (const one of all) {
          const body = await docs.read(one.relPath);
          if (body === null) {
            unread.push(one.relPath);
            continue;
          }
          const chars = proseChars(body);
          // 开头第一句：取第一段里第一个句号/问号/叹号为止。
          // 切不出标点就退回整段的前 30 字——空着比给个半截更没用。
          //
          // 【为什么先剥 frontmatter 与标题行】
          // 实测（真机 5-㉙ 第一版）：书里的第一段几乎总是 Markdown 标题行
          // （# 第一章 潮汛），于是「开头第一句」永远是那个标题——而标题已经单列成一栏了，
          // 这一栏白给。frontmatter 与标题都不是正文，要剥掉才轮得到真正的第一句。
          // 真机那次回执是「47 字：# 第一章 潮汛」，一眼看过去就知道这一栏没在干活。
          //
          // 【这一段注释里不许出现反引号】整份插件源码在一个 TS 模板字面量里，
          // 注释中的反引号会**提前结束那个字面量**，报错报在无关的行上（5-㉘ 同款）。
          const body2 = stripFrontmatter(body);
          const first =
            body2
              .split(/\\n\\s*\\n/)
              .map((p) => p.trim())
              .find((p) => p !== "") ?? "";
          const cut = first.search(/[。！？…]/);
          const opening = (cut > 0 ? first.slice(0, cut + 1) : first.slice(0, 30)).replace(/\\s+/g, " ");
          rows.push({ relPath: one.relPath, title: one.title, chars, opening });
        }

        if (rows.length === 0) {
          return { ok: true, text: \`没读到任何文稿：\${unread.join("、")}。\` };
        }

        // 平均值用**读到的**那些篇算：拿没读到的篇数摊薄平均，算出来的「正常章长」是假的。
        const average = Math.round(rows.reduce((sum, r) => sum + r.chars, 0) / rows.length);
        const lines = [\`《\${title}》共 \${rows.length} 篇，平均 \${average} 字：\`];
        for (const row of rows) {
          lines.push(\`- \${row.relPath} · \${row.title} · \${row.chars} 字：\${row.opening}\`);
        }
        // 只点出明显离群的，别把每一章都评一遍——那不是速览，是噪音。
        const short = rows.filter((r) => r.chars < average * 0.4);
        const long = rows.filter((r) => r.chars > average * 2);
        if (short.length > 0) {
          lines.push(\`偏短（不到平均的四成）：\${short.map((r) => r.relPath).join("、")}。\`);
        }
        if (long.length > 0) {
          lines.push(\`偏长（超过平均的两倍）：\${long.map((r) => r.relPath).join("、")}。\`);
        }
        if (unread.length > 0) {
          lines.push(\`注意：\${unread.length} 篇没读到（\${unread.join("、")}），以上不含它们。\`);
        }
        return { ok: true, text: lines.join("\\n") };
      }
    })
  );
}
`
  },
  {
    dir: "roster",
    // v1：初版。扫人物 / 势力 / 地图 / 专有名词四类档案，数每个名字在章节正文里出现几次、
    //      最后一次出现在哪一章，并把「有档案但全书没出现过」的点出来。
    version: 1,
    source: `// 墨宸内置插件：出场表——谁很久没出场了。
// 长篇写到几十章之后，人物是不是还活着，模型自己判断不了：它只看得到当前这一章。
// 这一份把全书正文过一遍，只把「谁在第几章出现过」交回模型。
import { defineTool } from "@deepseek-ai/cordis";

export const name = "roster";
export const inject = ["tools", "docs"];

// 花名册从这四个目录长出来：每一篇的标题就是一个名字。
// 【按目录而不是按 kind 判】kind 是主进程给的类别标签，而 relPath 是文件事实；
// 判文件事实不会因为某一本书的 kind 填错就整份列空。
const ROSTER_DIRS = [
  ["characters/", "人物"],
  ["factions/", "势力组织"],
  ["locations/", "地图"],
  ["glossary/", "专有名词"]
];

// 一个字的标题不扫：它在正文里到处撞上，数出来的次数没有意义。
const MIN_NAME = 2;

/** 这个名字在章节正文里出现几次，以及最后一次出现在第几篇（从 0 数）。 */
function scan(bodies, name) {
  let count = 0;
  let lastAt = -1;
  for (let i = 0; i < bodies.length; i += 1) {
    const text = bodies[i];
    if (text === null) continue;
    let at = text.indexOf(name);
    let inThis = false;
    while (at !== -1) {
      count += 1;
      inThis = true;
      at = text.indexOf(name, at + name.length);
    }
    // 【逐篇单独判，不能拿累计的 count 去判】写成 if (count > 0 && lastAt < i) 的话，
    // 名字只出现在第 1、3 章时，第 2 章也会把 lastAt 推到 2 ——
    // 回执会说「最后出现在第 3 章」而数字指向第 2 章，两处自己就对不上。
    if (inThis) lastAt = i;
  }
  return { count, lastAt };
}

export function apply(ctx) {
  const docs = ctx.get("docs");

  ctx.tools.register(
    defineTool({
      name: "book_cast",
      description:
        "列出这本书的人物 / 势力组织 / 地图 / 专有名词，并数清每个名字在章节正文里出现过几次、" +
        "最后一次出现在哪一章，同时点出「有档案但全书一次也没出现」的那些。" +
        "用于开新卷前扫一眼谁被落下了。名字是子串匹配，同名相近的人会互相沾一点。",
      parameters: { type: "object", properties: {} },
      async execute() {
        const title = docs.bookTitle();
        if (title === null) {
          return { ok: true, text: "还没打开作品，列不了出场表。" };
        }
        const all = docs.list();
        const chapters = all.filter((one) => one.relPath.startsWith("chapters/"));
        if (chapters.length === 0) {
          return { ok: true, text: "这本书还没有章节，出场表要拿章节正文来数。" };
        }

        const bodies = [];
        const unread = [];
        for (const one of chapters) {
          const body = await docs.read(one.relPath);
          bodies.push(body);
          if (body === null) unread.push(one.relPath);
        }

        const lines = [];
        const missing = [];
        const tooShort = [];
        let total = 0;
        // 花名册上**一共有多少个名字**，与「扫出来几个」分开记。
        // 合成一个数的话，「档案都建了但正文里一个都没出现」会掉进「没有花名册」那一档，
        // 而那两件事要给的建议正好相反。
        let rosterCount = 0;

        for (const [prefix, label] of ROSTER_DIRS) {
          const entries = [];
          for (const doc of all) {
            if (!doc.relPath.startsWith(prefix)) continue;
            rosterCount += 1;
            const name = doc.title.trim();
            if (name.length < MIN_NAME) {
              tooShort.push(label + "「" + name + "」");
              continue;
            }
            const hit = scan(bodies, name);
            if (hit.count === 0) {
              missing.push(label + "「" + name + "」");
              continue;
            }
            entries.push({ name, lastAt: hit.lastAt, count: hit.count });
          }
          if (entries.length === 0) continue;
          // 按**最后一次出现的位置**排，且必须用序号而不是路径字符串：
          // chapters/2.md 按字符串排在 chapters/10.md 后面，而那是错的。
          entries.sort((a, b) => a.lastAt - b.lastAt);
          total += entries.length;
          lines.push("\\n【" + label + "】" + entries.length + " 人");
          for (const one of entries) {
            lines.push(
              "- " + one.name + " · 最后 " + chapters[one.lastAt].relPath + " · 共 " + one.count + " 次"
            );
          }
        }

        if (rosterCount === 0) {
          return {
            ok: true,
            text:
              "这本书还没有人物 / 势力组织 / 地图 / 专有名词这几类档案，列不出花名册。" +
              "把它们建在 characters、factions、locations、glossary 四个目录下再问一次。"
          };
        }

        lines.unshift(
          total === 0
            ? \`《\${title}》出场表：花名册上有 \${rosterCount} 个名字，正文里一次都没出现过：\`
            : \`《\${title}》出场表：\${chapters.length} 章里数出来的，共 \${total} 人/物：\`
        );
        if (missing.length > 0) {
          lines.push(\`\\n有档案但全书正文一次也没出现：\${missing.join("、")}。\`);
        }
        if (tooShort.length > 0) {
          lines.push(\`名字太短没扫：\${tooShort.join("、")}（一个字的标题在正文里到处撞上）。\`);
        }
        if (unread.length > 0) {
          lines.push(\`注意：\${unread.length} 章没读到（\${unread.join("、")}），以上不含它们。\`);
        }
        return { ok: true, text: lines.join("\\n") };
      }
    })
  );
}
`
  }
];

/**
 * 把内置插件种到插件目录里，并在**版本落后且用户没改过**时升级它。
 *
 * 【三种情形，一个都不许含糊】
 * ① 目录不在 → 种下去。
 * ② 目录在、版本号相同 → 不动。
 * ③ 目录在、版本号落后：
 *    - 盘上的 client.js 与**当前这份源码**逐字相同 ⇒ 它只是没跟上，盖上去。
 *    - 不相同 ⇒ 用户改过。**只升版本号，绝不动内容**。
 *
 * 【第③条为什么不反过来：只要有差异就当作用户的】
 * 那样「用户改过」与「我们改过」分不开——而两者都表现为「内容与内置不一致」。
 * 于是修复永远发不到那些**一行没改**的安装上。
 * 这不是假设：v1「目录已在就不碰」这条规矩真机上就是这么表现的——
 * 修好「开头第一句取到了 Markdown 标题」之后，磁盘上那份仍旧是旧的，
 * 重开多少次都跑的是坏的那版。真机当时是靠 `--user-data-dir` 绕过去的，
 * 而那个开关**不影响** `app.getPath("appData")`，绕不过去。
 *
 * 【这条规则对用户的保证没有变小】
 * 用户改过的文件，任何时候都不会被应用改回去。要恢复出厂：删掉那个插件目录，
 * 下次启动重新种一遍——用户自己能走通的路。
 *
 * 【为什么不放进书的目录】
 * 与技能市场同一条铁律：全局能力只落全局目录。往书目录里塞东西会让「这本书带走后
 * 还带不走这个能力」这件事变得含糊，而插件本来就与哪本书无关。
 */
export function seedBuiltinPlugins(pluginsDir: string): string[] {
  const planted: string[] = [];
  for (const plugin of BUILTIN_PLUGINS) {
    const dir = join(pluginsDir, plugin.dir);
    const clientPath = join(dir, "client.js");
    const stampPath = join(dir, VERSION_STAMP);
    try {
      if (!existsSync(dir)) {
        writeBoth(clientPath, stampPath, plugin.source, plugin.version);
        planted.push(plugin.dir);
        continue;
      }
      const onDiskVersion = readVersion(stampPath);
      // 没有版本戳 ⇒ v1 时代种下的（或用户从别处拷了个同名目录）。一律当 0：
      // 于是它会被检查一次是否被改过，改过就不碰。
      if (onDiskVersion >= plugin.version) continue;
      const current = existsSync(clientPath) ? readFileSync(clientPath, "utf8") : null;
      if (current !== null && current !== plugin.source) {
        // 用户改过：只把版本号提上去，好让下一个版本还能正确认出「这是用户的」。
        writeFileSync(stampPath, JSON.stringify({ version: plugin.version }), "utf8");
        console.warn(
          `[插件] 内置插件 ${plugin.dir} 有你自己的修改（盘上版本 ${onDiskVersion}），` +
            `已原样保留，没有升级到 ${plugin.version}。`
        );
        continue;
      }
      // 与内置逐字相同 ⇒ 没被改过，盖上去拿修复。
      writeBoth(clientPath, stampPath, plugin.source, plugin.version);
      planted.push(plugin.dir);
    } catch (err) {
      // 写不进去（权限/磁盘满）不能连累启动：插件是增强，不是必需品。
      console.warn(
        `[插件] 内置插件 ${plugin.dir} 没能就位：${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  return planted;
}

function writeBoth(clientPath: string, stampPath: string, source: string, version: number): void {
  mkdirSync(dirname(clientPath), { recursive: true });
  writeFileSync(clientPath, source, "utf8");
  writeFileSync(stampPath, JSON.stringify({ version }), "utf8");
}

/**
 * 读版本戳；读不到或坏了都当 0。
 *
 * 【为什么宁可低不可高】把它当成「用户改过」是保守方向（不覆盖），
 * 而当成「没改过」会盖掉用户的编辑。高了要出事，低了只是多问一句。
 */
function readVersion(stampPath: string): number {
  try {
    const parsed = JSON.parse(readFileSync(stampPath, "utf8")) as { version?: unknown };
    return typeof parsed.version === "number" ? parsed.version : 0;
  } catch {
    return 0;
  }
}
