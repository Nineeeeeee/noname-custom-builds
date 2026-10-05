# 无名杀完整离线 PWA 实施方案

文档日期：2026-10-05。本文保留原实施设计；实际源码、部署状态与操作见 [部署维护说明](docs/pwa-deployment.md)。

本轮已实机确认 Wrangler 和 Cloudflare 账号条件，并将部署、凭据、发布脚本及开发顺序补充到可执行设计。账号已登录和 R2 已开通，不等于 PWA 已完成；本文的部署命令及新增脚本仍是后续实施步骤。

本文依据当前仓库源码及用户已经确认的要求编写。文中的新增路径、命令、协议和配置均是待实现设计，不代表仓库已经提供对应功能。实际实施仍须遵循根目录 `AGENTS.md`。

## 1. 已确定的交付范围

第一期交付完整离线 PWA 客户端，不按模式、武将、扩展或语音裁剪内容。

- 下载当前发行版的全部游戏文件，保留全部模式、武将、卡牌、图片、音频、字体、主题和扩展。
- 下载完成后，关闭浏览器或 PWA，断网重新打开，仍能启动游戏并进行单机对局。
- 保留配置、录像、自定义素材，以及扩展导入、编辑、导出、启停和删除等浏览器能够实现的功能。
- 联网时保留联机大厅和在线获取内容的功能；联机与获取未安装的在线内容需要网络。
- 面向用户及不超过 5 位朋友，采用单一发行渠道，不建设账号系统、云存档或多渠道发布平台。
- 用户 fork 的指定发行分支更新后，自动构建并发布，玩家按文件差异更新。
- 云端只保留当前发行版，不保留历史版本、回滚包或备份；发布时允许停用联网入口。
- 发布失败保持维护状态，修复后继续发布，不自动恢复旧版。

维护状态约束联网入口和云端资源请求。已经完整安装的客户端，在完全断网时仍能运行本地内容。服务器无法撤销离线资源，这一行为已经获得用户接受。

“完整内容”以该次构建的完整发行目录为准。任何第三方扩展若依赖 Node.js、原生插件或外部服务，需要逐项适配；PWA 本身不提供这些运行环境。发现现有内容不兼容时，应在第一期修复或明确记录实际阻碍，不能通过静默删包来通过验收。

## 2. 现状与需要解决的问题

2026-10-05 对现有 `dist/` 的只读统计：

| 项目 | 文件数 | 原始大小 |
| --- | ---: | ---: |
| 音频 | 9,572 | 646,655,787 字节，约 647 MB |
| 图片 | 4,110 | 552,694,112 字节，约 553 MB |
| 全部文件 | 15,625 | 1,339,178,679 字节，约 1.34 GB / 1.25 GiB |

统计对象是现有产物，不保证已经对应最新源码。正式发行必须从确定的源码提交重新构建，再生成清单；不能拿本机旧 `dist/` 直接发布。

当前扩展目录包括：`3D精选`、`boss`、`cardpile`、`coin`、`my-wudi`、`杀海拾遗`、`欢乐卡牌`、`玩点论杀`、`英雄杀`。这个列表只是当前基线，实施时自动发现，后续新增扩展也进入全量包。

| 已有位置 | 现状 | 实施要求 |
| --- | --- | --- |
| `apps/core/manifest.webmanifest`、`apps/core/index.html` | 已有安装描述、横屏和独立窗口配置，主要使用 SVG 图标 | 增加启动器入口、稳定应用 ID、PNG 和 Apple 安装图标 |
| `packages/jit/src/entry.ts` | 新会话会主动注销 Worker，还会执行编译探测 | PWA 分支取消主动注销，以控制权和协议握手决定启动 |
| `packages/jit/src/service-worker/index.ts` | 用于即时编译，限定本地主机名和部分路径，激活后通知所有页面刷新 | 新增统一 PWA Worker，复用编译策略，移除这些限制及强制刷新 |
| `packages/jit/src/service-worker/compile-strategy.ts` | 编译时通过 `fetch` 重新读取源文件 | 注入本地读取函数，离线时直接读取安装文件或用户文件 |
| `apps/core/noname/init/browser.js` | 文件操作依赖 `/checkFile`、`/readFile` 等后端接口 | 增加 PWA 本地文件适配，覆盖完整读写和目录操作 |
| `apps/core/noname/init/index.ts` | 启动时读取静态配置和文件系统，使用 IndexedDB 保存数据 | 提前安装文件适配，保证首次启动和离线启动都能执行 |
| `apps/core/noname/init/import.ts` | 通过绝对路径和动态 import 加载模式、武将、扩展 | 保持原有根路径，完整缓存动态依赖 |
| `apps/core/noname/library/fs/` | 已提供 `FileSystemAdapter` 和历史文件接口桥接 | 新适配器复用这套抽象 |
| `apps/core/noname/init/capacitor.js` | 已有读取静态资源和目录清单的适配 | 借鉴目录索引思路；不能直接替代需要写入能力的 PWA 适配 |
| `apps/core/scripts/build.ts` | 保留模块结构和稳定文件名，产物含源码副本 | 版本识别使用内容哈希，不能仅依赖文件名 |
| `scripts/build.ts` | 构建、扩展构建后合并到根 `dist/` | 生成 PWA 清单必须在合并之后；补齐子进程失败退出检查 |
| `apps/core/game/asset.json` | 资源列表未覆盖全部代码、扩展和部分素材 | 保留游戏用途，另建完整发行清单 |
| `.github/workflows/build.yml` | `main` 更新触发构建并推送 `build-output` | 新建独立 PWA 发布工作流，直接发布 Cloudflare |

现有 `scripts/build.ts` 没有检查两个 `spawnSync` 的退出状态。必须先修正为任一构建失败立即终止，避免把缺失文件或旧产物当成完整发行版。

### 2.1 本轮实机核实结果

| 项目 | 2026-10-05 核实结果 | 实施决定 |
| --- | --- | --- |
| Wrangler | 全局命令可用，版本 `4.147.0` | 本机直接使用现有命令；CI 固定同版本，不添加游戏运行时依赖 |
| 登录 | `wrangler whoami` 成功，邮箱 `605871798@qq.com` | 沿用 OAuth，无需重新登录；不读取或复制凭据文件内容 |
| Cloudflare account ID | `d8b2e1f89db7e58447e0ca535a1def7f` | 写入部署配置；这是账号标识，不是密钥 |
| R2 | `wrangler r2 bucket list` 成功；当前列出 `kairisei` | R2 已开通；建议新建 `noname-pwa` 专用桶，不复用现有业务桶 |
| 当前源码分支 | `my-features` | 建议作为第一期 PWA 发布分支；这是方案默认值，尚未配置自动发布 |
| Git 远端 | `origin` 为个人 fork，`upstream` 为官方且 push 已禁用 | 新工作流仅允许个人 fork 发布，不推送官方仓库 |
| 构建工具链 | lockfile 为 `9.0`；个人客户端工作流使用 Node 24、pnpm 9 | PWA CI 使用 Node 24 和 pnpm 9；实施时将实际验证通过的补丁版本锁定 |
| 完整产物 | 重新只读统计仍为 15,625 文件、1,339,178,679 字节；最大文件 11,456,996 字节 | 原有容量估算有效，当前没有超过 25 MiB 的文件 |
| 大厅部署 | reference 为 Ubuntu Docker 公网 `8082` 直连；旧游戏 Tunnel 已停用方案 | 新增 HTTPS/WSS 代理入口，不恢复旧 Tunnel 或改动其他 Connector |

上述检查只读取账号和仓库状态，没有创建桶、上传资源、部署 Worker、修改 DNS 或操作任何服务器。

## 3. 总体架构

采用一个专用 HTTPS 子域名，例如 `play.example.com`。示例不是用户已经确定的真实域名。

