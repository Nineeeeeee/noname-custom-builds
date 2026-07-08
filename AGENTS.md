# 无名杀项目指引

本文件是仓库级 Codex/Agent 指引。Codex 启动任务时会自动读取根目录的 `AGENTS.md`，用于建立项目上下文和开发约定。

## 0. 仓库操作约束

- 本仓库严禁执行任何 `git push` 或等价的远端推送操作。
- 允许按用户要求创建本地 commit，但本分支上的所有修改必须永远停留在本地，任何人都不应推送。

## 1. 项目概述

无名杀（Noname）是一款基于 HTML5 + TypeScript 开发的开源卡牌游戏，灵感来源于三国杀。本项目基于 **GPL-3.0 协议**开源，支持网页端、Electron 桌面端和移动端（Capacitor/Android）。

- **当前版本**: 1.11.4.1
- **运行环境**: Chromium >= 91 / Safari >= 16.4
- **仓库地址**: https://github.com/libnoname/noname

游戏采用事件驱动架构，核心由 `lib`（核心库）、`game`（游戏控制器）、`get`（工具函数）、`ui`（界面管理）、`ai`（人工智能）、`status`（状态管理）六大全局模块组成。

---

## 2. 技术栈

| 类别 | 技术选型 |
|------|---------|
| 语言 | TypeScript（主）、JavaScript（遗留/配置） |
| 前端框架 | Vue 3（部分 UI 组件，如内置编辑器） |
| 构建工具 | Vite 7（本体构建）、tsup（子包构建） |
| 包管理 | pnpm 9（Monorepo 工作区） |
| 代码检查 | ESLint + typescript-eslint + eslint-plugin-vue |
| 格式化 | Prettier |
| 目标平台 | Web 浏览器、Electron、Capacitor/Android |
| 依赖注入 | Vue 组件使用 `importmap` + Vue ESM Browser 构建 |

---

## 3. 目录结构说明

```
noname/
├── apps/                          # 前端应用
│   ├── core/                      # 🎯 主游戏应用（核心！）
│   │   ├── noname/                # 游戏引擎核心代码
│   │   │   ├── entry.ts           # 应用入口
│   │   │   ├── game/              # Game 类（游戏循环、回合控制）
│   │   │   ├── get/               # Get 工具模块（卡牌/武将信息获取）
│   │   │   ├── library/           # 核心库（元素定义、技能注册）
│   │   │   │   ├── element/       # 游戏元素类（Card/Player/GameEvent/Dialog等）
│   │   │   │   └── skill.js       # 内置技能表
│   │   │   ├── ui/                # UI 模块（DOM 操作、界面渲染）
│   │   │   ├── ai/                # AI 模块（电脑出牌逻辑）
│   │   │   ├── status/            # 状态模块（游戏运行时状态）
│   │   │   ├── init/              # 初始化（启动流程、加载配置）
│   │   │   └── util/              # 工具函数（拼音、路径、沙盒等）
│   │   ├── character/             # 武将包数据（按子目录分 pack）
│   │   ├── card/                  # 卡牌包数据
│   │   ├── mode/                  # 游戏模式（身份、国战、斗地主等）
│   │   ├── extension/             # 内置扩展
│   │   ├── audio/                 # 音频资源
│   │   ├── image/                 # 图片资源
│   │   ├── layout/                # 布局样式
│   │   ├── theme/                 # 主题样式
│   │   ├── font/                  # 字体文件
│   │   ├── typings/               # TypeScript 类型声明
│   │   └── game/                  # 静态配置（config.json、asset.json 等）
│   ├── electron/                  # Electron 桌面端
│   └── mobile/                    # Capacitor/Android 移动端
├── packages/                      # 可复用子包
│   ├── extension/                 # 扩展放置目录
│   ├── fs/                        # 文件服务（开发时本地服务器）
│   ├── jit/                       # JIT 编译（TypeScript Service Worker）
│   └── server/                    # WebSocket 联机服务器
├── scripts/                       # 构建与开发脚本
│   ├── dev.ts                     # 开发模式启动入口
│   ├── build.ts                   # 生产构建入口
│   ├── initExtension.ts           # 扩展初始化工具
│   └── extension-template/        # 扩展开发模板
└── docs/                          # 项目文档
```

---

## 4. 本地开发启动步骤

### 环境要求

- **Node.js**: ^20.19.0 || >=22.12.0
- **pnpm**: >= 9

### 安装与启动

```bash
# 1. 安装依赖（项目根目录）
pnpm install

# 2. 启动开发服务器
pnpm dev
```

`pnpm dev` 会并行启动三个进程：

| 进程 | 说明 | 端口 |
|------|------|------|
| `@noname/fs` (文件服务) | 本地静态文件服务器 | 8089 |
| `extension/**` (监听构建) | 扩展热更新构建 | - |
| `noname` (Vite Dev) | 主应用开发服务器 | 8080 |

