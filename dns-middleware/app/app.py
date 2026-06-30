from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import json
import os
import re
import time
from cachetools import TTLCache
import threading

app = Flask(__name__)
CORS(app)

BACKEND_URL = os.getenv('BACKEND_URL', 'http://localhost:8080')
CACHE_SIZE  = int(os.getenv('CACHE_SIZE', '1000'))
CACHE_TTL   = int(os.getenv('CACHE_TTL',  '300'))

dns_cache  = TTLCache(maxsize=CACHE_SIZE, ttl=CACHE_TTL)
cache_lock = threading.Lock()

stats = {
    'total_queries':      0,
    'cache_hits':         0,
    'cache_misses':       0,
    'successful_queries': 0,
    'failed_queries':     0,
    'start_time':         time.time()
}


# ─── Validation helpers ───────────────────────────────────────────────────────

def validate_domain(domain):
    if not domain:
        return False, "域名不能为空"
    domain = re.sub(r'^https?://', '', domain)
    domain = re.sub(r'^www\.', '', domain)
    pattern = r'^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$'
    if not re.match(pattern, domain):
        return False, "无效的域名格式"
    if len(domain) > 253:
        return False, "域名过长"
    return True, domain


def validate_dns_server(dns_server):
    """
    验证并规范化 DNS 服务器地址，支持：
      - 预设名称:       google / cloudflare / ...
      - DoH URL:        https://dns.example.com/dns-query
      - 带路径hostname: dns.example.com/dns-query  (自动补 https://)
      - 纯 IPv4:        1.2.3.4          → 1.2.3.4:53
      - IPv4+端口:      1.2.3.4:5353
      - 纯 hostname:    dns.example.com  → dns.example.com:53
      - hostname+端口:  dns.example.com:5353
      - IPv6:           [2001:db8::1]:53
    """
    if not dns_server:
        return True, dns_server

    presets = ['google','cloudflare','quad9','opendns','aliyun','baidu','tencent','114','system']
    if dns_server.lower() in presets:
        return True, dns_server.lower()

    if len(dns_server) > 512:
        return False, "DNS服务器地址过长"

    # DoH: https:// 或 http:// 开头
    if dns_server.startswith('https://') or dns_server.startswith('http://'):
        return True, dns_server

    # 带路径的 hostname（含 /），视为 DoH，补 https://
    if '/' in dns_server and not dns_server.startswith('['):
        return True, 'https://' + dns_server

    # IPv6 with brackets: [::1] 或 [::1]:53
    if dns_server.startswith('['):
        bracket_end = dns_server.find(']')
        if bracket_end == -1:
            return False, "IPv6地址格式错误，缺少右括号]"
        rest = dns_server[bracket_end+1:]
        if rest and rest.startswith(':'):
            port_str = rest[1:]
            if not port_str.isdigit() or not 1 <= int(port_str) <= 65535:
                return False, "无效的端口号"
        elif rest:
            return False, "IPv6地址格式错误"
        normalized = dns_server if rest else dns_server + ':53'
        return True, normalized

    # 拆最后一个冒号作为端口分隔符
    if ':' in dns_server:
        last_colon = dns_server.rfind(':')
        possible_port = dns_server[last_colon+1:]
        possible_host = dns_server[:last_colon]
        if ':' in possible_host:
            return False, "IPv6地址请使用括号格式，如 [::1]:53"
        if possible_port.isdigit() and 1 <= int(possible_port) <= 65535:
            host = possible_host
        else:
            return False, f"无效的端口号: {possible_port}"
    else:
        host = dns_server
        possible_port = '53'

    # 验证 host 部分
    ipv4_parts = host.split('.')
    if len(ipv4_parts) == 4 and all(p.isdigit() for p in ipv4_parts):
        for p in ipv4_parts:
            if not 0 <= int(p) <= 255:
                return False, "无效的IPv4地址"
    else:
        hostname_pattern = r'^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$'
        if not re.match(hostname_pattern, host):
            return False, f"无效的DNS服务器地址: {host}"

    return True, f"{host}:{possible_port}"


def validate_dns_types(dns_types):
    if not dns_types:
        return True, []
    valid = ['A','AAAA','CNAME','MX','TXT','NS','SOA','PTR','SRV','CAA']
    if isinstance(dns_types, str):
        dns_types = [dns_types]
    invalid = [t for t in dns_types if t.upper() not in valid]
    if invalid:
        return False, f"无效的DNS记录类型: {', '.join(invalid)}"
    return True, [t.upper() for t in dns_types]


def get_cache_key(domain, dns_server, dns_types, timeout):
    types_str = ','.join(sorted(dns_types)) if dns_types else 'default'
    return f"{domain}:{dns_server}:{types_str}:{timeout}"


