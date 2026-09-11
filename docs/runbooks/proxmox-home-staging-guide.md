# HomeFinance：纽约家中 Proxmox 私有测试环境部署指南

更新日期：2026-09-11  
适用对象：自己管理 Proxmox、希望按步骤部署 HomeFinance 的项目所有者。  
本指南代码基线：`0d40c2874cbdde6832b85cdea7512e83fa8ddd9e`（PR #7）。

> 这是操作方案，不是已经在你的服务器上执行成功的记录。该代码版本的 GitHub CI、真实数据库集成、4 条浏览器旅程和 Redis/MinIO 恢复测试通过，但家中 VM、网络和备份恢复仍需按本文验证。只使用测试数据，不导入真实财务资料。

## 1. 先了解方案和边界

推荐路线：独立 Ubuntu VM → Docker Compose → Tailscale 私网 → 手动构建和验收 → 备份恢复 → 后续才接自动发布。

```text
你的 Windows 电脑（Tailscale）
  ├─ 普通 SSH 经 Tailscale → Ubuntu VM:22
  │    └─ 本地 localhost:4173 隧道 → VM 127.0.0.1:80 → 前端 /api → 后端
  └─ 附件访问经 Tailscale → VM 的 Tailscale IPv4:9000 → MinIO 代理

纽约家中 Proxmox
  └─ homefinance-staging Ubuntu VM
       ├─ frontend + backend + mock-ai
       └─ PostgreSQL + Redis + MinIO（数据库及存储管理端口不对外发布）
```

- 不在 Proxmox 宿主机安装 Docker、项目或 GitHub Runner。
- 不做路由器公网端口转发，不启用 Tailscale Funnel，也不向公网开放 Proxmox `8006`。
- 网站在电脑上通过 `http://localhost:4173` 访问；附件通过 Tailscale IP 的 `9000` 端口访问。HTTP 位于加密 SSH/Tailscale 连接内，这不是公开 HTTPS 站点。
- 这条路径适合管理员测试，不是家人手机直接使用的最终入口。手机/PWA、正式 HTTPS 域名和真实 AI 接入另做部署设计。
- staging 使用确定性的模拟 AI，关闭公开注册；不能把模拟回答当作真实 AI 能力。
- 纽约断电、断网或 Proxmox 停机会导致服务不可用。建议 UPS，并保留异地加密备份。

### 为什么不直接运行现有 deploy.sh？

`ops/staging/deploy.sh` 要求已发布到 GHCR 的三种镜像摘要，并强制生成相应镜像地址。当前 GitHub 发布工作流还要求运行器能 SSH 到服务器；GitHub 托管运行器默认进不了家中 LAN/Tailscale。

本文第一次部署使用 VM 本地构建，不运行 `deploy.sh`、`promote.sh` 或 `rollback.sh`，不伪造 digest，也不创建发布 tag。备份脚本可以在本文复制后的 Compose 配置上运行。后续自动化见第 13 节。

## 2. 准备清单

完成后再开始建机：

- [ ] 能登录 Proxmox 管理页面，并能打开 VM Console；若人在外地且目前无法连接，请先解决现有远程入口，不能靠尚未安装的 Tailscale 自举。
- [ ] Proxmox 有余量：建议为 VM 分配 4 vCPU、8 GiB RAM、100 GiB SSD。恢复演练会启动第二套数据库/后端，必要时临时升至 12–16 GiB RAM，并预留两份以上数据空间。
- [ ] 准备 Ubuntu Server 24.04 LTS ISO，建议从官方获取并核对 SHA-256。
- [ ] 准备 Tailscale 账号，开启多因素认证；知道哪些设备允许访问测试 VM。
- [ ] GitHub 账号 QZSAMA 可读取私有仓库 `QZSAMA/HomeFinance`。
- [ ] Windows 已有 OpenSSH 客户端；测试阶段需要 Git 和 Node.js 22.12+ 的兼容版本（建议使用维护中的 Node 22 最新补丁版）。
- [ ] 备份目的地不是同一块 Proxmox 磁盘：优先 PBS/独立 NAS，再加异地加密副本。

记录到自己的密码管理器或运维笔记，不提交到 Git：

