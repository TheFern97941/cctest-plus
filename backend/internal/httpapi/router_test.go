package httpapi

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"cctest-plus/backend/internal/config"
	"cctest-plus/backend/internal/store"
	"cctest-plus/backend/internal/tasks"

	"github.com/gin-gonic/gin"
)

func TestRouterAPIAndStatic(t *testing.T) {
	gin.SetMode(gin.TestMode)

	tempDir := t.TempDir()
	distDir := filepath.Join(tempDir, "dist")
	if err := os.MkdirAll(filepath.Join(distDir, "assets"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(distDir, "index.html"), []byte("<html>ok</html>"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(distDir, "favicon.ico"), []byte("ico"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(distDir, "logo-mark.png"), []byte("png"), 0644); err != nil {
		t.Fatal(err)
	}

	db, err := store.Open(filepath.Join(tempDir, "app.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	cfg := config.Config{
		AppPort:        "8080",
		CCTestAPIKey:   "cct-test",
		CCTestBaseURL:  "https://cctest.ai",
		DatabasePath:   filepath.Join(tempDir, "app.sqlite"),
		PollInterval:   3 * time.Second,
		TaskTimeout:    30 * time.Minute,
		FrontendDist:   distDir,
		DevCORSOrigin:  "http://localhost:5173",
		RequestTimeout: 30 * time.Second,
	}

	engine := New(cfg, db, tasks.NewService(cfg, db))

	assertStatus(t, engine, http.MethodGet, "/api/health", http.StatusOK)
	assertStatus(t, engine, http.MethodGet, "/api/models", http.StatusOK)
	assertStatus(t, engine, http.MethodGet, "/api/tasks", http.StatusOK)
	assertStatus(t, engine, http.MethodPost, "/api/tasks/999/rerun", http.StatusNotFound)
	assertStatus(t, engine, http.MethodGet, "/", http.StatusOK)
	assertBody(t, engine, http.MethodGet, "/favicon.ico", http.StatusOK, "ico")
	assertBody(t, engine, http.MethodGet, "/logo-mark.png", http.StatusOK, "png")
	assertBody(t, engine, http.MethodGet, "/missing-route", http.StatusOK, "<html>ok</html>")
}

func assertStatus(t *testing.T, engine http.Handler, method, path string, expected int) {
	t.Helper()
	request := httptest.NewRequest(method, path, nil)
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	if recorder.Code != expected {
		t.Fatalf("%s %s: expected %d, got %d with body %s", method, path, expected, recorder.Code, recorder.Body.String())
	}
}

func assertBody(t *testing.T, engine http.Handler, method, path string, expectedStatus int, expectedBody string) {
	t.Helper()
	request := httptest.NewRequest(method, path, nil)
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	if recorder.Code != expectedStatus {
		t.Fatalf("%s %s: expected %d, got %d with body %s", method, path, expectedStatus, recorder.Code, recorder.Body.String())
	}
	if recorder.Body.String() != expectedBody {
		t.Fatalf("%s %s: expected body %q, got %q", method, path, expectedBody, recorder.Body.String())
	}
}
