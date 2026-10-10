# 第 2 波（C 段）：P2-2 Windows 保留名 + P2-3 CRLF 稿子整篇重写

日期：2026-10-10 · 分支：`feat/plan3-interaction-and-assembly` · 总单：`docs/superpowers/plans/2026-10-09-full-scan-report.md` 第五节 P2 表 L209-210 · 工作区有大量未提交在途改动（P1 + P2 前两波），**本段全程未 commit / stash / checkout / reset**

## 〇、先读盘后的纠偏（总单的行号与判断都过期了）

总单 P2-2 说「路径边界只有词法检查、没有 realpath 级判定」——**这条已经被前几波修掉了**，我没有重复改：
`packages/fs-store/src/paths.ts:56` 已有整仓唯一的 `isPathUnderRoot(child, parent, resolve)`，
`readDocFile`（`read-write.ts:65`）与 `writeDocFile` 的 critical section（`read-write.ts:134`）**都已过闸**，
`changes.ts:83/132/244/360` 与 `skills.ts:134` 也都改成引这一份。所以 P2-2 我只补它**缺的后半（Windows 保留名）**，
并按要求核了一遍读盘通路（见第三节表格）。

保留名这一档实测推翻了「fs.writeFile 会抛 ENOENT/EPERM，所以错误自然会被看见」这个想象：

| 实测（本机 win32 + Node 24.21.0） | 结果 |
| --- | --- |
| `await fs.writeFile('<tmp>/CON.txt','x')` | **不抛错**，`existsSync` 为 true，Node 自己读得回来 |
| `await fs.writeFile('<tmp>/nul.md','x')` | 同上，**静默成功** |
| `fs.realpath('C:\\PROGRA~1')`（`node:fs/promises`，生产用的就是这个） | 回 `C:\Program Files`——**压大小写、展开 8.3 短名** |
| `fs.realpathSync('C:\\PROGRA~1')` | 原样回显 `C:\PROGRA~1`——**不展开** |

两条结论都进了实现与用例：
① 保留名必须在**命名层/落盘前的闸**当场拒，跨平台一律拒（不能等平台报错，它根本不报）；
② `samePath`（`paths.ts:37-39`）在 win32 压大小写是必要的，而**异步 realpath 已经把大小写与短名压平了**——
我这个用例一开始误按 `realpathSync` 的行为写注释、并因此造了一条没牙的测试（见第五节 M5 的回炉）。

## 一、P2-2：Windows 保留名判定住哪一处（归属从盘上定）

### 读盘拿到的证据链（决定归属的依据）

文档名的 legality 判定原本就住在 `packages/contracts/src/book.ts`：
`FILE_NAME_FORBIDDEN`（L111）→ `sanitizeDocFileName`（L157）→ `planDocRelPath`（L173）。
这条链**已经是「渲染层先验、fs 层再兜一遍」双闸**：
- 渲染层：`utils/new-doc.ts`、`stores/useBookStore.ts:223`、`stores/useVolumeOutlineStore.ts:127` 都调 `planDocRelPath` 做建稿前预检；
- 主进程：`apps/desktop/src/main/book-service.ts` 的 `createDoc` 再调一次 `sanitizeDocFileName`（原注释写着「这里兜底再验一遍」）；
- fs 层：`assertSafeRelPath`（`paths.ts:11`）是所有 `readDocFile` / `writeDocFile` / `createDocFile` / `changes.ts` 的必经口。

⇒ 保留名判定**加在这同一份真身上**（contracts），不另开第二处；fs 层与主进程各引**这一条**再兜一遍，
三处闸吃的是**同一句理由**（铁律 6）。

### 改动