| 项目 | 你的值 |
|---|---|
| Proxmox VM ID | 自选未占用 ID |
| VM 名称 | `homefinance-staging` |
| Ubuntu 普通管理员 | 本文示例 `hfadmin` |
| VM LAN IP | 由家中 DHCP 分配，建议路由器做 DHCP 保留 |
| VM Tailscale IPv4 | 安装后通过 `tailscale ip -4` 查询 |
| Windows Tailscale IPv4 | 安装后查询 |
| SSH 密钥 | 记录本地文件位置；不发送私钥 |
| 部署目录 | `/opt/homefinance-staging` |
| 精确代码版本 | `0d40c2874cbdde6832b85cdea7512e83fa8ddd9e` |

官方参考（页面可能更新，安装细节以执行时官方说明为准）：

- Proxmox 管理手册：https://pve.proxmox.com/pve-docs/pve-admin-guide.html
- Ubuntu Server：https://ubuntu.com/download/server
- Docker Ubuntu 安装：https://docs.docker.com/engine/install/ubuntu/
- Tailscale Linux 安装：https://tailscale.com/kb/1031/install-linux
- Tailscale 访问控制：https://tailscale.com/kb/1018/acls
- GitHub CLI：https://cli.github.com/

## 3. 在 Proxmox 创建 VM

以下是 Proxmox 网页操作，不是在 Windows PowerShell 中执行。

1. 在节点存储的 ISO Images 中上传 Ubuntu Server 24.04 LTS ISO。
2. 点击 **Create VM**，选择未占用 VM ID，名称填 `homefinance-staging`。
3. OS 选择刚上传的 Ubuntu ISO。
4. System 保持适合当前 Proxmox 的 Linux 默认配置；磁盘控制器建议 VirtIO SCSI，启用 QEMU Guest Agent 选项。不要修改宿主机原有网络来适配应用。
5. Disk 建议 100 GiB；选可靠存储。Discard 仅在底层支持时启用，不要盲目更改缓存模式。
6. CPU 4 vCPU；单宿主机可选 CPU type `host`，如需要跨节点迁移则按集群兼容性配置。
7. Memory 8192 MiB，确保宿主机仍有充足可用内存。
8. Network 选择现有通向 LAN 的 bridge，通常是 `vmbr0`，网卡选 VirtIO。
9. 启动 VM，在 Console 安装 Ubuntu：创建 `hfadmin`，选择安装 OpenSSH Server；不安装额外数据库服务。
10. 重启进入磁盘系统，移除安装 ISO，检查磁盘启动顺序。

在 **Ubuntu Console** 执行：

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y qemu-guest-agent ca-certificates curl git openssl python3 jq nano ufw
sudo systemctl enable --now qemu-guest-agent
ip -br address
timedatectl
```

若 Guest Agent 启动失败，检查 Proxmox VM Options 中已启用该选项，完整关闭/重新启动 VM 后再查。确认系统时间同步；建议服务器用 UTC，应用家庭时区与服务器时区是独立设置，不要重写现有家庭时区。

在 Proxmox Options 中启用 Start at boot，并设置合理启动顺序/延迟。此时可以做一份标记为“干净 Ubuntu”的 VM 备份；快照仅作为短期辅助手段。

**检查点：** Ubuntu 能访问互联网，Proxmox 显示 Guest Agent/IP，Console 可正常登录。

## 4. 安装 Tailscale，配置最小访问范围

在 Windows 安装官方 Tailscale 客户端并登录。在 Ubuntu 使用官方 Linux 安装说明；以下采用先下载、检查再执行的方式：

```bash
curl -fsSL https://tailscale.com/install.sh -o /tmp/tailscale-install.sh
less /tmp/tailscale-install.sh
# 确认来源和内容后执行；若下载或检查失败，停止，不继续。
sudo sh /tmp/tailscale-install.sh
sudo tailscale up
tailscale ip -4
tailscale status
```

完成命令提供的账号登录/设备批准。安装到 Ubuntu VM，不要求安装到 Proxmox 宿主机。不启用子网路由、出口节点或 Tailscale SSH；本文使用普通 OpenSSH。

在 Tailscale 管理台：

1. 确认 VM 和 Windows 设备都属于你。
2. 检查访问策略：仅允许你的管理身份/设备访问这台 VM 的 TCP `22` 和 `9000`。前端 `80` 仅本机监听，不需要 tailnet 放行。
3. 如果当前策略是默认 allow-all，要收窄它；新增一条限制规则不会抵消另一条宽泛允许规则。不要直接覆盖已有家庭 tailnet 策略，先确认其他设备需求。
4. 对设备密钥过期设置做好记录和提醒。只有理解风险后才对这台受控服务器关闭密钥到期，不要全局关闭安全控制。

在 Windows PowerShell：

```powershell
# 将下面地址替换为 VM 的真实 Tailscale IPv4。
$HfVmAddress = '100.x.y.z'
tailscale ping $HfVmAddress
ssh "hfadmin@$HfVmAddress"
```

首次 SSH 的主机指纹应与 Ubuntu Console 执行 `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` 的结果比对，不要无条件接受未知主机。

若 ping 显示 relay，只说明流量走中继，不一定有故障；跨国延迟正常。连接不上时先查账号、策略和设备在线状态，不要为了排错打开路由器公网端口。

**检查点：** Windows 通过 Tailscale IP 成功 SSH 到 VM。

## 5. 设置 SSH 密钥和主机防火墙

在 Windows PowerShell 创建项目专用密钥。若文件已存在，不要覆盖；换一个文件名或复用你确认可用的密钥。

```powershell
ssh-keygen -t ed25519 -f "$env:USERPROFILE/.ssh/homefinance_staging" -C homefinance-staging
Get-Content "$env:USERPROFILE/.ssh/homefinance_staging.pub" |
  ssh "hfadmin@$HfVmAddress" 'umask 077; mkdir -p .ssh; cat >> .ssh/authorized_keys'
