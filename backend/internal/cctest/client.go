package cctest

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Client struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

type SubmitRequest struct {
	URL             string `json:"url"`
	APIKey          string `json:"apiKey"`
	Model           string `json:"model"`
	CheckTokenUsage bool   `json:"checkTokenUsage"`
}

type SubmitResponse struct {
	TaskID string `json:"taskId"`
}

type ResultResponse struct {
	Raw     map[string]any
	RawJSON string
}

func New(baseURL, apiKey string, timeout time.Duration) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		apiKey:  strings.TrimSpace(apiKey),
		http: &http.Client{
			Timeout: timeout,
		},
	}
}

func (c *Client) Submit(ctx context.Context, request SubmitRequest) (SubmitResponse, string, error) {
	body, err := json.Marshal(request)
	if err != nil {
		return SubmitResponse{}, "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/api/v1/check", bytes.NewReader(body))
	if err != nil {
		return SubmitResponse{}, "", err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")

	raw, status, err := c.do(req)
	if err != nil {
		return SubmitResponse{}, raw, err
	}
	if status < 200 || status >= 300 {
		return SubmitResponse{}, raw, fmt.Errorf("cctest submit returned %d", status)
	}

	var response SubmitResponse
	if err := json.Unmarshal([]byte(raw), &response); err != nil {
		return SubmitResponse{}, raw, fmt.Errorf("decode submit response: %w", err)
	}
	if response.TaskID == "" {
		return SubmitResponse{}, raw, errors.New("cctest submit response missing taskId")
	}
	return response, raw, nil
}

func (c *Client) Result(ctx context.Context, taskID string) (ResultResponse, int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/api/v1/check/"+taskID, nil)
	if err != nil {
		return ResultResponse{}, 0, err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	raw, status, err := c.do(req)
	if err != nil {
		return ResultResponse{RawJSON: raw}, status, err
	}

	var decoded map[string]any
	if raw != "" {
		if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
			return ResultResponse{RawJSON: raw}, status, fmt.Errorf("decode result response: %w", err)
		}
	}
	return ResultResponse{Raw: decoded, RawJSON: raw}, status, nil
}

func (c *Client) do(req *http.Request) (string, int, error) {
	resp, err := c.http.Do(req)
	if err != nil {
		return "", 0, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 4*1024*1024))
	if err != nil {
		return "", resp.StatusCode, err
	}
	return string(body), resp.StatusCode, nil
}
