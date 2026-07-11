# Android（Capacitor）客户端

该目录将仓库根目录的 `dist/` 游戏资源打入 Android WebView 容器。

## 前置条件

- JDK 与 Android SDK（本工程要求 Android API 36）
- 从仓库根目录执行过 `pnpm install`

## 构建

在此目录执行：

```bash
pnpm build:apk
```

该命令会依次构建根目录 `dist/`、同步 Capacitor 资源并生成 release APK：

```text
android/app/build/outputs/apk/release/app-release.apk
```

Google Play 上架则使用 `pnpm build:aab`，产物为 `app-release.aab`。

`release` 当前使用 debug keystore，适合本地或侧载测试。正式分发前必须在
`android/app/build.gradle.kts` 配置自己的 release keystore，并安全保存该私钥。
