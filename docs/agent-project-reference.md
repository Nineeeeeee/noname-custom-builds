# Agent Reference: 项目结构与开发说明

本文是从 `AGENTS.md` 抽出的低频参考资料。只有在需要理解项目结构、核心模块、扩展开发或代码规范时读取。

## 项目概述

无名杀（Noname）是一款基于 HTML5 + TypeScript 开发的开源卡牌游戏，灵感来源于三国杀。本项目基于 GPL-3.0 协议开源，支持网页端、Electron 桌面端和移动端（Capacitor/Android）。

游戏采用事件驱动架构，核心由 `lib`、`game`、`get`、`ui`、`ai`、`status` 六大全局模块组成。

## 技术栈

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

## 目录结构

```text
noname/
├── apps/
│   ├── core/                      # 主游戏应用
│   │   ├── noname/                # 游戏引擎核心代码
│   │   │   ├── entry.ts           # 应用入口
│   │   │   ├── game/              # Game 类（游戏循环、回合控制）
│   │   │   ├── get/               # Get 工具模块
│   │   │   ├── library/           # 核心库（元素定义、技能注册）
│   │   │   ├── ui/                # UI 模块
│   │   │   ├── ai/                # AI 模块
│   │   │   ├── status/            # 状态模块
│   │   │   ├── init/              # 初始化
│   │   │   └── util/              # 工具函数
│   │   ├── character/             # 武将包数据
│   │   ├── card/                  # 卡牌包数据
│   │   ├── mode/                  # 游戏模式
│   │   ├── extension/             # 内置扩展
│   │   ├── audio/                 # 音频资源
│   │   ├── image/                 # 图片资源
│   │   ├── layout/                # 布局样式
│   │   ├── theme/                 # 主题样式
│   │   ├── font/                  # 字体文件
│   │   ├── typings/               # TypeScript 类型声明
│   │   └── game/                  # 静态配置
│   ├── electron/                  # Electron 桌面端
│   └── mobile/                    # Capacitor/Android 移动端
├── packages/
│   ├── extension/                 # 扩展放置目录
│   ├── fs/                        # 文件服务
│   ├── jit/                       # JIT 编译
│   └── server/                    # WebSocket 联机服务器
├── lan-ai-server/                 # 可分发/局域网开服工具目录
├── scripts/                       # 构建与开发脚本
└── docs/                          # 项目文档
```

## 核心模块

### 游戏流程

游戏采用事件驱动模型。几乎一切游戏行为（出牌、伤害、摸牌、死亡等）都通过 `GameEvent` 触发。事件在 `apps/core/noname/library/element/gameEvent.ts` 及 `content.ts` 中定义。

```text
game.loop() -> createEvent() -> setContent() -> 执行事件逻辑 -> trigger() -> 下一个事件
```

关键概念：

- `lib.element.GameEvent`：事件基类
- `lib.element.content`：事件内容函数表
- `_status.event`：当前正在执行的事件

### 卡牌系统

| 路径 | 说明 |
|------|------|
| `apps/core/card/standard.js` | 标准卡牌包定义 |
| `apps/core/card/guozhan.js` | 国战卡牌包 |
| `apps/core/noname/library/element/card.js` | Card DOM 元素类定义 |
| `apps/core/noname/library/element/vcard.js` | 虚拟卡实现 |
| `apps/core/game/asset.json` | 卡牌素材索引 |

卡牌数据结构：

```javascript
export default {
    name: "standard",
    card: {
        sha: { name: "杀" },
        tao: { name: "桃" },
    },
};
```

### 武将系统

| 路径 | 说明 |
|------|------|
| `apps/core/character/standard/` | 标准武将包 |
| `apps/core/character/sp/` | SP 武将包 |
| `apps/core/character/shenhua/` | 神话武将包 |
| `apps/core/character/*` | 各扩展武将包 |
| `apps/core/noname/library/element/character.js` | Character 数据类 |

武将数据结构：

```javascript
["_liubei", "male", 4, 4, ["rende", "jijiang"], ["des:..."]]
```

### 技能系统

| 路径 | 说明 |
|------|------|
| `apps/core/noname/library/skill.js` | 内置技能表 |
| `apps/core/typings/Skill.d.ts` | 技能类型定义 |

技能通过 `SkillTrigger` 声明触发时机：

