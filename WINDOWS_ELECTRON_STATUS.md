# Windows Electron 打包状态交接

## 当前状态：未完成，仍有 404

用户安装新包后仍然白屏，控制台输出大量 404（vue, index.js, dedent.js, stackframe.js, error-stack-parser.js, stacktrace-gps.js, source-map-consumer.js, vue.esm-browser.js）。

## 回合 1：修复 electron-builder 文件剥离 ✅

**问题**：electron-builder 打包时剥离了 `vendor` 目录。
**根因**：
1. glob `**/*` 不匹配 `.pnpm`（dotfile）
2. 默认排除 `!**/node_modules/**`

**修复**：`apps/electron/build.ts` 三重改名：
```
node_modules/           → vendor/
vendor/.pnpm/           → vendor/pnpm/
vendor/pnpm/*/node_modules/  → vendor/pnpm/*/modules/
```

**验证通过**：vendor 目录完整存在于 win-unpacked 中（7.6M，40 modules）。

## 回合 2：404 — `_virtual/` 文件路径遗漏 ❌（当前问题）

**新根因**：`_virtual/` 目录下的 7 个文件使用 **父目录相对路径** `"../node_modules/.pnpm/..."`，而路径改写只处理了 `/node_modules/.pnpm/` 和 `./node_modules/.pnpm/`，完全遗漏了 `../` 模式。

**遗漏的文件**（都在 `public/_virtual/`）：
```
index.js       → "../node_modules/.pnpm/jszip@2.7.0/node_modules/jszip/lib/index.js"
index2.js      → "../node_modules/.pnpm/core-js-bundle@3.48.0/node_modules/core-js-bundle/index.js"
index3.js      → "../node_modules/.pnpm/crypto-js@4.2.0/node_modules/crypto-js/index.js"
index4.js      → "../node_modules/.pnpm/nosleep.js@0.12.0/node_modules/nosleep.js/src/index.js"
stackframe.js  → "../node_modules/.pnpm/stackframe@1.3.4/node_modules/stackframe/stackframe.js"
error-stack-parser.js → "../node_modules/.pnpm/error-stack-parser@2.1.4/node_modules/error-stack-parser/error-stack-parser.js"
stacktrace-gps.js → "../node_modules/.pnpm/stacktrace-gps@3.1.2/node_modules/stacktrace-gps/stacktrace-gps.js"
```

**为何 404**：`_virtual/` 在 `public/` 下，`../` 向上到 `public/`，然后找 `node_modules/`。但 `node_modules` 已改名 `vendor`，所以 `../node_modules/` 路径不存在 → 404。

## 待修复

`apps/electron/build.ts` `rewriteWebAssetPaths()` 的 walk 函数需要新增：

1. **添加 `../node_modules/.pnpm/` 改写**（当前缺失）：
   ```js
   .replaceAll('"../node_modules/.pnpm/', '"../vendor/pnpm/')
   .replaceAll("'../node_modules/.pnpm/", "'../vendor/pnpm/")
   .replaceAll("`../node_modules/.pnpm/", "`../vendor/pnpm/")
   ```

2. **修复嵌套 node_modules 正则**（当前 `\.?` 只匹配 `./` 和 `/`，不匹配 `../`）：
   ```js
   // 旧：/(["'`])(\.?\/vendor\/pnpm\/...)\/node_modules\//g
   // 新：/(["'`])((?:\.\.\/|\.\/|\/)?vendor\/pnpm\/...)\/node_modules\//g
   ```

## 修复后步骤

1. 修改 `apps/electron/build.ts`（上面 2 处）
2. 重新构建：`DISPLAY=:99 WINEPREFIX=/tmp/noname-electron-wine pnpm -F @noname/electron build:win`
3. 验证 `_virtual/` 文件不再包含旧路径
4. 生成新 zip，用户重新安装测试

## 当前分发包（有问题，不要用）

```
output/noname-20260710-000443.zip  (1.2G) — 有 404 bug
```

## 相关文件

- `apps/electron/build.ts` — `rewriteWebAssetPaths()` 函数
- `apps/electron/app/main.ts` — Electron 入口，用 Fastify 在 8089 端口 serve `public/`
- `packages/fs/src/index.ts` — `createApp()`，`@fastify/static` 静态文件服务
