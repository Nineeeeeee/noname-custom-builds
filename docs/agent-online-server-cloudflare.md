# 联机大厅与 Cloudflare Tunnel

本 reference 记录当前 `fairy` 主机的网页联机、局域网联机和公网 Cloudflare Tunnel 配置。涉及游戏内容或构建产物更新时，仍必须遵循根目录 `AGENTS.md` 的停服、构建、重启流程。

## 服务与端口

| 服务 | 端口 | 作用 |
| --- | --- | --- |
| `lan-ai-server/server.mjs` | `8090` | 服务根目录 `dist/` 的网页游戏；浏览器、iPad 等设备需要它加载游戏。 |
| `@noname/server` | `8082` | WebSocket 联机大厅：发现房间、加入房间及转发房间消息。 |
| 客户端“启动服务器” | `8080` | 临时由房主客户端直接监听的旧式局域网房间；与独立大厅不同。 |

独立大厅不是自行运行一局游戏的 AI 服务器。玩家进入大厅后仍由“创建房间”的玩家客户端作为游戏房主；该玩家退出，房间会关闭。

## 当前 `fairy` 配置

- Cloudflare Tunnel：`nine-tunnel`
- Tunnel ID：`24c11584-6896-4e08-8bac-45c632525b5a`
- 公网大厅域名：`game.491528.xyz`
- Cloudflare Published Application Route：`game.491528.xyz` → `http://localhost:8082`

`localhost` 指的是运行 Cloudflare Connector 的 `fairy` 主机。Tunnel 已有健康的 Connector 时，不要重复创建 Tunnel 或额外运行带 token 的 Connector；只需保证本机 `8082` 大厅在运行。

## 启动与验证

浏览器玩家需要同时启动网页服务和大厅：

```bash
cd /home/fengxuwen/noname/lan-ai-server
setsid -f node server.mjs

cd /home/fengxuwen/noname
setsid -f pnpm -F @noname/server dev
```

启动后应确认本机大厅能完成 WebSocket 连接；`8082` 已被占用通常表示已有大厅进程，不应再启动第二份。

## 玩家连接地址

| 场景 | 游戏网页/客户端 | 联机地址 |
| --- | --- | --- |
| 同一局域网、浏览器/iPad | `http://192.168.1.23:8090/` | `192.168.1.23:8082` |
| 外网、Electron 或网页 | 自己的 Electron，或可访问的网页服务 | `wss://game.491528.xyz` |
| 客户端临时“启动服务器” | 任意同版本客户端 | `192.168.1.23:8080` |

局域网优先使用 `192.168.1.23:8082`，延迟通常低于绕行 Cloudflare 的公网域名。

## WSS 必须显式填写

网页端联机设置默认 `wss_mode` 为关闭；当玩家只填域名时，客户端会默认拼成 `ws://`，并可能补用 `8080`，不能匹配 Cloudflare Tunnel 的 HTTPS/WSS 入口。

因此使用公网大厅时，必须在输入框完整填写：

```text
wss://game.491528.xyz
```

不要只填 `game.491528.xyz`，也不要填 `ws://game.491528.xyz` 或 `game.491528.xyz:8082`。

## Cloudflare 控制台新增/检查路由

在 `Networks → Tunnels → nine-tunnel → Routes → Add a published application` 中填写：

- Hostname：`game`
- Domain：`491528.xyz`
- Path：留空
- Service Type：`HTTP`
- Service：`localhost:8082`

WebSocket 在这里使用 `HTTP` 路由即可：客户端先以 HTTPS 发起 WebSocket Upgrade，Cloudflare Tunnel 再转发到本机的 HTTP/WebSocket 服务。不要把 Cloudflare 橙云代理直接指向公网 `:8082`；该端口不在常规代理端口列表中。

## 排障

- iPad/网页“连接失败”、但 Electron 可连：首先检查是否填写了完整的 `wss://game.491528.xyz`。
- 域名能解析却无法连接：检查 Tunnel 状态为 Healthy、Published Application Route 已保存，以及本机 `8082` 大厅正在运行。
- 局域网设备打不开网页：检查 `8090` 服务、防火墙、同一 Wi-Fi，以及使用的局域网地址是否为 `192.168.1.23`。
- 联机速度较慢：公网流量会经 Cloudflare 边缘回到 `fairy`；同局域网玩家改用局域网 `IP:8082`。
