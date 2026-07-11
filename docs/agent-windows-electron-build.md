# Agent Reference: Windows Electron 打包流程

本文记录 2026-07-11 验证通过的 Windows x64 Electron NSIS 打包流程。

## 前置环境

- 项目依赖由 `pnpm install` 安装。
- 构建机安装 `wine`、`wine64` 和 `wine32:i386`。
- 无桌面环境使用 `DISPLAY=:99`。
- Wine 构建前缀固定为 `/tmp/noname-electron-wine`。

## 标准命令

```bash
# 1. 生成最新网页游戏产物到 dist/
pnpm build

# 2. 初始化 Wine 构建前缀
DISPLAY=:99 WINEPREFIX=/tmp/noname-electron-wine WINEARCH=win64 wineboot -u

# 3. 生成 Windows x64 NSIS 安装器
DISPLAY=:99 WINEPREFIX=/tmp/noname-electron-wine pnpm -F @noname/electron build:win

# 4. 把最新安装器压成分发 ZIP
python3 -c 'import pathlib, time, zipfile; src=max(pathlib.Path("output").glob("noname Setup *.exe"), key=lambda p: p.stat().st_mtime); dst=pathlib.Path("output") / ("noname-" + time.strftime("%Y%m%d-%H%M%S") + ".zip"); z=zipfile.ZipFile(dst, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6); z.write(src, arcname=src.name); z.close(); print(dst)'
```

## 打包实现

1. `pnpm build` 刷新根目录 `dist/` 中的游戏代码、扩展和资源。
2. `apps/electron/build.ts` 构建 Electron 主进程和 preload。
3. 临时目录 `/tmp/noname-electron-packager/` 存放 Electron 程序，子目录 `public/` 存放根目录 `dist/` 的副本。
4. 生产环境以 `resources/app/public/` 为 `8089` 静态服务根目录。
5. 打包脚本依次把 `node_modules`、`.pnpm` 和包内 `node_modules` 改名为 `vendor`、`pnpm` 和 `modules`，并同步改写网页资源中的引用。
6. 打包脚本检测到残留 `/node_modules/` 或 `src="vue"` 时终止构建。
7. Electron Builder 完成后删除 `/tmp/noname-electron-packager/`。

## 成功标准

构建日志包含以下三行：

```text
Electron web assets prepared: ... dependency directories renamed, ... files rewritten
building target=nsis file=.../output/noname Setup 1.11.4.exe
打包完成: ...noname Setup 1.11.4.exe
```

执行以下命令验证产物：

```bash
file output/noname\ Setup\ 1.11.4.exe
file output/win-unpacked/noname.exe
stat output/noname\ Setup\ 1.11.4.exe output/win-unpacked/noname.exe
rg -n '/node_modules/|src="vue"' \
  output/win-unpacked/resources/app/public \
  -g '*.html' -g '*.js' -g '*.mjs' -g '*.css' -g '*.json' -g '*.webmanifest'
python3 -m zipfile -t output/noname-YYYYMMDD-HHMMSS.zip
python3 -m zipfile -l output/noname-YYYYMMDD-HHMMSS.zip
sha256sum output/noname-YYYYMMDD-HHMMSS.zip
```

- 安装器显示为 `PE32 ... Nullsoft Installer`。
- `output/win-unpacked/noname.exe` 显示为 `PE32+ ... x86-64`。
- 安装器修改时间晚于同轮生成的 `win-unpacked` 主程序。
- 依赖路径扫描命令无输出。
- ZIP 完整性测试输出 `Done testing`。
- ZIP 内仅包含 `noname Setup 1.11.4.exe`。

## 运行验证

正常启动日志包含：

```text
ts loaded ...
sfc loaded ...
service worker加载完成，重启页面
jit-test.ts 编译成功
[electron:preload] loaded
[electron:preload] DOM ready
```

以下日志仅表示对应功能状态：

- Vue development build 提示表示当前使用 Vue 浏览器开发版。
- `/preload.js` 404 触发 Electron 的 `init/node.js` fallback。
- `duplicated translate` 保留先加载的翻译文本。
- `audio/...mp3` 404 使对应卡牌或技能静音。

以下日志表示启动资源打包失败：

- `/vue` 返回 404。
- `vendor/pnpm/.../node_modules/...` 返回 404。
- Vue、Pako、StackFrame 或 SourceMap 返回 404。
- 控制台出现 `[electron:preload] unhandled rejection`。
- 页面未显示首次许可提示或启动背景。

关键依赖使用以下 URL 结构并返回 HTTP 200：

```text
/vendor/pnpm/vue@.../modules/vue/dist/vue.esm-browser.js
/vendor/pnpm/pako@.../modules/pako/index.js
/vendor/pnpm/stackframe@.../modules/stackframe/stackframe.js
/vendor/pnpm/source-map@.../modules/source-map/lib/source-map-consumer.js
```

## 产物

- 安装器路径为 `output/noname Setup 1.11.4.exe`。
- 分发包路径为 `output/noname-YYYYMMDD-HHMMSS.zip`。
- 检查目录为 `output/win-unpacked/`。
- 玩家分发物固定为时间戳 ZIP。
- `/tmp/noname-electron-wine` 保留供后续打包复用。
