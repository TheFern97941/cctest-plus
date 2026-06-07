package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

const (
	StatusPending       = "pending"
	StatusSubmitted     = "submitted"
	StatusPolling       = "polling"
	StatusSucceeded     = "succeeded"
	StatusPartialFailed = "partial_failed"
	StatusFailed        = "failed"
	StatusTimeout       = "timeout"

	FailureNone              = "none"
	FailureCCTestKeyError    = "cctest_key_error"
	FailureTargetAPIKeyError = "target_api_key_error"
	FailureCCTestQuotaError  = "cctest_quota_error"
	FailureSubmitFailed      = "submit_failed"
	FailurePollFailed        = "poll_failed"
	FailureTimeout           = "timeout"
	FailureMissingUsageAudit = "missing_usage_audit"
	FailureMalformedResult   = "malformed_result"
	FailureUnknown           = "unknown"
)

type Store struct {
	db *sql.DB
}

type Task struct {
	ID                 int64      `json:"id"`
	Remark             string     `json:"remark"`
	URL                string     `json:"url"`
	TargetAPIKey       string     `json:"-"`
	TargetAPIKeyMasked string     `json:"target_api_key_masked"`
	Model              string     `json:"model"`
	CheckTokenUsage    bool       `json:"check_token_usage"`
	CCTestTaskID       *string    `json:"cctest_task_id"`
	Status             string     `json:"status"`
	Verdict            *string    `json:"verdict"`
	Score              *float64   `json:"score"`
	FailureType        string     `json:"failure_type"`
	ErrorMessage       *string    `json:"error_message"`
	RawResultJSON      *string    `json:"raw_result_json"`
	CreatedAt          time.Time  `json:"created_at"`
	SubmittedAt        *time.Time `json:"submitted_at"`
	LastPolledAt       *time.Time `json:"last_polled_at"`
	CompletedAt        *time.Time `json:"completed_at"`
	TimeoutAt          time.Time  `json:"timeout_at"`
}

type CreateTaskInput struct {
	Remark             string
	URL                string
	TargetAPIKey       string
	TargetAPIKeyMasked string
	Model              string
	CheckTokenUsage    bool
	TimeoutAt          time.Time
}

type TaskUpdate struct {
	Status        *string
	CCTestTaskID  **string
	Verdict       **string
	Score         **float64
	FailureType   *string
	ErrorMessage  **string
	RawResultJSON **string
	SubmittedAt   **time.Time
	LastPolledAt  **time.Time
	CompletedAt   **time.Time
}

type TaskList struct {
	Items    []Task `json:"items"`
	Total    int64  `json:"total"`
	Page     int    `json:"page"`
	PageSize int    `json:"page_size"`
}

func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return nil, fmt.Errorf("create data dir: %w", err)
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	db.SetMaxOpenConns(1)
	store := &Store{db: db}
	if err := store.migrate(context.Background()); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) migrate(ctx context.Context) error {
	statements := []string{
		`PRAGMA journal_mode = WAL`,
		`PRAGMA foreign_keys = ON`,
		`CREATE TABLE IF NOT EXISTS tasks (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			remark TEXT NOT NULL,
			url TEXT NOT NULL,
			target_api_key TEXT NOT NULL,
			target_api_key_masked TEXT NOT NULL,
			model TEXT NOT NULL,
			check_token_usage INTEGER NOT NULL DEFAULT 0,
			cctest_task_id TEXT,
			status TEXT NOT NULL,
			verdict TEXT,
			score REAL,
			failure_type TEXT NOT NULL DEFAULT 'none',
			error_message TEXT,
			raw_result_json TEXT,
			created_at TEXT NOT NULL,
			submitted_at TEXT,
			last_polled_at TEXT,
			completed_at TEXT,
			timeout_at TEXT NOT NULL
		)`,
		`ALTER TABLE tasks ADD COLUMN check_token_usage INTEGER NOT NULL DEFAULT 0`,
		`CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at DESC, id DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`,
		`CREATE INDEX IF NOT EXISTS idx_tasks_cctest_task_id ON tasks(cctest_task_id)`,
	}
	for _, statement := range statements {
		if _, err := s.db.ExecContext(ctx, statement); err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "duplicate column") {
				continue
			}
			return fmt.Errorf("migrate: %w", err)
		}
	}
	return nil
}

