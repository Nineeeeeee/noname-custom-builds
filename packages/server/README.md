# 无名杀独立联机大厅

本目录只包含 WebSocket 联机大厅，不包含游戏网页、图片、音频或 Electron
客户端。玩家仍由其中一人的客户端创建房间并担任房主；大厅只负责房间发现和
消息转发。

## Node.js 分发包

GitHub Release 中的 `noname-lobby-node-*.zip` 已包含编译结果和生产依赖。
服务器安装 Node.js 20 或更高版本后，解压即可运行，不需要再次执行
`pnpm install`：

```bash
# Linux / macOS
chmod +x start-lobby.sh
./start-lobby.sh

# 或在任意平台直接使用 Node.js
node dist/cli.cjs
```

Windows 可双击 `start-lobby.cmd`。默认监听 TCP `8082`，也可通过环境变量或
命令行参数修改端口：

```bash
PORT=9000 ./start-lobby.sh
node dist/cli.cjs --port 9000
```

## Docker 镜像分发包

GitHub Release 中的 `noname-lobby-docker-linux-amd64-*.tar` 是已经构建好的
Linux AMD64 Docker 镜像，无需源码即可导入：

```bash
docker load -i noname-lobby-docker-linux-amd64-版本号.tar
```

`docker load` 完成后会显示实际镜像标签。使用该标签按照下文的安全参数启动
容器即可。

## 本机构建并运行

```bash
cd packages/server
docker compose up -d --build
docker compose ps
docker compose logs -f lobby
```

默认监听宿主机 TCP `8082`。停止和删除容器：

```bash
docker compose down
```

## 将镜像传到 Ubuntu 服务器

在构建机器导出镜像：

```bash
docker save -o noname-lobby-1.11.4.1.tar noname-lobby:1.11.4.1
```

把 tar 文件复制到 Ubuntu 服务器后执行：

```bash
docker load -i noname-lobby-1.11.4.1.tar
docker run -d \
  --name noname-lobby \
  --restart unless-stopped \
  --init \
  --read-only \
  --tmpfs /tmp:size=16m,mode=1777 \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  -p 8082:8082 \
  noname-lobby:1.11.4.1
```

查看状态和日志：

```bash
docker ps --filter name=noname-lobby
docker logs -f noname-lobby
```

## 公网连接

Ubuntu 云厂商安全组和系统防火墙都需要允许 TCP `8082`。Electron 客户端在
游戏联机地址中填写：

```text
服务器公网IP:8082
```

该方式使用未加密的 WebSocket，并且大厅没有账号认证。若玩家公网 IP 固定，
优先在安全组或防火墙中只允许玩家来源 IP；否则开放 `8082/tcp` 后，互联网上
任何人都能尝试连接大厅。

若 Ubuntu 启用了 UFW，应先确保 SSH 不会被拦截，再放行大厅端口：

```bash
sudo ufw allow OpenSSH
sudo ufw allow 8082/tcp
sudo ufw status
```

云厂商控制台中的安全组也要添加入站 TCP `8082`，这一步不能由容器代替。

## 更新镜像

加载新版镜像后重建同名容器：

```bash
docker stop noname-lobby
docker rm noname-lobby
docker load -i 新版镜像.tar
```

然后重新执行上面的 `docker run` 命令。大厅数据都在内存中，没有需要迁移的
房间数据库；重启时现有房间会断开。
