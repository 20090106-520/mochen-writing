// 场景画的**像素级**可读性复核（2026-10-08 波2a 建 · 2026-10-17 波2 起量的是原创位图）
//
// 【为什么生成器里那道 palette 自检不够】
// 生成器算的是「调色板上那几个色值的亮度差」，是设计期的**代理指标**：
// 它不知道某个主体最后被雾带、光池、暗角叠成了什么样子，也不知道缩到
// 卡片预览那么大时还剩多少信息。真正要判的是「**渲染出来的缩略图上有没有画**」，
// 所以这里把成品画在真机上画进 canvas、降到卡片预览的量级，再逐像素量。
// 生成器那道门保留（它能拦住「三层山压成同一层亮度」这种源头问题），
// **这道才是终点的门**。
//
// 【量的是哪六张】三个系列 × 昼夜（`book-boat-*` / `lamp-tower-*` / `ink-pool-*`）。
// 2026-10-17 波2 起这六张的盘上格式由 SVG 换成 **人工出图 + 脚本管线的原创位图**（webp），
// 但这道门**与格式无关**：矢量位图都画进 canvas 之后量同一批像素（规格单 §4 第 8 条）。
// `abyss-hall-night.webp` / `shallow-hall-day.webp` **不在**这道门的覆盖里——它们是
// **人物立绘族**（两位姑娘分守左右），G2 那条「两缘带与中段带的均值差 ≥10」对它们
// 是范畴错误（立绘族的画意恰恰在把中段留得比两缘**更亮**，实测缘中差 −3.7/−4.0）。
// 它们由 `appearance-skin-assets.test.ts` 管（存在/尺寸/比例/体积/昼夜成对）。
//
// 【三条判据，都可量，都在 320×180 的缩略图上算】
//   G1 明度分层：把亮度按 22 点一档分桶（22 点是 v2 的间隔阈值），
//      要求**至少 4 个桶各占 ≥2% 面积**——对应「远景/中景/主体/前景」四层拉得开。
//   G2 两缘有主体：左缘带与右缘带各自的 p90−p10 亮度跨度 ≥ 18，
//      且与中段带的均值差 ≥ 10（只有一片渐变是造不出跨度的）。
//   G3 中段保持安静：中段带的横向相邻像素平均亮度差 ≤ 4（正文要落在这里），
//      且两缘带的该值 ≥ 中段的 2 倍（信息确实在边缘，不在中间）。
// 三条里任何一条不过就抛错，不允许「看着还行」。
//
// 【不落盘、不污染】只在页面里建一张离屏 canvas；跑完不留在 DOM 里。
//
// 【怎么跑】这道门要一个**真的浏览器**来解码（webp 与 svg 都是），所以它连一台正在跑、
// 开了远程调试端口的实例（默认 9234，可用 `CDP_PORT` 改）：
//   1. `corepack pnpm --dir apps/desktop build`
//   2. `apps/desktop/node_modules/.bin/electron apps/desktop/out/main/index.js --remote-debugging-port=9234 --user-data-dir=<临时目录>`
//      （**别连用户自己那台**：这台只用来量东西。）
//   3. `node apps/desktop/scripts/check-scene-art.mjs`
// 原先它还 `import { connect } from "./tmp-cdp.mjs"`，而那份夹持住在 git-ignored 的
// `.superpowers/sdd/` 里 ⇒ 进仓后会成为一个仓库里不存在的依赖。这里只用到 `evaluate`，
// 所以把最小夹持直接抄在下面三十行，不引第二份文件、也不新增任何依赖。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.CDP_PORT ?? 9234);

