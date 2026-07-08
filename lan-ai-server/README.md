# 无名杀局域网开服说明

这个目录是给局域网游玩准备的开服目录。

- `public/`：已经构建好的网页游戏产物
- `server.mjs`：局域网网页服务，同时提供游戏需要的文件接口
- 默认网页端口：`8090`
- 多人联机大厅端口：`8082`

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

- 不要用普通静态服务器开 `public/`
- 必须用本目录的 `server.mjs` 开服
- 刷新页面，必要时强刷：`Ctrl + F5`

## 七、添加到桌面 / PWA

当前网页已经带轻量 PWA 配置：

- `public/manifest.webmanifest`
- `public/image/app-icon.svg`
- 首页的 PWA meta 标签

在手机或电脑浏览器打开网页后，可以在浏览器菜单里选择“添加到主屏幕”“安装应用”或类似入口。

注意：

- 局域网 `http://主机IP:8090/` 在不同浏览器上的 PWA 支持不完全一致。
- 如果浏览器不显示“安装应用”，通常仍可用“添加到主屏幕”创建快捷方式。
- 标准 PWA 安装通常要求 HTTPS 或 localhost；局域网 HTTP 可能被浏览器降级为普通网页快捷方式。
- 这只是轻量 PWA 外壳，方便桌面图标和全屏打开；不是完全离线版，开服设备仍需要运行 `server.mjs`。

## 八、更新开服产物

如果仓库代码更新后要重新生成这个目录里的网页产物：

```bash
cd /home/fengxuwen/noname
pnpm build
cp -a dist/. lan-ai-server/public/.
```
