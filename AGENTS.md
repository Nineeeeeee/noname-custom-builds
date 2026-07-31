# 无名杀项目 Agent 指引

本文件只保留 Codex/Agent 每次启动任务都应优先读取的高频规则。长篇项目背景、模块说明和打包细节已抽到 `docs/agent-*.md` reference。

## 0. 仓库操作约束

- 官方仓库 `https://github.com/libnoname/noname` 仅可用于拉取和同步上游改动，严禁向其执行任何 `git push` 或等价远端推送操作。
- 仅在用户明确要求时，允许把本仓库分支推送到用户个人仓库 `https://github.com/Nineeeeeee/noname-custom-builds`；不得推送到除此之外的任何远端。
- 远端应配置为：`upstream` 指向官方仓库且禁用 push，`origin` 指向用户个人仓库。每次推送前必须再次核对 push URL，确认目标严格等于用户个人仓库。
- 允许按用户要求创建本地 commit；未经用户明确要求时，所有修改仍应只保留在本地。
- 涉及游戏内容、扩展、资源或开服产物的任何修改，必须走正式流程：先关停当前 `lan-ai-server` 服务，再修改源码并重新构建/打包，让根目录 `dist/` 成为最新产物，最后重新开服验证。
- 仓库内不再为了开服长期维护第二份 `lan-ai-server/public`。严禁为了即时生效直接热补丁构建产物。

## 1. 项目速览

- 项目：无名杀（Noname），HTML5 + TypeScript 卡牌游戏。
- 当前版本：`1.11.4.1`
- 仓库地址：`https://github.com/libnoname/noname`
- 运行环境：Chromium >= 91 / Safari >= 16.4
- 包管理：`pnpm 9`
- 主要构建工具：Vite 7、tsup、electron-builder

关键目录：

```text
apps/core/        主游戏应用、资源、模式、武将、卡牌
apps/electron/    Electron 桌面端
packages/server/  WebSocket 联机服务器
packages/extension/ 扩展放置目录
lan-ai-server/    常用可分发/局域网开服工具目录
dist/             仓库内唯一构建产物源
output/           Electron 安装包和分发 zip 输出目录
docs/             项目文档和 Agent reference
```

更多项目结构、核心模块、扩展模板和代码规范见：`docs/agent-project-reference.md`。

## 2. 常用命令

```bash
# 安装依赖
pnpm install

# 开发服务器
pnpm dev

# 构建生产版本，输出到 dist/
pnpm build

# 启动离线服务预览构建结果
pnpm serve

# 构建 Windows Electron 桌面端
pnpm -F @noname/electron build:win

# 代码检查
pnpm lint
```

`pnpm build` 执行流程：

1. 构建主应用（Vite 构建 `apps/core`）。
2. 构建所有扩展。
3. 合并打包结果到 `dist/`，包含游戏代码、音频、图片、扩展、文档。

## 3. `lan-ai-server` 使用规则

用户后续可能频繁使用 `lan-ai-server/`。当用户提到“开服脚本”“可发给朋友玩的目录”“局域网开服目录”“Windows 双击运行包”等语义时，优先检查和使用：

- `dist/`：仓库内唯一构建产物源。
- `lan-ai-server/server.mjs`：Node.js 本地网页服务，默认监听 `0.0.0.0:8090`，仓库内默认服务根目录 `dist/`；最终分发包内才服务包里的 `public/`。
- `lan-ai-server/package-windows.mjs`：旧的 Node + bat 可分发包脚本，仅在用户明确要该方案时使用。
- `lan-ai-server/README.md`：该目录的开服和局域网使用说明。

维护规则：

1. 不要直接手工修改 `lan-ai-server/public/` 内的构建产物；该目录只应作为旧流程遗留或最终分发包内部结构。
2. 需要更新游戏内容时，先修改源码并重新构建，让根目录 `dist/` 保持最新。
3. 若正在运行 `lan-ai-server` 服务，修改/更新前先关停服务，更新后重新启动并验证 `http://127.0.0.1:8090/`。
4. `lan-ai-server/` 主要用于当前设备作为独立服务器或网页开服工具，不作为最终 Windows 玩家客户端首选分发形态。

## 4. Electron 玩家客户端架构

用户期望的最终分发/联机架构：

- 当前这台设备作为独立服务器，不参与游戏，只单独运行联机大厅服务（`@noname/server`，默认端口 `8082`）。
- 分发给玩家的是 Electron Windows exe。玩家双击 exe 后进入桌面游戏窗口，可单机打 AI，也可进入“联机”连接独立服务器。
- 不需要为“能联机”和“不能联机”打两种玩家包；同一个 Electron exe 同时支持单机和联机客户端能力。
- Electron exe 默认不需要启动联机大厅。联机时玩家在游戏内填写独立服务器地址：`服务器IP:8082`。
- 若所有玩家都使用 Electron exe，独立服务器只需要跑联机大厅；不需要额外提供网页静态服务。只有浏览器/手机也要加入时，才需要同时运行网页服务。

维护规则：

1. 更新游戏内容或资源时，先更新源码并运行 `pnpm build`，再生成新的 Windows 安装包/客户端。
2. 更新后把新的 Electron 安装包发给玩家覆盖安装；玩家本地配置/存档通常不会因覆盖安装被清空。
3. 联机大厅服务器可长期独立运行；只有联机服务代码或协议需要变化时才更新服务器端。
4. 为避免版本不一致导致联机问题，正式分发时尽量让所有玩家使用同一版 Electron 客户端，并记录服务器端对应版本。

Windows Electron 详细打包流程见：`docs/agent-windows-electron-build.md`。

## 5. Reference 路由

按任务需要读取对应 reference，不要默认把所有 reference 全量读入上下文：

- 项目结构、核心模块、扩展开发、代码规范：`docs/agent-project-reference.md`
- 已跑通的 Windows Electron 安装包流程：`docs/agent-windows-electron-build.md`
- 技能格式细节：`docs/lib-skill-format.md`
- 事件系统细节：`docs/game-event/`
- 启动流程：`docs/game-startup-flow.md`
- 本地运行：`docs/how-to-start.md`
- 联机大厅、局域网与 Cloudflare Tunnel：`docs/agent-online-server-cloudflare.md`