def update_stats(success=True, cache_hit=False):
    stats['total_queries'] += 1
    if success:
        stats['successful_queries'] += 1
    else:
        stats['failed_queries'] += 1
    if cache_hit:
        stats['cache_hits'] += 1
    else:
        stats['cache_misses'] += 1


# ─── Data processing ──────────────────────────────────────────────────────────

def process_dns_data(dns_data):
    if dns_data.get('status') != 'success':
        return dns_data
    records = dns_data.get('records', [])
    by_type = {}
    for r in records:
        t = r['type']
        by_type.setdefault(t, []).append(r)
    ttls = [r.get('ttl', 0) for r in records if r.get('ttl', 0) > 0]
    dns_data['statistics'] = {
        'total_records':   len(records),
        'record_types':    list(by_type.keys()),
        'records_by_type': {k: len(v) for k, v in by_type.items()},
        'avg_ttl': sum(ttls) / len(ttls) if ttls else 0,
        'min_ttl': min(ttls, default=0),
        'max_ttl': max(ttls, default=0),
    }
    dns_data['grouped_records'] = by_type
    dns_data['processed_time'] = time.time()
    return dns_data


def analyze_dns_comparison(results):
    analysis = {
        'fastest_server': None,
        'slowest_server': None,
        'most_records':   None,
        'consistency_check': {},
        'performance_summary': []
    }
    ok = [r for r in results if r.get('status') == 'success']
    if not ok:
        return analysis
    for r in ok:
        analysis['performance_summary'].append({
            'server':          r.get('server_name', 'unknown'),
            'response_time_ms': r.get('response_time_ms', 0),
            'record_count':    len(r.get('records', []))
        })
    by_speed = sorted(analysis['performance_summary'], key=lambda x: x['response_time_ms'])
    analysis['fastest_server'] = by_speed[0]['server']
    analysis['slowest_server'] = by_speed[-1]['server']
    by_records = sorted(analysis['performance_summary'], key=lambda x: x['record_count'], reverse=True)
    analysis['most_records'] = by_records[0]['server']
    if len(ok) > 1:
        all_rv = set()
        for r in ok:
            for rec in r.get('records', []):
                all_rv.add(f"{rec['type']}:{rec['value']}")
        for rv in all_rv:
            present = []
            for r in ok:
                name = r.get('server_name', 'unknown')
                for rec in r.get('records', []):
                    if f"{rec['type']}:{rec['value']}" == rv:
                        present.append(name)
                        break
            if len(present) != len(ok):
                analysis['consistency_check'][rv] = {
                    'present_in':  present,
                    'missing_from': [r.get('server_name','unknown') for r in ok
                                     if r.get('server_name','unknown') not in present]
                }
    return analysis


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.route('/health')
def health():
    return jsonify({"status": "healthy"}), 200


@app.route('/api/dns/servers')
def get_servers():
    try:
        r = requests.get(f"{BACKEND_URL}/dns/servers", timeout=5)
        return jsonify(r.json()), r.status_code
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/dns/types')
def get_types():
    try:
        r = requests.get(f"{BACKEND_URL}/dns/types", timeout=5)
        return jsonify(r.json()), r.status_code
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/dns/lookup', methods=['POST'])
def dns_lookup():
    try:
        data       = request.get_json()
        domain     = data.get('domain', '').strip()
        dns_server = data.get('dns_server', '')
        dns_types  = data.get('types', [])
        timeout    = data.get('timeout', 5)

        ok, r = validate_domain(domain)
        if not ok:
            update_stats(success=False)
            return jsonify({"status": "error", "message": r}), 400
        clean_domain = r

        ok, r = validate_dns_server(dns_server)
        if not ok:
            update_stats(success=False)
            return jsonify({"status": "error", "message": r}), 400
        clean_server = r

        ok, r = validate_dns_types(dns_types)
        if not ok:
            update_stats(success=False)
            return jsonify({"status": "error", "message": r}), 400
        clean_types = r

        if not isinstance(timeout, int) or timeout < 1 or timeout > 30:
            timeout = 5

        key = get_cache_key(clean_domain, clean_server, clean_types, timeout)
        with cache_lock:
            if key in dns_cache:
                cached = dns_cache[key].copy()
                update_stats(success=True, cache_hit=True)
                cached['cached'] = True
                return jsonify(cached), 200

        resp = requests.post(
            f"{BACKEND_URL}/dns/lookup",
            json={"domain": clean_domain, "dns_server": clean_server,
                  "types": clean_types, "timeout": timeout},
            timeout=timeout + 5
        )
        if resp.status_code != 200:
            update_stats(success=False)
            return jsonify({"status": "error", "message": "后端服务错误"}), 500

        result = process_dns_data(resp.json())
        result['cached'] = False

        if result.get('status') == 'success':
            with cache_lock:
                dns_cache[key] = result.copy()
            update_stats(success=True)
        else:
            update_stats(success=False)

        return jsonify(result), 200

    except requests.RequestException as e:
        update_stats(success=False)
        return jsonify({"status": "error", "message": f"网络请求错误: {e}"}), 500
    except Exception as e:
        update_stats(success=False)
        return jsonify({"status": "error", "message": f"服务器内部错误: {e}"}), 500


