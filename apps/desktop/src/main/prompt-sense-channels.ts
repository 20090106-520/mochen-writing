/**
 * 感官通道读数（2026-10-21，2026-11-16 从 prompt-assembly.ts 拆出）。
 *
 * 拆的理由同 prompt-craft / prompt-dialogue：prompt-assembly.ts 顶到 800 行预算
 * （tools/check-source-line-budget.mjs），这一段连清单与注释五十来行，留在原地
 * 下一处动态段就加不进来。这里只搬位置，口径一个字未改。
 *
 * 【为什么值得报】AI 写场景几乎只有画面（看见／光亮／脸色），人写场景会闻到、摸到、疼到。
 * 既有动态段没有一处管感官（词表、章首、对白比、腔调四维、原句、句首都不是这一层）。
 *
 * 【口径】输入是**已完稿**正文（当前章半截草稿不算）；分母是同一份正文的字数（含标点），
 * 逐通道数单字命中，÷字数×1000（1 位小数）——密度是尺度无关量，章有长短也能横着读。
 * **五枚恒定全列**（零命中也写 0.0），不排序、不捏总分（那要先编权重）。
 *
 * 【只摆不判】没有「嗅觉密度低于多少算病」的判据（要真人语料分位），所以不进体检、不进闸。
 * 叮嘱也刻意留分寸：「一处就够」——本仓要的是该闻到的那一拍闻到，不是每段都撒调料。
 */

/**
 * 感官五通道的单字清单。
 *
 * 【为什么是单字、为什么五通道互不重叠】单字计数是**代理读数**（同 text-vitality 的代理口径）：
 * 不切词、不引依赖；一旦两条通道共用同一个字（如「颤」「抖」），同一处细节会被各算一次，读数就偏了。
 * 清单写死在这里是**定义**，不是判据——换一批字读数就变，不许下游各抄一份。
 *
 * 【已知偏差，不掩盖】「色」也会命中「脸色」「神色」（其实仍偏视觉）、「干」会命中「干活」；
 * 这是代理指标的固有粗糙，不为此加词性判断（那要分词，本仓零依赖）。
 */
export const SENSE_CHANNEL_TERMS: readonly { channel: string; chars: readonly string[] }[] = [
  { channel: "视觉", chars: [..."看望见盯瞥瞧亮暗光影色"] },
  { channel: "听觉", chars: [..."听响声静喊叫吼嗓嚷嗡"] },
  { channel: "触觉", chars: [..."冷热烫凉湿干硬软滑痛疼痒麻"] },
  { channel: "嗅觉", chars: [..."香臭腥霉馊烟"] },
  { channel: "体内感", chars: [..."喘汗抖晕饿渴累乏颤"] }
];

function channelPerThousand(text: string, chars: readonly string[]): number {
  let hits = 0;
  for (const char of chars) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(char, from);
      if (at === -1) break;
      hits += 1;
      from = at + char.length;
    }
  }
  return Math.round((hits / text.length) * 1000 * 10) / 10;
}

/** 已完稿正文 → 一段五通道读数；空正文返回空串（不注入空段）。 */
export function senseChannelSentence(text: string): string {
  if (text.length === 0) return "";
  const readings = SENSE_CHANNEL_TERMS.map(
    ({ channel, chars }) => `${channel} ${channelPerThousand(text, chars).toFixed(1)}`
  );
  return (
    "本书感官通道读数（扫描自这本书已完稿的正文，每千字命中次数）：" +
    readings.join("、") +
    "。这本书平时偏哪一路，就在哪一路保持它自己的密度（别忽然大段铺感觉）；" +
    "「感官落点」那条照旧执行（每场戏至少两种非视觉感官），" +
    "但也别为了凑数把每段都撒上调料——只在真正该让读者闻到、摸到、疼到的那一拍写。"
  );
}