func (s *Store) CreateTask(ctx context.Context, input CreateTaskInput) (Task, error) {
	now := time.Now().UTC()
	result, err := s.db.ExecContext(ctx, `INSERT INTO tasks (
		remark, url, target_api_key, target_api_key_masked, model, check_token_usage, status, failure_type, created_at, timeout_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		input.Remark,
		input.URL,
		input.TargetAPIKey,
		input.TargetAPIKeyMasked,
		input.Model,
		boolInt(input.CheckTokenUsage),
		StatusPending,
		FailureNone,
		formatTime(now),
		formatTime(input.TimeoutAt),
	)
	if err != nil {
		return Task{}, fmt.Errorf("insert task: %w", err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return Task{}, fmt.Errorf("last insert id: %w", err)
	}
	return s.GetTask(ctx, id)
}

func (s *Store) GetTask(ctx context.Context, id int64) (Task, error) {
	row := s.db.QueryRowContext(ctx, `SELECT
		id, remark, url, target_api_key, target_api_key_masked, model, check_token_usage, cctest_task_id, status,
		verdict, score, failure_type, error_message, raw_result_json, created_at, submitted_at,
		last_polled_at, completed_at, timeout_at
		FROM tasks WHERE id = ?`, id)
	task, err := scanTask(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Task{}, sql.ErrNoRows
		}
		return Task{}, fmt.Errorf("get task: %w", err)
	}
	return task, nil
}

func (s *Store) ListTasks(ctx context.Context, page, pageSize int) (TaskList, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}

	var total int64
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM tasks`).Scan(&total); err != nil {
		return TaskList{}, fmt.Errorf("count tasks: %w", err)
	}

	offset := (page - 1) * pageSize
	rows, err := s.db.QueryContext(ctx, `SELECT
		id, remark, url, target_api_key, target_api_key_masked, model, check_token_usage, cctest_task_id, status,
		verdict, score, failure_type, error_message, raw_result_json, created_at, submitted_at,
		last_polled_at, completed_at, timeout_at
		FROM tasks
		ORDER BY created_at DESC, id DESC
		LIMIT ? OFFSET ?`, pageSize, offset)
	if err != nil {
		return TaskList{}, fmt.Errorf("list tasks: %w", err)
	}
	defer rows.Close()

	items := make([]Task, 0)
	for rows.Next() {
		task, err := scanTask(rows)
		if err != nil {
			return TaskList{}, err
		}
		items = append(items, task)
	}
	if err := rows.Err(); err != nil {
		return TaskList{}, err
	}

	return TaskList{
		Items:    items,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	}, nil
}