ssh -i "$env:USERPROFILE/.ssh/homefinance_staging" "hfadmin@$HfVmAddress"
```

给私钥设置口令，保存到密码管理器。只有 `.pub` 是公钥；没有 `.pub` 后缀的是私钥。

保留一个已连接的 SSH 窗口，同时在第二个窗口测试密钥登录。验证成功后，可在 Ubuntu 编辑 `/etc/ssh/sshd_config.d/00-homefinance.conf`：

```text
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
```

```bash
sudo nano /etc/ssh/sshd_config.d/00-homefinance.conf
sudo sshd -t
sudo sshd -T | grep -E 'passwordauthentication|kbdinteractiveauthentication|permitrootlogin'
sudo systemctl reload ssh
```

必须确认有效值都是 `no`；配置有错误或值被其他配置影响时先修正，不要关闭现有连接。保留 Proxmox Console 作为救援入口。

在 Ubuntu 设置基本防火墙（启用前确认 Tailscale 密钥登录已成功）：

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow in on tailscale0 to any port 22 proto tcp
sudo ufw allow in on tailscale0 to any port 9000 proto tcp
sudo ufw enable
sudo ufw status verbose
```

重要：Docker 发布端口及 Tailscale 自己的防火墙规则可能不完全受 UFW 常规规则约束。不能只依赖 UFW；后文明确限制 Docker 端口绑定，并要求 Tailscale 策略和实际访问测试。不要关闭 Docker 的 iptables 功能来“修复”防火墙。

## 6. 安装 Docker Engine 和 Compose