```text
用户 fork 的发行分支
        │ GitHub Actions：构建、全量清单、校验、发布
        ▼
Cloudflare Worker ── R2 私有桶 / noname-pwa/ 专用前缀
        │                ├─ 状态和当前版本清单
        │                ├─ 按 SHA-256 存储的原始文件
        │                └─ 按 SHA-256 存储的分块安装包
        │ HTTPS，同一游戏域名
        ▼
PWA 启动器 → 完整下载 / 增量更新 → 游戏原有入口
        │
        ├─ Service Worker：路由、离线响应、编译、Range
        ├─ Cache Storage：启动器、完整发行文件、编译结果
        ├─ PWA 专用 IndexedDB：版本、目录、下载状态、用户文件
        └─ 游戏已有 IndexedDB：配置、录像、游戏数据

游戏联网 → WSS → 独立 Worker + Durable Object 大厅（迁移推荐，见第 11.2 节）
```

云端 Worker 与浏览器 Service Worker 是不同组件：前者运行在 Cloudflare，提供文件和维护状态；后者运行在玩家设备，负责离线访问。

不使用 iframe 包裹整个游戏，也不把游戏放进 `/noname/` 子路径。游戏已有大量根路径导入，保持专用域名根路径能减少改动。游戏内部原有的沙盒 iframe 仍需正常工作。

无需长期保存第二份 `lan-ai-server/public/`，无需让用户当前设备提供网页静态资源。独立大厅仍独立运行。

## 4. 源码布局和构建接入

建议新增以下模块，具体命名可以在实施时调整，职责必须保留：

| 拟新增路径 | 职责 |
| --- | --- |
| `apps/core/pwa/launcher.html`、`launcher.ts` | 安装、维护、更新、完整性检查页面；构建输出根路径 `/launcher.html` |
| `apps/core/pwa/protocol.ts` | 发行清单、状态协议、消息类型及版本常量 |
| `apps/core/pwa/storage.ts` | 内容缓存和 PWA 专用数据库访问，页面与 Worker 共享 |
| `apps/core/pwa/filesystem.ts` | 只读发行文件与可写用户文件的统一文件系统 |
| `apps/core/pwa/download-worker.ts` | 下载调度、分块解包、哈希和写入，不阻塞 UI |
| `apps/core/pwa/service-worker.ts` | 统一请求入口、本地文件响应、即时编译和媒体 Range |
| `apps/core/noname/init/pwa.ts` | 安装 `lib.fs`、历史 `game.*` 文件接口和平台能力 |
| `scripts/pwa/build.ts`、`package.ts`、`verify.ts`、`publish.ts` | 构建协调、全量打包、验证和发布 |
| `packages/pwa-host/` | Cloudflare Worker、Wrangler 配置和云端只读路由 |
| `packages/pwa-host/wrangler.jsonc` | 固定账号、专用桶 binding、壳资源目录与路由 |
| `scripts/pwa/cloudflare.ts` | S3 客户端、分页、差异计划、重试和条件状态写入 |
| `scripts/pwa/release-config.ts` | 固定仓库、分支、账号、桶、前缀和发布参数，拒绝环境变量误配 |
| `.github/workflows/pwa-publish.yml` | fork 指定分支自动发布 |

新增明确的 PWA 构建标记，如 `NONAME_TARGET=pwa`，在 Vite 中转换成编译期常量。不要仅凭浏览器 UA、域名或 `display-mode: standalone` 识别 PWA；未安装时的浏览器访问也使用相同能力。

只在必要接入点修改现有代码：

1. `apps/core/noname/entry.ts` 在 PWA 构建下优先加载 `init/pwa.ts`，在 `boot()` 前完成文件系统初始化。
2. `apps/core/scripts/build.ts` 和相关插件在 PWA 构建下加入启动器及统一 Worker，禁止再注入另一份 JIT 注册入口。
3. `apps/core/scripts/vite-plugin-importmap.ts` 生成的 `game/game.js` 也要识别 PWA 构建，不能保留另一处注销和重复注册逻辑。
4. `packages/jit` 将编译策略的源码读取能力抽成可注入依赖；默认环境保留原有行为，PWA 使用本地读取。
5. 游戏更新菜单在 PWA 构建下进入启动器的更新流程，不能沿用桌面端直接覆写发行文件的更新逻辑。
6. 图片、音频和扩展资源继续使用原有 URL，少量播放器属性和文件版本标记按实际兼容需求调整。

拟新增命令，实施后才可运行：

```text
pnpm build:pwa          从源码构建本体和扩展，合并到 dist，再生成 PWA 分发材料
pnpm pwa:verify         检查清单、原始文件、安装包及解包结果
pnpm pwa:publish        进入维护状态并发布已验证的分发材料
pnpm pwa:plan           只读列出目标桶差异、上传量和删除量，不修改云端
```

根目录 `dist/` 仍是唯一完整游戏产物源。`output/pwa/` 仅存放由它生成的清单、传输包、对象文件和 Worker 部署材料，不作为第二个长期网页服务根目录。

通过源码和构建插件生成 PWA 产物，禁止手工热补丁 `dist/`。普通开发检查不自动启动、停止或重启任何服务器。

## 5. 完整发行清单与传输格式

### 5.1 清单

在最终 `dist/` 合并完成后扫描全部普通文件，包含 `src/`、`docs/`、许可证和扩展文件，不按资源类型删减。安装包只包含一个正式发行快照，不包含仓库 `.git`、源码工作区依赖或发布凭据。

建议协议结构如下：

```typescript
interface ReleaseManifest {
  schemaVersion: 1;
  releaseId: string;
  commit: string;
  gameVersion: string;
  runtimeProtocol: number;
  compilerVersion: string;
  entry: "index.html";
  fileCount: number;
  totalBytes: number;
  files: Record<string, FileRecord>;
  directories: string[];
  packs: Record<string, PackRecord>;
}

interface FileRecord {
  sha256: string;
  size: number;
  contentType: string;
  packId?: string;
  packEntry?: string;
}

interface PackRecord {
  sha256: string;
  size: number;
  format: "zip-store-v1";
  files: string[];
}
```

`files` 的键为规范化的相对路径，例如 `extension/my-wudi/extension.js`。`directories` 保存规范化目录路径，包含空目录，保证文件系统枚举完整。

JSON 使用固定键序和稳定序列化。`releaseId` 可由提交 SHA 和不含 `releaseId` 字段的清单主体哈希生成，不能仅使用游戏显示版本号。填入 `releaseId` 后计算最终清单 SHA-256，将它放在云端状态对象中，避免循环引用。生成、校验与发布记录实际构建提交和工具链。

内容对象按 SHA-256 去重；相同内容在不同路径上出现时共享字节，响应类型由当前路径清单决定。R2 ETag 不作为文件内容 SHA-256 的替代品。

### 5.2 分块安装包

首次安装使用多个小包传输，内容始终为全量，不向用户提供精简版选择。

- 初始实现采用 ZIP STORE，目标每包约 8 MiB，硬上限约 16 MiB；图片、音频已压缩，不依赖大幅压缩收益。
- 文件按目录和稳定分组打包，不把整个发行目录压成一个 1.34 GB 的 ZIP。
- 单文件超过包上限时使用原始对象下载；仍属于完整安装清单，不能遗漏。
- 下载调度默认少量并发，解包默认串行；可根据真实手机内存和网络测量调整。
- 包及包内每个文件均检查大小和 SHA-256。限制解包条目、总输出字节和路径，拒绝越界路径及意外内容。
- 壳内直接打包下载器、解包器和哈希实现，不从外部 CDN 动态加载它们。
- 拆包完成即释放临时包，本地长期只保留原始文件，不长期保存原始文件和完整 ZIP 的两份副本。

原始对象始终保留，供少量文件更新、单文件重试和修复使用。增量更新按文件哈希下载，不因一个安装包发生变化而下载其中全部未变化文件。

如果未来单文件变得很大，需要支持流式写入和增量哈希；不能把整个发行版拼接进内存。第一期测试必须测量手机上的真实峰值内存。

## 6. 玩家设备上的文件系统

### 6.1 存储划分