浏览器会自动打开 `http://127.0.0.1:8080`，即可开始开发调试。

---

## 5. 构建步骤

```bash
# 构建生产版本（输出到 dist/ 目录）
pnpm build

# 启动离线服务预览构建结果
pnpm serve

# 构建 Electron 桌面端（Windows）
pnpm -F @noname/electron build:win

# 构建移动端（需 Capacitor/Android 环境）
# 参考 apps/mobile/android/ 下的配置

# 代码检查
pnpm lint
```

`pnpm build` 执行流程：
1. 构建主应用（Vite 构建 `apps/core`）
2. 构建所有扩展
3. 合并打包结果到 `dist/`，包含：游戏代码、音频、图片、扩展、文档

---

## 6. 核心模块说明

### 6.1 游戏流程（GameEvent 事件系统）

游戏采用**事件驱动模型**。几乎一切游戏行为（出牌、伤害、摸牌、死亡等）都通过 `GameEvent` 触发。事件在 `apps/core/noname/library/element/gameEvent.ts` 及 `content.ts` 中定义。

```
game.loop() → createEvent() → setContent() → 执行事件逻辑 → trigger() → 下一个事件
```

关键概念：
- `lib.element.GameEvent`: 事件基类
- `lib.element.content`: 事件内容函数表
- `_status.event`: 当前正在执行的事件

### 6.2 卡牌系统

| 路径 | 说明 |
|------|------|
| `apps/core/card/standard.js` | 标准卡牌包定义 |
| `apps/core/card/guozhan.js` | 国战卡牌包 |
| `apps/core/noname/library/element/card.js` | Card DOM 元素类定义 |
| `apps/core/noname/library/element/vcard.js` | 虚拟卡（视为牌）实现 |
| `apps/core/game/asset.json` | 卡牌素材索引 |

卡牌数据结构：
```javascript
export default {
    name: "standard",
    card: {
        sha: { name: "杀", ... },    // 卡牌名 → 卡牌定义
        tao: { name: "桃", ... },
        // ...
    }
};
```

### 6.3 武将系统

| 路径 | 说明 |
|------|------|
| `apps/core/character/standard/` | 标准武将包 |
| `apps/core/character/sp/` | SP 武将包 |
| `apps/core/character/shenhua/` | 神话武将包 |
| `apps/core/character/*` | 各扩展武将包（huicui/shiji/tw/yijiang 等） |
| `apps/core/noname/library/element/character.js` | Character 数据类 |

武将数据结构：
```javascript
// character/pack 内每个文件导出武将数组
[武将ID, 性别, 体力, 体力上限, [技能数组], 配置信息]
// 例如：
["_liubei", "male", 4, 4, ["rende", "jijiang"], ["des:..."]]
```

### 6.4 技能系统

| 路径 | 说明 |
|------|------|
| `apps/core/noname/library/skill.js` | 内置技能表 |
| `apps/core/typings/Skill.d.ts` | 技能类型定义 |

技能通过 `SkillTrigger` 接口声明触发时机：
```typescript
interface SkillTrigger {
    global?: Signal | Signal[];   // 全场触发
    player?: Signal | Signal[];   // 自身作为触发者
    target?: Signal | Signal[];   // 作为目标时触发
    source?: Signal | Signal[];   // 作为来源时触发
}
```

常见触发时机（Signal）：`phaseUse`（出牌阶段）、`phaseJudge`（判定阶段）、`damageBegin`（受伤时）、`useCardAfter`（出牌后）等。

### 6.5 模式系统

| 路径 | 说明 |
|------|------|
| `apps/core/mode/identity.js` | 身份模式 |
| `apps/core/mode/guozhan/` | 国战模式 |
| `apps/core/mode/versus.js` | 对决模式 |
| `apps/core/mode/doudizhu.js` | 斗地主模式 |
| `apps/core/mode/brawl.js` | 乱斗模式 |

每个模式通过 `game.import("mode", modeDefinition)` 注册，定义中包含 `start`（开局逻辑）、`startBefore`（开局前处理）等钩子函数。模式可以自定义回合流程、胜利条件和特殊规则。

### 6.6 全局模块关系

```
entry.ts → init/index.ts (boot)
              ↓
    ┌─────────┼─────────┐
    ↓         ↓         ↓
  lib       game       ui
 (核心库)  (游戏控制)  (界面管理)
    ↑         ↑         ↑
  get       ai        status
 (工具)    (AI逻辑)   (运行时状态)
```