- `packages/contracts/src/book.ts` L113-155 新增（+43 行）：
  - `WINDOWS_RESERVED_NAMES`（L128-134）：`CON / PRN / AUX / NUL` + `COM1-9` / `LPT1-9`，共 22 条；
  - `isWindowsReservedNameSegment`（L140-143）：照 Win32 的名解析口径——**先去掉结尾的空格与圆点**
    （`segment.replace(/[ .]+$/g, "")`），**再看第一个圆点之前那一截**（`.split(".")[0]`），大写化后查表；
    所以 `CON.txt`、`CON.`、`NUL  `、`COM1.backup.log`、`nul.md` 全算命中；
  - `windowsReservedNameProblem(nameOrPath)`（L149-155）：**逐段判**（目录名同样是保留名），反斜杠先换正斜杠；
    命中返回那句**唯一的**人话（点名是哪一段撞了、为什么换、且明说「带扩展名也一样」），否则 null；
  - `sanitizeDocFileName` L163-166：洗完名字后追加 `windowsReservedNameProblem(cleaned) === null ? cleaned : null`。
    **选择「拒绝」而不是「悄悄改名」**（`CON` → `CON-1` 会让用户找不到自己起的名，而且改完照样可能撞别的稿子）；
    `planDocRelPath` 因此自动对保留名回 null，渲染层现有那条「起不出名字」的分支直接接得住，**没有动渲染层**。
- `packages/fs-store/src/paths.ts` L5 引 contracts 那一条，L18-22 在 `assertSafeRelPath` 的 `..` 检查之后
  落 `invalid-path: <那句人话>`。这一处闸覆盖 `readDocFile` / `writeDocFile` / `createDocFile` / `changes.ts` 全部通路，
  **没有新增第二张表、第二句文案、第二处 `fs.realpath`**。
- `apps/desktop/src/main/book-service.ts` L226-227：`createDoc` 在 `sanitizeDocFileName` **之前**单问一次保留名，
  把它返回的理由原样递上屏（`reason: "invalid-path"`）。这里只搬运文案、不另编一份——
  否则用户只会看到笼统的「标题起不了文件名」，不知道自己撞的是系统保留名。**未碰** `agent-service.ts` / `agent-ipc.ts`。

### 用例（新增 `packages/contracts/test/windows-reserved-name.test.ts`，34 条）

保留名单在测试里**硬编码 22 条**（不从实现导出，否则实现漏一条就跟着一起漏）：逐条挡、大小写无关、
带扩展名（`CON.txt` / `nul.md` / `COM1.backup` / `LPT9.final.md`）、结尾圆点与空格（`CON.` / `"NUL  "` / `"nul. "`）、
路径逐段（含反斜杠形态）、理由必须点名是哪一段。
**挡过头那一档同样钉住**：`CON1`、`COM0`、`LPT10`、`CONFIG.md`、`AUXILIARY.md`、`NULL.md`、`chapter-CON`、
`CON-2.md`、`第 CON 章`、`chapters/01-开局.md`、`characters/李深.md`、`outline/01.md` 必须放行。
再加 `sanitizeDocFileName("CON")` 等回 null、普通标题照旧出 `chapters/01 开局.md`。

### 用例（扩展 `packages/fs-store/test/path-boundary.test.ts`，21 条，原 15 条）

新增 describe「Windows 保留名（P2-2 的后半）」6 条：
`assertSafeRelPath("chapters/CON.txt")` 报 `invalid-path` 且理由点名 `CON.txt`；
**真 `writeDocFile`** 撞保留名 ⇒ `ok:false/reason:"invalid-path"` 且盘上不许多出那个文件（这条就是实测「真机不拦」的补票）；
`readDocFile` 撞保留名 ⇒ 抛的是那句人话而不是 ENOENT；
`createDocFile` 撞保留名 ⇒ 不建目录也不建文件；
嵌套目录段 `chapters/LPT1/01.md` 一样拒；
`CON1` / `CONFIG` 那类像而不是的照旧能写能读。
新增「保留名判定也只许一份真身」读源码用例：`paths.ts` 必须 `import` 且调用 `windowsReservedNameProblem`，
并且**整个 fs-store/src 里不许有人再定义自己的保留名函数**（`copiers` 必须为 `[]`）。
另按上面实测补了 win32 专属 3 条：注入「child 大写 / parent 小写」解析器必须仍判在书内、
真 fs 上「根 `.toLowerCase()` / 文稿原样」必须仍在书内且 `readDocFile` 读得回来、
`samePath` 单测 win32 压平 / POSIX **不许**压平（保证大小写敏感用例在 Linux CI 上也绿）。

### 红 → 绿（原文摘录）

第一轮（contracts，实现还不存在）`~/dw-gate/p22-red1.log`：

