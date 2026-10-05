# 独立联机大厅迁移 Cloudflare Workers 调研

日期：2026-10-05。本文保留设计阶段调研；实际已实现的大厅、验证范围与部署记录见 [部署维护说明](pwa-deployment.md)。

## 1. 结论

可以把当前抽离的联机大厅迁到 Cloudflare，让玩家直接连接 Cloudflare 的 WSS 地址，完全去掉大厅对小主机、Ubuntu Docker、Cloudflare Tunnel 或另一个代理服务器的依赖。

推荐方案是 **独立 Worker + 一个 SQLite-backed Durable Object**。现有 Node.js 包不能原样作为普通 Worker 上传，但大厅的消息协议、房间管理和转发逻辑可以复用。这是根据当前源码得出的迁移可行性结论，还不是实测上线结果。

游戏规则和 AI 仍由创建房间的玩家客户端运行。迁移大厅不会变成云端自动运行一局游戏；房主退出或被手机系统挂起，仍可能影响房间。

## 2. 当前源码为什么适合迁移

核心在 `packages/server/src/server/createServer.ts`，约 435 行；运行依赖只有 `ws`。服务器维护 `clients`、`rooms`、`events`，处理建房、入房、配置、在线列表、约战、封禁检查及消息转发，没有读取游戏素材或运行游戏引擎。

| 现有实现 | 迁移处理 |
| --- | --- |
| `new WebSocketServer({ port: 8082 })` | HTTP Upgrade → `WebSocketPair` → DO 接收连接，云端不监听玩家指定的 8082 端口 |
| 进程内 clients/rooms Map | 所有连接统一路由到同一个命名 DO，重建会话索引 |
| Client 上直接挂 owner/room 对象引用 | 改成 `ownerWsId`、`roomKey`，通过 ID 查连接，避免休眠后引用失效 |
| `setInterval` 每分钟发送字符串 heartbeat | DO Alarm 调度心跳和超时检查；保留旧客户端能识别的字符串协议 |
| 两秒 key 握手超时 | 保存截止时间，由统一 Alarm 检查，不承诺毫秒级定时精度 |
| `req.socket.remoteAddress` | 从 Worker 请求的 `CF-Connecting-IP` 取得来源地址，不使用客户端自报 IP |
| `client.on('message'/'close')` | DO `webSocketMessage`、`webSocketClose`、`webSocketError` |
| CLI、start/stop、SIGTERM | Worker 导出 fetch 与 DO 类；部署由 Wrangler 管理 |

Worker 的 Node HTTP 兼容层目前不支持 `upgrade` 事件和直接操作底层 socket，因此打开 `nodejs_compat` 不能直接解决当前 `ws` 服务端的运行问题。[Node HTTP 兼容限制](https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/)

## 3. 推荐结构

```text
PWA / Electron 玩家
        │ wss://lobby.491528.xyz/（候选域名）
        ▼
noname-lobby-host Worker
        │ 固定路由到 NONAME_LOBBY.idFromName("friends-v1")
        ▼
NonameLobby Durable Object：单个共享大厅
        ├─ 接收全部玩家 WebSocket
        ├─ 建房、入房、在线列表、约战
        ├─ 客机消息 → 房主；房主消息 → 指定客机
        └─ 连接附件 + 少量 SQLite 元数据

PWA 游戏资源另走 noname-pwa-host Worker + R2
```

DO 提供一个稳定的协调对象来管理同一大厅的连接。普通 Worker 在不同请求或地区可能运行于不同实例；把房间只放普通 Worker 的全局 Map，不能保证朋友看见和加入同一房间。[Workers/DO WebSocket 能力](https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/)

目前用户加朋友约 6 人，一个 DO 管全部房间足够作为首版设计，也能保留现有「单 WebSocket 进大厅后建房/入房」的交互。不按 IP、每个玩家、每次请求或随机值创建 DO，否则会把大厅拆开。以后规模增大再考虑「大厅索引 + 每房间 DO」，本期不增加跨对象转发协议。

大厅 Worker 与 PWA 发布 Worker 分开部署。更新图片、技能或 PWA 壳时不用部署大厅，避免每次游戏发布打断正在联机的人。

## 4. 协议兼容和客户端改动

保留当前 JSON 数组协议：