在 Ubuntu 执行。若 VM 已经有 Docker 或其他服务，先检查，不要照抄安装卸载操作；本步骤以全新 VM 为前提。

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo nano /etc/apt/sources.list.d/docker.sources
```

将下面内容写入刚打开的文件（对应 Ubuntu 24.04 noble、x86_64/amd64；ARM 主机需要把 Architectures 改成 `arm64`）：

```text
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: amd64
Signed-By: /etc/apt/keyrings/docker.asc
```

```bash
dpkg --print-architecture
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker run --rm hello-world
sudo docker compose version
```

核对架构后再安装。本文使用 `sudo docker`，不必加入 docker 用户组；能控制 Docker 就基本等于拥有 VM 的 root 权限。

**检查点：** hello-world 成功，Compose v2 可用。

## 7. 下载精确版本的项目

在 Ubuntu **普通 hfadmin 用户**下安装 GitHub CLI，并交互登录：

```bash
sudo apt install -y gh
gh auth login
gh auth setup-git
mkdir -p ~/src
cd ~/src
git clone https://github.com/QZSAMA/HomeFinance.git
cd HomeFinance
git fetch origin codex/staging-deployment
git checkout --detach 0d40c2874cbdde6832b85cdea7512e83fa8ddd9e
git rev-parse HEAD
git status --short
```

这是私有仓库，按 CLI 指引通过浏览器完成账号登录。不把 token 写在 clone URL、脚本、截图或文档里。若目录已存在，先查看 `git status`，不要覆盖自己的文件。

输出的 SHA 应与本文基线完全一致；将来用新版本部署时，重新确认该精确 SHA 的检查结果。Ubuntu 新 clone 使用 LF 换行，可避免从 Windows 复制 Bash 脚本产生 CRLF 问题。

## 8. 准备仅私网可达的 Compose 配置

在 Ubuntu 普通用户的仓库根目录执行：

```bash
sudo install -d -m 700 /opt/homefinance-staging
sudo install -m 600 ops/staging/compose.staging.yml /opt/homefinance-staging/compose.staging.yml
sudo install -m 600 ops/staging/.env.example /opt/homefinance-staging/.env
sudo install -m 644 ops/staging/minio-proxy.conf /opt/homefinance-staging/minio-proxy.conf
sudo install -m 700 ops/staging/backup.sh ops/staging/backup-retention.sh ops/staging/restore-rehearsal.sh /opt/homefinance-staging/
sudo nano /opt/homefinance-staging/compose.staging.yml
```

**不要直接启动原始 Compose。** 在复制后的文件中只调整这两处 ports（不是仓库源文件）：

```yaml
# minio-proxy 服务中：用实际 VM Tailscale IPv4 替换示例。
ports: ['100.x.y.z:9000:9000']

# frontend 服务中：仅本机监听，外部必须走 SSH 隧道。
ports: ['127.0.0.1:80:80']
```

必须替换原有的 `9000:9000` 和 `80:80`，不能在后面再追加。不要给 postgres、redis、backend 或 minio 增加 ports。不要使用普通 Compose override 叠加 ports，以免旧的全接口绑定仍被保留。

接着生成四份不同的随机值：

```bash
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
sudo nano /opt/homefinance-staging/.env
```

将四个值分别用于下面的数据库密码、MinIO 密码、JWT、staging 注册密钥；不要复用。生成结果属于敏感信息，不截图、不粘到 GitHub issue。采用 hex 避免数据库 URL 和 shell 特殊字符转义问题。

`.env` 最终应是下列结构；所有示例占位符必须替换：

```dotenv
POSTGRES_USER=staging
POSTGRES_PASSWORD=替换为第一个hex值
POSTGRES_DB=homefinance_staging
MINIO_ROOT_USER=staging
MINIO_ROOT_PASSWORD=替换为第二个hex值
JWT_SECRET=替换为第三个hex值
STAGING_E2E_REGISTRATION_KEY=替换为第四个hex值
CORS_ORIGIN=http://localhost:4173
COMPOSE_PROJECT_NAME=homefinance-staging
POSTGRES_VOLUME_NAME=homefinance-staging-postgres-data
REDIS_VOLUME_NAME=homefinance-staging-redis-data
MINIO_VOLUME_NAME=homefinance-staging-minio-data
MINIO_PUBLIC_ENDPOINT=100.x.y.z
MINIO_PUBLIC_PORT=9000
MINIO_PUBLIC_USE_SSL=false
BACKEND_IMAGE=homefinance-backend:0d40c28
FRONTEND_IMAGE=homefinance-frontend:0d40c28
MOCK_AI_IMAGE=homefinance-mock-ai:0d40c28
```

MINIO_PUBLIC_ENDPOINT 填 VM 的实际 Tailscale IPv4，不带 `http://`。不要把 `.env` 中的家庭时区改成纽约时区：此文件没有家庭时区配置，应用创建家庭时另选。

```bash
sudo chmod 600 /opt/homefinance-staging/.env
sudo docker compose --env-file /opt/homefinance-staging/.env -f /opt/homefinance-staging/compose.staging.yml config --quiet
```

`config --quiet` 无报错是通过。不要把不带 `--quiet` 的完整展开配置贴给别人，它会包含密码。

## 9. 构建并启动测试环境

仍在 Ubuntu 仓库根目录：

```bash
sudo docker build -t homefinance-backend:0d40c28 ./backend
sudo docker build -t homefinance-frontend:0d40c28 ./frontend
sudo docker build -t homefinance-mock-ai:0d40c28 ./e2e/mock-ai
```