| 存储 | 内容 | 处理规则 |
| --- | --- | --- |
| 壳缓存 | 启动器、图标、离线提示及所需依赖 | 小规模缓存，保证断网能打开安装状态页面 |
| 发行内容缓存 | 完整原始文件，以哈希作内部键 | 游戏运行从这里读取，不依赖 HTTP 浏览器缓存 |
| 编译结果缓存 | TS、Vue 等生成的模块 | 可重新生成；由源码、路径、参数和编译器版本共同识别 |
| PWA 专用 IndexedDB | 清单、目录、安装进度、客户端版本关联、用户文件和删除标记 | 不复用或覆写游戏原有数据库结构 |
| 游戏原有 IndexedDB | 配置、录像和游戏数据 | 保持原有命名与存取接口 |

采用 Cache Storage 加 IndexedDB 作为基础实现。OPFS 可以作为经验证后的存储后端，但不能把它作为全部目标浏览器的隐含前提。

### 6.2 发行层与用户层

读取顺序：用户文件覆盖层 → 删除标记判断 → 当前页面关联的发行清单 → 内容缓存。

目录删除还需要持久化递归删除标记：删除 `extension/foo/` 后，不能在下次启动或更新时重新露出该目录的发行文件。后续明确写入该目录的新用户文件可见，其余发行子项仍保持删除状态。单个文件的删除也必须同时清除旧用户覆盖文件，避免读取顺序把它重新读出来。

用户文件与官方发行文件分开存储，更新不覆盖用户导入扩展或自定义素材。对发行文件的编辑产生覆盖文件，删除产生标记；不直接修改哈希对象。目录枚举合并两层并排除被删除条目，处理完整的递归创建、删除、追加和截断语义。

实现 `FileSystemAdapter` 的 `open/read/write/stat/list/createDir/remove`，并复用 `installLegacyFileSystemAPI` 安装历史接口。还须适配历史 `game.download` 的下载写入、进度和错误处理，保证在线扩展获取及依赖它的功能可用。

`noname.config.txt` 等一次性配置文件按原有语义消费，删除标记或已消费状态要持久化，避免每次重启重复导入。用户文件的导出沿用浏览器下载能力；不建立自动备份系统。

### 6.3 扩展导入与编辑

ZIP 扩展安装采用本地暂存命名空间：解包和验证完成后才切换到正式目录并更新游戏扩展配置。中断不能留下配置显示已安装、文件却不完整的扩展。

扩展的 JS、图片、音频和动态 import 都通过原有 `/extension/...` 路径读取。编辑后为相关模块增加文件修订标记，确保下次加载使用新文件而不是浏览器已缓存的模块；不能通过删除全部网站数据刷新扩展。

测试覆盖 ESM 扩展、历史 `game.import` 扩展、TS/Vue 扩展、中文目录、嵌套模块和自定义素材。运行 Node.js 或原生接口的扩展按实际依赖逐项处理，不以禁用所有扩展规避适配。

## 7. 启动器、安装与本地更新

### 7.1 启动路径

`/` 转到根路径 `/launcher.html`，PWA 的 `start_url` 也指向这里。游戏入口保持 `/index.html`，所有原有相对路径和根路径继续成立。

启动器依次执行：

1. 打开 PWA 本地数据库，确认缓存和存储 API 可用。
2. 注册或使用已有 `/service-worker.js`，等待 `controllerchange` 或已有控制权，与 Worker 进行版本握手；等待 `ready` 本身不等于页面已被控制。
3. 请求在线维护状态，使用短超时、禁止缓存，不依赖 `navigator.onLine` 判断真实连通性。
4. 明确收到维护状态时显示维护页，不进入游戏。请求确实失败或完全断网时，只有本地完整安装存在才允许离线启动。
5. 云端版本变化时更新；未安装时执行完整安装；已有文件损坏时修复或更新。
6. 确认全部安装文件、清单、目录索引和运行协议可用后，关联当前发行版本，进入 `/index.html`。

直接打开游戏入口时也要经过同等检查，避免绕过安装状态进入半安装游戏。安装器和游戏中的提示只展示版本、下载进度、维护和空间问题，不把哈希、R2 对象键等实现细节放进正常用户流程。

### 7.2 本地状态机

```text
未安装 → 下载中 → 校验中 → 完整安装 → 游戏启动
             │                    │
             ├─ 中断：保存进度     └─ 新版：差异下载 → 校验 → 切换
             └─ 失败：重试 / 空间处理

明确收到云端维护状态 → 维护页面
无网络且已完整安装   → 本地离线启动
无网络且未完整安装   → 提示联网完成安装
```

每个已验证文件写入缓存成功后，才记录完成状态。Cache Storage 与 IndexedDB 不具备跨存储事务，必须处理缓存已写入而状态尚未写入，以及状态存在但缓存被清理的情况。恢复时重新检查实际对象，不只相信完成标记。

所有目标文件完成后，在 IndexedDB 事务中更新活动清单指针。设备上未完成的安装不能冒充完整版本。启动时检查清单文件是否存在；深度哈希检查由安装校验及完整性检查入口执行，避免每次启动重新读取全部 1.34 GB。

页面退出或手机进入后台可能中止下载。第一期保证下次打开继续下载，不承诺所有浏览器关闭后仍在后台持续下载。不同窗口共享安装锁，避免重复下载、同时切换版本或误删彼此使用的文件；锁要能在异常退出后恢复。

### 7.3 首版实现参数和持久化结构

以下参数是开发起点，真机验收后据测量调整，不作为未经测试的性能承诺。

| 参数 | 初值 | 行为 |
| --- | --- | --- |
| 安装包目标 / 上限 | 8 MiB / 16 MiB，包含 ZIP 封装 | 单文件及封装超过上限就走原始对象 |
| 下载并发 / 解包并发 | 2 / 1 | 只保留有限个包和当前解包文件，避免整包文件全部复制到内存 |
| 失败重试 | 每次操作最多 5 次，指数退避加随机延迟 | 429 遵从 `Retry-After`；503 维护立即暂停；410 转入当前版更新 |
| 状态请求超时 | 5 秒 | 超时属于不可达；本地完整版本可离线启动 |
| 状态轮询 | 启动时、窗口回到前台、前台每 60 秒 | 后台暂停轮询；维护返回立即更新提示 |
| 安装锁 | IndexedDB 事务取得租约；15 秒续租、60 秒过期 | 每次写入和切换验证持有者及锁代次；Web Locks 仅作增强 |
| 数据持久化申请 | 用户点安装时调用 `persist()`，安装前读取 `estimate()` | 拒绝持久化不冒充安装失败，实际写入配额不足则暂停 |

PWA 数据库名拟为 `noname-pwa-v1`，object stores 如下：

| store | 键 / 核心内容 |
| --- | --- |
| `meta` | `activeRelease`、数据库协议、运行协议、壳协议 |
| `releases` | `releaseId` → 已校验清单、目录索引及完整安装状态 |
| `downloads` | `[releaseId, sha256]` → 验证完成字节、重试状态；不保存临时 ZIP 副本 |
| `userFiles` | 规范路径 → Blob、大小、修订号、修改时间 |
| `userDirs` | 规范路径 → 用户创建目录 |
| `tombstones` | 规范路径 → 文件或目录删除标记 |
| `clients` | `clientId` → 固定发行版本、父客户端、最后确认时间 |
| `locks` | 安装/更新/清理锁 → 持有者、代次、到期时间 |

Cache Storage 拟分为 `noname-pwa-shell-v1`、`noname-pwa-content-v1`、`noname-pwa-compiled-v1`。内容缓存键为同源内部 URL `/__pwa/cache/sha256/<hash>`，它仅是存储键，不是云端公开路由。游戏配置数据库维持原名。

安装可用空间估算为「目标缺少的唯一对象字节 + 两个最大传输包 + 解包临时空间 + 预留量」。更新只估算新增对象，不重复把已存在对象算进下载量；建议设备可用空间仍按至少约 3 GB 提示。`estimate()` 不能保证实际写入成功，所有写入都要捕获配额错误。

页面启动以对象存在性检查判断完整度；深度检查逐文件流式或有界读取并核对 SHA-256。清理只处理未被活动清单、安装目标和仍存活客户端引用的对象。页面引用恢复先完成，再允许清理；锁过期或心跳超时本身不能证明后台页面已经关闭。

