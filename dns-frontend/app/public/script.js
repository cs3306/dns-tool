let currentResults = null;
let batchMode = false;
let availableDNSServers = {};
let availableDNSTypes = [];

const API_BASE_URL = '/api';
window.eventsBound = false;

function bindEventHandlers() {
    if (window.eventsBound) return;

    const lookupBtn = document.getElementById('lookupBtn');
    if (lookupBtn) lookupBtn.onclick = e => { e.preventDefault(); performDNSLookup(); };

    const domainInput = document.getElementById('domainInput');
    if (domainInput) domainInput.onkeypress = e => { if (e.key === 'Enter') { e.preventDefault(); performDNSLookup(); } };

    const advancedToggle = document.getElementById('advancedToggle');
    if (advancedToggle) advancedToggle.onclick = e => { e.preventDefault(); toggleAdvancedOptions(); };

    // 自定义 DNS 输入框：实时校验 + 高亮
    const customDnsInput = document.getElementById('customDnsInput');
    if (customDnsInput) {
        customDnsInput.oninput = function() {
            const val = this.value.trim();
            const serverSelect = document.getElementById('dnsServerSelect');
            if (val) {
                const valid = validateCustomDns(val);
                this.style.borderColor = valid ? 'var(--green)' : 'var(--red)';
                if (serverSelect) serverSelect.style.opacity = '0.4';
            } else {
                this.style.borderColor = '';
                if (serverSelect) serverSelect.style.opacity = '';
            }
        };
    }

    const compareBtn = document.getElementById('compareBtn');
    if (compareBtn) compareBtn.onclick = e => { e.preventDefault(); performDNSComparison(); };

    const batchToggle = document.getElementById('batchToggle');
    if (batchToggle) batchToggle.onclick = e => { e.preventDefault(); toggleBatchMode(); };

    document.querySelectorAll('.example-btn').forEach(btn => {
        btn.onclick = e => { e.preventDefault(); quickLookup(btn.textContent.trim()); };
    });

    document.onclick = e => {
        const t = e.target;
        if (t.matches('[data-action="about"]'))       { e.preventDefault(); showAbout(); }
        else if (t.matches('[data-action="help"]'))   { e.preventDefault(); showHelp(); }
        else if (t.matches('[data-action="stats"]'))  { e.preventDefault(); loadServiceStats(); }
        else if (t.matches('#exportBtn'))             { e.preventDefault(); exportResults(); }
        else if (t.matches('#refreshBtn'))            { e.preventDefault(); batchMode ? performBatchLookup() : performDNSLookup(); }
        else if (t.matches('#clearBtn'))              { e.preventDefault(); clearResults(); }
        else if (t.matches('#batchLookupBtn'))        { e.preventDefault(); performBatchLookup(); }
        else if (t.matches('.modal-close'))           { e.preventDefault(); closeModal(); }
        else if (t.matches('#modalOverlay') && t === e.target) { closeModal(); }
        else if (t.matches('.record-item') || t.closest('.record-item')) {
            const item = t.matches('.record-item') ? t : t.closest('.record-item');
            const val = item.querySelector('.record-value');
            if (val) copyToClipboard(val.textContent);
        }
    };

    window.eventsBound = true;
}

function initializeApp() {
    bindEventHandlers();
    setTimeout(() => { loadDNSServers(); loadDNSTypes(); checkServiceHealth(); }, 100);
}

document.addEventListener('DOMContentLoaded', initializeApp);
if (document.readyState !== 'loading') setTimeout(initializeApp, 50);
window.addEventListener('load', () => { if (!window.eventsBound) bindEventHandlers(); });

// ─── DNS Lookup ───────────────────────────────────────────────────────────────

