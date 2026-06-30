package models

// DNSRecord 单条 DNS 记录
type DNSRecord struct {
	Type  string `json:"type"`
	Value string `json:"value"`
	TTL   uint32 `json:"ttl"`
}

// LookupRequest 单域名查询请求
type LookupRequest struct {
	Domain    string   `json:"domain" binding:"required"`
	DNSServer string   `json:"dns_server"`
	Types     []string `json:"types"`
	Timeout   int      `json:"timeout"`
}

// LookupResponse 单域名查询响应
type LookupResponse struct {
	Status         string      `json:"status"`
	Domain         string      `json:"domain"`
	DNSServer      string      `json:"dns_server,omitempty"`
	Records        []DNSRecord `json:"records"`
	ResponseTimeMs float64     `json:"response_time_ms"`
	QueryTime      float64     `json:"query_time"`
	Message        string      `json:"message,omitempty"`
}

// BatchRequest 批量查询请求
type BatchRequest struct {
	Domains   []string `json:"domains" binding:"required"`
	DNSServer string   `json:"dns_server"`
	Types     []string `json:"types"`
	Timeout   int      `json:"timeout"`
}

// BatchResponse 批量查询响应
type BatchResponse struct {
	Status  string           `json:"status"`
	Results []LookupResponse `json:"results"`
	Total   int              `json:"total"`
	Message string           `json:"message,omitempty"`
}

// ServersResponse DNS 服务器列表响应
type ServersResponse struct {
	Status  string            `json:"status"`
	Servers map[string]string `json:"servers"`
}

// TypesResponse DNS 记录类型响应
type TypesResponse struct {
	Status string   `json:"status"`
	Types  []string `json:"types"`
}
