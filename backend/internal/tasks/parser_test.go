package tasks

import (
	"encoding/json"
	"testing"

	"cctest-plus/backend/internal/store"
)

func TestParseCCTestResultDoneWithoutTokenUsageAudit(t *testing.T) {
	rawJSON := `{
		"status": "done",
		"step": 6,
		"stepName": "evaluate",
		"checkTokenUsage": false,
		"progress": 1,
		"scores": {
			"tag_check": 10,
			"structure": 20,
			"behavior": 30,
			"signature_proto": 30,
			"multimodal": 10
		},
		"total": 100,
		"verdictKey": "official",
		"tokenAudit": null,
		"metrics": {
			"latencyMs": 5501,
			"ttfbMs": 5406,
			"tokensPerSec": 2.4,
			"inputTokens": 8838,
			"outputTokens": 13
		}
	}`
	var raw map[string]any
	if err := json.Unmarshal([]byte(rawJSON), &raw); err != nil {
		t.Fatal(err)
	}

	parsed := ParseCCTestResult(raw)
	if !parsed.Final {
		t.Fatal("expected final result")
	}
	if parsed.Status != store.StatusSucceeded {
		t.Fatalf("expected succeeded, got %s", parsed.Status)
	}
	if parsed.Verdict == nil || *parsed.Verdict != "official" {
		t.Fatalf("expected official verdict, got %#v", parsed.Verdict)
	}
	if parsed.Score == nil || *parsed.Score != 100 {
		t.Fatalf("expected score 100, got %#v", parsed.Score)
	}
	if parsed.FailureType != store.FailureNone {
		t.Fatalf("expected no failure, got %s", parsed.FailureType)
	}
}
