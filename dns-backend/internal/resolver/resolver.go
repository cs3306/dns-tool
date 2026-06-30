package resolver

import (
	"bytes"
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/cs3306/dns-tool/dns-backend/pkg/models"
	"github.com/miekg/dns"
)

// PresetServers 预设 DNS 服务器
var PresetServers = map[string]string{
	"google":     "8.8.8.8:53",
	"cloudflare": "1.1.1.1:53",
	"quad9":      "9.9.9.9:53",
	"opendns":    "208.67.222.222:53",
	"aliyun":     "223.5.5.5:53",
	"baidu":      "180.76.76.76:53",
	"tencent":    "119.29.29.29:53",
	"114":        "114.114.114.114:53",
	"system":     "",
}

// SupportedTypes 支持的 DNS 记录类型
var SupportedTypes = []string{"A", "AAAA", "CNAME", "MX", "TXT", "NS", "SOA", "PTR", "SRV", "CAA"}

var typeMap = map[string]uint16{
	"A":     dns.TypeA,
	"AAAA":  dns.TypeAAAA,
	"CNAME": dns.TypeCNAME,
	"MX":    dns.TypeMX,
	"TXT":   dns.TypeTXT,
	"NS":    dns.TypeNS,
	"SOA":   dns.TypeSOA,
	"PTR":   dns.TypePTR,
	"SRV":   dns.TypeSRV,
	"CAA":   dns.TypeCAA,
}

// Resolver DNS 解析器
type Resolver struct {
	httpClient *http.Client
}

// New 创建解析器
func New() *Resolver {
	return &Resolver{
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
			Transport: &http.Transport{
				TLSClientConfig:     &tls.Config{InsecureSkipVerify: false},
				MaxIdleConns:        10,
				IdleConnTimeout:     30 * time.Second,
				DisableCompression:  false,
			},
		},
	}
}

// isDoH 判断是否为 DoH 地址
// 支持: https://example.com/dns-query  或  example.com/path  (带斜杠视为DoH)
func isDoH(server string) bool {
	return strings.HasPrefix(server, "https://") ||
		strings.HasPrefix(server, "http://") ||
		(strings.Contains(server, "/") && !strings.HasPrefix(server, "["))
}

// normalizeDoH 规范化 DoH URL，确保有 https:// 前缀
func normalizeDoH(server string) string {
	if strings.HasPrefix(server, "http://") || strings.HasPrefix(server, "https://") {
		return server
	}
	return "https://" + server
}

// resolveServer 把服务器名/IP/hostname 转为 host:port
func resolveServer(server string) string {
	if server == "" {
		return "8.8.8.8:53"
	}
	if addr, ok := PresetServers[strings.ToLower(server)]; ok {
		if addr == "" {
			conf, err := dns.ClientConfigFromFile("/etc/resolv.conf")
			if err == nil && len(conf.Servers) > 0 {
				return net.JoinHostPort(conf.Servers[0], conf.Port)
			}
			return "8.8.8.8:53"
		}
		return addr
	}
	if _, _, err := net.SplitHostPort(server); err == nil {
		return server
	}
	if strings.Contains(server, ":") {
		return "[" + server + "]:53"
	}
	return server + ":53"
}

// Lookup 查询单个域名，自动判断 DoH 或普通 DNS
func (r *Resolver) Lookup(domain, serverName string, types []string, timeoutSec int) models.LookupResponse {
	if timeoutSec <= 0 || timeoutSec > 30 {
		timeoutSec = 5
	}
	if len(types) == 0 {
		types = SupportedTypes
	}

	displayServer := serverName
	if displayServer == "" {
		displayServer = "google"
	}

	var allRecords []models.DNSRecord
	start := time.Now()

	if isDoH(serverName) {
		allRecords = r.lookupDoH(domain, serverName, types, timeoutSec)
	} else {
		allRecords = r.lookupUDP(domain, serverName, types, timeoutSec)
	}

	elapsed := float64(time.Since(start).Milliseconds())

	return models.LookupResponse{
		Status:         "success",
		Domain:         domain,
		DNSServer:      displayServer,
		Records:        allRecords,
		ResponseTimeMs: elapsed,
		QueryTime:      float64(time.Now().Unix()),
	}
}

