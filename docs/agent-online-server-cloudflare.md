# 联机大厅公网 Docker 部署

本 reference 记录独立联机大厅的目标部署方式。游戏大厅不再使用 Cloudflare
Tunnel；目标是在 Ubuntu 公网服务器上运行 Docker 容器，让 Electron 客户端
直接连接 `公网IP:8082`。涉及游戏内容或开服产物更新时，仍必须遵循根目录
`AGENTS.md` 的停服、构建、重启流程。

## 服务与端口

| 服务 | 端口 | 作用 |
| --- | --- | --- |
| `noname-lobby` Docker 容器 | `8082` | WebSocket 联机大厅：发现房间、加入房间及转发房间消息。 |
| 客户端“启动服务器” | `8080` | 临时由房主客户端直接监听的旧式局域网房间；与独立大厅不同。 |

独立大厅不是自行运行一局游戏的 AI 服务器。玩家进入大厅后仍由“创建房间”的玩家客户端作为游戏房主；该玩家退出，房间会关闭。

玩家都使用 Electron 客户端时，服务器不需要运行 `lan-ai-server/server.mjs`，
也不需要保存游戏的 `dist/`。

## Docker 构建与导出

具体命令和 Ubuntu 运行参数见
`packages/server/README.md`。仓库内构建入口：

```bash
cd packages/server
docker compose up -d --build
docker save -o noname-lobby-1.11.4.1.tar noname-lobby:1.11.4.1
```

正式分发的镜像使用 Node 24、非 root 用户、只读文件系统、健康检查和
`restart: unless-stopped`。

个人仓库的 `Build Windows and Android Release` GitHub Actions 工作流会在
同一个 Release 中额外生成两种大厅包：

- `noname-lobby-docker-linux-amd64-*.tar`：已构建的 Docker 镜像，使用
  `docker load -i` 导入。
- `noname-lobby-node-*.zip`：包含编译结果和生产依赖，Node.js 20 或更高版本
  解压后可直接运行，无需再次安装依赖。

Node 分发包的启动方式和 Docker tar 的导入方式见
`packages/server/README.md`。

## Ubuntu 公网服务器

服务器需要同时满足：

1. Docker 已安装并正在运行。
2. 云厂商安全组允许入站 TCP `8082`。
3. Ubuntu 防火墙允许 TCP `8082`。
4. Docker 容器发布 `0.0.0.0:8082 -> 8082/tcp`。

Electron 客户端联机地址直接填写：

```text
服务器公网IP:8082
```

该连接是未加密的 `ws://`，大厅也没有账号认证。公开端口可能被任意互联网
用户扫描或连接；若玩家来源 IP 固定，应优先只允许这些来源 IP。

## 旧 Cloudflare 配置

`fairy` 上的同一个 Cloudflare Connector 还承载 `nine.491528.xyz` 和
`id.491528.xyz`，不能为了停用游戏域名而直接停止整个 `cloudflared` 进程。
旧的 `game.491528.xyz -> localhost:8082` 路由可单独从 Tunnel 配置和
Cloudflare 控制台删除，但它不再是游戏大厅部署的一部分。

## 排障

- 容器退出：检查 `docker logs noname-lobby`。
- 容器健康但外网连不上：依次检查云安全组、UFW 和 Docker 的端口发布。
- 服务器本机验证：检查 WebSocket 请求是否返回 HTTP `101 Switching Protocols`。
- 只有网页端失败：HTTPS 网页会阻止未加密的 `ws://公网IP:8082`；当前直连方案面向 Electron 客户端。
