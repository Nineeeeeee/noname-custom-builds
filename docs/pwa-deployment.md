# 离线 PWA 与 Cloudflare 大厅

实现日期：2026-10-05。原设计见 `pwa-implementation-plan.md`；本文件记录实际操作。

## 地址与玩家使用

- 游戏：`https://play.491528.xyz/launcher.html`。首次完整资源发布前显示准备发行内容，不能进入游戏。
- 大厅：`wss://lobby.491528.xyz`，健康检查 `https://lobby.491528.xyz/health`。
- 备用游戏地址：`https://noname-pwa-host.kartsim-pwa-cloudflare.workers.dev`。
- 备用大厅地址：`wss://noname-lobby-host.kartsim-pwa-cloudflare.workers.dev`。

固定使用同一个游戏域名安装。不同域名的数据隔离，切换域名不会搬迁存档。

首次联网打开启动器，点击“完整下载”，等待“完整安装已就绪”。完整内容约 1.34 GB，建议设备预留至少 3 GB，实际能否安装取决于浏览器给本站的存储配额。中断后再次打开继续下载，已经校验的文件会复用。Chrome/Edge 可点击安装按钮或浏览器菜单安装；iPhone/iPad 使用 Safari 分享菜单“添加到主屏幕”。完整安装后关闭浏览器，再断网打开即可单机游玩。

联机需要联网，在游戏中选择“联机”，连接完整地址 `wss://lobby.491528.xyz`，由一位玩家建房，其他玩家进入。Electron 使用同一个地址，建议所有玩家使用同一份源码发行版本。房主运行游戏规则与 AI，房主断开会结束房间；大厅只管理连接和转发消息。

联网发现新发行版时返回启动器更新；按文件 SHA-256 下载差异，保持配置、录像、自定义素材、用户扩展和编辑后的文件。已打开的游戏窗口固定其原发行文件，新窗口使用更新后的发行版。发行更新期间在线入口显示维护；完全断网时已经完整安装的版本仍可使用。资源缺失或损坏可运行“完整性检查与修复”。不要清除本站数据，否则本地安装与存档也会丢失。

## 资源与凭据

Cloudflare 账号 `d8b2e1f89db7e58447e0ca535a1def7f`。本项目只使用新建 `noname-pwa` 私有 Standard R2 桶，固定前缀 `noname-pwa/`，不操作 `kairisei`。独立 Worker 分别为 `noname-pwa-host` 和 `noname-lobby-host`，首版共享 SQLite Durable Object `friends-v1`。未升级付费套餐。

本机 Worker 部署沿用 Wrangler OAuth，无需另给本机 API Token。批量 R2 发布使用桶限定 Object Read & Write S3 凭据。GitHub Actions 在独立机器运行，需要自己的 `CLOUDFLARE_API_TOKEN`；不能继承本机 OAuth。

通过 SSH 运行以下脚本，输入不会显示，也不会成为命令参数。Workers Token 可暂留空以先完成本机发布；配置 Actions 前必须补齐。

```bash
sudo bash /home/fengxuwen/noname/scripts/pwa/prepare-credentials.sh
```

它生成 root 可读、权限 600 的 `/tmp/noname-pwa-deploy.env`。不要把密钥写入源码、提交、文档或聊天。发布完成后删除此临时文件。

## 本机正式发布

本次按用户最新要求跳过额外内容完整性校验，使用 `NONAME_PWA_VERIFY=0 pnpm build:pwa` 和 `pnpm pwa:publish -- --no-verify`。保留文件哈希用于差异更新，保留发布目标限制、维护状态和并发所有权检查。

先在 `my-features` 提交源码，再构建以记录实际提交 SHA。普通修改只改源码，不手工修改 `dist/`，不维护 `lan-ai-server/public/`。

```bash
wrangler whoami
pnpm install --frozen-lockfile
pnpm test:pwa
pnpm exec tsc -p apps/core/pwa/tsconfig.json
pnpm exec tsc -p packages/pwa-host/tsconfig.json
pnpm exec tsc -p packages/server-worker/tsconfig.json
pnpm build:pwa
pnpm pwa:verify
source /tmp/noname-pwa-deploy.env
export PWA_PUBLIC_ORIGIN=https://play.491528.xyz
pnpm pwa:plan
pnpm pwa:publish
```

`dist/` 是唯一完整发行产物；`output/pwa/` 是自动生成的传输对象、分块包、清单和部署壳。校验器检查目录集合、所有文件字节与哈希、每个包的哈希及全部解包内容。ZIP STORE 目标约 8 MiB，上限 16 MiB。

发布脚本先校验本地材料，再用条件写入获取发布所有权并进入维护。先删除新清单不引用的旧对象，再上传新对象；新上传或未获得前次验证证明的对象下载回读校验。部署壳、验证清单与云端对象集合、验证实际 HTTPS 壳字节，最后开放 ready。R2 只留当前游戏发行，原始对象与安装包合计约 2.7 GB；不保留历史包、回滚或备份。Workers 平台会记录自己的部署版本。

失败保持维护，不自动恢复旧版。确认前一个发布进程已结束后，修复原因并运行 `pnpm pwa:publish -- --resume`。不要在另一个发布进程还运行时执行恢复；条件写入会拒绝并发抢占。取消或上传中断留下的文件由下次发布按目标清单清理。