任何一个构建失败都应停止，先排查网络、磁盘和错误日志。现有前端约 870 kB 的 bundle 警告是已知风险，不代表整个发布已达到无警告标准。代码版本固定不等于镜像可复现：基础镜像可能变化，因此下一步记录实际镜像 ID。

启动（首次会下载 PostgreSQL/Redis/MinIO/Nginx 等基础镜像）：

```bash
sudo docker compose --env-file /opt/homefinance-staging/.env -f /opt/homefinance-staging/compose.staging.yml up -d --wait --wait-timeout 300
sudo docker compose --env-file /opt/homefinance-staging/.env -f /opt/homefinance-staging/compose.staging.yml ps
curl --fail http://127.0.0.1/api/health
sudo docker compose --env-file /opt/homefinance-staging/.env -f /opt/homefinance-staging/compose.staging.yml exec -T backend npx prisma migrate status
sudo docker image inspect homefinance-backend:0d40c28 homefinance-frontend:0d40c28 homefinance-mock-ai:0d40c28 --format '{{.RepoTags}} {{.Id}}'
```

后端容器启动会执行 `prisma migrate deploy`。这会修改数据库；首次空测试库可以执行。将来已有数据时必须先备份并审查迁移，不能把上述命令当作无副作用的重启。

检查 `ps` 的 Ports：

- frontend 只出现 `127.0.0.1:80->80`。
- minio-proxy 只出现实际 `100.x.y.z:9000->9000`。
- 不应有 `0.0.0.0:80`、`0.0.0.0:9000` 或 `[::]` 发布。
- postgres/redis/minio/backend 不应有主机发布端口；仅显示容器内部端口是正常的。

从家中另一台不在授权 tailnet 的设备访问 VM LAN IP 的 `80`、`9000` 应失败；从未授权 tailnet 设备访问也应失败。若任一个能访问，先修正暴露和策略，再继续。

**检查点：** 服务就绪、health 成功、migration status 正常、端口符合上述边界。

## 10. 打开网站并跑浏览器验收

### 10.1 在 Windows 开启 SSH 隧道

```powershell
$HfVmAddress = '100.x.y.z' # 替换成真实地址
ssh -i "$env:USERPROFILE/.ssh/homefinance_staging" -o ExitOnForwardFailure=yes -N -L 127.0.0.1:4173:127.0.0.1:80 "hfadmin@$HfVmAddress"
```

保持该窗口运行；正常情况下没有输出。浏览器打开：

```text
http://localhost:4173
```

不要改成公网 IP。关闭隧道窗口后网页无法连接是正常现象，不代表容器停止。

### 10.2 在另一个 Windows PowerShell 跑现有四条测试

使用单独的源码目录，避免改变你平时开发中的工作区：

```powershell
git clone https://github.com/QZSAMA/HomeFinance.git HomeFinance-staging-check
cd HomeFinance-staging-check
git fetch origin codex/staging-deployment
git checkout --detach 0d40c2874cbdde6832b85cdea7512e83fa8ddd9e
cd frontend
node --version
npm ci
npx playwright install chromium
$env:E2E_BASE_URL = 'http://localhost:4173'
$HfRegistrationSecret = Read-Host '输入服务器上的 STAGING_E2E_REGISTRATION_KEY' -AsSecureString
$env:E2E_REGISTRATION_KEY = [System.Net.NetworkCredential]::new('', $HfRegistrationSecret).Password
try {
  npx playwright test
} finally {
  Remove-Item Env:E2E_REGISTRATION_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:E2E_BASE_URL -ErrorAction SilentlyContinue
  $HfRegistrationSecret = $null
}
```

注册密钥来自第 8 节，保存在自己的密码管理器中。此过程需要它作为测试进程环境变量，输入隐藏并不意味着进程内不存在明文；只在可信电脑运行。

这里必须用 `npx playwright test`，**不要用 `npm run test:e2e`**：后者会尝试在 Windows 本地启动另一套 Docker 测试环境，不是在验收远端 VM。

期待结果：4 passed。若失败，先保留 `frontend/test-results` 和 `playwright-report` 在私密位置。trace 可能含注册密钥、token、请求正文等，不要直接公开上传。不要增加超时或删除断言来制造通过。

浏览器测试会生成测试账户、家庭和交易，可能没有自动清理。只在 staging 运行；不得对真实家庭数据库执行。现有测试不等于覆盖全部附件操作，下一节必须手动检查。

### 10.3 建立自己的测试账户与手动检查

