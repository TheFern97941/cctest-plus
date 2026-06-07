package tasks

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/url"
	"strings"
	"time"

	"cctest-plus/backend/internal/cctest"
	"cctest-plus/backend/internal/config"
	"cctest-plus/backend/internal/store"
	"cctest-plus/backend/internal/util"
)

var SupportedModels = []Model{
	{ID: "claude-opus-4-8", Label: "Claude Opus 4.8"},
	{ID: "claude-opus-4-7", Label: "Claude Opus 4.7"},
	{ID: "claude-opus-4-6", Label: "Claude Opus 4.6"},
	{ID: "claude-sonnet-4-6", Label: "Claude Sonnet 4.6"},
}

type Model struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

type Service struct {
	cfg    config.Config
	store  *store.Store
	client *cctest.Client
}

type CreateTaskRequest struct {
	Remark          string `json:"remark"`
	URL             string `json:"url"`
	APIKey          string `json:"apiKey"`
	Model           string `json:"model"`
	CheckTokenUsage bool   `json:"checkTokenUsage"`
}

type RerunTaskRequest struct {
	CheckTokenUsage *bool `json:"checkTokenUsage"`
}

func NewService(cfg config.Config, store *store.Store) *Service {
	return &Service{
		cfg:    cfg,
		store:  store,
		client: cctest.New(cfg.CCTestBaseURL, cfg.CCTestAPIKey, cfg.RequestTimeout),
	}
}

func (s *Service) CreateTask(ctx context.Context, request CreateTaskRequest) (store.Task, error) {
	if strings.TrimSpace(s.cfg.CCTestAPIKey) == "" {
		return store.Task{}, errors.New("CCTEST_API_KEY is not configured")
	}

	request.Remark = strings.TrimSpace(request.Remark)
	request.URL = strings.TrimSpace(request.URL)
	request.APIKey = strings.TrimSpace(request.APIKey)
	request.Model = strings.TrimSpace(request.Model)

	if request.Remark == "" {
		return store.Task{}, errors.New("remark is required")
	}
	if request.URL == "" {
		return store.Task{}, errors.New("url is required")
	}
	if _, err := url.ParseRequestURI(request.URL); err != nil {
		return store.Task{}, errors.New("url is invalid")
	}
	if request.APIKey == "" {
		return store.Task{}, errors.New("apiKey is required")
	}
	if !isSupportedModel(request.Model) {
		return store.Task{}, fmt.Errorf("unsupported model: %s", request.Model)
	}

	task, err := s.store.CreateTask(ctx, store.CreateTaskInput{
		Remark:             request.Remark,
		URL:                request.URL,
		TargetAPIKey:       request.APIKey,
		TargetAPIKeyMasked: util.MaskKey(request.APIKey),
		Model:              request.Model,
		CheckTokenUsage:    request.CheckTokenUsage,
		TimeoutAt:          time.Now().UTC().Add(s.cfg.TaskTimeout),
	})
	if err != nil {
		return store.Task{}, err
	}

	go s.ProcessTask(context.Background(), task.ID)
	return task, nil
}

func (s *Service) RerunTask(ctx context.Context, id int64, request RerunTaskRequest) (store.Task, error) {
	original, err := s.store.GetTask(ctx, id)
	if err != nil {
		return store.Task{}, err
	}

	checkTokenUsage := original.CheckTokenUsage
	if request.CheckTokenUsage != nil {
		checkTokenUsage = *request.CheckTokenUsage
	}

	return s.CreateTask(ctx, CreateTaskRequest{
		Remark:          original.Remark,
		URL:             original.URL,
		APIKey:          original.TargetAPIKey,
		Model:           original.Model,
		CheckTokenUsage: checkTokenUsage,
	})
}

func (s *Service) ProcessTask(ctx context.Context, id int64) {
	task, err := s.store.GetTask(ctx, id)
	if err != nil {
		log.Printf("load task %d: %v", id, err)
		return
	}
	if store.IsFinalStatus(task.Status) {
		return
	}

	if task.CCTestTaskID == nil || *task.CCTestTaskID == "" {
		task, err = s.submit(ctx, task)
		if err != nil {
			log.Printf("submit task %d: %v", id, err)
			return
		}
	}

	ticker := time.NewTicker(s.cfg.PollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			task, err = s.store.GetTask(ctx, id)
			if err != nil {
				log.Printf("reload task %d: %v", id, err)
				return
			}
			if store.IsFinalStatus(task.Status) {
				return
			}
			if time.Now().UTC().After(task.TimeoutAt) {
				now := time.Now().UTC()
				status := store.StatusTimeout
				failure := store.FailureTimeout
				message := "CCTest task did not finish within 30 minutes"
				completed := &now
				_, _ = s.store.UpdateTask(ctx, id, store.TaskUpdate{
					Status:       &status,
					FailureType:  &failure,
					ErrorMessage: nullableString(message),
					CompletedAt:  &completed,
				})
				return
			}
			if err := s.pollOnce(ctx, task); err != nil {
				log.Printf("poll task %d: %v", id, err)
			}
		}
	}
}

