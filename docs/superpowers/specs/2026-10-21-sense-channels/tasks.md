# 任务清单 · 感官通道读数

## T1 清单与读数（prompt-assembly）

- [ ] `SENSE_CHANNEL_TERMS`：五通道单字清单（视觉／听觉／触觉／嗅觉／体内感），互不重叠
- [ ] 私有 `channelPerThousand(text, terms)`：命中总数 ÷ 字数 × 1000，1 位小数；空文本 null
- [ ] `senseChannelSentence(assembled)`：五枚全列 + 一句「别只给画面」的叮嘱；空正文返回空串

## T2 注入

- [ ] `defaultPromptFor` 在句首自查之后按「非空才加」注入

## T3 单测 + 变异

- [ ] `apps/desktop/src/main/prompt-sense-channels.test.ts`（新）：
  - 逐通道读数与手算逐位相等（固定短文本）
  - 五枚恒定全列（零命中也写 0.0）
  - 空正文不注入
  - 当前章（active）与非 chapter 条目不进分母／不计数
  - 清单是定义：删掉清单里一个字，读数就变（变异用例）
- [ ] 变异：① 删嗅觉通道 → 五枚全列用例红；② 分母改成全集（含当前章）→ 当前章用例红；
      ③ 清单删一个字 → 读数用例红；全部还原后全绿

## T4 门禁与台账

- [ ] `prettier --write` 两个源码文件
- [ ] `corepack pnpm verify` → `VERIFY_EXIT=0`
- [ ] 台账追加 §一百四十三
- [ ] 仅本地 `git commit`（不推送）
