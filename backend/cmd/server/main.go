package main

import (
	"context"
	"log"

	"cctest-plus/backend/internal/config"
	"cctest-plus/backend/internal/httpapi"
	"cctest-plus/backend/internal/store"
	"cctest-plus/backend/internal/tasks"
)

func main() {
	cfg := config.Load()

	db, err := store.Open(cfg.DatabasePath)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	defer db.Close()

	service := tasks.NewService(cfg, db)
	service.ResumeActiveTasks(context.Background())

	engine := httpapi.New(cfg, db, service)
	log.Printf("cctest-plus backend listening on :%s", cfg.AppPort)
	if err := engine.Run(":" + cfg.AppPort); err != nil {
		log.Fatal(err)
	}
}
