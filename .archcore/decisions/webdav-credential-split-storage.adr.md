---
title: "WebDAV credentials are stored in two parts"
status: accepted
tags:
  - "security"
  - "webdav"
---

## Context

WebDAV 远程备份需要用户的三件凭据：URL、用户名、密码。三件同存配置文件的话，密码就以明文落在界面可读的位置；而现有 CSP 白名单规则又要求网络请求与配置读写都收在主进程。

## Decision

凭据分份存：URL 与用户名进配置文件，密码单独进 credential-store。网络请求、配置读写、密钥处理全部在主进程执行，主进程外不返回明文密码。

### Rationale

- 明文密码的暴露面缩到 credential-store 一处。
- 网络请求留在主进程，与现有 CSP 白名单规则不冲突。

## Alternatives Considered

1. 三件凭据同存配置文件 —— 否决，因为密码会明文落在界面可读的位置。
2. 把网络请求放到渲染进程 —— 否决，因为会与现有 CSP 白名单规则冲突（提交 e6c5460，项目台账第六十八节）。

## Consequences

### Positive

- 主进程外拿不到明文密码。
- 与既有 CSP 规则不冲突。

### Negative

- 凭据读取路径分成两处；缓解：读写只在主进程侧发生，调用方只拿配置对象。

### Risks

- 备份文件含作品内容，远程目录若被他人可读即外泄 —— 缓解：远程权限由用户自设，本仓不做额外加密 [assumption]。

## Implementation Notes

- 路径拼接：空后缀会让根层 PROPFIND 被误判为成功，需在拼接处提前挡住。
- 本地备份逻辑保持不变：远端拉回与 `restoreBookBackup` 同结构。
- 五条 WebDAV 通道各自落到带参形状表或无参清单，并在 `IPC_DENY_REPLIES` 配失败回会。