async function performDNSLookup() {
    const domainInput = document.getElementById('domainInput');
    if (!domainInput) return;
    const domain = domainInput.value.trim();
    if (!domain) { showNotification('请输入域名', 'warning'); domainInput.focus(); return; }

    const serverSelect  = document.getElementById('dnsServerSelect');
    const typeSelect    = document.getElementById('dnsTypeSelect');
    const timeoutInput  = document.getElementById('timeoutInput');
    const customDnsInput = document.getElementById('customDnsInput');

    const dnsServer = customDnsInput && customDnsInput.value.trim()
        ? customDnsInput.value.trim()
        : (serverSelect ? serverSelect.value : '');
    const selectedTypes = typeSelect ? Array.from(typeSelect.selectedOptions).map(o => o.value) : [];
    const timeout = timeoutInput ? parseInt(timeoutInput.value) || 5 : 5;

    showLoading(true); hideResults();

    try {
        const resp = await fetch(`${API_BASE_URL}/dns/lookup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ domain, dns_server: dnsServer, types: selectedTypes.length ? selectedTypes : undefined, timeout })
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        const data = await resp.json();
        if (data.status === 'success') {
            currentResults = [data];
            displayResults(currentResults);
            showNotification('✅ DNS查询完成', 'success');
        } else {
            throw new Error(data.message || 'DNS查询失败');
        }
    } catch (err) {
        showError('DNS查询失败: ' + err.message);
        showNotification('DNS查询失败: ' + err.message, 'error');
    } finally {
        showLoading(false);
    }
}

async function performBatchLookup() {
    const batchDomains = document.getElementById('batchDomains');
    if (!batchDomains) return;
    const domains = batchDomains.value.split('\n').map(d => d.trim()).filter(d => d.length);
    if (!domains.length) { showNotification('请输入至少一个域名', 'warning'); return; }
    if (domains.length > 20) { showNotification('最多只能同时查询20个域名', 'warning'); return; }

    const serverSelect   = document.getElementById('dnsServerSelect');
    const typeSelect     = document.getElementById('dnsTypeSelect');
    const timeoutInput   = document.getElementById('timeoutInput');
    const customDnsInput = document.getElementById('customDnsInput');

    const dnsServer = customDnsInput && customDnsInput.value.trim()
        ? customDnsInput.value.trim()
        : (serverSelect ? serverSelect.value : '');
    const selectedTypes = typeSelect ? Array.from(typeSelect.selectedOptions).map(o => o.value) : [];
    const timeout = timeoutInput ? parseInt(timeoutInput.value) || 5 : 5;

    showLoading(true); hideResults();

    try {
        const resp = await fetch(`${API_BASE_URL}/dns/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ domains, dns_server: dnsServer, types: selectedTypes.length ? selectedTypes : undefined, timeout })
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        const data = await resp.json();
        if (data.status === 'success') {
            currentResults = data.results;
            displayResults(currentResults);
            showNotification(`✅ 批量查询完成，共查询 ${domains.length} 个域名`, 'success');
        } else {
            throw new Error(data.message || '批量查询失败');
        }
    } catch (err) {
        showError('批量查询失败: ' + err.message);
        showNotification('批量查询失败: ' + err.message, 'error');
    } finally {
        showLoading(false);
    }
}

async function performDNSComparison() {
    const domainInput = document.getElementById('domainInput');
    if (!domainInput) return;
    const domain = domainInput.value.trim();
    if (!domain) { showNotification('请输入域名进行比较', 'warning'); return; }

    showLoading(true); hideResults();

    try {
        const resp = await fetch(`${API_BASE_URL}/dns/compare`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ domain, dns_servers: ['google','cloudflare','quad9','aliyun'], types: ['A','AAAA'], timeout: 10 })
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        const data = await resp.json();
        if (data.status === 'success') {
            displayComparisonResults(data);
            showNotification('✅ DNS服务器比较完成', 'success');
        } else {
            throw new Error(data.message || 'DNS服务器比较失败');
        }
    } catch (err) {
        showError('DNS服务器比较失败: ' + err.message);
        showNotification('DNS服务器比较失败: ' + err.message, 'error');
    } finally {
        showLoading(false);
    }
}

// ─── Display ──────────────────────────────────────────────────────────────────