网页注册被关闭是设计行为，不要为方便直接开启公开注册。使用浏览器测试生成的账号进行人工操作不方便；可以在 Ubuntu 创建一个明确的私人测试账号：

```bash
sudo -i
cd /opt/homefinance-staging
# 此文件只允许 root 修改，且必须是第 8 节可信的简单 KEY=value 内容。
set -a
. ./.env
set +a
read -r -p '测试邮箱: ' HF_TEST_EMAIL
read -r -p '测试用户名: ' HF_TEST_NAME
read -r -s -p '测试密码（建议密码管理器生成至少16位随机密码）: ' HF_TEST_PASSWORD
printf '\n'
export HF_TEST_EMAIL HF_TEST_NAME HF_TEST_PASSWORD
python3 - <<'PY'
import json, os, urllib.request, urllib.error
payload = json.dumps({
    'email': os.environ['HF_TEST_EMAIL'],
    'name': os.environ['HF_TEST_NAME'],
    'password': os.environ['HF_TEST_PASSWORD'],
}).encode()
request = urllib.request.Request('http://127.0.0.1/api/auth/register', data=payload, headers={
    'Content-Type': 'application/json',
    'X-Staging-Registration-Key': os.environ['STAGING_E2E_REGISTRATION_KEY'],
})
try:
    with urllib.request.urlopen(request, timeout=30) as response:
        print('注册 HTTP 状态:', response.status)
except urllib.error.HTTPError as error:
    print('注册失败 HTTP 状态:', error.code)
    raise SystemExit(1)
PY
unset HF_TEST_EMAIL HF_TEST_NAME HF_TEST_PASSWORD
exit
```

此命令不会打印响应 token。失败先看 HTTP 状态和私密日志；重复邮箱会被拒绝，不要绕过服务端验证。

用新账号在 `http://localhost:4173/login` 登录并完成：

- [ ] 创建测试家庭，明确选择家庭时区。人在纽约不等于账务必须用纽约时区；按家庭账务习惯选择，现有设计创建后不能随便改。
- [ ] 新增收入 100 CNY、支出 25 CNY，核对同期间净收入 75 CNY。
- [ ] 编辑收入，再新增支出；取消编辑，再新增一条，确认没有误改旧记录。
- [ ] 上传无敏感信息的小文件，打开附件，检查下载 URL 为 VM Tailscale IP:9000，不是 `minio:9000` 或公网地址。
- [ ] 删除测试附件，确认 UI 和下载行为符合预期。
- [ ] 测试 viewer 不能新增、修改、删除。
- [ ] 记录代码 SHA、三镜像 ID、测试时间和结果，不记录密码/token。

PWA 仅缓存应用壳，不保证离线财务数据可用。当前内网 HTTP 附件适用于此私有测试方案；浏览器若提示本地网络访问权限，仅在确认页面与目标均为自己的测试服务时允许。未来切换公开 HTTPS 时还要同步改存储入口，避免混合内容与签名失效。

## 11. 设置备份并实际演练恢复

### 11.1 首次应用一致性备份

先确认没有发布或用户写入。当前脚本会暂停 backend/frontend 和 MinIO，网站会短暂不可用；它没有与部署、恢复、定时任务统一加锁，不得同时运行这些操作。

```bash
sudo bash /opt/homefinance-staging/backup.sh
```

记录命令最后输出的绝对目录，例如 `/opt/homefinance-staging/backups/daily/20260911T120000Z`。然后替换成自己的实际目录检查：

```bash
sudo sha256sum -c /opt/homefinance-staging/backups/daily/实际时间戳/SHA256SUMS
sudo docker compose --env-file /opt/homefinance-staging/.env -f /opt/homefinance-staging/compose.staging.yml ps
curl --fail http://127.0.0.1/api/health
```

确认两个文件 `postgres.dump` 和 `minio-data.tar` 都存在且校验通过，服务已恢复。失败时不要把该目录标为有效备份；若脚本异常中断，先用 `ps` 检查并按需 `start minio minio-proxy backend frontend`，再检查健康状态。

备份还需要这些配套材料：精确源码 SHA、实际镜像 ID/可恢复的镜像、服务器复制后的 Compose 和 MinIO 代理配置、加密保存的 `.env`。数据库密码不是数据备份本身，丢失配置可能导致恢复困难。

### 11.2 异地副本与 Proxmox 备份