```
❯ packages/contracts/test/windows-reserved-name.test.ts (34 tests | 32 failed)
AssertionError: expected 'CON' to be null
AssertionError: expected 'chapters/CON.md' to be null
AssertionError: expected 'characters/AUX.md' to be null
AssertionError: expected 'outline/NUL.md' to be null
 Test Files  1 failed (1)      Tests  32 failed | 2 passed (34)
```

第二轮（fs-store 侧）`~/dw-gate/red2.log`：

```
❯ packages/fs-store/test/path-boundary.test.ts (17 tests | 5 failed)
AssertionError: expected 'ENOENT: no such file or directory, op…' to contain '保留名'
AssertionError: expected true to be false          // writeDocFile 竟然写成功
 Test Files  2 failed (2)      Tests  17 failed | 18 passed (35)
```

绿：`~/dw-gate/green1.log` / `green2.log` → `Test Files 34 passed (34)`、`Tests 487 passed | 2 skipped (489)`
（末态 490，见第八节）。

## 二、P2-2 要求核对的「读盘通路是否都过闸」——逐条结论

| 通路 | 是否过 `isPathUnderRoot` | 证据（行号） | 结论 |
| --- | --- | --- | --- |
| `doc:read` → `readDocFile` | **是** | `read-write.ts:65`（队列外、`readFile` 之前） | **已修，证据在此**（前几波），本段未重复改 |
| `writeDocFile` | **是** | `read-write.ts:134`，位置在 `runWriteExclusive` **里面** | **已修**，而且刻意放在锁内（排队等锁期间链接可能被换掉） |
| `doc:create` → `createDocFile` | **否**（只有词法 `assertSafeRelPath`） | `create.ts:35` | 残留：由主进程 `ipc-guard` 的 `insideCurrentBook` + `relPathStaysInsideRoot` 兜住（**书根由主进程自己持有，不是 IPC 传的**），fs 层那一刀我没补——见第九节 |
| `changes.ts`（历史列表 / 回滚 / 备份读写） | **是** | `:83`、`:132`、`:244`、`:360` | 已收口到同一份 |
| `skills.ts readSkillFile` | **是** | `:134` | 已收口；但保留名闸到不了它（走的是自己的形状检查），见第九节 |
| `readBookData` / `writeBookData` | **否** | `book-data.ts:59`、`:90` | 文件名由白名单 `key` 映射得出，用户不控名 ⇒ 无保留名面；realpath 面属软链范畴，见第九节 |

## 三、P2-3：先测现状

读了 `packages/fs-store/src/read-write.ts` 与 `changes.ts`、`fingerprint.ts`，现状是：

1. `readDocFile` **原样**回盘上字节（`read-write.ts:67-70`），不做任何行尾归一；
   `fingerprint = makeFingerprint(content)`——**算的是盘上那段原始字节**（含它自己的 `\r\n`）；
2. `writeDocFile` 的期望指纹闸同样用 `makeFingerprint(current)`（`:157`、`:175`），备份存 `current` 逐字（`:185`），
   原子写走 `writeFileAtomic`（tmp + fsync + rename，`atomic-write.ts:103`），回滚 `restoreChange` 也是
   `makeFingerprint(current)` 判 stale、写回备份原文（`changes.ts:365-394`）；
3. 渲染层编辑器是 `<textarea :value>`，浏览器赋值时把 `\r\n` 归一成 `\n`（HTML 规范 value sanitization），
   交回来的正文**整篇行尾都换掉了**，而主进程按 `expectedFingerprint` 判的是「改前盘上那段字节」——
   闸**认得出内容变了**（不 stale、会写），于是这一次保存**整篇重写**：盘上 diff 是全文件，
   而所有在途提案存的期望指纹仍是旧那段字节，**一并变 stale**。故障现象与总单描述一致。

⇒ 关键事实：**指纹的口径本来就是「盘上那一段字节」**。修法必须顺着这条口径，否则闸会自撞。

## 四、P2-3：选了 ①（保留稿子原有行尾），为什么不选 ②

**选 ①**：以**盘上这一篇**的行尾为准，写之前把正文换成那一种，且**指纹必须对将要落盘的字节算**。

