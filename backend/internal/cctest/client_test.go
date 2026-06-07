package cctest

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestSubmitAlwaysSendsCheckTokenUsage(t *testing.T) {
	var body map[string]any
	client := New("https://cctest.example", "cct-test", time.Second)
	client.http.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path != "/api/v1/check" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(`{"taskId":"task-1"}`)),
		}, nil
	})

	if _, _, err := client.Submit(context.Background(), SubmitRequest{
		URL:             "https://relay.example",
		APIKey:          "sk-test",
		Model:           "claude-opus-4-8",
		CheckTokenUsage: false,
	}); err != nil {
		t.Fatalf("submit: %v", err)
	}

	value, ok := body["checkTokenUsage"]
	if !ok {
		t.Fatal("expected checkTokenUsage to be present")
	}
	if value != false {
		t.Fatalf("expected checkTokenUsage false, got %#v", value)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}