// lookupUDP 走标准 UDP/TCP DNS
func (r *Resolver) lookupUDP(domain, serverName string, types []string, timeoutSec int) []models.DNSRecord {
	server := resolveServer(serverName)
	client := &dns.Client{
		Timeout: time.Duration(timeoutSec) * time.Second,
	}
	fqdn := dns.Fqdn(domain)

	var records []models.DNSRecord
	for _, t := range types {
		qtype, ok := typeMap[strings.ToUpper(t)]
		if !ok {
			continue
		}
		msg := new(dns.Msg)
		msg.SetQuestion(fqdn, qtype)
		msg.RecursionDesired = true

		resp, _, err := client.Exchange(msg, server)
		if err != nil {
			continue
		}
		for _, ans := range resp.Answer {
			if rec := parseRecord(ans); rec != nil {
				records = append(records, *rec)
			}
		}
	}
	return records
}

// lookupDoH 走 DoH (RFC 8484, application/dns-message)
func (r *Resolver) lookupDoH(domain, serverName string, types []string, timeoutSec int) []models.DNSRecord {
	dohURL := normalizeDoH(serverName)
	fqdn := dns.Fqdn(domain)

	httpClient := &http.Client{
		Timeout: time.Duration(timeoutSec) * time.Second,
		Transport: &http.Transport{
			TLSClientConfig:    &tls.Config{InsecureSkipVerify: false},
			MaxIdleConns:       10,
			IdleConnTimeout:    30 * time.Second,
		},
	}

	var records []models.DNSRecord
	for _, t := range types {
		qtype, ok := typeMap[strings.ToUpper(t)]
		if !ok {
			continue
		}

		msg := new(dns.Msg)
		msg.SetQuestion(fqdn, qtype)
		msg.RecursionDesired = true
		msg.Id = 0 // DoH 要求 ID=0

		wire, err := msg.Pack()
		if err != nil {
			continue
		}

		req, err := http.NewRequest(http.MethodPost, dohURL, bytes.NewReader(wire))
		if err != nil {
			continue
		}
		req.Header.Set("Content-Type", "application/dns-message")
		req.Header.Set("Accept", "application/dns-message")

		resp, err := httpClient.Do(req)
		if err != nil {
			continue
		}

		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil || resp.StatusCode != http.StatusOK {
			continue
		}

		var respMsg dns.Msg
		if err := respMsg.Unpack(body); err != nil {
			continue
		}

		for _, ans := range respMsg.Answer {
			if rec := parseRecord(ans); rec != nil {
				records = append(records, *rec)
			}
		}
	}
	return records
}

// parseRecord 把 dns.RR 转成统一结构
func parseRecord(rr dns.RR) *models.DNSRecord {
	hdr := rr.Header()
	rec := &models.DNSRecord{TTL: hdr.Ttl}

	switch v := rr.(type) {
	case *dns.A:
		rec.Type = "A"
		rec.Value = v.A.String()
	case *dns.AAAA:
		rec.Type = "AAAA"
		rec.Value = v.AAAA.String()
	case *dns.CNAME:
		rec.Type = "CNAME"
		rec.Value = strings.TrimSuffix(v.Target, ".")
	case *dns.MX:
		rec.Type = "MX"
		rec.Value = fmt.Sprintf("%d %s", v.Preference, strings.TrimSuffix(v.Mx, "."))
	case *dns.TXT:
		rec.Type = "TXT"
		rec.Value = strings.Join(v.Txt, " ")
	case *dns.NS:
		rec.Type = "NS"
		rec.Value = strings.TrimSuffix(v.Ns, ".")
	case *dns.SOA:
		rec.Type = "SOA"
		rec.Value = fmt.Sprintf("%s %s %d %d %d %d %d",
			strings.TrimSuffix(v.Ns, "."),
			strings.TrimSuffix(v.Mbox, "."),
			v.Serial, v.Refresh, v.Retry, v.Expire, v.Minttl)
	case *dns.PTR:
		rec.Type = "PTR"
		rec.Value = strings.TrimSuffix(v.Ptr, ".")
	case *dns.SRV:
		rec.Type = "SRV"
		rec.Value = fmt.Sprintf("%d %d %d %s",
			v.Priority, v.Weight, v.Port,
			strings.TrimSuffix(v.Target, "."))
	case *dns.CAA:
		rec.Type = "CAA"
		rec.Value = fmt.Sprintf("%d %s \"%s\"", v.Flag, v.Tag, v.Value)
	default:
		return nil
	}
	return rec
}