/** 连上那台实例的页面目标，只暴露 `evaluate`（这道门要做的事仅此一件）。 */
async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === "page" && t.url.includes("index.html"));
  if (!page) throw new Error(`9234 上没有 page 目标 —— 实例没起来，或起的不是它`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  };
  return {
    async evaluate(expression) {
      const next = ++id;
      const r = await new Promise((resolve, reject) => {
        pending.set(next, { resolve, reject });
        ws.send(
          JSON.stringify({
            id: next,
            method: "Runtime.evaluate",
            params: { expression, awaitPromise: true, returnByValue: true }
          })
        );
      });
      if (r.exceptionDetails) {
        throw new Error(
          "EVAL: " + JSON.stringify(r.exceptionDetails.exception ?? r.exceptionDetails)
        );
      }
      return r.result.value;
    },
    close: () => ws.close()
  };
}

const SKIN_DIR = path.join(__dirname, "..", "src", "renderer", "public", "skins");
const FILES = [
  "book-boat-night.webp",
  "book-boat-day.webp",
  "lamp-tower-night.webp",
  "lamp-tower-day.webp",
  "ink-pool-night.webp",
  "ink-pool-day.webp"
];
const TW = 320;
const TH = 180;

/**
 * 按扩展名给 MIME。这道门**与格式无关**（画进 canvas 后都是同一批像素），
 * 但 `new Image()` 需要按 MIME 走对解码器 ⇒ 认这几种即可；白名单外的当场抛错，
 * 免得写成 `image/webp` 却去喂一个 svg，或者反过来「解不出来就静默跳过」。
 */
function mimeFor(file) {
  if (file.endsWith(".webp")) return "image/webp";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".jpg") || file.endsWith(".jpeg")) return "image/jpeg";
  throw new Error(`${file} 的扩展名不在白名单里（webp / svg / png / jpg）`);
}

const cdp = await connect();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 在页面里把画解码进离屏 canvas 并回传统计；表达式里不出现反引号（记忆第 7 条）。 */
function measureExpr(mime, b64) {
  return (
    "(function(){var b64='" +
    b64 +
    "';return new Promise(function(res){var img=new Image();" +
    "img.onerror=function(){res(JSON.stringify({error:'画没能解码'}));};" +
    "img.onload=function(){" +
    "var cv=document.createElement('canvas');cv.width=" +
    TW +
    ";cv.height=" +
    TH +
    ";var ctx=cv.getContext('2d');ctx.fillStyle='#000';ctx.fillRect(0,0,cv.width,cv.height);" +
    "ctx.drawImage(img,0,0,cv.width,cv.height);" +
    "var d=ctx.getImageData(0,0,cv.width,cv.height).data;var W=cv.width,H=cv.height;" +
    "var L=new Float64Array(W*H);var lin=function(v){var s=v/255;return s<=0.03928?s/12.92:Math.pow((s+0.055)/1.055,2.4);};" +
    "for(var i=0;i<W*H;i++){var r=d[i*4],g=d[i*4+1],bl=d[i*4+2];L[i]=(0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(bl))*255;}" +
    "var pct=function(arr,p){var a=Array.prototype.slice.call(arr).sort(function(x,y){return x-y;});return a[Math.min(a.length-1,Math.floor(a.length*p))];};" +
    "var bucket=new Array(12).fill(0);for(var i=0;i<L.length;i++){bucket[Math.min(11,Math.floor(L[i]/22))]+=1;}" +
    "var occ=bucket.map(function(c,i){return {b:i,share:+(c/L.length*100).toFixed(1)};}).filter(function(x){return x.share>=2;});" +
    "var band=function(x0,x1){var v=[];var e=0;var n=0;for(var y=Math.floor(H*0.12);y<Math.floor(H*0.88);y++){for(var x=x0;x<x1-1;x++){var l=L[y*W+x];v.push(l);var dl=Math.abs(L[y*W+x+1]-l);e+=dl;n++;}}var m=v.reduce(function(a,c){return a+c;},0)/v.length;var sd=pct(v,0.9)-pct(v,0.1);return {mean:+m.toFixed(1),span:+sd.toFixed(1),edge:+(e/n).toFixed(2)};};" +
    "var left=band(0,Math.floor(W*0.27));var mid=band(Math.floor(W*0.29),Math.floor(W*0.70));var right=band(Math.floor(W*0.73),W);" +
    "var all=Array.prototype.slice.call(L);var lo=pct(all,0.02);var hi=pct(all,0.98);" +
    "res(JSON.stringify({w:W,h:H,buckets:occ,left:left,mid:mid,right:right,p2:+lo.toFixed(1),p98:+hi.toFixed(1)}));};" +
    "img.src='data:" +
    mime +
    ";base64,'+b64;})})()"
  );
}

