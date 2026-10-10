/**
 * 右栏「浏览」那一格到底该显示什么（2026-10-09 全仓扫描 P1-9）。
 *
 * 判据抽出来的原因：面板原来只有一句 `book.browseContents[relPath] ?? "正在读取…"`，
 * 读盘失败时那一格既没有正文也没有别的话，于是**永远停在「正在读取…」**。
 * 三态（读到 / 读不动 / 还在读）得有一份说得清、也测得动的地方，面板只管挂上去。
 */

/** 「还在读」那句原话：唯一一处允许它对用户说话的地方就是这里。 */
export const BROWSING_LABEL = "正在读取…";

/** 读不动时给用户的重试通路——这条确实存在（再点左栏那一格就是一次新的 browse）。 */
export const BROWSE_RETRY_HINT = "（在左栏再点一次那一格可以重试）";

export type BrowseBodyState = "none" | "ready" | "failed" | "browsing";

export type BrowseBodyView = {
  readonly state: BrowseBodyState;
  readonly text: string;
};

/**
 * 三态判据只看一次两张表，界面不许各自猜：
 * 没这一格 → none（空串）；有正文 → ready；有理由 → failed；两者都没有 → browsing。
 * `ready` 排在 `failed` 前面：好结果到手之后，上一轮的失败理由不该继续压在那一格底下。
 */
export function browseBodyViewOf(
  contents: Readonly<Record<string, string>>,
  errors: Readonly<Record<string, string>>,
  relPath: string | null | undefined
): BrowseBodyView {
  if (!relPath) return { state: "none", text: "" };
  const content = contents[relPath];
  // 用 undefined 判定而不是真值：空稿本来就是空串，那句"这篇是空的"由别的层说，
  // 但绝不能被读成「还没读回来」。
  if (content !== undefined) return { state: "ready", text: content };
  const reason = errors[relPath];
  if (reason !== undefined) {
    return { state: "failed", text: `没能读到这一格的正文：${reason}${BROWSE_RETRY_HINT}` };
  }
  return { state: "browsing", text: BROWSING_LABEL };
}

export function browseBodyOf(
  contents: Readonly<Record<string, string>>,
  errors: Readonly<Record<string, string>>,
  relPath: string | null | undefined
): string {
  return browseBodyViewOf(contents, errors, relPath).text;
}