- 为什么不是 ②（不重写、但让它可见）：这条**必须改渲染层文案**（并行 agent 正在 `apps/desktop/src/renderer/**` 上干活，
  按约定我停在边界外，只在报告里写缺口），更关键的是它治不了病根——「打开 CRLF 稿子 → 自动保存」是最日常的动作，
  ② 只能让每次自动保存都失败一次或每次都提示一次，用户学不会；而 ① 之后这条路径**逐字节零变化**，
  根本不需要用户理解任何新规则。②的「可见」如果将来仍想做，缺的接口是：
  `DocWriteResult` 里目前没有「行尾被改写过」这一档（①实现后自然也不再产生这一档，所以不建议补）。

### 改动（`packages/fs-store/src/read-write.ts`，全文件 230 行，预算内）

- L19-53 新增判据（**只住这一处**）：
  - `type DocLineEnding = "crlf" | "lf" | "cr"`（L24）；
  - `detectLineEnding`（L36-42）：**第一个行结束符定调**。纯 LF → `lf`；纯 CRLF → `crlf`；
    混合 → 看第一个（`\r\n` 打头判 `crlf`，`\n` 打头判 `lf`）；整篇无换行（空文件 / 单行）→ `lf`（**绝不无中生有加 `\r`**）；
    老 Mac 单 `\r` → `cr`（能保住就保住）。混合行尾没有「正确答案」，但必须有**确定**答案，
    否则同一篇稿子每次保存的行尾都在飘；取第一个的理由是它与用户打开文件看到的第一眼一致；
  - `applyLineEnding`（L49-53）：**先归一成 LF 再整篇换成目标**——直接把 `\n` 换成 `\r\n` 会在原文已有 `\r\n` 时叠成 `\r\r\n`。
- L165 `const body = applyLineEnding(content, detectLineEnding(current ?? ""));`，随后三处**必须**用 `body`：
  - L173 幂等短路 `current === body`（原来比的是 `content`）；
  - L200 `writeFileAtomic(target, body, fs)`；
  - L229 `fingerprint: makeFingerprint(body)` ← **这一步最容易做错**：拿调用方的 `content` 算指纹，
    回报的指纹与盘上那段字节不是同一串，下一笔保存（含在途提案的期望指纹）**立刻自撞成 stale**；
  - L185 备份仍写 `current`（**盘上原文逐字**，不是归一过的版本）；L157/L175 的 `currentFingerprint` 仍按原文算。
- 附带收益：L173 那条短路现在把「只打开没编辑就自动保存」这一档吃掉了——被 textarea 抹平的正文换回原行尾就是原文，
  **盘上一字不动、也不留一份假备份**。
- **JSON 通路一律不受影响**（我们自己序列化的字节）：`writeBookData`（`book-data.ts:90`）、`bookMetaJson`（`book-meta.ts:34`）
  都没接这套判据，各有一条用例钉住（见下）。

### 用例（新增 `packages/fs-store/test/line-ending.test.ts`，18 条）

判据单测：纯 LF / 纯 CRLF、混合按首结束符（两个方向）、空文件与单行、老 Mac 单 `\r`、
`applyLineEnding("A\r\nB\nC\rD", …)` 不叠出 `\r\r\n`。
行为单测（全部用 `asFromTextarea()` 模拟浏览器那次归一，即递进主进程的一律是 LF 版正文）：
纯 CRLF 原文改一句 ⇒ 盘上**逐字节**仍是 CRLF、没动过的那几行不变；纯 LF ⇒ 一个 `\r` 都不许多出来；
「只打开不编辑就自动保存」⇒ `backupRelPath` 为 null、指纹不变、盘上字节不变；混合收口两个方向；
空文件 → LF；新建一篇 → LF；单 `\r` 保住；
**指纹自证**：`result.fingerprint === makeFingerprint(盘上读回的字节) === 下一次 readDocFile().fingerprint`；
拿回报的指纹再存一次**不许** stale；备份存的是改前 CRLF 原文；
外部把文件换成 LF 版 ⇒ 照旧报 stale（闸不许被行尾判据绕过）；
`writeBookData` 递来的 `\r\n` 原样落盘；`bookMetaJson` 带 `\n` 且不带 `\r`。