| 方向 | 保留的主要消息 |
| --- | --- |
| 客户端 → 大厅 | `["server", "key", ...]`、create、enter、changeAvatar、events、config、status、send、close |
| 大厅 → 客户端 | roomlist、updaterooms、updateclients、updateevents、createroom、enterroomfailed、onconnection、onmessage、onclose、selfclose、denied |
| 心跳 | 文本 `heartbeat`，先保持原客户端的被动回应方式 |

客机进入房间后，其原始游戏消息继续包在 `onmessage` 中交给房主，不在 DO 中执行消息里的游戏函数或技能代码。房主的 send/close 仍仅能操作归自己房间管理的连接。

`apps/core/noname/game/index.js` 的 `connect()` 已支持完整 WSS URL；已有 Electron 客户端理论上只需换联机地址，无需为 Cloudflare 更改协议，是否完全兼容由混合联机实测确认。

地址必须填写完整形式：`wss://lobby.491528.xyz`。当前代码对部分省略协议且不带端口的域名会自动补 `8080`，不能只告诉玩家填写裸域名。初次验证也可使用 `wss://noname-lobby-host.<账户子域>.workers.dev`，账户子域尚未查询，两个地址都不是已部署入口。

## 5. DO 休眠和状态恢复

使用 Hibernation API 的 `ctx.acceptWebSocket()`。休眠时连接保留但内存会被清空，唤醒后构造函数重跑，所以仅把原来的 Map 搬进 DO 仍然不完整。连接附件最大 16,384 字节，不能把任意大小的房间 config 全部塞进去。[休眠与连接附件](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)

建议按以下结构实施：

- 连接附件：`wsid`、`onlineKey`、昵称/头像、roomKey、ownerWsId、握手截止时间、心跳状态；控制每项大小。
- DO storage：当前房间 config、约战列表、封禁配置及过期时间。SQLite-backed DO 可以使用 storage 的 get/put，不要求先做复杂 SQL 表。
- 初始化：`ctx.getWebSockets()` 读取存活连接，反序列化附件，加载必要房间数据，重建 clients 和 owners 索引。
- 清理：没有存活房主的房间不恢复为可加入房间；清除失效配置。关闭/error 清理必须幂等，避免重复 onclose 和幽灵人数。
- 转发：消息只经内存/连接发送，不把每一条对局消息、录像或素材写入 DO 数据库；仅拓扑和配置变更才持久化。