云端不保留旧版。本地更新暂存和仍在运行的页面引用只是保证文件一致性的运行状态，不提供历史版本选择或回滚功能。切换完成且旧页面退出后清理无引用的发行文件，始终保留用户数据。

## 8. Service Worker 与即时编译

PWA 页面只注册一份根作用域 Worker。开发服务器、Electron 和 Android 的默认构建继续使用原有平台流程，不在这些环境中注册 PWA Worker。

PWA Worker 优先构建为包含依赖的单文件 classic Worker，避免对 module Service Worker 兼容性增加额外假设；如选择 module 构建，必须验证所声明的浏览器最低版本。Worker 文件及其编译器也计入真实安装和内存测量。

Worker 的统一路由顺序：

1. 壳页面和壳资源：保证本地离线可达，根导航进入启动器。
2. `/__pwa/` 在线状态和下载请求：按协议走网络，不返回陈旧维护状态。
3. 游戏原路径：解析当前页面的发行版本，读取用户层或发行层。
4. 需要转换的请求：从本地原始字节执行即时编译。
5. 音视频 Range：从完整本地对象生成范围响应。
6. 其他请求：明确区分外部联网功能和未知本地路径；缺失游戏文件进入修复流程，不静默使用另一版文件。

必须处理以下细节：

- Worker 内部 `fetch()` 不会自动再走自己的 fetch 拦截；编译源码读取必须直接调用共享存储模块，不能依赖自我拦截。
- 为每个游戏文档固定发行版本，使用 `clientId/resultingClientId` 和持久化关联。Worker 重启后可恢复关联，不能只保存在内存 Map。
- 新窗口、刷新、游戏内部沙盒 iframe 及 Worker 子资源都要继承正确版本；无法确定版本时返回启动器，不随机使用全局最新指针。
- 从哈希缓存恢复文件时按原始请求路径构造响应，保留模块和 CSS 相对导入的正确基址；不能将 `/__pwa/objects/<sha256>` 下载地址作为原有模块的最终资源 URL。相同哈希在不同路径上出现时仍按该路径清单提供响应类型。
- 即时编译缓存键包含源码哈希、规范化路径、转换参数、编译器版本及相关依赖标识，避免相同源码在不同相对路径下被错误复用。
- 保留 `?raw`、`?url`、`?worker`、Vue 子模块参数等语义；只处理已定义的控制参数，不能一律抹掉查询字符串。
- `raw` 转换正确序列化字符串；JS 模块、普通 JSON 获取、CSS 模块和普通样式加载分别处理，不能只依赖某个请求头在所有浏览器中都存在。
- `.ts`、`.vue` 编译器及其依赖全部随壳或完整安装包提供，断网首次使用也能工作。
- 注册使用适合更新检查的缓存策略，PWA Worker 不再主动注销或广播刷新；运行协议改变时经过启动器握手和受控切换。
- 壳控制的 Worker 属于浏览器注册资源，清单中的同名发行文件只是版本记录，不能由内容缓存响应意外替换注册脚本。

媒体缓存只接受完整文件。Range 响应实现 `206`、`Content-Range`、`Content-Length`、`Accept-Ranges`，不可满足范围返回 `416`，处理 HEAD 与普通 GET；绝不能把一段 `206` 响应登记为完整文件。播放器的 CORS 属性和 iOS 音频行为按实机结果适配。

Worker 更新采用明确握手：旧页面在运行时，新 Worker 默认等待；启动器确认所有游戏窗口已退出或用户结束当前会话后发送激活消息。仅首次安装、无旧客户端时可立即 claim。新 Worker 与本地活动版本协议不兼容时先进入启动器，不能在更新半途自动接管旧局并广播刷新。壳升级中断时必须保留能够继续安装的本地启动器。

## 9. 云端路由与维护发布

### 9.1 R2 对象组织

使用专用桶或经用户确认的精确前缀，示例：

```text
noname-pwa/
  control/state.json
  current/manifest.json
  objects/<sha256>
  packs/<sha256>.zip
```

不创建按版本长期保存的历史目录。原始对象与传输包仅保留当前发行清单引用的内容；所有清理只允许操作该桶或已验证的专用前缀，严禁清理用户的其他 R2 内容。

状态对象至少包含 `schemaVersion`、`state`（`maintenance` 或 `ready`）、`publicationId`、`releaseId`、`manifestSha256` 和面向用户的维护提示。维护时可记录本次目标版本，但它不代表已经可供玩家安装。

还应包含 `commit`、`shellProtocol`、`runtimeProtocol`、`updatedAt`；状态对象不存在、损坏或协议不认识都按 maintenance 处理。`ready` 是发布脚本最后写入的唯一开放标志，不能由 Worker 在缺文件时自行生成。

### 9.2 Worker 路由

| 路径 | 行为 |
| --- | --- |
| `/`、`/launcher.html`、壳脚本和图标 | 从 Worker 静态资源返回，维护期间也能展示状态 |
| `/service-worker.js` | 同源、有效 JS 类型、允许及时重新验证；不由长期 CDN 缓存固定旧版 |
| `/__pwa/status` | 返回在线状态，`Cache-Control: no-store`，读取失败时云端按维护处理 |
| `/__pwa/manifest` | ready 时返回当前清单；维护时返回结构化 `503` |
| `/__pwa/objects/<sha256>` | 只提供当前清单引用的原始对象，支持 GET/HEAD/Range |
| `/__pwa/packs/<sha256>` | 只提供当前清单引用的安装包 |
| 已淘汰版本的下载请求 | ready 时明确提示更新到当前版，可使用 `410`；维护期间统一 `503` |
| 未知游戏资源 | `404`，禁止用 HTML 首页兜底 |

R2 桶使用私有访问，通过 Worker binding 提供资源，不需要公开 `r2.dev` 地址或另一套资源域名。玩家端不持有写入或管理凭据。

哈希对象可以使用 Worker 的边缘缓存降低 R2 读取次数；必须先检查维护状态和当前清单授权，再读缓存。不能让整站 CDN 缓存规则绕过维护判断。状态、清单和维护错误不缓存；客户端请求单文件时携带期望 `releaseId`，避免更新中读到另一版对象。

下载接口返回玩家的响应统一 `Cache-Control: no-store`，避免浏览器 HTTP 缓存直接满足旧下载请求而绕过维护检查。边缘缓存由 Worker 显式写入独立缓存响应，内部可设置 TTL；不能把其长期缓存头直接传给玩家。安装器验证后的内容仍显式写入 Cache Storage，用于离线游戏，这与网络接口禁止 HTTP 缓存是两套机制。

请求格式固定为 `/__pwa/manifest?releaseId=<id>`、`/__pwa/objects/<sha256>?releaseId=<id>`、`/__pwa/packs/<sha256>?releaseId=<id>`。状态返回 200 的结构化 JSON，包含 maintenance 或 ready；资源路由维护返回 503，版本不符返回 410，当前版未引用的哈希返回 404，非法哈希或路径返回 400，不支持的方法返回 405。

响应顺序固定为：读状态 → 检查 releaseId → 加载并校验当前清单 → 校验哈希属于清单 → 查边缘缓存/R2。状态每请求读取 R2，不使用跨请求的本地状态 TTL 或 KV 作为权威源；解析后的清单可按「releaseId + manifestSha256」缓存。这样维护切换不受旧状态缓存影响。切维护前已开始的传输可能结束，之后的新请求必须被挡住；维护不是瞬间撤回已经发出的字节。

R2 内容使用 `object.body` 流式返回，ZIP 和音视频不能先 `arrayBuffer()` 再交给浏览器。边缘缓存键同时包含 releaseId 和哈希。R2 binding 的 `get(..., {range})` 读取范围，响应头由 Worker 按真实大小构造；首版只支持单范围，多个范围忽略 Range 并返回完整 200，非法或越界单范围返回 416。服务端和离线 Worker 共用同一组范围解析用例。

### 9.3 发布顺序

本地构建准备可在进入维护前完成，以缩短停用时间；云端替换阶段全程维护。