let bad = 0;
for (const file of FILES) {
  /* 按**二进制**读，不能按 utf8 读——webp 是位图，utf8 往返会把字节改掉。 */
  const b64 = fs.readFileSync(path.join(SKIN_DIR, file)).toString("base64");
  const r = JSON.parse(await cdp.evaluate(measureExpr(mimeFor(file), b64)));
  if (r.error) {
    console.log("FAIL " + file + " | 出图失败：" + r.error);
    bad++;
    continue;
  }
  const g1 = r.buckets.length >= 4;
  const g2 =
    r.left.span >= 18 &&
    r.right.span >= 18 &&
    Math.abs(r.left.mean - r.mid.mean) >= 10 &&
    Math.abs(r.right.mean - r.mid.mean) >= 10;
  const g3 = r.mid.edge <= 4 && r.left.edge >= r.mid.edge * 2 && r.right.edge >= r.mid.edge * 2;
  const ok = g1 && g2 && g3;
  if (!ok) bad++;
  console.log(
    (ok ? "PASS " : "FAIL ") +
      file.padEnd(22) +
      " G1分层=" +
      r.buckets.length +
      (g1 ? "✓" : "✗") +
      " G2缘跨=" +
      r.left.span +
      "/" +
      r.right.span +
      " 缘中差=" +
      (r.left.mean - r.mid.mean).toFixed(1) +
      "/" +
      (r.right.mean - r.mid.mean).toFixed(1) +
      (g2 ? "✓" : "✗") +
      " G3静=" +
      r.mid.edge +
      " 缘动=" +
      r.left.edge +
      "/" +
      r.right.edge +
      (g3 ? "✓" : "✗") +
      " | p2..p98=" +
      r.p2 +
      ".." +
      r.p98 +
      " 桶=" +
      r.buckets.map((x) => x.b + ":" + x.share).join(",")
  );
}
await sleep(120);
console.log(bad === 0 ? "六张全过" : "有 " + bad + " 张不合格");

/**
 * 反向用例：一张**只有底色渐变、没有主体**的对照图必须判红。
 * 没有这一步，「六张全过」可能只是因为判据根本不成立（永远绿）。
 * 这条对照就是 v1 夜版在缩略图上的真实样子——一片没有东西的渐变。
 */
const blank =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 2560 1440' width='2560' height='1440'>" +
  "<defs><linearGradient id='c' x1='0' y1='0' x2='0' y2='1'>" +
  "<stop offset='0' stop-color='#2C6E8C'/><stop offset='0.42' stop-color='#0D2839'/>" +
  "<stop offset='1' stop-color='#060F18'/></linearGradient></defs>" +
  "<rect width='2560' height='1440' fill='url(#c)'/></svg>";
const ctrl = JSON.parse(
  await cdp.evaluate(measureExpr("image/svg+xml", Buffer.from(blank, "utf8").toString("base64")))
);
const ctrlPass = ctrl.buckets.length >= 4 && ctrl.left.span >= 18 && ctrl.right.span >= 18;
console.log(
  (ctrlPass
    ? "FAIL 反向用例：空渐变竟然判过了，说明判据没牙齿 | "
    : "PASS 反向用例：空渐变判红 | ") +
    JSON.stringify(ctrl.buckets) +
    " 缘跨=" +
    ctrl.left.span +
    "/" +
    ctrl.right.span +
    " 缘中差=" +
    (ctrl.left.mean - ctrl.mid.mean).toFixed(1) +
    "/" +
    (ctrl.right.mean - ctrl.mid.mean).toFixed(1)
);
process.exit(bad === 0 && !ctrlPass ? 0 : 1);
