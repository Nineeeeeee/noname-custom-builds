# 无名杀局域网开服说明

这个目录是给局域网游玩准备的开服工具目录。仓库内以根目录 `dist/` 作为唯一构建产物源，本目录默认只放开服和打包脚本。

注意：

- `server.mjs` 是需要纳入版本管理的开服工具源码。
- 本仓库内开服默认直接读取根目录 `dist/`，不需要再维护一份 `lan-ai-server/public/`。
- `public/` 只作为最终 Windows 分发包里的自包含网页产物目录，或旧流程遗留目录；不应直接手工修改，也不纳入 Git 跟踪。
- 需要更新开服内容时，应先修改源码并重新构建，让根目录 `dist/` 保持最新。

- `../dist/`：仓库内唯一构建产物源
- `server.mjs`：局域网网页服务，同时提供游戏需要的文件接口；在仓库内默认服务 `../dist/`
- `package-windows.mjs`：基于 `../dist/` 生成 Windows 可双击运行 ZIP 包的脚本
- 默认网页端口：`8090`
- 多人联机大厅端口：`8082`

## Windows 分发包

需要把当前 `dist/` 打成可发给 Windows 朋友的双击运行包时，在本目录执行：

```bash
node package-windows.mjs
```

脚本会生成：

```text
output/noname-时间戳.zip
```

`output/` 里只保留最新一个 `noname-*.zip`。ZIP 解压后，Windows 用户双击 `start-noname.bat` 即可启动本地网页服务并自动打开浏览器。

脚本会把 Windows 版 `node.exe` 放进包里。查找顺序：

1. 环境变量 `NONAME_WINDOWS_NODE_EXE` 或 `NODE_WIN_EXE` 指向的 `node.exe`
2. 本目录下的 `node/node.exe`
3. 本目录下的 `runtime/node.exe`
4. 本目录下的 `.runtime/node.exe`
5. 如果以上都没有，则自动下载当前 Node 版本对应的官方 Windows x64 便携包并抽取 `node.exe`

## 一、单人玩 AI

单人打 AI 只需要开网页服务，不需要联机大厅。

在当前目录执行：

```bash
cd /home/fengxuwen/noname/lan-ai-server
node server.mjs
```

本机打开：

```text
http://127.0.0.1:8090/
```

同一局域网的手机、平板或其他电脑打开：

```text
http://主机局域网IP:8090/
```

也可以尝试：

```text
http://fairy.local:8090/
```

进入游戏后不要选“联机”，直接选身份、国战、斗地主等普通模式，就可以单人打 AI。

## 二、多人联机

多人联机需要同时开两个服务：

- 网页服务：让所有玩家打开同一份游戏网页，端口 `8090`
- 联机大厅服务：让玩家进入同一个房间，端口 `8082`

### 1. 开网页服务

终端 1：

```bash
cd /home/fengxuwen/noname/lan-ai-server
node server.mjs
```

所有玩家用浏览器打开：

```text
http://主机局域网IP:8090/
```

### 2. 开联机大厅

终端 2：

```bash
cd /home/fengxuwen/noname
pnpm -F @noname/server dev
```

看到类似下面的输出就表示联机大厅已启动：

```text
Server listening on port 8082
```

### 3. 游戏内连接

所有玩家进入网页后，选择“联机”，地址填：

```text
主机局域网IP:8082
```

例如：

```text
192.168.1.23:8082
```

主机自己也可以填：

```text
127.0.0.1:8082
```

但为了统一，主机也填 `主机局域网IP:8082` 更直观。

## 三、后台开服

如果不想占着终端，可以后台启动网页服务：

```bash
cd /home/fengxuwen/noname/lan-ai-server
setsid -f node server.mjs
```

后台启动联机大厅：

```bash
cd /home/fengxuwen/noname
setsid -f pnpm -F @noname/server dev
```

## 四、关服

查进程：

```bash
ps -ef | grep -E "server.mjs|@noname/server|packages/server"
```

关掉对应 PID：

```bash
kill 进程PID
```

如果只是单人网页服务，一般要关的是：

```text
node server.mjs
```

如果是多人联机，还要关联机大厅服务。

## 五、查主机局域网 IP

Linux：

```bash
ip addr
```

Windows：

```powershell
ipconfig
```

macOS：

```bash
ifconfig
```

一般是类似这样的地址：

```text
192.168.x.x
10.x.x.x
172.16.x.x
```

## 六、常见问题

如果其他设备打不开网页：

- 确认设备和主机在同一个 Wi-Fi/局域网
- 确认访问的是 `http://主机局域网IP:8090/`
- 检查主机防火墙是否放行 TCP `8090`

如果多人联机连不上：

- 确认 `pnpm -F @noname/server dev` 正在运行
- 游戏内联机地址填 `主机局域网IP:8082`
- 检查主机防火墙是否放行 TCP `8082`

如果页面提示 `game.checkFile is not a function`：

- 不要绕过 `server.mjs` 直接用普通静态服务器开 `dist/` 或 `public/`
- 必须用本目录的 `server.mjs` 开服
- 刷新页面，必要时强刷：`Ctrl + F5`

## 七、添加到桌面 / PWA

当前网页已经带轻量 PWA 配置：

- `../dist/manifest.webmanifest`
- `../dist/image/app-icon.svg`
- 首页的 PWA meta 标签

在手机或电脑浏览器打开网页后，可以在浏览器菜单里选择“添加到主屏幕”“安装应用”或类似入口。

注意：

- 局域网 `http://主机IP:8090/` 在不同浏览器上的 PWA 支持不完全一致。
- 如果浏览器不显示“安装应用”，通常仍可用“添加到主屏幕”创建快捷方式。
- 标准 PWA 安装通常要求 HTTPS 或 localhost；局域网 HTTP 可能被浏览器降级为普通网页快捷方式。
- 这只是轻量 PWA 外壳，方便桌面图标和全屏打开；不是完全离线版，开服设备仍需要运行 `server.mjs`。

## 八、更新开服产物

如果仓库代码更新后要重新生成开服使用的网页产物：

```bash
cd /home/fengxuwen/noname
pnpm build
```

`lan-ai-server/server.mjs` 在仓库内会直接服务新的 `dist/`。不需要再把 `dist/` 复制到 `lan-ai-server/public/`。