### 红 → 绿（原文摘录，`~/dw-gate/red2.log`）

```
❯ packages/fs-store/test/line-ending.test.ts (18 tests | 12 failed)
AssertionError: expected '第一章\n\n第一段原文。\n\n第二段改过。\n'
             to be '第一章\r\n\r\n第一段原文。\r\n\r\n第二段改过。\r\n'   // Object.is equality
AssertionError: expected '新写的开头\r\n第二行\r\n' to be '新写的开头\n第二行\n'
AssertionError: expected '甲\n乙\n丙\n' to be '甲\r乙\r丙\r'
AssertionError: expected '' not to be ''
```

## 五、变异（证明断言有鉴别力）

每个变异都用 **Edit 工具**改、跑完再用 **Edit 工具**改回；`perl -i` / `sed -i` 原地改写**没有发生**
（我试过的 `perl -e 'no'` 与 python heredoc 两条都直接执行失败，未落到文件上）。回读文件确认过生产形态。

| 变异 | 改法 | 结果 | 判定 |
| --- | --- | --- | --- |
| M1 | 去掉 `isWindowsReservedNameSegment` 里 `.split(".")[0]`（即不再认带扩展名） | `p22`/`path-boundary` 共 **12 failed**（`CON.txt`、`nul.md`、`COM1.backup` 那几条报 `the given combination of arguments (null and string) is invalid`） | 杀掉 |
| M2 | 去掉「先吃掉结尾空格/圆点」的 `replace(/[ .]+$/g, "")` | **8 failed**（`CON.`、`NUL␣␣`、`invalid-path` 那条 + fs 层 `expected true to be false`） | 杀掉 |
| M3 | `detectLineEnding` 恒回 `"lf"` | `line-ending.test.ts` **8 failed**（含 `expected 'lf' to be 'crlf'`、三条落盘断言） | 杀掉 |
| M4 | 指纹算回 `content`（`makeFingerprint(body)` → `makeFingerprint(content)`） | **2 failed**：`expected 'b0010662…' to be '12417935…'`（指纹自证那条）+ `expected false to be true`（第二笔保存报出假 stale） | 杀掉——这正是「闸会自撞」那条铁证 |
| M5（第一次） | `samePath` → `a === b`（去掉 win32 压平） | **19 passed，全绿**（`m5.log`） | **没牙**——因为我按 `realpathSync` 的行为构造用例，而生产用的是异步 `realpath`，它自己已经压平了大小写与 8.3 短名 |
| M5（补刀后） | 同上，仍是 `a === b` | `path-boundary.test.ts` **2 failed**（`expected false to be true`，`m5b.log`） | 杀掉（靠注入「child 大写 / parent 小写」解析器那条 + `samePath` 单测） |
| M6 | 幂等短路 `current === body` → `current === content`（即不换算行尾就比原文） | **1 failed**（EXIT=1，`~/dw-gate/m6-shortcircuit.log`）：`line-ending.test.ts:116` `AssertionError: expected '.mochen/changes/2026-10-10T02-57-22-4…' to be null` ⇒ 短路失效，多存了一份**假备份**并整篇重写 | 杀掉（这条正是「只打开不编辑就自动保存」那一档的守门人） |
| 回退 | M6 用 Edit 改回 `current === body` 后复跑 | **EXIT=0**，`18 passed`（`~/dw-gate/m6-revert-green.log`）；回读确认 `:173 current === body`、`:200 writeFileAtomic(target, body, fs)`、`:229 makeFingerprint(body)` 三处都是生产形态 | — |

回炉 M5 的过程值得记一笔：我最初的注释写的是「Windows 的 realpath 既不压大小写也不展开短名」，
这句**是错的**（那是 `realpathSync`）；实测后已把注释改成测到的事实，并把没有鉴别力的真 fs 用例换成注入解析器 + `samePath` 单测。

## 六、门禁与真实退出码

pnpm 自证：`command -v pnpm` → `/c/Users/17863/tools/pnpm-shim/pnpm`，`pnpm --version` → **11.7.0**。
所有跑测都用 `> log 2>&1; echo "EXIT=$?"`，退出码没有被管道吞。

