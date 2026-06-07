package config

import (
	"flag"
	"io"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	AppPort        string
	CCTestAPIKey   string
	CCTestBaseURL  string
	DatabasePath   string
	PollInterval   time.Duration
	TaskTimeout    time.Duration
	FrontendDist   string
	DevCORSOrigin  string
	RequestTimeout time.Duration
}

const (
	keyAppPort        = "APP_PORT"
	keyCCTestAPIKey   = "CCTEST_API_KEY"
	keyCCTestBaseURL  = "CCTEST_BASE_URL"
	keyDatabasePath   = "DATABASE_PATH"
	keyPollInterval   = "POLL_INTERVAL_SECONDS"
	keyTaskTimeout    = "TASK_TIMEOUT_MINUTES"
	keyFrontendDist   = "FRONTEND_DIST"
	keyDevCORSOrigin  = "DEV_CORS_ORIGIN"
	keyRequestTimeout = "REQUEST_TIMEOUT_SECONDS"
)

type configValue struct {
	value   string
	baseDir string
}

func Load() Config {
	cfg, err := LoadArgs(os.Args[1:])
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	return cfg
}

func LoadArgs(args []string) (Config, error) {
	wd, err := os.Getwd()
	if err != nil {
		wd = "."
	}

	values := processEnvValues(wd)

	flagValues, err := parseFlagValues(args, wd)
	if err != nil {
		return Config{}, err
	}
	mergeValues(values, flagValues)

	fallbackBaseDir := wd
	if envValues, envDir := readEnvFile(); envDir != "" {
		fallbackBaseDir = envDir
		mergeValues(values, envValues)
	}

	return Config{
		AppPort:        stringValue(values, keyAppPort, "8080"),
		CCTestAPIKey:   stringValue(values, keyCCTestAPIKey, ""),
		CCTestBaseURL:  stringValue(values, keyCCTestBaseURL, "https://cctest.ai"),
		DatabasePath:   pathValue(values, keyDatabasePath, "./data/cctest-plus.sqlite", fallbackBaseDir),
		PollInterval:   time.Duration(intValue(values, keyPollInterval, 3)) * time.Second,
		TaskTimeout:    time.Duration(intValue(values, keyTaskTimeout, 30)) * time.Minute,
		FrontendDist:   pathValue(values, keyFrontendDist, "./frontend/dist", fallbackBaseDir),
		DevCORSOrigin:  stringValue(values, keyDevCORSOrigin, "http://localhost:5173"),
		RequestTimeout: time.Duration(intValue(values, keyRequestTimeout, 30)) * time.Second,
	}, nil
}

func readEnvFile() (map[string]configValue, string) {
	candidates := []string{
		".env",
		filepath.Join("..", ".env"),
		filepath.Join("..", "..", ".env"),
	}
	for _, candidate := range candidates {
		envMap, err := godotenv.Read(candidate)
		if err != nil {
			continue
		}
		dir, err := filepath.Abs(filepath.Dir(candidate))
		if err != nil {
			dir = "."
		}
		values := make(map[string]configValue, len(envMap))
		for key, value := range envMap {
			values[key] = configValue{value: value, baseDir: dir}
		}
		return values, dir
	}
	return map[string]configValue{}, ""
}

func processEnvValues(baseDir string) map[string]configValue {
	keys := []string{
		keyAppPort,
		keyCCTestAPIKey,
		keyCCTestBaseURL,
		keyDatabasePath,
		keyPollInterval,
		keyTaskTimeout,
		keyFrontendDist,
		keyDevCORSOrigin,
		keyRequestTimeout,
	}
	values := make(map[string]configValue, len(keys))
	for _, key := range keys {
		if value, ok := os.LookupEnv(key); ok {
			values[key] = configValue{value: value, baseDir: baseDir}
		}
	}
	return values
}

func parseFlagValues(args []string, baseDir string) (map[string]configValue, error) {
	definitions := map[string]string{
		"app-port":                keyAppPort,
		"cctest-api-key":          keyCCTestAPIKey,
		"cctest-base-url":         keyCCTestBaseURL,
		"database-path":           keyDatabasePath,
		"poll-interval-seconds":   keyPollInterval,
		"task-timeout-minutes":    keyTaskTimeout,
		"frontend-dist":           keyFrontendDist,
		"dev-cors-origin":         keyDevCORSOrigin,
		"request-timeout-seconds": keyRequestTimeout,
	}

	fs := flag.NewFlagSet("cctest-plus", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	for name := range definitions {
		fs.String(name, "", "")
	}
	if err := fs.Parse(args); err != nil {
		return nil, err
	}

	values := make(map[string]configValue)
	fs.Visit(func(flag *flag.Flag) {
		key := definitions[flag.Name]
		values[key] = configValue{value: flag.Value.String(), baseDir: baseDir}
	})
	return values, nil
}

func mergeValues(target, source map[string]configValue) {
	for key, value := range source {
		target[key] = value
	}
}

func stringValue(values map[string]configValue, key, fallback string) string {
	if item, ok := values[key]; ok {
		return item.value
	}
	return fallback
}

func intValue(values map[string]configValue, key string, fallback int) int {
	item, ok := values[key]
	if !ok {
		return fallback
	}
	value, err := strconv.Atoi(item.value)
	if err != nil {
		log.Printf("invalid %s=%q, using %d", key, item.value, fallback)
		return fallback
	}
	return value
}

func pathValue(values map[string]configValue, key, fallback, fallbackBaseDir string) string {
	if item, ok := values[key]; ok {
		return resolvePath(item.baseDir, item.value)
	}
	return resolvePath(fallbackBaseDir, fallback)
}

func resolvePath(baseDir, path string) string {
	if path == "" || filepath.IsAbs(path) {
		return path
	}
	return filepath.Join(baseDir, path)
}
