import { describe, expect, it, vi } from "vitest";
import {
  basicAuthHeader,
  deleteResource,
  extractEntriesFromPropfindXml,
  extractHrefsFromPropfindXml,
  getFile,
  isWebdavUrlAllowed,
  joinWebdavUrl,
  mkcolDir,
  propfindChildren,
  propfindEntries,
  putFile,
  type WebdavFetch
} from "./webdav-client.js";

/**
 * WebDAV 协议纯函数层（2026-10-15）。真网络与真服务器在单测里复现不了，
 * 这里只钉「给定 fetch 回某状态码与某 body 时，本模块按预期分类与归一」。
 */

function fetchReturning(status: number, text: string): WebdavFetch {
  return vi.fn(async () => ({ status, text }));
}

function fetchThrowing(message: string): WebdavFetch {
  return vi.fn(async () => {
    throw new Error(message);
  });
}

describe("webdav-client · isWebdavUrlAllowed", () => {
  it("https 一律放行（不论是本机还是远端）", () => {
    expect(isWebdavUrlAllowed("https://nas.local/dav/")).toBe(true);
    expect(isWebdavUrlAllowed("https://example.com/dav")).toBe(true);
  });

  it("http 仅本机回环例外（与 ollama 同档理由）", () => {
    expect(isWebdavUrlAllowed("http://localhost:8080/dav/")).toBe(true);
    expect(isWebdavUrlAllowed("http://127.0.0.1:8080/dav/")).toBe(true);
    expect(isWebdavUrlAllowed("http://[::1]:8080/dav/")).toBe(true);
  });

  it("http 非本机回环一律拒：明文 http 会把密码与全书裸送链路", () => {
    expect(isWebdavUrlAllowed("http://nas.local/dav/")).toBe(false);
    expect(isWebdavUrlAllowed("http://example.com/dav")).toBe(false);
  });

  it("解析不出的 URL 拒（与 provider-fetch 同款判据）", () => {
    expect(isWebdavUrlAllowed("not-a-url")).toBe(false);
    expect(isWebdavUrlAllowed("")).toBe(false);
  });

  it("其他协议拒（file / ftp 等都不在白名单里）", () => {
    expect(isWebdavUrlAllowed("file:///tmp/dav")).toBe(false);
    expect(isWebdavUrlAllowed("ftp://nas.local/dav")).toBe(false);
  });
});

describe("webdav-client · basicAuthHeader", () => {
  it("纯 ASCII 用户名密码按 RFC 7617-base64 编码", () => {
    expect(basicAuthHeader("alice", "secret")).toBe(
      `Basic ${Buffer.from("alice:secret", "utf8").toString("base64")}`
    );
  });

  it("非 ASCII 用户名 / 密码按 UTF-8 编码（坚果云密码常含中文）", () => {
    const header = basicAuthHeader("alice", "密码");
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    expect(decoded).toBe("alice:密码");
  });
});

describe("webdav-client · joinWebdavUrl", () => {
  it("base 末尾的斜杠与段首的斜杠被归一到一条", () => {
    expect(joinWebdavUrl("https://nas/dav/", "book-1", "book-2026/")).toBe(
      "https://nas/dav/book-1/book-2026"
    );
  });

  it("中文段被逐段 encodeURIComponent（服务端事实要求）", () => {
    const url = joinWebdavUrl("https://nas/dav/", "chapters/第一章.md");
    expect(url).toContain(encodeURIComponent("第一章.md"));
    expect(url).toContain(encodeURIComponent("chapters"));
  });

  it("空段与「.」段被跳过", () => {
    expect(joinWebdavUrl("https://nas/dav/", "", ".", "book-1")).toBe("https://nas/dav/book-1");
  });

  it("多斜杠段被归一（连续斜杠不变成空段）", () => {
    expect(joinWebdavUrl("https://nas/dav//", "a//b", "/c")).toBe("https://nas/dav/a/b/c");
  });
});

