# 部署步骤

## 1. 解压 & 进入目录

```bash
mkdir -p /docker/dns-tool
tar -xzf dns-tool.tar.gz -C /docker/dns-tool --strip-components=1
cd /docker/dns-tool
```

## 2. 编译镜像

```bash
docker compose build
```

## 3. 启动服务

```bash
docker compose up -d
docker compose ps        # 确认三个容器都 healthy
docker compose logs -f   # 看日志，Ctrl+C 退出
```

## 4. 配置 Nginx

### 4a. 在 nginx.conf 里把 YOUR_DOMAIN 换成实际域名

```bash
sed -i 's/YOUR_DOMAIN/dns.example.com/g' nginx.conf
```

### 4b. 在 /etc/nginx/nginx.conf 的 http {} 块里加 map（如果还没有）

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
```

### 4c. 部署配置

```bash
cp nginx.conf /etc/nginx/sites-available/dns-tool
ln -sf /etc/nginx/sites-available/dns-tool /etc/nginx/sites-enabled/dns-tool
nginx -t && nginx -s reload
```

### 4d. 测试

```bash
curl http://dns.example.com/health
curl -X POST http://dns.example.com/api/dns/lookup \
  -H 'Content-Type: application/json' \
  -d '{"domain":"google.com"}'
```

## 5. 申请 HTTPS 证书（acme.sh）

```bash
# 安装 acme.sh（如未安装）
curl https://get.acme.sh | sh -s email=your@email.com

# 申请证书（webroot 模式，需要 nginx 已在运行）
~/.acme.sh/acme.sh --issue -d dns.example.com --webroot /var/www/html

# 或者用 standalone 模式（需要临时停 nginx）
nginx -s stop
~/.acme.sh/acme.sh --issue -d dns.example.com --standalone
nginx

# 安装证书
mkdir -p /etc/nginx/ssl/dns.example.com
~/.acme.sh/acme.sh --install-cert -d dns.example.com \
  --cert-file      /etc/nginx/ssl/dns.example.com/cert.cer \
  --key-file       /etc/nginx/ssl/dns.example.com/dns.example.com.key \
  --fullchain-file /etc/nginx/ssl/dns.example.com/fullchain.cer \
  --reloadcmd      "nginx -s reload"
```

然后取消注释 nginx.conf 里的 HTTPS server 块，并把 HTTP server 换成 301 跳转。

## 6. 常用命令

```bash
# 查看状态
docker compose ps

# 重启某个服务
docker compose restart frontend

# 查看某个服务日志
docker compose logs -f backend

# 停止
docker compose down

# 更新重建
docker compose build --no-cache
docker compose up -d
```