@app.route('/api/dns/batch', methods=['POST'])
def batch_lookup():
    try:
        data       = request.get_json()
        domains    = data.get('domains', [])
        dns_server = data.get('dns_server', '')
        dns_types  = data.get('types', [])
        timeout    = data.get('timeout', 5)

        if not domains or len(domains) > 20:
            return jsonify({"status": "error", "message": "域名列表不能为空且不能超过20个"}), 400

        ok, r = validate_dns_server(dns_server)
        if not ok:
            return jsonify({"status": "error", "message": r}), 400
        clean_server = r

        ok, r = validate_dns_types(dns_types)
        if not ok:
            return jsonify({"status": "error", "message": r}), 400
        clean_types = r

        if not isinstance(timeout, int) or timeout < 1 or timeout > 30:
            timeout = 5

        resp = requests.post(
            f"{BACKEND_URL}/dns/batch",
            json={"domains": domains, "dns_server": clean_server,
                  "types": clean_types, "timeout": timeout},
            timeout=timeout * len(domains) + 10
        )
        if resp.status_code != 200:
            return jsonify({"status": "error", "message": "批量查询后端服务错误"}), 500

        batch = resp.json()
        if batch.get('status') == 'success':
            processed = []
            for item in batch.get('results', []):
                p = process_dns_data(item)
                update_stats(success=p.get('status') == 'success')
                processed.append(p)
            batch['results'] = processed

        return jsonify(batch), 200

    except Exception as e:
        return jsonify({"status": "error", "message": f"批量查询错误: {e}"}), 500


@app.route('/api/dns/compare', methods=['POST'])
def compare_servers():
    try:
        data       = request.get_json()
        domain     = data.get('domain', '').strip()
        servers    = data.get('dns_servers', [])
        dns_types  = data.get('types', ['A', 'AAAA'])
        timeout    = data.get('timeout', 5)

        ok, r = validate_domain(domain)
        if not ok:
            return jsonify({"status": "error", "message": r}), 400
        clean_domain = r

        if not servers or len(servers) > 5:
            return jsonify({"status": "error", "message": "DNS服务器列表不能为空且不能超过5个"}), 400

        clean_servers = []
        for s in servers:
            ok, r = validate_dns_server(s)
            if not ok:
                return jsonify({"status": "error", "message": f"无效DNS服务器 {s}: {r}"}), 400
            clean_servers.append(r)

        results = []
        for server in clean_servers:
            try:
                resp = requests.post(
                    f"{BACKEND_URL}/dns/lookup",
                    json={"domain": clean_domain, "dns_server": server,
                          "types": dns_types, "timeout": timeout},
                    timeout=timeout + 5
                )
                if resp.status_code == 200:
                    item = resp.json()
                    item['server_name'] = server
                    results.append(process_dns_data(item))
                else:
                    results.append({"status": "error", "dns_server": server,
                                    "server_name": server, "message": "查询失败"})
            except Exception as e:
                results.append({"status": "error", "dns_server": server,
                                "server_name": server, "message": str(e)})

        return jsonify({
            "status": "success",
            "domain": clean_domain,
            "comparison_time": time.time(),
            "results": results,
            "analysis": analyze_dns_comparison(results)
        }), 200

    except Exception as e:
        return jsonify({"status": "error", "message": f"DNS服务器比较错误: {e}"}), 500


@app.route('/api/stats')
def get_stats():
    uptime_h = (time.time() - stats['start_time']) / 3600
    hit_rate = (stats['cache_hits'] / stats['total_queries'] * 100
                if stats['total_queries'] else 0)
    return jsonify({
        "status": "success",
        "data": {
            "total_queries":      stats['total_queries'],
            "successful_queries": stats['successful_queries'],
            "failed_queries":     stats['failed_queries'],
            "cache_hits":         stats['cache_hits'],
            "cache_misses":       stats['cache_misses'],
            "cache_hit_rate":     round(hit_rate, 2),
            "cache_size":         len(dns_cache),
            "uptime_hours":       round(uptime_h, 2),
            "queries_per_hour":   round(stats['total_queries'] / max(uptime_h, 1), 2)
        }
    }), 200


@app.route('/api/cache/clear', methods=['POST'])
def clear_cache():
    with cache_lock:
        dns_cache.clear()
    return jsonify({"status": "success", "message": "缓存已清空"}), 200


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)