| 门禁 | 命令 | 退出码 | 日志 / 数字 |
| --- | --- | --- | --- |
| 本段目标包（末态复跑） | `pnpm exec vitest run packages/fs-store packages/contracts --maxWorkers=1` | **0** | `~/dw-gate/final-c-run.log`：`Test Files 34 passed (34)`、`Tests 490 passed \| 2 skipped (492)`、15.28s |
| fs-store 单包 | `pnpm exec vitest run packages/fs-store --maxWorkers=1` | **0** | `~/dw-gate/c-run.log`：`18 passed (18)`、`201 passed \| 2 skipped (203)` |
| 类型闸 1 | `pnpm exec tsc --noEmit -p packages/fs-store/tsconfig.json` | **0** | — |
| 类型闸 2 | `pnpm exec tsc --noEmit -p packages/contracts/tsconfig.json` | **0** | — |
| 行数预算 | `node tools/check-source-line-budget.mjs` | **0** | `行数预算通过（601 份，含 .mjs/.cjs）`；改动文件最大 230 行（`read-write.ts`） |
| 格式 | `pnpm exec prettier --check <7 个碰过的文件>` | **0** | `All matched files use Prettier code style!`（`~/dw-gate/final-c-run.log` 同批，先前有 `prettier-write.log` 一轮 `--write`，与 `--check` 同批完成） |
| 主进程回归 | `vitest run apps/desktop/src/main`（除 agent-service 那几个文件） | 0 | `~/dw-gate/main-check.log`：`5 passed`、`138 passed (138)` |
| 消费方回归 | `vitest run` fs-store/contracts 的全部下游（含 agent-runtime 侧引用） | 0 | `~/dw-gate/consumers.log`：`17 passed`、`283 passed (283)`；`~/dw-gate/final-test.log`：`40 passed`、`642 passed \| 2 skipped (644)` |
| 边界自检 | `vitest run tools/boundary.selfcheck.test.mjs` | 0 | `~/dw-gate/boundary-only.log`：`10 passed (10)` |

## 七、跑全仓时看到的两处非本段问题（不动、如实记）

`~/dw-gate/desktop-all.log`：`2 failed | 246 passed (248)`、`5 failed | 3193 passed (3198)`。5 条失败逐条归因：

1. `apps/desktop/src/main/agent-service-turn-gate.test.ts` 4 条 `Error: Test timed out in 5000ms`
   —— 属**并行 agent 正在改的那个文件**（`agent-service.ts` / `agent-ipc.ts` 是他的地盘），我没碰、也不该碰；
2. `tools/boundary.selfcheck.test.mjs` 1 条 `AssertionError: expected +0 to be 1`（「CLI 形态会真的执行并把违规转成非零退出码」）
   —— 单独跑**全绿**（`boundary-only.log`，10 passed，EXIT=0），在大跑里因负载/spawn 时序翻红，属环境噪声，未改。