describe("webdav-client · extractHrefsFromPropfindXml", () => {
  it("解析 D: 前缀的多条 href，过滤自身那条", () => {
    const xml = `<?xml version="1.0"?>
<D:multistatus xmlns:D="DAV:">
  <D:response><D:href>/dav/book-1/</D:href></D:response>
  <D:response><D:href>/dav/book-1/book-2026-01-01-000000/</D:href></D:response>
  <D:response><D:href>/dav/book-1/book-2025-12-31-235959/</D:href></D:response>
</D:multistatus>`;
    const result = extractHrefsFromPropfindXml(xml, "https://nas/dav/book-1/");
    expect(result).toEqual([
      "/dav/book-1/book-2026-01-01-000000/",
      "/dav/book-1/book-2025-12-31-235959/"
    ]);
  });

  it("解析 d: 小写前缀也认（部分服务端用小写）", () => {
    const xml = `<d:multistatus xmlns:d="DAV:">
  <d:response><d:href>/dav/book-1/</d:href></d:response>
  <d:response><d:href>/dav/book-1/abc/</d:href></d:response>
</d:multistatus>`;
    const result = extractHrefsFromPropfindXml(xml, "https://nas/dav/book-1/");
    expect(result).toEqual(["/dav/book-1/abc/"]);
  });

  it("解析无前缀 href（坚果云等实现）", () => {
    const xml = `<multistatus>
  <response><href>/dav/book-1/</href></response>
  <response><href>/dav/book-1/x/</href></response>
</multistatus>`;
    const result = extractHrefsFromPropfindXml(xml, "https://nas/dav/book-1/");
    expect(result).toEqual(["/dav/book-1/x/"]);
  });

  it("绝对 URL 的 href 被解 pathname 后比归一", () => {
    const xml = `<D:multistatus>
  <D:response><D:href>https://nas/dav/book-1/</D:href></D:response>
  <D:response><D:href>https://nas/dav/book-1/y/</D:href></D:response>
</D:multistatus>`;
    const result = extractHrefsFromPropfindXml(xml, "https://nas/dav/book-1/");
    expect(result).toEqual(["/dav/book-1/y/"]);
  });

  it("重复 href 只留一条（去重）", () => {
    const xml = `<D:multistatus>
  <D:response><D:href>/dav/book-1/</D:href></D:response>
  <D:response><D:href>/dav/book-1/z/</D:href></D:response>
  <D:response><D:href>/dav/book-1/z/</D:href></D:response>
</D:multistatus>`;
    const result = extractHrefsFromPropfindXml(xml, "https://nas/dav/book-1/");
    expect(result).toEqual(["/dav/book-1/z/"]);
  });

  it("空 XML 不抛，回空数组", () => {
    expect(extractHrefsFromPropfindXml("", "https://nas/dav/book-1/")).toEqual([]);
  });
});

describe("webdav-client · extractEntriesFromPropfindXml", () => {
  it("带 collection 的项是目录、resourcetype 空的项是文件（自身那条被过滤）", () => {
    const xml = `<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/dav/book/</D:href>
    <D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat>
  </D:response>
  <D:response>
    <D:href>/dav/book/chapters/</D:href>
    <D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat>
  </D:response>
  <D:response>
    <D:href>/dav/book/book.json</D:href>
    <D:propstat><D:prop><D:resourcetype/></D:prop></D:propstat>
  </D:response>
</D:multistatus>`;
    const result = extractEntriesFromPropfindXml(xml, "https://nas/dav/book/");
    expect(result).toEqual([
      { path: "/dav/book/chapters/", isDir: true },
      { path: "/dav/book/book.json", isDir: false }
    ]);
  });

  it("成对的小写 <d:collection></d:collection> 也认（不同服务端写法不一）", () => {
    const xml = `<d:multistatus>
  <d:response>
    <d:href>/dav/book/</d:href>
    <d:resourcetype><d:collection></d:collection></d:resourcetype>
  </d:response>
  <d:response>
    <d:href>/dav/book/chapters/</d:href>
    <d:resourcetype><d:collection></d:collection></d:resourcetype>
  </d:response>
</d:multistatus>`;
    const result = extractEntriesFromPropfindXml(xml, "https://nas/dav/book/");
    expect(result).toEqual([{ path: "/dav/book/chapters/", isDir: true }]);
  });

  it("文件名里含 collection 字样不误判成目录（判据要求「<」紧跟 collection）", () => {
    const xml = `<D:multistatus>
  <D:response><D:href>/dav/book/</D:href></D:response>
  <D:response>
    <D:href>/dav/book/my-collection.md</D:href>
    <D:propstat><D:prop><D:resourcetype/></D:prop></D:propstat>
  </D:response>
</D:multistatus>`;
    const result = extractEntriesFromPropfindXml(xml, "https://nas/dav/book/");
    expect(result).toEqual([{ path: "/dav/book/my-collection.md", isDir: false }]);
  });

  it("绝对 URL 的 href 解 pathname；重复项去重", () => {
    const xml = `<D:multistatus>
  <D:response><D:href>https://nas/dav/book/</D:href></D:response>
  <D:response><D:href>https://nas/dav/book/y.md</D:href></D:response>
  <D:response><D:href>https://nas/dav/book/y.md</D:href></D:response>
</D:multistatus>`;
    const result = extractEntriesFromPropfindXml(xml, "https://nas/dav/book/");
    expect(result).toEqual([{ path: "/dav/book/y.md", isDir: false }]);
  });

  it("空 XML / 无 href 的块不抛，回空数组", () => {
    expect(extractEntriesFromPropfindXml("", "https://nas/dav/book/")).toEqual([]);
    expect(
      extractEntriesFromPropfindXml("<D:multistatus><D:response/></D:multistatus>", "https://x/y/")
    ).toEqual([]);
  });
});