function displayResults(results) {
    const section  = document.getElementById('resultsSection');
    const content  = document.getElementById('resultsContent');
    if (!section || !content) return;
    content.innerHTML = '';
    results.forEach((result, i) => {
        const div = document.createElement('div');
        div.className = 'domain-result';
        div.style.animationDelay = `${i * 0.1}s`;
        div.innerHTML = result.status === 'error' ? createErrorResult(result) : createSuccessResult(result);
        content.appendChild(div);
    });
    section.classList.remove('hidden');
    setTimeout(() => section.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
}

function createErrorResult(result) {
    return `
        <div class="domain-header">
            <h3 class="domain-name">${escapeHtml(result.domain || 'Unknown')}</h3>
            <span class="status error">❌ 错误</span>
            ${result.dns_server ? `<span class="dns-server">DNS: ${escapeHtml(result.dns_server)}</span>` : ''}
        </div>
        <div class="error-message">${escapeHtml(result.message || '未知错误')}</div>`;
}

function createSuccessResult(result) {
    return `
        <div class="domain-header">
            <h3 class="domain-name">${escapeHtml(result.domain)}</h3>
            <span class="status success">✅ 成功</span>
            ${result.dns_server ? `<span class="dns-server">DNS: ${escapeHtml(result.dns_server)}</span>` : ''}
            ${result.cached ? '<span class="cache-indicator">📋 缓存</span>' : ''}
        </div>
        ${createPerformanceHtml(result)}
        ${createStatisticsHtml(result.statistics)}
        <div class="records-grid">${createRecordsHtml(result.grouped_records || {})}</div>`;
}

function createPerformanceHtml(result) {
    if (!result.response_time_ms && !result.query_time) return '';
    const qt = result.query_time ? new Date(result.query_time * 1000).toLocaleString() : '';
    return `<div class="performance-info">
        ${result.response_time_ms ? `<span class="perf-item">⚡ 响应时间: ${result.response_time_ms.toFixed(2)}ms</span>` : ''}
        ${qt ? `<span class="perf-item">🕒 查询时间: ${qt}</span>` : ''}
    </div>`;
}

function createRecordsHtml(grouped) {
    if (!grouped || !Object.keys(grouped).length) return '<div class="no-records">暂无DNS记录</div>';
    const order = ['A','AAAA','CNAME','MX','TXT','NS','SOA','PTR','SRV','CAA'];
    const labels = { A:'IPv4地址', AAAA:'IPv6地址', CNAME:'别名记录', MX:'邮件服务器',
                     TXT:'文本记录', NS:'域名服务器', SOA:'授权记录', PTR:'反向解析',
                     SRV:'服务记录', CAA:'证书授权' };
    return order.filter(t => grouped[t] && grouped[t].length).map(t => `
        <div class="record-type-group">
            <div class="record-type-title">${labels[t] || t}<span class="record-count">${grouped[t].length}</span></div>
            ${grouped[t].map(r => `
                <div class="record-item" title="点击复制">
                    <div class="record-value">${escapeHtml(r.value || '')}</div>
                    ${r.ttl ? `<div class="record-ttl">TTL: ${r.ttl}s</div>` : ''}
                </div>`).join('')}
        </div>`).join('');
}

function createStatisticsHtml(stats) {
    if (!stats) return '';
    return `<div class="statistics">
        <h4>📊 统计信息</h4>
        <div class="stats-grid">
            <div class="stat-item"><div class="stat-value">${stats.total_records || 0}</div><div class="stat-label">总记录数</div></div>
            <div class="stat-item"><div class="stat-value">${stats.record_types ? stats.record_types.length : 0}</div><div class="stat-label">记录类型</div></div>
            ${stats.avg_ttl ? `<div class="stat-item"><div class="stat-value">${Math.round(stats.avg_ttl)}</div><div class="stat-label">平均TTL(秒)</div></div>` : ''}
            ${stats.min_ttl !== undefined ? `<div class="stat-item"><div class="stat-value">${stats.min_ttl}</div><div class="stat-label">最小TTL(秒)</div></div>` : ''}
            ${stats.max_ttl !== undefined ? `<div class="stat-item"><div class="stat-value">${stats.max_ttl}</div><div class="stat-label">最大TTL(秒)</div></div>` : ''}
        </div>
    </div>`;
}

function displayComparisonResults(data) {
    const section = document.getElementById('resultsSection');
    const content = document.getElementById('resultsContent');
    if (!section || !content) return;
    content.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'comparison-title';
    title.innerHTML = `<h3>🔍 DNS服务器比较结果 - ${data.domain}</h3>
        <p>比较时间: ${new Date(data.comparison_time * 1000).toLocaleString()}</p>`;
    content.appendChild(title);

    if (data.analysis) {
        const a = document.createElement('div');
        a.className = 'comparison-analysis';
        a.innerHTML = createAnalysisHtml(data.analysis);
        content.appendChild(a);
    }

    data.results.forEach((result, i) => {
        const div = document.createElement('div');
        div.className = 'server-result domain-result';
        div.style.animationDelay = `${i * 0.1}s`;
        div.innerHTML = result.status === 'error' ? createErrorResult(result) : createSuccessResult(result);
        content.appendChild(div);
    });

    section.classList.remove('hidden');
    setTimeout(() => section.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
}

function createAnalysisHtml(analysis) {
    let table = '';
    if (analysis.performance_summary && analysis.performance_summary.length) {
        const sorted = [...analysis.performance_summary].sort((a, b) => a.response_time_ms - b.response_time_ms);
        table = `<table class="performance-table"><thead><tr>
            <th>DNS服务器</th><th>响应时间 (ms)</th><th>记录数量</th><th>性能评级</th>
        </tr></thead><tbody>
        ${sorted.map((item, i) => `<tr>
            <td>${item.server}</td>
            <td>${item.response_time_ms.toFixed(2)}</td>
            <td>${item.record_count}</td>
            <td>${['🥇','🥈','🥉'][i] || '📊'}</td>
        </tr>`).join('')}
        </tbody></table>`;
    }
    return `<div class="analysis-summary">
        <h4>📊 性能分析</h4>
        <div class="performance-stats">
            <div class="stat-row"><span class="stat-name">最快服务器:</span><span class="stat-data">${analysis.fastest_server || '未知'}</span></div>
            <div class="stat-row"><span class="stat-name">最慢服务器:</span><span class="stat-data">${analysis.slowest_server || '未知'}</span></div>
            <div class="stat-row"><span class="stat-name">记录最多:</span><span class="stat-data">${analysis.most_records || '未知'}</span></div>
        </div>${table}
    </div>`;
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function quickLookup(domain) {
    const input = document.getElementById('domainInput');
    if (input) { input.value = domain; performDNSLookup(); }
}

function toggleBatchMode() {
    batchMode = !batchMode;
    const area   = document.getElementById('batchInputArea');
    const toggle = document.getElementById('batchToggle');
    if (area && toggle) {
        area.classList.toggle('hidden', !batchMode);
        toggle.textContent = batchMode ? '📊 单个查询' : '📊 批量查询';
    }
}

function toggleAdvancedOptions() {
    const panel  = document.getElementById('advancedOptions');
    const toggle = document.getElementById('advancedToggle');
    if (panel && toggle) {
        const hidden = panel.classList.toggle('hidden');
        toggle.textContent = hidden ? '⚙️ 显示高级选项' : '⚙️ 隐藏高级选项';
    }
}

function showLoading(show) {
    const el = document.getElementById('loadingIndicator');
    if (el) el.classList.toggle('hidden', !show);
}

function hideResults() {
    const el = document.getElementById('resultsSection');
    if (el) el.classList.add('hidden');
}

function clearResults() {
    currentResults = null;
    hideResults();
    showNotification('✅ 结果已清空', 'success');
}

function showError(message) {
    const section = document.getElementById('resultsSection');
    const content = document.getElementById('resultsContent');
    if (!section || !content) return;
    content.innerHTML = `<div class="domain-result"><div class="error-message"><strong>❌ 错误：</strong> ${escapeHtml(message)}</div></div>`;
    section.classList.remove('hidden');
}

function showNotification(message, type = 'info') {
    document.querySelectorAll('.notification').forEach(n => n.remove());
    const icons = { success: '✅', warning: '⚠️', error: '❌', info: 'ℹ️' };
    const n = document.createElement('div');
    n.className = `notification ${type}`;
    n.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${escapeHtml(message)}</span>`;
    document.body.appendChild(n);
    setTimeout(() => n.classList.add('show'), 100);
    setTimeout(() => { n.classList.remove('show'); setTimeout(() => n.remove(), 300); }, 5000);
}

// 前端轻量校验自定义 DNS
// 支持: https://url  |  hostname/path (DoH)  |  IP  |  IP:Port  |  hostname:Port
function validateCustomDns(val) {
    if (!val) return true;
    const presets = ['google','cloudflare','quad9','opendns','aliyun','baidu','tencent','114','system'];
    if (presets.includes(val.toLowerCase())) return true;

    // DoH: https:// 或 http://
    if (val.startsWith('https://') || val.startsWith('http://')) return true;

    // 带路径视为 DoH (hostname/path)
    if (val.includes('/') && !val.startsWith('[')) return true;

    // IPv6 with brackets
    if (val.startsWith('[')) return /^\[[\da-fA-F:]+\](:\d+)?$/.test(val);

    const lastColon = val.lastIndexOf(':');
    let host = val;
    if (lastColon !== -1) {
        const maybePort = val.slice(lastColon + 1);
        if (/^\d+$/.test(maybePort) && +maybePort >= 1 && +maybePort <= 65535) {
            host = val.slice(0, lastColon);
        }
    }
    // IPv4
    const ipv4 = host.split('.');
    if (ipv4.length === 4 && ipv4.every(p => /^\d+$/.test(p) && +p <= 255)) return true;
    // hostname
    return /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$/.test(host);
}

function escapeHtml(text) {
    if (typeof text !== 'string') return text;
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
}

async function copyToClipboard(text) {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
        } else {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        }
        showNotification('✅ 已复制: ' + text, 'success');
    } catch (err) {
        showNotification('❌ 复制失败', 'error');
    }
}

function exportResults() {
    if (!currentResults) { showNotification('没有可导出的结果', 'warning'); return; }
    const blob = new Blob([JSON.stringify({ timestamp: new Date().toISOString(), results: currentResults }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dns-results-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    showNotification('✅ 结果已导出', 'success');
}

function showModal(title, content) {
    const overlay = document.getElementById('modalOverlay');
    const titleEl = document.getElementById('modalTitle');
    const body    = document.getElementById('modalBody');
    if (overlay && titleEl && body) {
        titleEl.textContent = title;
        body.innerHTML = content;
        overlay.classList.remove('hidden');
        setTimeout(() => overlay.classList.add('show'), 10);
    }
}

function closeModal() {
    const overlay = document.getElementById('modalOverlay');
    if (overlay) { overlay.classList.remove('show'); setTimeout(() => overlay.classList.add('hidden'), 300); }
}

function showAbout() {
    showModal('关于DNS查询工具', `<div class="about-content">
        <h4>🌐 DNS查询工具</h4>
        <p><strong>版本:</strong> 1.0.0</p>
        <p><strong>架构:</strong> Node.js + Python + Golang</p>
        <p><strong>功能特性:</strong></p>
        <ul>
            <li>✅ 支持多种DNS服务商</li>
            <li>✅ 完整的DNS记录类型查询</li>
            <li>✅ 批量域名查询</li>
            <li>✅ DNS服务器性能比较</li>
            <li>✅ 智能缓存机制</li>
            <li>✅ 结果导出功能</li>
        </ul>
        <p><strong>技术栈:</strong> Node.js + Express / Python + Flask / Go + Gin / Docker</p>
    </div>`);
}

function showHelp() {
    showModal('使用帮助', `<div class="help-content">
        <h5>🔍 基本查询</h5>
        <p>在域名输入框中输入域名，点击"查询"或按回车键。</p>
        <h5>⚙️ 高级选项</h5>
        <p>选择 DNS 服务器、记录类型、超时时间，或输入自定义 DNS 服务器地址。</p>
        <h5>📊 批量查询</h5>
        <p>点击"批量查询"，每行输入一个域名，最多支持 20 个。</p>
        <h5>🔄 DNS 比较</h5>
        <p>输入域名后点击"DNS 比较"，对比 Google / Cloudflare / Quad9 / 阿里云的解析结果与响应速度。</p>
        <h5>📋 复制 & 导出</h5>
        <p>点击任意记录值复制，点击"导出"保存为 JSON 文件。</p>
        <h5>⌨️ 快捷键</h5>
        <p>Ctrl+Enter: 执行查询 &nbsp;|&nbsp; Ctrl+K: 聚焦输入框 &nbsp;|&nbsp; Esc: 关闭弹窗</p>
    </div>`);
}

async function loadServiceStats() {
    try {
        const r = await fetch(`${API_BASE_URL}/stats`);
        const d = await r.json();
        if (d.status === 'success') {
            const s = d.data;
            showModal('服务统计', `<div class="stats-content">
                <h4>📊 服务统计</h4>
                ${Object.entries({
                    '总查询次数': s.total_queries,
                    '成功查询':   s.successful_queries,
                    '失败查询':   s.failed_queries,
                    '缓存命中率': s.cache_hit_rate + '%',
                    '缓存大小':   s.cache_size,
                    '运行时间':   s.uptime_hours + ' 小时',
                    '每小时查询': s.queries_per_hour,
                }).map(([k, v]) => `<div class="stat-row" style="margin-bottom:0.4rem">
                    <span class="stat-name">${k}:</span>
                    <span class="stat-data" style="margin-left:0.5rem">${v}</span>
                </div>`).join('')}
            </div>`);
        }
    } catch (err) {
        showNotification('无法加载服务统计: ' + err.message, 'error');
    }
}

async function loadDNSServers() {
    try {
        const r = await fetch(`${API_BASE_URL}/dns/servers`);
        const d = await r.json();
        if (d.status === 'success') {
            availableDNSServers = d.servers;
            const select = document.getElementById('dnsServerSelect');
            if (select) {
                select.innerHTML = '<option value="">默认 (Google DNS)</option>';
                const names = { google:'Google DNS (8.8.8.8)', cloudflare:'Cloudflare DNS (1.1.1.1)',
                    quad9:'Quad9 DNS (9.9.9.9)', opendns:'OpenDNS (208.67.222.222)',
                    aliyun:'阿里云DNS (223.5.5.5)', baidu:'百度DNS (180.76.76.76)',
                    tencent:'腾讯DNS (119.29.29.29)', '114':'114DNS (114.114.114.114)', system:'系统默认DNS' };
                Object.keys(d.servers).forEach(k => {
                    const opt = document.createElement('option');
                    opt.value = k; opt.textContent = names[k] || k;
                    select.appendChild(opt);
                });
            }
        }
    } catch (err) {
        console.error('加载DNS服务器列表失败:', err);
    }
}

async function loadDNSTypes() {
    try {
        const r = await fetch(`${API_BASE_URL}/dns/types`);
        const d = await r.json();
        if (d.status === 'success') {
            availableDNSTypes = d.types;
        }
    } catch {
        availableDNSTypes = ['A','AAAA','CNAME','MX','TXT','NS','SOA','PTR','SRV','CAA'];
    }
    const select = document.getElementById('dnsTypeSelect');
    if (select) {
        select.innerHTML = '';
        const descs = { A:'A - IPv4地址', AAAA:'AAAA - IPv6地址', CNAME:'CNAME - 别名记录',
            MX:'MX - 邮件服务器', TXT:'TXT - 文本记录', NS:'NS - 域名服务器',
            SOA:'SOA - 授权记录', PTR:'PTR - 反向解析', SRV:'SRV - 服务记录', CAA:'CAA - 证书授权' };
        availableDNSTypes.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t; opt.textContent = descs[t] || t;
            opt.selected = ['A','AAAA','CNAME','MX','TXT','NS'].includes(t);
            select.appendChild(opt);
        });
    }
}

async function checkServiceHealth() {
    try {
        const r = await fetch('/health/detailed');
        const d = await r.json();
        if (d.status !== 'healthy') showNotification('服务状态异常，某些功能可能不可用', 'warning');
    } catch { /* ignore */ }
}

document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); batchMode ? performBatchLookup() : performDNSLookup(); }
    if (e.key === 'Escape') closeModal();
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        const input = document.getElementById('domainInput');
        if (input) { input.focus(); input.select(); }
    }
});
