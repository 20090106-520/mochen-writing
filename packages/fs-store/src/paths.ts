export function toPosixRelPath(relPath: string): string {
  return relPath.replaceAll("\\", "/");
}

export function assertSafeRelPath(relPath: string): string {
  if (!relPath || relPath.trim() === "") throw new Error("invalid-path: 空路径");
  const posix = toPosixRelPath(relPath);
  if (posix.startsWith("/") || /^[a-zA-Z]:\//.test(posix))
    throw new Error(`invalid-path: 需要书内相对路径，收到 ${relPath}`);
  const segments = posix.split("/").filter((s) => s !== "" && s !== ".");
  if (segments.some((s) => s === "..")) throw new Error(`outside-book: 路径越界 ${relPath}`);
  return segments.join("/");
}
