package httpapi

import (
	"database/sql"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"cctest-plus/backend/internal/config"
	"cctest-plus/backend/internal/store"
	"cctest-plus/backend/internal/tasks"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

type Router struct {
	cfg     config.Config
	store   *store.Store
	service *tasks.Service
}

func New(cfg config.Config, store *store.Store, service *tasks.Service) *gin.Engine {
	router := &Router{
		cfg:     cfg,
		store:   store,
		service: service,
	}

	engine := gin.Default()
	engine.Use(cors.New(cors.Config{
		AllowOrigins:     []string{cfg.DevCORSOrigin},
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept"},
		AllowCredentials: true,
	}))

	api := engine.Group("/api")
	api.GET("/health", router.health)
	api.GET("/models", router.models)
	api.POST("/tasks", router.createTask)
	api.GET("/tasks", router.listTasks)
	api.GET("/tasks/:id", router.getTask)
	api.POST("/tasks/:id/rerun", router.rerunTask)

	router.mountStatic(engine)
	return engine
}

func (r *Router) health(ctx *gin.Context) {
	ctx.JSON(http.StatusOK, gin.H{
		"ok":                 true,
		"cctest_configured":  strings.TrimSpace(r.cfg.CCTestAPIKey) != "",
		"poll_interval_secs": int(r.cfg.PollInterval.Seconds()),
	})
}

func (r *Router) models(ctx *gin.Context) {
	ctx.JSON(http.StatusOK, gin.H{"items": tasks.SupportedModels})
}

func (r *Router) createTask(ctx *gin.Context) {
	var request tasks.CreateTaskRequest
	if err := ctx.ShouldBindJSON(&request); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	task, err := r.service.CreateTask(ctx.Request.Context(), request)
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ctx.JSON(http.StatusCreated, task)
}

func (r *Router) listTasks(ctx *gin.Context) {
	page := parsePositiveInt(ctx.Query("page"), 1)
	pageSize := parsePositiveInt(ctx.Query("page_size"), 20)
	list, err := r.store.ListTasks(ctx.Request.Context(), page, pageSize)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	ctx.JSON(http.StatusOK, list)
}

func (r *Router) getTask(ctx *gin.Context) {
	id, err := strconv.ParseInt(ctx.Param("id"), 10, 64)
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid task id"})
		return
	}
	task, err := r.store.GetTask(ctx.Request.Context(), id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			ctx.JSON(http.StatusNotFound, gin.H{"error": "task not found"})
			return
		}
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	ctx.JSON(http.StatusOK, task)
}

func (r *Router) rerunTask(ctx *gin.Context) {
	id, err := strconv.ParseInt(ctx.Param("id"), 10, 64)
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid task id"})
		return
	}

	var request tasks.RerunTaskRequest
	if ctx.Request.ContentLength != 0 {
		if err := ctx.ShouldBindJSON(&request); err != nil {
			ctx.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
	}

	task, err := r.service.RerunTask(ctx.Request.Context(), id, request)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			ctx.JSON(http.StatusNotFound, gin.H{"error": "task not found"})
			return
		}
		ctx.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ctx.JSON(http.StatusCreated, task)
}

func (r *Router) mountStatic(engine *gin.Engine) {
	indexPath := filepath.Join(r.cfg.FrontendDist, "index.html")
	if _, err := os.Stat(indexPath); err != nil {
		return
	}

	engine.Static("/assets", filepath.Join(r.cfg.FrontendDist, "assets"))
	engine.NoRoute(func(ctx *gin.Context) {
		requestPath := ctx.Request.URL.Path
		if strings.HasPrefix(requestPath, "/api/") {
			ctx.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}

		if staticPath, ok := r.frontendRootFile(requestPath); ok {
			ctx.File(staticPath)
			return
		}

		ctx.File(indexPath)
	})
}

func (r *Router) frontendRootFile(requestPath string) (string, bool) {
	cleanPath := filepath.Clean("/" + strings.TrimPrefix(requestPath, "/"))
	if cleanPath == "/" || strings.Contains(strings.TrimPrefix(cleanPath, "/"), "/") {
		return "", false
	}

	staticPath := filepath.Join(r.cfg.FrontendDist, strings.TrimPrefix(cleanPath, "/"))
	info, err := os.Stat(staticPath)
	if err != nil || info.IsDir() {
		return "", false
	}
	return staticPath, true
}

func parsePositiveInt(raw string, fallback int) int {
	value, err := strconv.Atoi(raw)
	if err != nil || value < 1 {
		return fallback
	}
	return value
}