用户点名的噪声同样出现过、同样未计入回归：NTFS POSIX 权限位（`expected 438 to be 384`）、
`\` vs `/` 分隔符、临时库被占的 `EBUSY`。所有依赖大小写不敏感的用例都做了 win32 / POSIX **两边都绿**的处理
（注入解析器 + `process.platform` 分支单测）。

## 八、没做到的部分与原因（残留清单，请裁）

1. **`createDocFile` 没有 fs 层 realpath 闸**（`create.ts:35` 只有 `assertSafeRelPath`）。
   现状由主进程 `insideCurrentBook` / `relPathStaysInsideRoot` 兜住；补 fs 层闸需要在 `create.ts` 引 `isPathUnderRoot`
   并给它加 `resolve` 缝（一个新可选参数、一处新调用），**不在我这次点名的四个文件里**，所以只记不改。
   注意新建时目标不存在，`isPathUnderRoot` 会退到父目录判——语义是对的，只是这次不该我动。
2. **`scanBook` / `docMetaOf` 读 `.md` 不过 realpath 闸**（`scan.ts:36` `readdir`、`:73` `readFile`）：
   别人发来的书里若有指向书外的软链，扫描会把那篇的摘要读进来。修法是把 scan 的读换成走 `readDocFile`
   或给 scan 注 `resolve`——那会动 scan 的 IO 计数护栏（`scan-excerpt.test.ts` 的 `readFile` spy），**超出本段授权面**。
3. **`readBookData` / `writeBookData` 不过 realpath 闸**（`book-data.ts:59`、`:90`）：文件名来自白名单 key 映射，
   没有用户可控的名字；残留的只有「`.mochen/*.json` 本身被换成软链」这一档，同样属于上面第 1 条的口子范畴。
4. **`skills.ts readSkillFile` 走的是自己的形状检查**（`:116-127`，只认 `<目录名>/SKILL.md`），
   没经 `assertSafeRelPath` ⇒ **保留名闸到不了技能目录那一段**（realpath 闸有，`:134`）。
   修法是把技能路径改判成 `assertSafeRelPath` + `isPathUnderRoot`，但 `skills.ts` 不在我点名的文件里，未动。
5. **导出文件名撞保留名**：`packages/fs-store/src/export-shared.ts:113 sanitizeFilename` 只把非法字符换成 `_`、截 80，
   `packages/fs-store/src/export-service.ts:380` 用它拼 `${safeName}.md`——书名《CON》导出的文件名就是 `CON.md`，
   按实测**Windows 会静默收下**。这条要我裁的是**「改名 vs 拒绝」**：
   导出名撞保留名时，是悄悄加个后缀（导出文件本来就允许多份）、还是拒导出一句人话？
   两种都改 `sanitizeFilename` 的既有口径，而它**渲染层预览也在用**（文件注释自己写着「两处不许各写一份」），
   动它就等于动到并行 agent 的可见行为，所以我停在这里。
   若你选「拒绝」，接口上需要给 `ExportResult.filename` 那条路加一档理由；若选「改名」，
   一行 `windowsReservedNameProblem` 复用 contracts 真身即可（**不该再写第二张表**）。
6. **`apps/desktop/src/main/ipc-guard.ts:42` 是全仓第二处 `fs/promises.realpath`**（`:568-586` 的 `isUnderReal`），
   与铁律 6「`fs.realpath` 整仓只许 `paths.ts` 那一处」有张力。我**没动**：那是主进程 IPC 信任边界，
   且不在我的授权文件里（`ipc-guard.ts` 未被点名，而 `book-service.ts` 被点名了）。
   `isPathUnderRoot` 现在已经是导出的，将来可以让 `ipc-guard` 委派过去；但委派会给它引入 fs-store 依赖，
   主进程边界层依赖 fs 层是新的耦合方向，这条也想听你的判断。
7. **`paths.ts:59` 的默认参数写的是内联 `(target) => realpath(target)`，而同文件 `:34` 已有 `realPath` 常量**
   ——同一文件里两处调 `realpath`，不算跨文件重复，但确实是「一句话说了两遍」。
   一行即可改成 `= realPath`，我没顺手改（不在 P2-2 的病灶上，且 `isPathUnderRoot` 是别的波次刚落地的代码，
   改动该由它的归属方确认）。
8. `agent-service-turn-gate.test.ts` 的 4 条超时是并行 agent 在途状态，不是我要修的东西（第七节）。

## 九、本段碰过的文件（7 个）

- `packages/contracts/src/book.ts`（+43：保留名表 / 逐段判 / 唯一文案 / `sanitizeDocFileName` 拒）
- `packages/fs-store/src/paths.ts`（+ 引 contracts 一条 + `assertSafeRelPath` 落 `invalid-path`）
- `packages/fs-store/src/read-write.ts`（+ 行尾判据三件套 + `body` 三处落点，230 行）
- `apps/desktop/src/main/book-service.ts`（`createDoc` 把保留名理由递上屏；同文件其余改动是你的 P1-7 在途工作，我只 `--write` 了三行 `handleTrusted(...)` 的折行）
- `packages/contracts/test/windows-reserved-name.test.ts`（新增，34 条）
- `packages/fs-store/test/path-boundary.test.ts`（扩到 21 条）
- `packages/fs-store/test/line-ending.test.ts`（新增，18 条）

`packages/fs-store/src/changes.ts`、`book-data.ts` 按要求**只读未改**（指纹口径本来就是盘上字节，无需动）。
