package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadArgsPrefersEnvFileOverFlagsAndProcessEnv(t *testing.T) {
	tmpDir := t.TempDir()
	t.Chdir(tmpDir)
	t.Setenv(keyAppPort, "7000")
	t.Setenv(keyDatabasePath, "./env.sqlite")
	t.Setenv(keyPollInterval, "9")

	if err := os.WriteFile(".env", []byte("APP_PORT=9000\nDATABASE_PATH=./dotenv.sqlite\nPOLL_INTERVAL_SECONDS=5\n"), 0o600); err != nil {
		t.Fatalf("write .env: %v", err)
	}

	cfg, err := LoadArgs([]string{"--app-port", "8000", "--database-path", "./flag.sqlite", "--poll-interval-seconds", "7"})
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if cfg.AppPort != "9000" {
		t.Fatalf("expected .env app port, got %q", cfg.AppPort)
	}
	if cfg.DatabasePath != filepath.Join(tmpDir, "dotenv.sqlite") {
		t.Fatalf("expected .env database path, got %q", cfg.DatabasePath)
	}
	if cfg.PollInterval.Seconds() != 5 {
		t.Fatalf("expected .env poll interval, got %s", cfg.PollInterval)
	}
}

func TestLoadArgsPrefersFlagsOverProcessEnvWhenEnvFileMissing(t *testing.T) {
	tmpDir := t.TempDir()
	t.Chdir(tmpDir)
	t.Setenv(keyAppPort, "7000")
	t.Setenv(keyDatabasePath, "./env.sqlite")

	cfg, err := LoadArgs([]string{"--app-port", "8000", "--database-path", "./flag.sqlite"})
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if cfg.AppPort != "8000" {
		t.Fatalf("expected flag app port, got %q", cfg.AppPort)
	}
	if cfg.DatabasePath != filepath.Join(tmpDir, "flag.sqlite") {
		t.Fatalf("expected flag database path, got %q", cfg.DatabasePath)
	}
}

func TestLoadArgsFallsBackToProcessEnvWhenEnvFileAndFlagsMissing(t *testing.T) {
	tmpDir := t.TempDir()
	t.Chdir(tmpDir)
	t.Setenv(keyAppPort, "7000")
	t.Setenv(keyDatabasePath, "./env.sqlite")

	cfg, err := LoadArgs(nil)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if cfg.AppPort != "7000" {
		t.Fatalf("expected process env app port, got %q", cfg.AppPort)
	}
	if cfg.DatabasePath != filepath.Join(tmpDir, "env.sqlite") {
		t.Fatalf("expected process env database path, got %q", cfg.DatabasePath)
	}
}

func TestLoadArgsUsesDefaultsWhenEnvFileIsMissing(t *testing.T) {
	tmpDir := t.TempDir()
	t.Chdir(tmpDir)

	cfg, err := LoadArgs(nil)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if cfg.AppPort != "8080" {
		t.Fatalf("expected default app port, got %q", cfg.AppPort)
	}
	if cfg.DatabasePath != filepath.Join(tmpDir, "data", "cctest-plus.sqlite") {
		t.Fatalf("expected default database path, got %q", cfg.DatabasePath)
	}
}
