package tasks

import (
	"encoding/json"
	"math"
	"strings"

	"cctest-plus/backend/internal/store"
)

type ParsedResult struct {
	Final        bool
	Status       string
	Verdict      *string
	Score        *float64
	FailureType  string
	ErrorMessage *string
	Partial      bool
}

func ParseCCTestResult(raw map[string]any) ParsedResult {
	if raw == nil {
		return ParsedResult{Final: false, Status: store.StatusPolling, FailureType: store.FailureNone}
	}

	status := strings.ToLower(firstString(raw, "status", "state", "taskStatus"))
	message := firstString(raw, "message", "error", "errorMessage", "reason")
	verdict := firstStringPtr(raw, "verdictKey", "verdict", "result", "classification", "type")
	score := firstFloatPtr(raw, "total", "score", "confidence")

	if verdict == nil {
		verdict = findStringRecursive(raw, "classification", "verdict")
	}
	if score == nil {
		score = findFloatRecursive(raw, "score")
	}
	if message == "" {
		if found := findStringRecursive(raw, "message", "errorMessage", "error", "reason"); found != nil {
			message = *found
		}
	}

	failureType := classifyFailure(raw, message)
	hasUsageAudit := containsAnyKey(raw, "usage", "usageAudit", "tokenUsage", "token_audit", "cache")
	tokenUsageRequired := firstBool(raw, "checkTokenUsage")

	if looksFinalSuccess(status, verdict, score) {
		if tokenUsageRequired && !hasUsageAudit {
			return ParsedResult{
				Final:        true,
				Status:       store.StatusPartialFailed,
				Verdict:      verdict,
				Score:        score,
				FailureType:  store.FailureMissingUsageAudit,
				ErrorMessage: stringPtr("Token usage audit is missing from the CCTest response"),
				Partial:      true,
			}
		}
		return ParsedResult{
			Final:       true,
			Status:      store.StatusSucceeded,
			Verdict:     verdict,
			Score:       score,
			FailureType: store.FailureNone,
		}
	}

	if looksFinalFailure(status, raw, message) {
		return ParsedResult{
			Final:        true,
			Status:       store.StatusFailed,
			Verdict:      verdict,
			Score:        score,
			FailureType:  failureType,
			ErrorMessage: emptyToNil(message),
		}
	}

	return ParsedResult{
		Final:        false,
		Status:       store.StatusPolling,
		Verdict:      verdict,
		Score:        score,
		FailureType:  store.FailureNone,
		ErrorMessage: emptyToNil(message),
	}
}

func looksFinalSuccess(status string, verdict *string, score *float64) bool {
	if status == "success" || status == "succeeded" || status == "completed" || status == "done" || status == "finished" {
		return true
	}
	return verdict != nil || score != nil
}

func looksFinalFailure(status string, raw map[string]any, message string) bool {
	if status == "failed" || status == "failure" || status == "error" || status == "cancelled" || status == "canceled" {
		return true
	}
	code := strings.ToLower(firstString(raw, "code", "errorCode", "statusCode"))
	if strings.Contains(code, "error") || strings.HasPrefix(code, "4") || strings.HasPrefix(code, "5") {
		return true
	}
	return containsFailureWords(message)
}

func classifyFailure(raw map[string]any, message string) string {
	text := strings.ToLower(message + " " + mustJSON(raw))
	switch {
	case strings.Contains(text, "quota") || strings.Contains(text, "credit") || strings.Contains(text, "余额") || strings.Contains(text, "次数不足"):
		return store.FailureCCTestQuotaError
	case strings.Contains(text, "authorization") || strings.Contains(text, "bearer") || strings.Contains(text, "cct-") || strings.Contains(text, "unauthorized"):
		return store.FailureCCTestKeyError
	case strings.Contains(text, "api key") || strings.Contains(text, "apikey") || strings.Contains(text, "sk-") || strings.Contains(text, "401") || strings.Contains(text, "403"):
		return store.FailureTargetAPIKeyError
	default:
		return store.FailureUnknown
	}
}

func containsFailureWords(message string) bool {
	text := strings.ToLower(message)
	words := []string{
		"failed",
		"failure",
		"error",
		"invalid",
		"unauthorized",
		"forbidden",
		"quota",
		"credit",
		"timeout",
		"失败",
		"错误",
		"无效",
		"未授权",
		"次数不足",
	}
	for _, word := range words {
		if strings.Contains(text, word) {
			return true
		}
	}
	return false
}

func firstString(raw map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := raw[key]; ok {
			switch typed := value.(type) {
			case string:
				return typed
			case float64:
				if typed == math.Trunc(typed) {
					return strings.TrimSuffix(strings.TrimSuffix(jsonNumber(typed), "0"), ".")
				}
			}
		}
	}
	return ""
}

func firstStringPtr(raw map[string]any, keys ...string) *string {
	value := firstString(raw, keys...)
	return emptyToNil(value)
}

func firstFloatPtr(raw map[string]any, keys ...string) *float64 {
	for _, key := range keys {
		if value, ok := raw[key]; ok {
			switch typed := value.(type) {
			case float64:
				return &typed
			case int:
				value := float64(typed)
				return &value
			}
		}
	}
	return nil
}

func firstBool(raw map[string]any, keys ...string) bool {
	for _, key := range keys {
		if value, ok := raw[key]; ok {
			if typed, ok := value.(bool); ok {
				return typed
			}
		}
	}
	return false
}

func findStringRecursive(value any, keys ...string) *string {
	switch typed := value.(type) {
	case map[string]any:
		for _, wanted := range keys {
			for key, child := range typed {
				if strings.EqualFold(key, wanted) {
					if s, ok := child.(string); ok && s != "" {
						return &s
					}
				}
			}
		}
		for _, child := range typed {
			if found := findStringRecursive(child, keys...); found != nil {
				return found
			}
		}
	case []any:
		for _, child := range typed {
			if found := findStringRecursive(child, keys...); found != nil {
				return found
			}
		}
	}
	return nil
}

func findFloatRecursive(value any, keys ...string) *float64 {
	switch typed := value.(type) {
	case map[string]any:
		for _, wanted := range keys {
			for key, child := range typed {
				if strings.EqualFold(key, wanted) {
					if number, ok := child.(float64); ok {
						return &number
					}
				}
			}
		}
		for _, child := range typed {
			if found := findFloatRecursive(child, keys...); found != nil {
				return found
			}
		}
	case []any:
		for _, child := range typed {
			if found := findFloatRecursive(child, keys...); found != nil {
				return found
			}
		}
	}
	return nil
}

func containsAnyKey(value any, keys ...string) bool {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			for _, wanted := range keys {
				if strings.Contains(strings.ToLower(key), strings.ToLower(wanted)) {
					return true
				}
			}
			if containsAnyKey(child, keys...) {
				return true
			}
		}
	case []any:
		for _, child := range typed {
			if containsAnyKey(child, keys...) {
				return true
			}
		}
	}
	return false
}

func emptyToNil(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func stringPtr(value string) *string {
	return &value
}

func mustJSON(value any) string {
	body, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	return string(body)
}

func jsonNumber(value float64) string {
	body, _ := json.Marshal(value)
	return string(body)
}
