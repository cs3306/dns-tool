package main

import (
	"log"
	"os"

	"github.com/cs3306/dns-tool/dns-backend/internal/handler"
	"github.com/gin-gonic/gin"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	if os.Getenv("GIN_MODE") == "release" {
		gin.SetMode(gin.ReleaseMode)
	}

	h := handler.New()
	r := gin.Default()

	// CORS
	r.Use(func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	r.GET("/health", h.Health)
	r.GET("/dns/servers", h.GetServers)
	r.GET("/dns/types", h.GetTypes)
	r.POST("/dns/lookup", h.Lookup)
	r.POST("/dns/batch", h.BatchLookup)

	log.Printf("DNS Backend starting on :%s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatal(err)
	}
}