保留旧客户端时，不能直接使用 heartbeat→heartbeat 自动回应替换现有服务端定时心跳：当前客户端只在收到 heartbeat 后回应，不会主动发起。首版通过单个 Alarm 管全部握手和心跳截止时间，保留一分钟发送、下一周期检查的行为。若以后客户端改成主动 ping，再使用 `setWebSocketAutoResponse()` 减少唤醒；这是可选升级，不是首版兼容前提。[自动回应机制](https://developers.cloudflare.com/durable-objects/api/state/)

休眠后恢复会话元数据，不等于断网后自动恢复整局。平台重启或大厅代码部署可能断开连接；官方明确说明代码更新会断开现有 WebSocket。大厅升级安排在无对局时，不能承诺无缝更新。[部署断连说明](https://developers.cloudflare.com/durable-objects/best-practices/websockets/#websocket-standard-api)

## 6. 成本和限制

DO 已支持 Workers Free，免费计划需要 **SQLite-backed** 类，Wrangler migration 应使用 `new_sqlite_classes`。当前 DO 免费配额为每日 100,000 请求、13,000 GB-s 时长，以及 SQLite 每日 500 万行读、10 万行写、总计 5 GB 存储。WebSocket 入站消息按 20:1 折算计费请求，出站消息不收该项请求费用；实际是否触及免费配额仍要结合 usage 看。[DO 计费](https://developers.cloudflare.com/durable-objects/platform/pricing/)

为当前人数估算：如果 6 人每日玩 4 小时，平均每人每秒发 1 条消息，共 86,400 条入站消息。一个 DO 即使这 4 小时都活跃，按文档的 0.128 GB 分配内存估算约 1,843 GB-s。两者都只是设定条件下的预算，**没有测量本游戏的真实消息率**；技能同步可能突发，实际测试要记录总消息数、最大消息大小和峰值转发延迟。

初步判断这个人数可以先用 Free 验证；不能由「只有 6 人」推导一定零费用。额度账号共享，未知的其他 Workers/DO 用量也要考虑。PWA R2 下载费用单独计算。

DO 入站 WebSocket 单条消息上限为 32 MiB。运行时最多接收上限不是建议的游戏消息大小；应用限制应根据完整建房、初始化和重连消息的实测峰值决定，不能随手设很小导致部分模式进不去。[DO 限制](https://developers.cloudflare.com/durable-objects/platform/limits/)

所有玩家消息最终经过同一个 DO 的实际部署地点，并非每个玩家都在本地边缘完成相互转发。大陆访问路径和延迟需要朋友的真实网络测试；首次创建可以考虑 `apac` locationHint，但提示不是具体城市保证，不能仅凭 Cloudflare 边缘节点数量承诺低延迟。[DO 数据位置](https://developers.cloudflare.com/durable-objects/reference/data-location/)

## 7. 如果希望尽量原样运行 Node 包

另一个可行方向是 **Cloudflare Containers**：现有 `packages/server/Dockerfile` 可以作为容器适配起点，由 Worker 转发 WSS 到容器内 8082，不用玩家连接小主机。Cloudflare 有 WebSocket→Container 的官方示例。[官方容器示例](https://developers.cloudflare.com/containers/examples/websocket/)

| 选项 | 改动 | 费用和维护判断 |
| --- | --- | --- |
| Worker + SQLite DO，推荐 | 重写连接、心跳、状态恢复，复用大厅协议 | 可从 Free 验证；最符合小人数、消息转发的形态 |
| Worker + Containers | 保留 Node/ws/Docker 主体，增加容器路由和生命周期适配 | 当前需要 Workers Paid；容器 CPU、内存、磁盘及网络用量按规则计算 |
| Worker 代理回小主机 | 很少 | 仍依赖小主机，不满足本次目标 |

Containers 的付费计划当前以 $5/月 Workers Paid 为基础，并按容器实际使用计算包含额度和额外费用，不是 $5 保证全包。原本只在进程内的房间仍会受容器重启影响；必须固定共享容器路由、检查运行用户/健康检查兼容性，不能简单随机把连接分到不同容器。[Containers 计费](https://developers.cloudflare.com/containers/platform/pricing/)

本项目大厅很小且没有原生依赖，为保留 Node 运行时付费不如直接做 DO 适配。Containers 留作「尽量少改源码」时的替代选项。

## 8. 拟新增配置和实施顺序

建议新包 `packages/server-worker/`，与现有 Node 包并存。以下配置只是草案，还没有对应源码可部署：

```jsonc
{
  "name": "noname-lobby-host",
  "main": "src/index.ts",
  "account_id": "d8b2e1f89db7e58447e0ca535a1def7f",
  "compatibility_date": "2026-10-05",
  "workers_dev": true,
  "preview_urls": false,
  "durable_objects": {
    "bindings": [
      { "name": "NONAME_LOBBY", "class_name": "NonameLobby" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["NonameLobby"] }
  ]
}
```

实施工作：

1. 抽出可共享的纯协议处理和房间规则，保留 Node adapter；清晰划分连接、时钟和状态保存依赖。
2. 新增 Worker/DO adapter，完成附件恢复、Alarm、发送/关闭权限检查及输入验证。
3. 对关键行为做自动验证：握手、创建/加入、满员/观战配置、双向转发、房主离线、休眠恢复、错误与重复 close、多房间隔离、约战。
4. 检查现有进入失败路径：当前源码在确认配置允许进入前已设置 client.room。迁移时避免复制这个副作用，失败加入者不计入房间人数。
5. 在用户要求实施和部署后，用已登录的全局 Wrangler 发布独立测试入口；不重启或关闭现有小主机大厅。
6. PWA 与同版本 Electron 实机联机，完成一局、重连、空闲心跳和手机前后台测试；测延迟及免费额度。
7. 核实域名后绑定候选 `lobby.491528.xyz`，玩家切换完整 WSS 地址；全部通过再按用户要求处理旧服务器。

Worker 只公开必要升级入口和健康响应；legacy onlineKey 是客户端标识，不是账号认证。可先加连接数、消息大小和速率边界；若用户需要只有朋友能加入，另设计兼容的访问令牌，不把 Cloudflare Access 登录页直接套在旧 WebSocket 客户端上。

实施不需要 R2 存游戏素材，不需要另一台 Ubuntu 或公网 8082，不需要为本期新增 D1/Redis。已有 PWA 部署凭据可以按适当权限复用；本轮未创建 DO namespace，也未查询账号实际付费计划。