- 在 Proxmox 配置 VM 定时备份，目标优先是独立 PBS/NAS；普通在线 VM 备份不替代上述应用一致性备份。
- 将应用备份及敏感配置用经过验证的加密备份工具同步到另一地点，妥善保存加密恢复密钥。
- 整机和备份均在纽约同一台服务器上，不能防止失窃、火灾和整机损坏。
- 本文首次先手工备份；连续几次成功后再设置每日/每周计划和失败通知，不要无监控地直接加 cron。
- 建议最低保留 7 份 daily、4 份 weekly；需要先实际生成 weekly，不能认为 daily 自动包含周备份。

手工生成周备份：

```bash
sudo env BACKUP_CLASS=weekly bash /opt/homefinance-staging/backup.sh
```

`backup-retention.sh` 会真实删除超过保留数的旧目录，不能恢复，除非已有独立副本。第一次不要运行；先完成异地同步、核对目录后再决定是否启用。也不要执行 `docker system prune --volumes` 或 `docker compose down -v` 清理磁盘。

### 11.3 现有脚本的隔离恢复演练

确保磁盘/内存有第二套服务的余量，且当前没有其他部署/备份操作。使用第 11.1 节实际输出的本机绝对路径：

```bash
sudo bash /opt/homefinance-staging/restore-rehearsal.sh /opt/homefinance-staging/backups/daily/实际时间戳
```

脚本会创建独立 Compose 项目和独立卷，恢复 PostgreSQL 与 MinIO，验证 API、迁移和 bucket 可访问性，退出时清理其临时项目。它不应覆盖正在运行的 staging 卷。

重要限制：

- 当前 `SHA256SUMS` 内记录的是绝对路径。从异地复制到不同目录后不能直接沿用此检查方式；需要先逐项验证对应文件内容和原始 hash，再在可信恢复流程中处理路径，不能直接重建校验文件并据此宣布备份有效。
- 脚本使用当前 `.env` 镜像恢复，并可能应用其 migrations，不一定复原备份当天的软件版本。因此同时保留备份版本的镜像和配置很重要。
- 成功消息只证明上述基础检查，不证明恢复后的所有账目、附件内容和租户权限正确。
- 它是会清理测试环境的自动演练，不是灾难发生时直接覆盖主环境的恢复工具。

完成后检查原 staging 的 health、交易和附件仍正常，并记录恢复时间。正式投入使用前，再做一次独立 VM 的恢复演练，核对数据数量、选定附件 hash、同币种报表和用户权限。应在该测试 VM 的隔离网络中操作，禁止恢复出的实例与原 VM 使用相同 LAN IP/Tailscale 身份同时上线。

## 12. 重启检查、日常操作与排错

### 重启验证

确认无人使用并已备份，执行 `sudo reboot`。等待 VM 启动后重新连接 Tailscale/SSH，重建 Windows 隧道。

- 检查 Tailscale 服务和 IP。
- 检查 `docker compose ... ps`、health、migration status。
- 检查之前的测试交易和附件还在。
- 如果绑定 Tailscale IP 的 minio-proxy 因地址尚未就绪启动失败，待 `tailscale ip -4` 正常后再运行本指南第 9 节 `up -d --wait`。自动恢复启动顺序需要后续单独配置，不把“开机自启”当作已经验证成功。

### 常用只读诊断命令（Ubuntu）

```bash
df -h
free -h
tailscale status
sudo systemctl status docker tailscaled --no-pager
sudo docker compose --env-file /opt/homefinance-staging/.env -f /opt/homefinance-staging/compose.staging.yml ps
sudo docker compose --env-file /opt/homefinance-staging/.env -f /opt/homefinance-staging/compose.staging.yml logs --tail 100 backend frontend minio
```

日志可能含私人信息。分享前删除 token、密码、邮件、附件签名 URL 等。不要用完整 `.env` 或 `docker inspect` 输出代替诊断摘要。