func (s *Service) ResumeActiveTasks(ctx context.Context) {
	tasks, err := s.store.ListActiveTasks(ctx, 1000)
	if err != nil {
		log.Printf("resume active tasks: %v", err)
		return
	}
	for _, task := range tasks {
		go s.ProcessTask(ctx, task.ID)
	}
}

func (s *Service) submit(ctx context.Context, task store.Task) (store.Task, error) {
	now := time.Now().UTC()
	status := store.StatusSubmitted
	submitted := &now
	updated, err := s.store.UpdateTask(ctx, task.ID, store.TaskUpdate{
		Status:      &status,
		SubmittedAt: &submitted,
	})
	if err != nil {
		return store.Task{}, err
	}

	response, raw, err := s.client.Submit(ctx, cctest.SubmitRequest{
		URL:             updated.URL,
		APIKey:          updated.TargetAPIKey,
		Model:           updated.Model,
		CheckTokenUsage: updated.CheckTokenUsage,
	})
	if err != nil {
		now := time.Now().UTC()
		failed := store.StatusFailed
		failure := classifySubmitError(raw, err)
		message := err.Error()
		if raw != "" {
			message = message + ": " + raw
		}
		completed := &now
		rawPtr := emptyToNil(raw)
		_, updateErr := s.store.UpdateTask(ctx, task.ID, store.TaskUpdate{
			Status:        &failed,
			FailureType:   &failure,
			ErrorMessage:  nullableString(message),
			RawResultJSON: &rawPtr,
			CompletedAt:   &completed,
		})
		if updateErr != nil {
			return store.Task{}, updateErr
		}
		return store.Task{}, err
	}

	polling := store.StatusPolling
	taskID := response.TaskID
	taskIDPtr := &taskID
	rawPtr := &raw
	return s.store.UpdateTask(ctx, task.ID, store.TaskUpdate{
		Status:        &polling,
		CCTestTaskID:  &taskIDPtr,
		RawResultJSON: &rawPtr,
	})
}

func (s *Service) pollOnce(ctx context.Context, task store.Task) error {
	if task.CCTestTaskID == nil || *task.CCTestTaskID == "" {
		return errors.New("missing cctest task id")
	}

	result, statusCode, err := s.client.Result(ctx, *task.CCTestTaskID)
	now := time.Now().UTC()
	lastPolled := &now
	rawPtr := &result.RawJSON

	if err != nil {
		status := store.StatusPolling
		failure := store.FailurePollFailed
		message := err.Error()
		if statusCode == httpUnauthorized || statusCode == httpForbidden {
			status = store.StatusFailed
			failure = store.FailureCCTestKeyError
			completed := &now
			_, updateErr := s.store.UpdateTask(ctx, task.ID, store.TaskUpdate{
				Status:        &status,
				FailureType:   &failure,
				ErrorMessage:  nullableString(message),
				RawResultJSON: &rawPtr,
				LastPolledAt:  &lastPolled,
				CompletedAt:   &completed,
			})
			return errors.Join(err, updateErr)
		}
		_, updateErr := s.store.UpdateTask(ctx, task.ID, store.TaskUpdate{
			Status:        &status,
			FailureType:   &failure,
			ErrorMessage:  nullableString(message),
			RawResultJSON: &rawPtr,
			LastPolledAt:  &lastPolled,
		})
		return errors.Join(err, updateErr)
	}

	parsed := ParseCCTestResult(result.Raw)
	status := parsed.Status
	update := store.TaskUpdate{
		Status:        &status,
		Verdict:       &parsed.Verdict,
		Score:         &parsed.Score,
		FailureType:   &parsed.FailureType,
		ErrorMessage:  &parsed.ErrorMessage,
		RawResultJSON: &rawPtr,
		LastPolledAt:  &lastPolled,
	}
	if parsed.Final {
		completed := &now
		update.CompletedAt = &completed
	}
	_, updateErr := s.store.UpdateTask(ctx, task.ID, update)
	return updateErr
}

func isSupportedModel(model string) bool {
	for _, supported := range SupportedModels {
		if supported.ID == model {
			return true
		}
	}
	return false
}

func classifySubmitError(raw string, err error) string {
	text := strings.ToLower(raw + " " + err.Error())
	switch {
	case strings.Contains(text, "quota") || strings.Contains(text, "credit"):
		return store.FailureCCTestQuotaError
	case strings.Contains(text, "authorization") || strings.Contains(text, "bearer") || strings.Contains(text, "unauthorized"):
		return store.FailureCCTestKeyError
	case strings.Contains(text, "api key") || strings.Contains(text, "apikey") || strings.Contains(text, "401") || strings.Contains(text, "403"):
		return store.FailureTargetAPIKeyError
	default:
		return store.FailureSubmitFailed
	}
}

func nullableString(value string) **string {
	ptr := emptyToNil(value)
	return &ptr
}

const (
	httpUnauthorized = 401
	httpForbidden    = 403
)