大厅独立部署，不随游戏资源发布：

```bash
pnpm deploy:lobby
```

大厅部署安排在没有正在进行的对局时；部署可能断开 WebSocket。DO 休眠后从连接附件和 SQLite 存储恢复拓扑，定时器使用持久 alarm，不在每条游戏转发时写数据库。断连后清理房间与成员，不能通过另一个房间发送消息到任意玩家。

## GitHub Actions

仅个人 fork `Nineeeeeee/noname-custom-builds` 的 `my-features` 可以发布。先确认首次正式发布可用，再配置 `pwa-production` Environment：

- Secrets：`CLOUDFLARE_API_TOKEN`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`。
- Variable：`PWA_PUBLIC_ORIGIN=https://play.491528.xyz`。

在加载上述临时凭据后运行 `pnpm pwa:configure-actions`。脚本固定个人仓库，将 Secrets 通过标准输入发送给 `gh`，不输出内容。

每次推送前单独核实 `git remote get-url --push origin` 确认个人仓库，并明确推送 `HEAD:refs/heads/my-features`。严禁推送 upstream。首次推送后检查“Publish offline PWA”运行结果与线上 ready 提交；随后该分支更新自动构建发布。“Publish Cloudflare lobby”只接受手动触发。

工作流固定 Node 24.13.0、pnpm 9.15.9、Wrangler 4.147.0，冻结全部工作区 lockfile。凭据只提供给最后的发布步骤。PWA 发布串行，不取消正在上传的发布；过时提交在发布前核对远端分支并跳过。

## 验证范围与限制

自动检查：构建失败传播、完整发行与分块校验、中文路径与文件覆盖、删除标记、空目录、追加截断、扩展原子导入、租约过期与多窗口互斥、缓存/数据库不一致、深度损坏检测、即时编译、Range/HEAD、维护先于边缘缓存、旧发行拒绝、越界删除拒绝。

真实 Chromium 测试入口：`pnpm test:pwa:browser`。它只启动自己的独立 HTTP 夹具，游戏请求必须来自本地安装，不用静态游戏服务器兜底。结果写入 `output/pwa-browser-results.json`，测试使用持久测试 profile，不触碰玩家数据。测试覆盖完整安装/暂停继续、关闭整个浏览器后离线启动、本地 TS/Vue 编译与编辑、媒体 Range、两文件差异更新、旧窗口版本固定、用户文件保留、单文件损坏修复及在线维护。

大厅协议测试：`NONAME_TEST_LOBBY=wss://lobby.491528.xyz NONAME_TEST_HEARTBEAT=1 node --import tsx tests/pwa/lobby-live.ts`，独立测试玩家会在结束时关闭连接。包含真实建房/入房、512 KiB 转发、房间隔离、alarm 心跳、空闲后继续转发和房主断开清理。延迟数据只是测试消息，不能代表实际游戏体验。

Windows、Android、iPhone/iPad 真机安装、存储回收、音频播放和真实内存峰值必须由持有设备者验收。Linux Electron/Chromium 协议检查不能代替 Windows exe 完整混合对局。全部模式和扩展文件均保留，自动加载代码库存不代表每种模式与第三方扩展都完成一场完整对局；依赖 Node、原生插件或外部服务的第三方扩展需要对应环境，PWA 不提供这些能力。

2026-10-05 已执行：13 项自动测试、三个运行时类型检查、修改范围 ESLint、冻结依赖安装和正式全量构建校验均通过。首次全新安装暂停后复用了 85 个已校验文件；浏览器关闭且测试源服务器停止后离线冷启动通过，276 个模式/卡牌/武将/扩展代码文件离线读取通过，两人身份 AI 对局完成 7 轮。真实 ZIP 导入、TS/Vue 编译、模块 Worker 返回 42 通过；两文件差异更新仅请求 2 个对象、共 2453 字节，完整性修复仅请求 1 个对象。配置、录像、图片、音频的游戏数据库记录和用户扩展编辑文件保持不变，无页面脚本异常。

公网大厅建房、入房、512 KiB 双向转发、权限隔离、65 秒空闲后的 alarm 心跳与继续转发、房主断开清理均通过。实际 Linux Electron 39.8.10 与 PWA 游戏页面的房间及双向协议转发通过；这是协议验证，不等于 Windows 完整混合对局验收。

当前源码本来缺少部分被游戏引用的资源，例如 `image/character/hanxuan.jpg`、`image/character/dengwantang.jpg` 和 `audio/card/male/tao.mp3`，测试可观察到对应 404；这些文件不在源码和构建发行目录中，不是安装漏文件。未用其他内容冒充缺失资源。TS 扩展先尝试 `.js` 再加载 `.ts` 的正常回退也会出现一次 404。全部单机模式的完整对局、全部扩展组合、手机内存峰值、实体设备音频与桌面安装仍需验收。

免费额度为账号共享；新增资源不等于免费配额独占，也不保证永远不超限。监控 Cloudflare Workers/R2 用量，出现超限时先检查流量与资源变化，不自动升级套餐。