1. 从确定的源码提交干净构建，验证所有本体和扩展构建成功。
2. 生成全量文件清单、原始对象和传输包，完成本地逐字节校验及包解包验证。
3. 串行取得发布权，记录唯一 `publicationId`，将 `state.json` 设为 maintenance 并确认可见。
4. 分页列出专用前缀下对象，与新清单允许列表比较。先删除新版本不再引用的旧对象和旧安装包，保留相同哈希的文件。
5. 上传新清单缺少的对象与安装包；不建立旧版备份。壳有变化时，在维护期间更新 Worker 静态资源及运行协议。
6. 对新增对象从 R2 重新读取、流式核对大小与 SHA-256；复用对象检查前次已验证记录和对象元数据，不可信时重新读取。上传使用 R2 S3 支持的 `Content-MD5` 检测传输损坏，并写入 `sha256` 自定义元数据。元数据不是服务端重新计算的 SHA-256，不能只凭 HEAD 或 ETag 当成内容验证。
7. 写入唯一当前清单，再验证云端清单哈希、对象可读及必要启动资源。
8. 确认本次仍持有发布权、壳与清单协议匹配，将 `state.json` 设为 ready，开放玩家入口。
9. 输出发布提交、文件数、字节数和完成结果；R2 不保留旧版清单或回滚材料。

禁止在异常处理的 `finally` 中无条件解除维护。构建失败不开始云端替换；删除或上传后失败则保留维护状态，重新执行同一目标发布或从最新目标重新构建。发布步骤必须可重复执行，处理分页、分批删除、上传重试和部分完成情况。

先删旧、再补新使资源对象占用接近单个目标版本的大小，无需同时保留完整新旧两套。分块包与原始文件是两种传输用途，不是历史备份。

### 9.4 维护与离线行为

明确收到 maintenance 的在线启动器禁止进入游戏；已打开的 PWA 页面定期检测维护状态并提示返回启动器。未开发完整对局续存前，不能承诺维护后恢复中断的对局。

网络检查失败且本地完整安装存在时可以离线运行，不能为了强制维护而加入每次必须联网的许可证检查。浏览器已有缓存和正在运行的离线页面不能被服务器远程强制停用。

PWA 维护不等于停止独立大厅，也不等于停止仓库的网页服务。发布脚本不能擅自操作 `lan-ai-server`、Docker 大厅、开发服务器或现有 Cloudflare Connector。

### 9.5 Wrangler 配置草案

拟新增 `packages/pwa-host/wrangler.jsonc`。以下字段已对照本机 4.147.0 配置 schema 核实；实际部署前必须完成源码及壳输出，不能直接照此部署空目录。

```jsonc
{
  "name": "noname-pwa-host",
  "main": "src/index.ts",
  "account_id": "d8b2e1f89db7e58447e0ca535a1def7f",
  "compatibility_date": "2026-10-05",
  "workers_dev": true,
  "preview_urls": false,
  "r2_buckets": [
    { "binding": "PWA_BUCKET", "bucket_name": "noname-pwa" }
  ],
  "assets": {
    "directory": "../../output/pwa/shell",
    "binding": "ASSETS",
    "html_handling": "none",
    "not_found_handling": "none",
    "run_worker_first": true
  },
  "vars": {
    "PWA_PREFIX": "noname-pwa/",
    "PWA_SCHEMA_VERSION": "1"
  }
}
```

本机使用全局 Wrangler，配置省略依赖仓库 `node_modules/wrangler` 的 `$schema` 路径；需要编辑器提示时可引用全局安装的 schema，不必给游戏仓库重复安装 Wrangler。