- **`lib`**: 存储所有静态数据（武将包、卡牌包、技能表、翻译文本）和元素类定义
- **`game`**: 管理游戏循环、回合流程、玩家列表、事件队列
- **`get`**: 提供大量工具方法，如 `get.info(card)` 获取卡牌信息、`get.translation` 获取翻译
- **`ui`**: 负责 DOM 操作、界面渲染、动画效果
- **`ai`**: 电脑玩家的决策逻辑，包含基础估值和策略函数
- **`status`**: 运行时状态，如当前事件、选中的卡牌/目标、暂停状态等

---

## 7. 如何添加自定义武将/卡牌/技能

无名杀通过**扩展（Extension）**机制实现自定义内容。可以使用内置模板快速生成扩展脚手架：

```bash
# 创建普通扩展
pnpm init:extension my-extension --author "你的名字"

# 创建含 Vue 组件的扩展
pnpm init:extension my-extension --author "你的名字" --vue
```

扩展目录结构：
```
packages/extension/my-extension/
├── src/index.ts          # 扩展入口（必须）
├── info.json             # 扩展元信息
├── package.json
└── vite.config.ts
```

### 扩展入口模板（src/index.ts）

```typescript
import { lib, game, ui, get, ai, _status } from "noname";

export default function (): importExtensionConfig {
    return {
        name: "my-extension",
        editable: false,
        precontent: function () {
            // 在这里注册武将、卡牌、技能

            // 注册武将
            lib.config.all.characters.push("my_char_pack");
            lib.translate["my_char_pack_character_config"] = "我的武将包";

            // 注册卡牌
            lib.config.all.cards.push("my_card_pack");
            lib.translate["my_card_pack_card_config"] = "我的卡牌包";
        },
        content: function (config, pack) {
            // 扩展配置变更时的回调
        },
        config: {
            /* 扩展配置项 */
        },
        package: {
            character: {
                character: {
                    // 武将定义
                    my_hero: ["male", 4, 4, ["my_skill"], []],
                },
                translate: {
                    my_hero: "我的武将",
                },
            },
            card: {
                card: { /* 卡牌定义 */ },
                translate: {},
                list: [],
            },
            skill: {
                skill: {
                    // 技能定义
                    my_skill: {
                        trigger: { player: "phaseUse" },
                        content: async (event, trigger, player) => {
                            await player.draw(2);
                        },
                    },
                },
                translate: {
                    my_skill: "我的技能",
                },
            },
            intro: "扩展描述",
            author: "作者名",
            version: "1.0",
        },
        files: { character: [], card: [], skill: [], audio: [] },
    };
}
```

### 扩展开发要点

1. 扩展代码通过 `import "noname"` 引用全局模块
2. `precontent` 在加载阶段执行，用于注册全局数据
3. 技能 `content` 函数内使用事件驱动模型，`trigger` 提供当前事件的触发者
4. 卡牌/武将添加后需在配置中启用才能使用

---

## 8. 代码规范

| 规范项 | 要求 |
|--------|------|
| 语言 | 新代码使用 TypeScript，核心应用类型声明放在 `apps/core/typings/` |
| 模块导入 | ESM (`import/export`)，不使用 `require` |
| 代码风格 | ESLint + Prettier，运行 `pnpm lint` 检查 |
| 命名约定 | 类名 PascalCase、函数/变量 camelCase、常量 UPPER_SNAKE_CASE |
| 注释 | JSDoc 风格类型注释（`@param`、`@type`、`@returns`） |
| TS 配置 | `strict: true`，但 `noImplicitAny: false`（兼容遗留代码） |
| 浏览器兼容 | 目标 `chrome91` / `safari16.4`，使用 core-js 提供 polyfill |

ESLint 特别规则：
- 允许使用 `@ts-ignore` 和 `@ts-nocheck`
- 允许空 catch 块
- 允许 `no-fallthrough` 但需注释 `// [falls through]`

---

## 9. 相关资源链接

| 资源 | 链接 |
|------|------|
| GitHub 仓库 | https://github.com/libnoname/noname |
| PR 提交规范 | https://github.com/libnoname/noname/wiki/PR提交规范 |
| 本地运行文档 | https://github.com/libnoname/noname/wiki/如何运行无名杀 |
| 安卓客户端 | https://github.com/nonameShijian/noname-shijian-android/releases |
| PC 客户端 | https://github.com/nonameShijian/noname/releases |
| 项目本地文档 | `/docs/` 目录（how-to-start.md、lib-skill-format.md 等） |
| 技能格式文档 | `docs/lib-skill-format.md` |
| 事件开发文档 | `docs/game-event/` 目录 |

---

> **提示**: 本项目代码量庞大，涉及大量历史遗留 JavaScript 代码。建议使用 VS Code 或 WebStorm 进行开发，利用 TypeScript 类型智能提示高效导航代码。首次阅读建议从 `noname/entry.ts` → `noname/init/index.ts`（boot 函数）开始追踪游戏启动流程。