```typescript
interface SkillTrigger {
    global?: Signal | Signal[];
    player?: Signal | Signal[];
    target?: Signal | Signal[];
    source?: Signal | Signal[];
}
```

常见触发时机：`phaseUse`、`phaseJudge`、`damageBegin`、`useCardAfter` 等。

### 模式系统

| 路径 | 说明 |
|------|------|
| `apps/core/mode/identity.js` | 身份模式 |
| `apps/core/mode/guozhan/` | 国战模式 |
| `apps/core/mode/versus.js` | 对决模式 |
| `apps/core/mode/doudizhu.js` | 斗地主模式 |
| `apps/core/mode/brawl.js` | 乱斗模式 |

每个模式通过 `game.import("mode", modeDefinition)` 注册，定义中包含 `start`、`startBefore` 等钩子函数。

### 全局模块关系

```text
entry.ts -> init/index.ts (boot)
              |
    lib       game       ui
    get       ai         status
```

- `lib`：存储静态数据、翻译文本、元素类定义。
- `game`：管理游戏循环、回合流程、玩家列表、事件队列。
- `get`：提供工具方法，如 `get.info(card)`、`get.translation`。
- `ui`：负责 DOM 操作、界面渲染、动画效果。
- `ai`：电脑玩家的决策逻辑。
- `status`：运行时状态，如当前事件、选中的卡牌/目标、暂停状态。

## 添加扩展

无名杀通过 Extension 机制实现自定义内容。可以使用内置模板生成扩展脚手架：

```bash
pnpm init:extension my-extension --author "你的名字"
pnpm init:extension my-extension --author "你的名字" --vue
```

扩展目录结构：

```text
packages/extension/my-extension/
├── src/index.ts
├── info.json
├── package.json
└── vite.config.ts
```

扩展入口模板：

```typescript
import { lib, game, ui, get, ai, _status } from "noname";

export default function (): importExtensionConfig {
    return {
        name: "my-extension",
        editable: false,
        precontent: function () {
            lib.config.all.characters.push("my_char_pack");
            lib.translate["my_char_pack_character_config"] = "我的武将包";
        },
        content: function (config, pack) {},
        config: {},
        package: {
            character: {
                character: {
                    my_hero: ["male", 4, 4, ["my_skill"], []],
                },
                translate: {
                    my_hero: "我的武将",
                },
            },
            card: {
                card: {},
                translate: {},
                list: [],
            },
            skill: {
                skill: {
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

扩展开发要点：

1. 扩展代码通过 `import "noname"` 引用全局模块。
2. `precontent` 在加载阶段执行，用于注册全局数据。
3. 技能 `content` 函数内使用事件驱动模型，`trigger` 提供当前事件触发者。
4. 卡牌/武将添加后需在配置中启用才能使用。

## 代码规范

| 规范项 | 要求 |
|--------|------|
| 语言 | 新代码使用 TypeScript，核心应用类型声明放在 `apps/core/typings/` |
| 模块导入 | ESM (`import/export`)，不使用 `require` |
| 代码风格 | ESLint + Prettier，运行 `pnpm lint` 检查 |
| 命名约定 | 类名 PascalCase、函数/变量 camelCase、常量 UPPER_SNAKE_CASE |
| 注释 | JSDoc 风格类型注释 |
| TS 配置 | `strict: true`，但 `noImplicitAny: false` |
| 浏览器兼容 | 目标 `chrome91` / `safari16.4`，使用 core-js 提供 polyfill |

ESLint 特别规则：

- 允许使用 `@ts-ignore` 和 `@ts-nocheck`。
- 允许空 catch 块。
- 允许 `no-fallthrough`，但需注释 `// [falls through]`。

## 相关资源

| 资源 | 链接 |
|------|------|
| GitHub 仓库 | `https://github.com/libnoname/noname` |
| PR 提交规范 | `https://github.com/libnoname/noname/wiki/PR提交规范` |
| 本地运行文档 | `https://github.com/libnoname/noname/wiki/如何运行无名杀` |
| 安卓客户端 | `https://github.com/nonameShijian/noname-shijian-android/releases` |
| PC 客户端 | `https://github.com/nonameShijian/noname/releases` |
| 技能格式文档 | `docs/lib-skill-format.md` |
| 事件开发文档 | `docs/game-event/` |

