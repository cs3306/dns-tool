package handler

import (
	"net/http"
	"sync"
	"time"

	"github.com/cs3306/dns-tool/dns-backend/internal/resolver"
	"github.com/cs3306/dns-tool/dns-backend/pkg/models"
	"github.com/gin-gonic/gin"
)

// Handler HTTP 处理器
type Handler struct {
	resolver *resolver.Resolver
}

// New 创建 Handler
func New() *Handler {
	return &Handler{resolver: resolver.New()}
}

// Health 健康检查
func (h *Handler) Health(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":    "healthy",
		"service":   "dns-backend",
		"timestamp": time.Now().Unix(),
	})
}

// GetServers 返回预设 DNS 服务器列表
func (h *Handler) GetServers(c *gin.Context) {
	c.JSON(http.StatusOK, models.ServersResponse{
		Status:  "success",
		Servers: resolver.PresetServers,
	})
}

// GetTypes 返回支持的记录类型
func (h *Handler) GetTypes(c *gin.Context) {
	c.JSON(http.StatusOK, models.TypesResponse{
		Status: "success",
		Types:  resolver.SupportedTypes,
	})
}

// Lookup 单域名查询
func (h *Handler) Lookup(c *gin.Context) {
	var req models.LookupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"status":  "error",
			"message": "请求参数错误: " + err.Error(),
		})
		return
	}

	result := h.resolver.Lookup(req.Domain, req.DNSServer, req.Types, req.Timeout)
	c.JSON(http.StatusOK, result)
}

// BatchLookup 批量查询
func (h *Handler) BatchLookup(c *gin.Context) {
	var req models.BatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"status":  "error",
			"message": "请求参数错误: " + err.Error(),
		})
		return
	}

	if len(req.Domains) == 0 || len(req.Domains) > 20 {
		c.JSON(http.StatusBadRequest, gin.H{
			"status":  "error",
			"message": "域名列表不能为空且不能超过 20 个",
		})
		return
	}

	results := make([]models.LookupResponse, len(req.Domains))
	var wg sync.WaitGroup

	for i, domain := range req.Domains {
		wg.Add(1)
		go func(idx int, d string) {
			defer wg.Done()
			results[idx] = h.resolver.Lookup(d, req.DNSServer, req.Types, req.Timeout)
		}(i, domain)
	}
	wg.Wait()

	c.JSON(http.StatusOK, models.BatchResponse{
		Status:  "success",
		Results: results,
		Total:   len(results),
	})
}
