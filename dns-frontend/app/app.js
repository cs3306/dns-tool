const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL || 'http://middleware:5000';
const SITE_URL = process.env.SITE_URL || `http://localhost:${PORT}`;

const requestLogger = (req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.url} - ${req.ip}`);
    next();
};

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
            scriptSrcAttr: ["'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "blob:"],
            connectSrc: ["'self'", "http:", "https:"],
            fontSrc: ["'self'", "data:"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            frameAncestors: ["'none'"],
        },
    },
    crossOriginEmbedderPolicy: false,
}));

app.use(compression());
app.use(cors({
    origin: NODE_ENV === 'production' ? [SITE_URL] : true,
    credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

if (NODE_ENV === 'development') {
    app.use(requestLogger);
}

app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: NODE_ENV === 'production' ? '1h' : 0,
    etag: NODE_ENV !== 'development',
    lastModified: NODE_ENV !== 'development',
    setHeaders: (res, filePath) => {
        if (NODE_ENV === 'development') {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
}));

const apiProxyOptions = {
    target: MIDDLEWARE_URL,
    changeOrigin: true,
    timeout: 120000,
    proxyTimeout: 120000,
    pathRewrite: { '^/api': '/api' },
    onError: (err, req, res) => {
        console.error(`[${new Date().toISOString()}] API Proxy Error:`, {
            url: req.url,
            method: req.method,
            error: err.message,
            target: MIDDLEWARE_URL
        });
        if (!res.headersSent) {
            res.status(502).json({
                status: 'error',
                message: '中间层服务暂时不可用，请稍后重试',
                error: NODE_ENV === 'development' ? err.message : undefined
            });
        }
    },
    onProxyReq: (proxyReq, req, res) => {
        console.log(`[${new Date().toISOString()}] Proxying API request:`, {
            method: req.method,
            url: req.url,
            target: `${MIDDLEWARE_URL}${req.url}`
        });
        if (req.body && Object.keys(req.body).length > 0) {
            const bodyData = JSON.stringify(req.body);
            proxyReq.setHeader('Content-Type', 'application/json');
            proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
            proxyReq.write(bodyData);
        }
    },
    onProxyRes: (proxyRes, req, res) => {
        console.log(`[${new Date().toISOString()}] API response:`, {
            status: proxyRes.statusCode,
            url: req.url
        });
        proxyRes.headers['Access-Control-Allow-Origin'] = '*';
        proxyRes.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
        proxyRes.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    }
};

app.use('/api', createProxyMiddleware(apiProxyOptions));

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'dns-frontend',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        environment: NODE_ENV,
        middleware_url: MIDDLEWARE_URL,
    });
});

app.get('/health/detailed', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'dns-frontend',
        timestamp: new Date().toISOString(),
        checks: { server: 'ok' }
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.send(`User-agent: *\nDisallow: /api/\nAllow: /`);
});

app.get('/sitemap.xml', (req, res) => {
    res.type('application/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url>
        <loc>${SITE_URL}/</loc>
        <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
        <changefreq>weekly</changefreq>
        <priority>1.0</priority>
    </url>
</urlset>`);
});

app.use('*', (req, res) => {
    if (req.url.startsWith('/api/')) {
        res.status(404).json({ status: 'error', message: 'API endpoint not found', path: req.url });
    } else {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

app.use((err, req, res, next) => {
    console.error(`[${new Date().toISOString()}] Server Error:`, err.message);
    if (!res.headersSent) {
        res.status(500).json({
            status: 'error',
            message: '服务器内部错误',
            error: NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

process.on('SIGTERM', () => { console.log('SIGTERM received'); process.exit(0); });
process.on('SIGINT',  () => { console.log('SIGINT received');  process.exit(0); });

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 DNS Frontend Server started on port ${PORT} [${NODE_ENV}]`);
    console.log(`🔗 Middleware URL: ${MIDDLEWARE_URL}`);
});
