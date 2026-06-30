# DNS Lookup Tool · DNS 查询工具

[English](#english) | [中文](#中文)

---

## English

A three-tier DNS lookup tool supporting multiple DNS providers, DoH (DNS over HTTPS), batch queries, and server performance comparison.

### Architecture

```
Browser ──► dns-frontend (Node.js:3000)
               │  HTTP Proxy /api/*
               ▼
         dns-middleware (Python/Flask:5000)
               │  TTL Cache + Validation
               ▼
         dns-backend (Go/Gin:8080)
               │  UDP/TCP DNS + DoH (RFC 8484)
               ▼
         DNS Servers / DoH Endpoints
```

| Service | Language | Port | Role |
|---------|----------|------|------|
| dns-frontend | Node.js 18 + Express | 3000 | Static files + API reverse proxy |
| dns-middleware | Python 3.11 + Flask | 5000 | Input validation + TTL cache + aggregation |
| dns-backend | Go + Gin | 8080 | Actual DNS resolution (UDP/TCP + DoH) |

### Features

- ✅ Record types: A / AAAA / CNAME / MX / TXT / NS / SOA / PTR / SRV / CAA
- ✅ Preset DNS servers: Google / Cloudflare / Quad9 / Alibaba / Baidu / Tencent / 114
- ✅ Custom DNS server (IP, IP:Port, hostname:Port)
- ✅ **DoH support** — `https://your.host/dns-query` or `your.host/path`
- ✅ Batch queries (up to 20 domains)
- ✅ DNS server performance comparison
- ✅ TTL cache (default 5 min, max 1000 entries)
- ✅ Query statistics & cache hit rate
- ✅ JSON export

### Quick Start

```bash
git clone https://github.com/cs3306/dns-tool.git
cd dns-tool
docker compose up -d
```

Access at http://localhost:3000

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Frontend port |
| `NODE_ENV` | development | Environment mode |
| `SITE_URL` | http://localhost:3000 | Public URL (for CORS & sitemap) |
| `MIDDLEWARE_URL` | http://middleware:5000 | Middleware address |
| `BACKEND_URL` | http://localhost:8080 | Backend address |
| `CACHE_SIZE` | 1000 | Max cache entries |
| `CACHE_TTL` | 300 | Cache TTL in seconds |

### API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/dns/lookup` | Single domain lookup |
| POST | `/api/dns/batch` | Batch lookup (≤20) |
| POST | `/api/dns/compare` | Compare DNS servers (≤5) |
| GET | `/api/dns/servers` | List available DNS servers |
| GET | `/api/dns/types` | List supported record types |
| GET | `/api/stats` | Query statistics |
| POST | `/api/cache/clear` | Clear cache |
| GET | `/health` | Health check |

### Docker Hub

```bash
docker pull cs3306/dns-frontend:latest
docker pull cs3306/dns-middleware:latest
docker pull cs3306/dns-backend:latest
```

---

## 中文

三层架构的 DNS 查询工具，支持多 DNS 服务商、DoH（DNS over HTTPS）、批量查询和服务器性能比较。

### 架构说明

```
浏览器 ──► dns-frontend (Node.js:3000)
               │  反向代理 /api/*
               ▼
         dns-middleware (Python/Flask:5000)
               │  TTL 缓存 + 输入校验
               ▼
         dns-backend (Go/Gin:8080)
               │  UDP/TCP DNS + DoH (RFC 8484)
               ▼
         DNS 服务器 / DoH 端点
```

| 服务 | 语言 | 端口 | 职责 |
|------|------|------|------|
| dns-frontend | Node.js 18 + Express | 3000 | 静态文件 + API 反向代理 |
| dns-middleware | Python 3.11 + Flask | 5000 | 输入校验 + TTL 缓存 + 数据聚合 |
| dns-backend | Go + Gin | 8080 | 实际 DNS 解析（UDP/TCP + DoH） |

### 功能特性

- ✅ 支持记录类型：A / AAAA / CNAME / MX / TXT / NS / SOA / PTR / SRV / CAA
- ✅ 预设 DNS 服务商：Google / Cloudflare / Quad9 / 阿里云 / 百度 / 腾讯 / 114
- ✅ 自定义 DNS 服务器（IP、IP:Port、hostname:Port）
- ✅ **支持 DoH** — 填入 `https://your.host/dns-query` 或 `your.host/path` 即可
- ✅ 批量域名查询（最多 20 个）
- ✅ DNS 服务器性能比较
- ✅ TTL 缓存（默认 5 分钟，最多 1000 条）
- ✅ 查询统计 & 缓存命中率
- ✅ 结果 JSON 导出

### 快速开始

```bash
git clone https://github.com/cs3306/dns-tool.git
cd dns-tool
docker compose up -d
```

访问 http://localhost:3000

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | 3000 | 前端端口 |
| `NODE_ENV` | development | 环境模式 |
| `SITE_URL` | http://localhost:3000 | 公开访问地址（用于 CORS 和 sitemap） |
| `MIDDLEWARE_URL` | http://middleware:5000 | middleware 地址 |
| `BACKEND_URL` | http://localhost:8080 | backend 地址 |
| `CACHE_SIZE` | 1000 | 缓存最大条数 |
| `CACHE_TTL` | 300 | 缓存 TTL（秒） |

### API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/dns/lookup` | 单域名查询 |
| POST | `/api/dns/batch` | 批量查询（≤20） |
| POST | `/api/dns/compare` | DNS 服务器比较（≤5） |
| GET | `/api/dns/servers` | 可用 DNS 服务器列表 |
| GET | `/api/dns/types` | 支持的记录类型 |
| GET | `/api/stats` | 查询统计 |
| POST | `/api/cache/clear` | 清空缓存 |
| GET | `/health` | 健康检查 |

### Docker Hub 镜像

```bash
docker pull cs3306/dns-frontend:latest
docker pull cs3306/dns-middleware:latest
docker pull cs3306/dns-backend:latest
```

### License

MIT