`output/pwa/shell/` 只含启动器、其依赖、Web App Manifest、PNG/Apple 图标和单文件 `/service-worker.js`，不能把完整 `dist/` 指向 Workers 静态资源。全部游戏内容放 R2。Worker 对上述壳路径使用精确白名单调用 `env.ASSETS.fetch()`，设置响应头；`/` 显式跳转 `/launcher.html`，不要让 HTML 自动规范化把游戏 `/index.html` 变成根路径。未知路径维持 404。[静态资源配置说明](https://developers.cloudflare.com/workers/static-assets/binding/)

壳 HTML、Web App Manifest 和 `/service-worker.js` 设 `Cache-Control: no-cache`；注册 Worker 用 `updateViaCache: "none"`。壳的 JS/CSS 可用带哈希文件名缓存，浏览器本地壳切换仍由握手控制。云端 `/index.html` 导航返回启动器引导，安装成功且受控后，浏览器 Service Worker 才提供真正的游戏入口；不能把这个引导 HTML 登记为游戏文件。

首轮使用部署返回的 `https://noname-pwa-host.<账户子域>.workers.dev` 核验云端协议；账户子域尚未查询，不能编造完整 URL。正式安装前确定长期域名，避免玩家在临时域名安装 1.34 GB 后再次搬家。

正式域名草案为 `play.491528.xyz`，它来自仓库已有域名背景，**尚未核实该 zone 归属、DNS 冲突或获选为正式域名**。核实后配置 Custom Domain：

```jsonc
"workers_dev": false,
"routes": [
  { "pattern": "play.491528.xyz", "custom_domain": true }
]
```

域名变化会改变网站存储源，旧存档和完整安装缓存不会自动迁移；因此正式分发后保持域名稳定。已有 `nine.491528.xyz`、`id.491528.xyz` 和旧 `game.491528.xyz` 不作为自动接管目标。

Workers 默认会记录代码、绑定和静态壳的部署版本。R2 只保留当前游戏发行对象、无历史游戏包的要求可以实现；不能把这等同于 Cloudflare 平台完全不保存任何历史代码或静态壳。关闭 version preview URL，不提供玩家回滚入口，也不额外备份；若“云端无历史”必须包括平台内部壳版本，则改为壳也从 R2 当前目录提供，并另外核实 Worker 代码版本的删除能力。[Workers 版本机制](https://developers.cloudflare.com/workers/versions-and-deployments/)

### 9.6 批量发布的具体接口

本机 OAuth 足以继续使用已经验证的 Wrangler 管理命令。首次创建桶和部署 Worker 使用 Wrangler；约 1.56 万个游戏文件的上传、列举、比对、分批删除和验证由 Node 发布脚本使用 R2 S3 API 完成，不为每个文件启动一次 Wrangler。[R2 批量上传指引](https://developers.cloudflare.com/r2/objects/upload-objects/)

拟给开发/发布工具增加 `@aws-sdk/client-s3`，Worker 运行时通过 R2 binding 读取，不打包 AWS SDK。S3 参数固定为：

```text
endpoint = https://d8b2e1f89db7e58447e0ca535a1def7f.r2.cloudflarestorage.com
region   = auto
bucket   = noname-pwa
prefix   = noname-pwa/
```

`cloudflare.ts` 封装 `ListObjectsV2`（每页最多 1,000，必须循环 ContinuationToken）、`HeadObject`、`GetObject`、`PutObject`、`DeleteObjects`（每批最多 1,000，检查逐项错误）。上传并发初值 4，云端回读验证初值 2；重试只重试可恢复错误，任何步骤最终失败就保留 maintenance。对 AWS SDK 自动附加的校验算法要按 R2 实测兼容性配置，首版不能假设 AWS S3 的所有 SHA-256/多段校验头都能直接使用。[R2 S3 兼容表](https://developers.cloudflare.com/r2/api/s3/api/)

上传清单记录每个对象的路径、大小、SHA-256 和 MD5；同一个内容对象只上传一次。计划允许集合为 `control/state.json`、`current/manifest.json`、新清单所有 `objects/` 与 `packs/`。未知对象在专用前缀内才列入清理计划，前缀外对象永远不删；桶、账号或前缀与发行配置不一致时立即失败。最后重新完整列举前缀确认无旧发行残留。

使用 R2 S3 的条件 PutObject（If-Match / If-None-Match）更新状态对象，避免凭旧状态写回 ready。CAS 失败立即退出。`publicationId` 同时写入日志和状态，但**只检查 publicationId 不能替代发布互斥**。正常生产发布统一走同一个 Actions concurrency group；本地发布仅用于首次引导或无 CI 写入者的故障修复，生产流水线启用后本地更新改为触发 workflow_dispatch。维护中的接续发布必须确认前一次 runner 已结束，不能自动按超时抢占仍在运行的发布者。

PWA 资源 Worker 只提供玩家读取接口，状态切换直接通过带凭据的 S3 API 操作。资源发布无需公开 `/admin/upload` 或匿名维护开关，也无需 D1、KV 或账号系统；大厅的独立 Worker/DO 迁移见第 11.2 节。

## 10. fork 更新与自动发布

在用户个人仓库 `Nineeeeeee/noname-custom-builds` 配置新工作流，发行分支名称在实施前填入。工作流只能对这个仓库和指定分支发布，官方仓库没有发布或推送入口。

触发方式：指定发行分支的 `push`，另提供 `workflow_dispatch` 便于失败重试。流水线执行构建、验证、R2 差异同步及维护状态切换，不依赖推送 `build-output` 分支。

建议规则：

- 固定 Node 和 pnpm 版本，正确匹配各工作区 lockfile，缓存依赖；版本依据仓库实际可复现构建确定，不能照抄互不一致的旧工作流配置。
- 以当前提交固定构建，记录提交 SHA、构建时间和清单哈希。传输包固定排序和 ZIP 元数据，避免纯时间戳变化使所有包重新上传。
- 同一站点发布使用统一 concurrency group，禁止互相覆盖；破坏性发布阶段不能取消正在运行的任务。
- 进入云端替换前检查目标是否已经过时，过时任务跳过。较新的提交在发布中到达时，由后续任务继续发布，较早任务不能覆盖已发布的较新版本。
- Cloudflare 令牌、账户标识、R2 写入凭据仅放在 Actions Secrets；Worker 运行时只需要读取绑定，公开下载接口只提供读操作。
- 删除前生成并核对精确对象差异；只删除本项目前缀，发布脚本对空前缀、错误账户和错误桶直接报错。
- 不把 PWA 历史发行包上传为长期 Actions artifact 或额外 Release 备份；既有 Windows/Android 发行流程不因 PWA 设计被擅自改动。

自动同步指 fork 的发行分支已经有新提交后自动发布。官方上游改动仍须先合并进 fork；合并冲突及核心接口变更不能靠自动上传解决。

### 10.1 凭据和 Actions 配置

本机 Wrangler OAuth 和 CI 凭据是两个环境。本机登录文件不能复制进 GitHub，也不能充当 R2 S3 的 Access Key。[Cloudflare Actions 部署说明](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)

在个人 fork 的 `pwa-production` Environment 中配置：

| 名称 | 类型 | 用途 |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Secret | Wrangler 发布 Worker；使用限定当前账号的 Workers 部署权限，域名权限按实际路由需要补充 |
| `R2_ACCESS_KEY_ID` | Secret | S3 批量发布认证 |
| `R2_SECRET_ACCESS_KEY` | Secret | 与上项配套；创建时仅允许 `noname-pwa` 桶的 Object Read & Write |
| `PWA_PUBLIC_ORIGIN` | Variable | 最终 HTTPS 游戏源，不带路径；正式域名确定后填写 |

account ID、桶和前缀固定在发布配置里，不作为任意可覆盖的删除参数。R2 S3 密钥需在 Cloudflare R2 的 API Tokens 界面单独生成；只有本机登录还不足以执行 S3 批量脚本。本轮没有检查 GitHub Secrets，因此其存在性仍未确认。[R2 S3 凭据配置](https://developers.cloudflare.com/r2/get-started/s3/)

CI Secret 只提供给发布步骤，构建和校验步骤不持有它们。日志只输出计划摘要、对象键及结果，禁止输出环境变量或 HTTP Authorization；失败日志保留 SHA、阶段和 publicationId，供继续发布定位。

工作流骨架如下，**新增命令实现前不能启用**。`publish.ts` 必须在清理对象后、解除维护前调用同一版 Wrangler 部署壳及 Worker；不能把 deploy 放在维护前的单独步骤。

```yaml
name: Publish PWA

on:
  push:
    branches: [my-features]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: noname-pwa-production
  cancel-in-progress: false

jobs:
  publish:
    if: github.repository == 'Nineeeeeee/noname-custom-builds' && github.ref == 'refs/heads/my-features'
    runs-on: ubuntu-latest
    environment: pwa-production
    steps:
      - uses: actions/checkout@v6
        with:
          persist-credentials: false
      - uses: pnpm/action-setup@v5
        with:
          version: 9
      - uses: actions/setup-node@v6
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: npm install --global wrangler@4.147.0
      - run: pnpm build:pwa
        env:
          NONAME_TARGET: pwa
          NONAME_BUILD_CHANNEL: release
          NONAME_BUILD_COMMIT: ${{ github.sha }}
      - run: pnpm pwa:verify
      - name: Publish verified release
        run: pnpm pwa:publish -- --ci
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: d8b2e1f89db7e58447e0ca535a1def7f
          AWS_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          PWA_PUBLIC_ORIGIN: ${{ vars.PWA_PUBLIC_ORIGIN }}
          GH_TOKEN: ${{ github.token }}
```

所有 `pwa:*` 脚本先剥离 pnpm 传入的独立 `--` 再解析参数。`--ci` 读取 Actions 上下文，并通过 GitHub API 查询指定分支当前 HEAD；开始维护前若已经不是本次 SHA，则跳过，不上传也不删除。取得发布权后完成本次发布，再由新的流水线接续；不能因分支后来又有提交，在上传一半时直接弃掉维护状态。

仓库当前个人客户端工作流 `.github/workflows/client-release.yml` 使用 Node 24 / pnpm 9，PWA 跟随这条基线。骨架中的 major 版本要在实施验证后锁到补丁版本；更新 lockfile、ZIP 生成器和编译器版本也进入清单协议/构建记录。

首次 PWA 只增加独立工作流。旧 `.github/workflows/build.yml` 对 `main` 推送 `build-output` 的规则需要单独审查：PWA 工作流不借用它、不自动扩大触发分支，也不自行启用官方仓库发布或任何 git push。

## 11. 联机和浏览器兼容

现有大厅是独立 Node.js WebSocket 服务，默认端口 `8082`。HTTPS PWA 必须使用 WSS；本轮推荐按第 11.2 节迁入独立 Worker + Durable Object，从而去掉小主机依赖。继续使用现有 Node 大厅时，才采用第 11.1 节的 HTTPS/WSS 反向代理备选。

### 11.1 保留外部 Node 大厅时的 WSS 接入备选

游戏 `apps/core/noname/game/index.js` 的 `connect()` 已能接收完整 `ws://` / `wss://` 地址；PWA 默认联机地址可写成 `wss://lobby.491528.xyz`。该域名只是候选，仍待确认大厅实际公网 IP、DNS 归属和服务器上已有代理。

建议在**大厅所在 Ubuntu 服务器**新增 Caddy HTTPS 入口，DNS 指向该服务器，首轮用 DNS only，避免引入额外 Cloudflare 代理变量。如果服务器已有 Nginx/Caddy，复用现有代理体系，不再部署第二个占用 80/443 的服务。

以下是新增入口的配置片段，假设 Caddy 运行在宿主机上，Docker 大厅已映射到宿主机 8082：

```caddyfile
lobby.491528.xyz {
    reverse_proxy 127.0.0.1:8082
}
```

Caddy 支持 WebSocket 升级和证书管理，部署时验证实际证书和 101 握手；代理需要服务器 DNS 可达及相应 80/443 入站规则。如果代理本身也在容器中，`127.0.0.1` 指向代理容器，必须改成共享 Docker 网络内大厅服务名，例如 `lobby:8082`。[Caddy reverse_proxy 文档](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)

现有 Electron 的公网 IP:8082 入口继续使用。WSS 只是新增访问入口，通常不需要改大厅协议或重建大厅；PWA 的 HTTPS 页面不能连接未加密大厅。跨客户端测试应同时检查 WSS 与现有 WS 连接加入同一大厅、房主离开时的房间行为。

保留当前玩家客户端充当房主、独立大厅转发消息的结构。大厅代码或协议没有变化时，PWA 内容更新不重建或重启大厅；存在协议变化时单独安排服务器更新。首次上线测试 PWA 与同版本 Electron 客户端混合联机，并记录对应版本。

PWA 不能在浏览器里直接启动 Node WebSocket 监听服务器；相关旧式本地开服能力应使用已有独立大厅流程引导，不以伪造 Node API 实现。在线扩展来源若不支持浏览器 CORS，需要按实际来源适配受限读取代理，不能开放任意地址的通用代理。

兼容性验收覆盖 Windows Chrome/Edge、Android Chrome、iPhone/iPad Safari 的浏览器与安装形态。尽量保持现有 Chromium 91 / Safari 16.4 代码目标，采用能力检测和必要兼容实现；全量存储能否成功还取决于实际配额，尤其旧版 Safari，需要实机确认。

使用 `navigator.storage.estimate()` 检查估算空间，申请 `persist()` 并显示实际结果。安装桌面图标不等于永久保留资源；用户清除网站数据、存储回收或无痕模式都会影响离线可用性。配额不足或核心 API 不可用时给出可理解的错误，不默默降级成精简版。

### 11.2 本轮调研：大厅也可迁入 Cloudflare

2026-10-05 追加源码和官方文档调研：当前 `packages/server` 只管理房间并转发 WebSocket，没有运行游戏引擎或读取素材，适合改为 **独立 Worker + 一个 SQLite-backed Durable Object**。迁移后玩家直接访问 Cloudflare WSS，大厅不再依赖小主机、Ubuntu 服务器或 Caddy。第 11.1 节仅作为继续保留 Node 大厅时的备选。

现有 Node/ws 监听代码不能原样上传普通 Worker，需要适配连接 API、共享状态恢复和心跳；游戏消息协议及客户端房主结构可以保留。客户端地址使用完整 `wss://...`，避开裸域名自动补 8080 的旧逻辑。大厅与 PWA 分成两个 Worker，PWA 内容更新不部署大厅。

详细对照、休眠恢复、Free 成本估算、Containers 替代方案和 Wrangler 草案见 [独立大厅 Workers 调研](docs/pwa-lobby-workers-research.md)。这是可行性推荐，尚未实现或部署；原有大厅继续运行，迁移联机验收通过后再按用户要求切换。

## 12. 存储预算

| 存储位置 | 当前规模估算 | 说明 |
| --- | ---: | --- |
| R2 原始对象 | 约 1.34 GB | 当前发行的完整文件，内容相同者去重 |
| R2 分块包 | 不超过约 1.34 GB 加少量封装开销 | 超大单文件可复用原始对象，不重复进包 |
| R2 合计 | 约 2.7 GB | 建议按 3–4 GB 用量预算，随资源增长重新估算 |
| 玩家设备发行文件 | 约 1.34 GB 加缓存开销 | 解包后不长期留完整安装包副本 |
| 玩家设备余量 | 建议至少约 3 GB 可用空间 | 还需考虑临时解包、更新新增文件、用户扩展和浏览器实际配额 |

云端先清理不再引用的旧资源再上传，不按 3 个历史版本或两套完整版本预留空间。失败发布留下的对象下次按新目标清理，也不转为历史备份。

按 8 MiB 目标拆分，1.34 GB 原始内容约对应 160 个传输包，实际以稳定分组和封装结果为准。用户加 5 位朋友共 6 人首次安装，大致是约 960 次包下载，加壳和状态请求；游戏每次读取 15,625 个本地文件不会产生同等数量的云端请求。仅修复或差异更新才按缺少的哈希对象下载。

由于每个对象请求都读取权威状态，未命中边缘缓存时通常还需读清单和对象，不能只按包下载次数计算 R2 Class B。前台每 60 秒轮询、6 人同时开 4 小时，对应约 1,440 次状态请求/日。当前 Standard 免费层包括每月 100 万 Class A、1,000 万 Class B；已有 `kairisei` 用量共同计入账号额度，本轮未查询其占用。[R2 计费](https://developers.cloudflare.com/r2/pricing/)

Worker Free 当前包含每日 100,000 次请求；选用 `run_worker_first: true` 的壳访问也会调用 Worker，不能按纯静态资源无限请求估计。6 人规模可先按免费计划验证，但还需测量 15,625 项清单解析在冷启动时的 CPU，不能仅凭人数承诺永远免费；超出配额或 CPU 限额时调整实现或计划。[Workers 计费](https://developers.cloudflare.com/workers/platform/pricing/)

玩家数量不会复制云端游戏文件，存档和用户文件默认在各自设备上。R2 按实际用量计费，Standard 的免费存储额度为账户内共享的 10 GB-month/月；请求和 Worker 的计费另行核算。不要把用量预算解释为必须提前购买固定容量。

## 13. 实施顺序与交付物

以下是同一期内的开发顺序，不是把功能拆到第二期。

1. 修正构建失败传播，增加 PWA 构建标记；从干净构建生成完整清单、传输包和验证程序。
2. 实现共享存储及 PWA 文件系统，覆盖全部文件接口，再接入启动流程。
3. 实现统一 Service Worker，接入编译、根路径、媒体 Range 和页面版本关联。
4. 实现启动器、全量下载、继续下载、完整性检查、增量更新及存储错误处理。
5. 完成现有全部扩展与模式的兼容修复，包括编辑、导入、导出、自定义素材和录像功能。
6. 实现 Cloudflare Worker、R2 发布状态机和只保留当前版的清理流程。
7. 接入个人 fork 自动发布；配置同源 HTTPS、图标和 WSS 大厅入口。
8. 完成自动化、桌面和手机验收，记录真实安装体积、内存峰值、首次下载及差异更新耗时。

交付包含源码、构建及发布脚本、配置样例、完整清单验证、必要测试和部署使用说明。具体 Cloudflare 部署需要实际账户配置；本实施文档本身不执行部署。

### 13.1 可以直接分配的开发任务

| 顺序 | 改动及依赖 | 完成时必须可审查的结果 |
| --- | --- | --- |
| A：构建与协议 | 修正 `scripts/build.ts`；新增 `protocol.ts`、打包器和校验器 | 错误退出确实传到流水线；当前全部文件可逐字节还原；重复打包不因 ZIP 时间戳改变哈希 |
| B：本地存储 | `storage.ts`、`filesystem.ts`、`init/pwa.ts`，依赖 A 的清单 | 用户层、发行层和递归删除合并正确；游戏启动不请求 `/readFile` 等服务器接口 |
| C：编译与路由 | 统一 SW、JIT 读取注入、两个 JIT 注册入口接入，依赖 B | 关闭后断网重启能加载 JS/TS/Vue、图片和音频；相对依赖路径不改变 |
| D：安装更新 | 启动器、下载 Worker、多窗口锁，依赖 A–C | 全量安装、继续下载、空间不足恢复及只下载变更对象；未完成版本无法启动游戏 |
| E：云端发布 | `pwa-host`、`cloudflare.ts`、`publish.ts`，使用隔离测试夹具 | 状态优先、对象流式输出、删旧补新、各阶段失败保持维护、CAS 冲突拒绝开放 |
| F：游戏功能 | 检查原扩展/模式、素材编辑、录像、浏览器能力提示 | 全部内容进入清单；离线导入编辑和更新后存档保持；不适配处有具体源码定位 |
| G：上线接入 | Actions、正式游戏源、WSS，依赖 A–F | 首次人工发布成功后再启用指定分支自动发布；终端和混合联机验收完成 |

先做 A–D 得到本地完整离线闭环，再接入生产上传。实现过程中可以用不依赖服务器的单元测试、浏览器独立存储夹具和 Worker binding mock；真实离线、安装及云端维护验收另安排获得授权的测试入口，不擅自访问正在使用的服务。

### 13.2 首次上线运行手册

以下步骤留给用户要求实施和上线时执行，本轮只完善方案。

1. 完成源码 A–F，从指定提交构建并通过 `pwa:verify`。确认正式游戏域名及大厅服务器参数，准备 R2 S3 凭据和 CI API Token。
2. `wrangler whoami` 确认同一账号；只在桶不存在时运行 `wrangler r2 bucket create noname-pwa`，保留 Standard、私有桶，不开启 r2.dev 公共访问。
3. `pnpm pwa:plan` 输出账号、桶、前缀、目标 SHA、文件数、上传/删除对象数与字节数。空前缀、错误源或对象差异不匹配时先终止。
4. 首次桶里没有 `state.json` 时，以 `If-None-Match: *` 写 maintenance；然后用 `wrangler deploy --config packages/pwa-host/wrangler.jsonc` 引导站点。在后续发布中部署由 `publish.ts` 在维护阶段统一调度。
5. 本机按发布脚本需要配置 S3 环境变量，运行 `pnpm pwa:publish -- --bootstrap`；脚本继续同一次目标，传输并验证后才写 ready。首次引导重入也要检查 publicationId，不覆盖正在进行的发布。
6. 使用最终 HTTPS 源验证状态、manifest、HEAD/Range、非法路径与维护失败场景，再完成授权的桌面/手机完整离线测试。游戏域名稳定后再邀请朋友安装。
7. 按第 11.2 节实现并验证 Cloudflare 大厅，完成 PWA 与同版 Electron 混合联机；若选择保留 Node 大厅则部署第 11.1 节代理。迁移验收通过前保持旧大厅原进程，后续切换按用户要求处理。
8. 配置 `pwa-production` Secrets/Variable，再将工作流及源码按用户要求提交/推送到个人 fork；用手动触发验证一次，之后才由该分支 push 自动发布。

故障处理入口固定为：构建失败则修源码重跑；下载中断则继续同一目标；上传或校验失败保持维护并重跑；维护中的另一 publicationId 先查对应 Actions runner 是否结束。没有任何「失败自动恢复旧版」步骤。

## 14. 验收标准

### 14.1 自动检查

- 清单路径集合等于最终发行文件集合；无重复路径、遗漏、非法目录或意外外部依赖。
- 原始对象和包内容逐文件大小、SHA-256 匹配，解包后可还原完整发行快照。
- 本体或任一扩展构建失败时流水线失败，不能继续发布。
- 文件系统覆盖路径规范化、中文、目录合并、空目录、覆盖、删除标记、追加和截断。
- 安装中断、缓存与数据库状态不一致、空间不足、损坏文件和多窗口互斥均能恢复。
- 即时编译从本地读取，测试 raw/url/worker/Vue 子模块、不同相对路径及编辑后的模块更新。
- Range、HEAD、错误响应和未知文件不会返回错误类型或把部分内容当完整文件。
- 云端维护检查先于对象缓存；发布在每个关键步骤失败都保持 maintenance。
- 清理脚本准确保留新清单引用对象，拒绝越界删除；较旧任务不会覆盖较新发布。

### 14.2 游戏与离线检查

1. 在线首次安装全部内容，关闭所有游戏窗口，再断网冷启动；不以在线页面切换到离线代替冷启动测试。
2. 检查全部模式入口及各可单机模式的代表性完整对局；按当前发行内容覆盖身份、国战、对决、挑战、斗地主、单挑、战棋、塔防、炉石、乱斗等。
3. 启用并检查全部现有扩展，测试嵌套动态模块、武将及卡牌展示、技能语音和背景音乐；扩展冲突与 PWA 资源缺失分别定位。
4. 离线导入本地扩展 ZIP、编辑、导出、删除，重启确认文件和配置一致；覆盖 TS/Vue 及历史扩展格式。
5. 检查自定义图片、音乐、配置、录像和原有编辑功能，确认更新不清空玩家数据。
6. 比较网络请求日志：本地游戏所需资源没有成功依赖网络；Worker 的更新检查或明确的在线功能请求不算本地资源依赖。
7. 清理一个已安装资源后重新启动，能定位并修复；云端旧版已清理时引导更新当前版，不无休止重试旧地址。

### 14.3 发布及终端检查

1. 修改一个技能和一张图片，fork 更新自动发布，记录上传和客户端实际差异下载量。
2. 发布过程中启动在线客户端，显示维护；上传失败保持维护，重试成功后开放。
3. 维护时断网打开已经完整安装的客户端，本地仍可用，符合已确认的离线行为。
4. 在 Windows、Android、iPhone/iPad 真机完成安装、冷启动、音频和更新；不能用桌面浏览器模拟器替代所有手机测试。
5. 测试 WSS 大厅、PWA 房主以及同版本桌面客户端加入；PWA 发布不擅自操作独立大厅生命周期。
6. 测量云端最终与发布峰值用量，确认没有保留历史版本或长期临时包。

测试期间只有得到用户明确授权后才启动测试服务器或访问现有服务地址。可以使用独立的测试夹具和模拟 API 进行不依赖服务器的检查；不得为了验证编码而操作正在使用的服务。

## 15. 已知配置与部署前待落实项

| 配置 | 当前状态 |
| --- | --- |
| Cloudflare 登录与 account ID | 已核实有效；`d8b2e1f89db7e58447e0ca535a1def7f` |
| R2 可用性 | 已核实列表可读、现有 `kairisei` 桶；本方案继续选择 R2 |
| 专用桶与对象前缀 | 草案：新桶 `noname-pwa` + `noname-pwa/`，尚未创建；不使用已有业务桶 |
| Worker 名称 | 草案 `noname-pwa-host`，尚未核实同名资源或部署 |
| 正式游戏源 | 候选 `play.491528.xyz`；待核实 zone、DNS 冲突并确定长期使用 |
| fork 的 PWA 发行分支 | 默认建议当前 `my-features`；工作流尚未建立 |
| Actions / S3 凭据 | 待检查或配置第 10.1 节的 3 个 Secrets 与 1 个 Variable |
| 大厅 WSS | 候选 `lobby.491528.xyz`；本轮推荐独立 Worker + SQLite DO，适配后可去掉小主机。保留 Node 大厅时才需公网 IP 和反向代理 |
| 平台历史版本范围 | R2 游戏发行仅保留当前；Workers 平台内部代码/静态壳版本行为见第 9.5 节 |

这些参数不影响先完成源码、离线存储、打包和测试。实际外部部署及服务器配置另按用户授权执行。

## 16. 参考资料

仓库依据：`AGENTS.md`、`docs/agent-project-reference.md`、`docs/agent-online-server-cloudflare.md`，以及第 2 节列出的源码位置。

外部机制和限制参考，实施时应再次确认实际 API 与配额：

- [Cloudflare R2 Workers API：对象流、校验、Range、分页和删除](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- [Cloudflare Workers 静态资源](https://developers.cloudflare.com/workers/static-assets/)
- [Cloudflare Workers 静态资源配置与 binding](https://developers.cloudflare.com/workers/static-assets/binding/)
- [Cloudflare R2 S3 凭据](https://developers.cloudflare.com/r2/get-started/s3/)
- [Cloudflare R2 S3 API 兼容性](https://developers.cloudflare.com/r2/api/s3/api/)
- [Cloudflare R2 批量上传](https://developers.cloudflare.com/r2/objects/upload-objects/)
- [Cloudflare Workers GitHub Actions 部署](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [Cloudflare Workers 版本与部署](https://developers.cloudflare.com/workers/versions-and-deployments/)
- [Caddy WebSocket 反向代理](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
- [Cloudflare R2 计费及免费额度](https://developers.cloudflare.com/r2/pricing/)
- [Cloudflare Workers 计费](https://developers.cloudflare.com/workers/platform/pricing/)
- [MDN：Service Worker 注册、作用域与控制关系](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register)
- [MDN：Service Worker fetch 事件](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/fetch_event)
- [MDN：浏览器存储配额和回收](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
- [Chrome：缓存音频和视频的 Range 处理](https://developer.chrome.com/docs/workbox/serving-cached-audio-and-video)
- [GitHub Actions：工作流触发事件](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
- [GitHub Actions：发布并发控制](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