| 现象 | 先检查 | 不要做 |
|---|---|---|
| SSH 不通 | Tailscale 在线、策略、用户名、密钥、Proxmox Console | 开放公网 22/8006 来绕过问题 |
| `localhost:4173` 不通 | 隧道是否仍在、端口是否占用、VM health | 修改前端 API 指向公网 |
| `cannot assign requested address` | Compose 中 Tailscale IP 正确且已就绪 | 改回 `0.0.0.0` 长期运行 |
| 网页能开，附件打不开 | 客户端也在 tailnet、9000 策略、public endpoint、MinIO proxy | 把 9001 管理控制台开放公网 |
| 注册 403 | staging 默认关闭公开注册，检查专用测试密钥 | 长期开启公开注册 |
| 镜像拉取失败 | VM 出网、DNS、Docker Hub 限流 | 粘贴凭据到公共日志 |
| migration 失败 | 保留日志、查 DB 状态、审查迁移 | 删卷重建、强行 migrate reset |
| 空间不足 | 镜像、日志、备份和卷各占多少，先验证独立备份 | 批量 prune volumes |
| 更新失败 | 保留当前数据，按兼容性评估前向修复 | 自动启用旧镜像连接新 schema |

日常升级必须先备份、固定新 SHA、构建新 tag 并记录镜像 ID，再验收。不要覆盖 `:0d40c28` 旧 tag，也不要改用 `latest`。应用旧镜像不等于数据库回滚；需要回退时先确认 schema 兼容性。

该历史代码基线的 Dockerfile 仍使用 Node 20，并固定了一些较旧的基础镜像。正式长期运行前必须评估运行时支持周期、镜像漏洞和升级回归；不要将“历史版本 CI 通过”等同于“当前无安全风险”。本文保留基线用于测试复现，不在操作过程中偷偷更换运行时。

## 13. 什么时候接 GitHub 自动部署？

只有当手动部署、网络隔离、重启和恢复演练均通过后，再推进：

1. 明确只用于 staging，保留 QZSAMA 的 GitHub Environment 审批。
2. 推荐 GitHub 托管 runner 在部署 job 中用短期机器身份加入 tailnet，只能连接测试 VM 所需端口；不要将宽泛、长期个人 Tailscale 凭据放进 Actions。
3. 另一种方式是独立部署 runner，但必须与 Proxmox 管理面隔离，不能运行不可信 PR，也不能把 runner 直接放在 Proxmox 宿主机。
4. 调整现有 workflow，并为新身份/网络路径补验证；仅设置 `STAGING_HOST=100.x.y.z` 不会自动打通连接。
5. 发布后端、前端、mock-ai 镜像到 GHCR，固定 digest，配置 Environment 所需 secrets：
   - `STAGING_HOST`
   - `STAGING_SSH_USER`
   - `STAGING_SSH_PRIVATE_KEY`
   - `STAGING_SSH_KNOWN_HOSTS`
   - `STAGING_GHCR_TOKEN`
   - `STAGING_E2E_REGISTRATION_KEY`
6. 核对 root/普通部署用户的 Docker registry 登录上下文及最小 sudo 权限，不能认为普通用户 `docker login` 自动提供 root 拉取凭据。
7. 评审迁移、备份、失败恢复后，再显式批准创建 release tag 和实际部署。

本指南不要求现在合并 PR、创建 tag、打开公网或配置生产密钥。现有自动发布链尚未在家中网络执行；不要跳过前面步骤直接触发它。

## 14. 完成清单与求助时提供的信息

- [ ] VM 与 Proxmox 宿主机隔离，Console 可救援。
- [ ] Tailscale + SSH 密钥登录成功，访问策略已限制。
- [ ] 无公网端口转发，Docker 端口绑定已核对。
- [ ] 固定代码版本、镜像 ID 和配置已记录。
- [ ] 数据库、Redis、MinIO、后端、前端、mock-ai 正常。
- [ ] 四条 Playwright 测试通过，附件手动测试通过。
- [ ] 重启后连接与数据正常。
- [ ] 应用备份校验通过，至少有一份异地加密副本。
- [ ] 隔离恢复演练通过，并理解其尚未覆盖完整业务恢复。
- [ ] 真实财务数据、公开 HTTPS、真实 AI 与自动发布仍单独审批。

需要继续协助时，提供：做到的章节、命令名称、脱敏后的错误、Ubuntu/Docker/Compose 版本、是否能经 Tailscale SSH。IP 和用户名可以单独提供；不要发送私钥、完整 `.env`、密码、token 或未经脱敏的浏览器 trace。

本文件仅新增运维说明，不修改应用行为或现有脚本。语义 Graphify 更新沿用项目既有限制暂未执行；不以 AST-only 输出覆盖已审阅的语义图谱。