func (s *Store) ListActiveTasks(ctx context.Context, limit int) ([]Task, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT
		id, remark, url, target_api_key, target_api_key_masked, model, check_token_usage, cctest_task_id, status,
		verdict, score, failure_type, error_message, raw_result_json, created_at, submitted_at,
		last_polled_at, completed_at, timeout_at
		FROM tasks
		WHERE status IN (?, ?, ?)
		ORDER BY created_at ASC, id ASC
		LIMIT ?`, StatusPending, StatusSubmitted, StatusPolling, limit)
	if err != nil {
		return nil, fmt.Errorf("list active tasks: %w", err)
	}
	defer rows.Close()

	var tasks []Task
	for rows.Next() {
		task, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		tasks = append(tasks, task)
	}
	return tasks, rows.Err()
}

func (s *Store) UpdateTask(ctx context.Context, id int64, update TaskUpdate) (Task, error) {
	assignments := make([]string, 0)
	args := make([]any, 0)

	if update.Status != nil {
		assignments = append(assignments, "status = ?")
		args = append(args, *update.Status)
	}
	if update.CCTestTaskID != nil {
		assignments = append(assignments, "cctest_task_id = ?")
		args = append(args, valueString(*update.CCTestTaskID))
	}
	if update.Verdict != nil {
		assignments = append(assignments, "verdict = ?")
		args = append(args, valueString(*update.Verdict))
	}
	if update.Score != nil {
		assignments = append(assignments, "score = ?")
		args = append(args, valueFloat(*update.Score))
	}
	if update.FailureType != nil {
		assignments = append(assignments, "failure_type = ?")
		args = append(args, *update.FailureType)
	}
	if update.ErrorMessage != nil {
		assignments = append(assignments, "error_message = ?")
		args = append(args, valueString(*update.ErrorMessage))
	}
	if update.RawResultJSON != nil {
		assignments = append(assignments, "raw_result_json = ?")
		args = append(args, valueString(*update.RawResultJSON))
	}
	if update.SubmittedAt != nil {
		assignments = append(assignments, "submitted_at = ?")
		args = append(args, valueTime(*update.SubmittedAt))
	}
	if update.LastPolledAt != nil {
		assignments = append(assignments, "last_polled_at = ?")
		args = append(args, valueTime(*update.LastPolledAt))
	}
	if update.CompletedAt != nil {
		assignments = append(assignments, "completed_at = ?")
		args = append(args, valueTime(*update.CompletedAt))
	}

	if len(assignments) == 0 {
		return s.GetTask(ctx, id)
	}

	args = append(args, id)
	statement := fmt.Sprintf("UPDATE tasks SET %s WHERE id = ?", strings.Join(assignments, ", "))
	if _, err := s.db.ExecContext(ctx, statement, args...); err != nil {
		return Task{}, fmt.Errorf("update task: %w", err)
	}
	return s.GetTask(ctx, id)
}

func IsFinalStatus(status string) bool {
	return status == StatusSucceeded ||
		status == StatusPartialFailed ||
		status == StatusFailed ||
		status == StatusTimeout
}

type scanner interface {
	Scan(dest ...any) error
}

func scanTask(row scanner) (Task, error) {
	var task Task
	var cctestTaskID sql.NullString
	var verdict sql.NullString
	var score sql.NullFloat64
	var errorMessage sql.NullString
	var rawResultJSON sql.NullString
	var checkTokenUsage int
	var createdAt string
	var submittedAt sql.NullString
	var lastPolledAt sql.NullString
	var completedAt sql.NullString
	var timeoutAt string

	err := row.Scan(
		&task.ID,
		&task.Remark,
		&task.URL,
		&task.TargetAPIKey,
		&task.TargetAPIKeyMasked,
		&task.Model,
		&checkTokenUsage,
		&cctestTaskID,
		&task.Status,
		&verdict,
		&score,
		&task.FailureType,
		&errorMessage,
		&rawResultJSON,
		&createdAt,
		&submittedAt,
		&lastPolledAt,
		&completedAt,
		&timeoutAt,
	)
	if err != nil {
		return Task{}, err
	}

	task.CCTestTaskID = stringPtr(cctestTaskID)
	task.CheckTokenUsage = checkTokenUsage != 0
	task.Verdict = stringPtr(verdict)
	task.Score = floatPtr(score)
	task.ErrorMessage = stringPtr(errorMessage)
	task.RawResultJSON = stringPtr(rawResultJSON)
	task.CreatedAt = parseStoredTime(createdAt)
	task.SubmittedAt = timePtr(submittedAt)
	task.LastPolledAt = timePtr(lastPolledAt)
	task.CompletedAt = timePtr(completedAt)
	task.TimeoutAt = parseStoredTime(timeoutAt)
	return task, nil
}

func formatTime(t time.Time) string {
	return t.UTC().Format(time.RFC3339Nano)
}

func parseStoredTime(raw string) time.Time {
	t, err := time.Parse(time.RFC3339Nano, raw)
	if err != nil {
		return time.Time{}
	}
	return t
}

func stringPtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}

func floatPtr(value sql.NullFloat64) *float64 {
	if !value.Valid {
		return nil
	}
	return &value.Float64
}

func timePtr(value sql.NullString) *time.Time {
	if !value.Valid || value.String == "" {
		return nil
	}
	parsed := parseStoredTime(value.String)
	return &parsed
}

func valueString(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}

func valueFloat(value *float64) any {
	if value == nil {
		return nil
	}
	return *value
}

func valueTime(value *time.Time) any {
	if value == nil {
		return nil
	}
	return formatTime(*value)
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