describe("webdav-client · mkcolDir", () => {
  it("201 = 已建（existed=false）", async () => {
    const fetch = fetchReturning(201, "");
    const result = await mkcolDir(fetch, "https://nas/dav/x/", {});
    expect(result).toEqual({ ok: true, existed: false });
  });

  it("405 = 已存在（existed=true，多数服务端如此回）", async () => {
    const fetch = fetchReturning(405, "");
    const result = await mkcolDir(fetch, "https://nas/dav/x/", {});
    expect(result).toEqual({ ok: true, existed: true });
  });

  it("401 = 凭据不对，回 ok=false + status=401", async () => {
    const fetch = fetchReturning(401, "Unauthorized");
    const result = await mkcolDir(fetch, "https://nas/dav/x/", {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("fetch 抛错回 ok=false + status=0 + 人话", async () => {
    const fetch = fetchThrowing("network down");
    const result = await mkcolDir(fetch, "https://nas/dav/x/", {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(0);
      expect(result.message).toContain("network down");
    }
  });
});

describe("webdav-client · putFile", () => {
  it("200/201/204 都算成功（不同服务端选其一）", async () => {
    for (const status of [200, 201, 204]) {
      const fetch = fetchReturning(status, "");
      const result = await putFile(fetch, "https://nas/dav/x.md", {}, new Uint8Array());
      expect(result.ok).toBe(true);
    }
  });

  it("非 2xx 回 ok=false + 状态码与 body 摘要", async () => {
    const fetch = fetchReturning(500, "server error body");
    const result = await putFile(fetch, "https://nas/dav/x.md", {}, new Uint8Array());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.message).toContain("server error body");
    }
  });

  it("fetch 抛错回 ok=false + status=0", async () => {
    const fetch = fetchThrowing("connection reset");
    const result = await putFile(fetch, "https://nas/dav/x.md", {}, new Uint8Array());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(0);
  });
});

describe("webdav-client · deleteResource", () => {
  it("200/204 都算成功", async () => {
    for (const status of [200, 204]) {
      const fetch = fetchReturning(status, "");
      const result = await deleteResource(fetch, "https://nas/dav/x", {});
      expect(result.ok).toBe(true);
    }
  });

  it("404 在探活删除语义下视为已清（服务端可能并发删了）", async () => {
    const fetch = fetchReturning(404, "");
    const result = await deleteResource(fetch, "https://nas/dav/x", {});
    expect(result.ok).toBe(true);
  });

  it("500 回 ok=false + 人话", async () => {
    const fetch = fetchReturning(500, "fail");
    const result = await deleteResource(fetch, "https://nas/dav/x", {});
    expect(result.ok).toBe(false);
  });
});

describe("webdav-client · propfindChildren", () => {
  it("207 + XML body ⇒ 解析子项（自身被过滤）", async () => {
    const body = `<D:multistatus xmlns:D="DAV:">
  <D:response><D:href>/dav/book/</D:href></D:response>
  <D:response><D:href>/dav/book/a/</D:href></D:response>
  <D:response><D:href>/dav/book/b/</D:href></D:response>
</D:multistatus>`;
    const fetch = fetchReturning(207, body);
    const result = await propfindChildren(fetch, "https://nas/dav/book/", {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.children).toEqual(["/dav/book/a/", "/dav/book/b/"]);
  });

  it("404 视为空（书根目录还没建过）", async () => {
    const fetch = fetchReturning(404, "");
    const result = await propfindChildren(fetch, "https://nas/dav/book/", {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.children).toEqual([]);
  });

  it("非 207/404 ⇒ ok=false + 状态码与人话", async () => {
    const fetch = fetchReturning(401, "Unauthorized");
    const result = await propfindChildren(fetch, "https://nas/dav/book/", {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("请求带 Depth: 1 头与最小 propfind body", async () => {
    const fetch = vi.fn(async (init) => {
      expect(init.headers.depth).toBe("1");
      expect(init.body).toContain("propfind");
      return { status: 207, text: "<D:multistatus></D:multistatus>" };
    });
    await propfindChildren(fetch, "https://nas/dav/book/", {});
    expect(fetch).toHaveBeenCalled();
  });

  it("fetch 抛错回 ok=false + status=0", async () => {
    const fetch = fetchThrowing("timeout");
    const result = await propfindChildren(fetch, "https://nas/dav/book/", {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(0);
  });
});

describe("webdav-client · propfindEntries", () => {
  it("207 ⇒ 解析出带 isDir 的项（与 propfindChildren 同一份请求、不同输出面）", async () => {
    const body = `<D:multistatus xmlns:D="DAV:">
  <D:response><D:href>/dav/book/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response>
  <D:response><D:href>/dav/book/chapters/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response>
  <D:response><D:href>/dav/book/book.json</D:href><D:propstat><D:prop><D:resourcetype/></D:prop></D:propstat></D:response>
</D:multistatus>`;
    const fetch = fetchReturning(207, body);
    const result = await propfindEntries(fetch, "https://nas/dav/book/", {});
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.entries).toEqual([
        { path: "/dav/book/chapters/", isDir: true },
        { path: "/dav/book/book.json", isDir: false }
      ]);
  });

  it("404 视为空（这一格远程没有）", async () => {
    const fetch = fetchReturning(404, "");
    const result = await propfindEntries(fetch, "https://nas/dav/book/", {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.entries).toEqual([]);
  });

  it("非 207/404 ⇒ ok=false + 状态码与人话", async () => {
    const fetch = fetchReturning(403, "Forbidden");
    const result = await propfindEntries(fetch, "https://nas/dav/book/", {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.message).toContain("Forbidden");
    }
  });

  it("fetch 抛错回 ok=false + status=0", async () => {
    const fetch = fetchThrowing("socket hang up");
    const result = await propfindEntries(fetch, "https://nas/dav/book/", {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(0);
  });
});

describe("webdav-client · getFile", () => {
  it("200 且带 bytes ⇒ 按字节原样回（图片等二进制件靠这一位）", async () => {
    const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    const fetch: WebdavFetch = vi.fn(async () => ({ status: 200, text: "ignored", bytes: data }));
    const result = await getFile(fetch, "https://nas/dav/book/a.png", {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(Array.from(result.data)).toEqual(Array.from(data));
  });

  it("200 只给 text（夹具路径）⇒ 按 UTF-8 编码成字节", async () => {
    const fetch = fetchReturning(200, "第一章");
    const result = await getFile(fetch, "https://nas/dav/book/a.md", {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(new TextDecoder().decode(result.data)).toBe("第一章");
  });

  it("用 GET 且不带 body；HEAD 那类语义不在这一层", async () => {
    const fetch = vi.fn(async (init) => {
      expect(init.method).toBe("GET");
      expect(init.body).toBeNull();
      return { status: 200, text: "ok" };
    });
    await getFile(fetch, "https://nas/dav/book/a.md", {});
    expect(fetch).toHaveBeenCalled();
  });

  it("非 200 ⇒ ok=false + 状态码与 body 摘要", async () => {
    const fetch = fetchReturning(404, "Not Found");
    const result = await getFile(fetch, "https://nas/dav/book/a.md", {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.message).toContain("Not Found");
    }
  });

  it("fetch 抛错回 ok=false + status=0 + 人话", async () => {
    const fetch = fetchThrowing("connection reset");
    const result = await getFile(fetch, "https://nas/dav/book/a.md", {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(0);
      expect(result.message).toContain("connection reset");
    }
  });
});
