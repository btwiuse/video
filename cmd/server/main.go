package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

var verbose *bool

func vlog(format string, args ...any) {
	if *verbose {
		log.Printf(format, args...)
	}
}

// ============================================================================
// Pipeline state (in-memory, single instance)
// ============================================================================

type PipelineStatus string

const (
	StatusPending  PipelineStatus = "pending"
	StatusRunning  PipelineStatus = "running"
	StatusDone     PipelineStatus = "done"
	StatusFailed   PipelineStatus = "failed"
	StatusCanceled PipelineStatus = "canceled"
	StatusStep1    PipelineStatus = "step_1"
	StatusStep2    PipelineStatus = "step_2"
	StatusStep3    PipelineStatus = "step_3"
	StatusStep4    PipelineStatus = "step_4"
	StatusStep5    PipelineStatus = "step_5"
)

type Pipeline struct {
	ID        string
	Name      string
	Status    PipelineStatus
	Step      int           // current step 0-5
	Error     string
	Cmd       *exec.Cmd     `json:"-"` // not serializable
	Ctx       context.Context `json:"-"` // not serializable
	Cancel    context.CancelFunc `json:"-"` // not serializable
	CreatedAt time.Time
	UpdatedAt time.Time
	StartedAt time.Time
	Duration  string
}

var (
	pipelines = make(map[string]*Pipeline)
	mu        sync.RWMutex
)

// ============================================================================
// Helpers
// ============================================================================

func logPath(id string) string {
	base := os.Getenv("DATA_DIR")
	if base == "" {
		base = "."
	}
	return filepath.Join(base, "output", id, "pipeline.log")
}

func outputDir(id string) string {
	base := os.Getenv("DATA_DIR")
	if base == "" {
		base = "."
	}
	return filepath.Join(base, "output", id)
}

func listArtifactsRecursive(dir string) ([]map[string]any, error) {
	var files []map[string]any
	err := filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(dir, path)
		if err != nil {
			return err
		}
		info, _ := d.Info()
		files = append(files, map[string]any{
			"name": rel,
			"size": info.Size(),
		})
		return nil
	})
	if err != nil {
		return nil, err
	}
	if files == nil {
		files = []map[string]any{}
	}
	return files, nil
}

func scriptPath(id string) string {
	return filepath.Join(outputDir(id), "script.txt")
}

func pipelineKey(id string) string {
	base := os.Getenv("DATA_DIR")
	if base == "" {
		base = "."
	}
	return filepath.Join(base, "output", id, "pipeline.json")
}

func savePipelineState(p *Pipeline) {
	p.UpdatedAt = time.Now()
	data, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		vlog("pipeline %s marshal error: %v", p.ID, err)
		return
	}
	key := pipelineKey(p.ID)
	if err := os.MkdirAll(filepath.Dir(key), 0755); err != nil {
		vlog("pipeline %s mkdir error: %v", p.ID, err)
		return
	}
	if err := os.WriteFile(key, data, 0644); err != nil {
		vlog("pipeline %s write error: %v", p.ID, err)
		return
	}
}

func loadPipelineState(id string) *Pipeline {
	data, err := os.ReadFile(pipelineKey(id))
	if err != nil {
		return nil
	}
	var p Pipeline
	if err := json.Unmarshal(data, &p); err != nil {
		return nil
	}
	return &p
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func generatePipelineName(scriptPath string) string {
	data, err := os.ReadFile(scriptPath)
	if err != nil {
		return "Untitled Pipeline"
	}
	text := string(data)
	lines := strings.Split(text, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "#") || strings.HasPrefix(line, "//") || strings.HasPrefix(line, "场景") || strings.HasPrefix(line, "===") {
			continue
		}
		if len(line) > 30 {
			line = line[:30] + "..."
		}
		return line
	}
	return "Untitled Pipeline"
}

func detectStatus(id string) PipelineStatus {
	dir := outputDir(id)
	if fileExists(filepath.Join(dir, "final.mp4")) {
		return StatusDone
	}
	steps := []string{
		"storyboard.json",
		"manifest.json",
		"clip_manifest.json",
		"audio_manifest.json",
	}
	for i, f := range steps {
		if !fileExists(filepath.Join(dir, f)) {
			return PipelineStatus(fmt.Sprintf("step_%d", i+1))
		}
	}
	return StatusStep5
}

func runPythonAsync(p *Pipeline, args []string, stepNum int, maxShotsPerScene, totalShots, totalDuration int) {
	p.Ctx, p.Cancel = context.WithCancel(context.Background())
	cmd := exec.CommandContext(p.Ctx, "uv", append([]string{"run", "python"}, args...)...)
	cmd.Dir = "."
	outDir := outputDir(p.ID)
	dataDir := "."
	if v := os.Getenv("DATA_DIR"); v != "" {
		dataDir = v
	}
	env := append(os.Environ(),
		fmt.Sprintf("DATA_DIR=%s", dataDir),
		fmt.Sprintf("OUTPUT_DIR=%s", outDir),
		fmt.Sprintf("PIPELINE_ID=%s", p.ID),
	)
	if v := os.Getenv("PUBLIC_URL"); v != "" {
		env = append(env, fmt.Sprintf("PUBLIC_URL=%s", v))
	} else if v := os.Getenv("RAILWAY_PUBLIC_DOMAIN"); v != "" {
		env = append(env, fmt.Sprintf("PUBLIC_URL=https://%s", v))
	}
	if maxShotsPerScene > 0 {
		env = append(env, fmt.Sprintf("MAX_SHOTS_PER_SCENE=%d", maxShotsPerScene))
	}
	if totalShots > 0 {
		env = append(env, fmt.Sprintf("TOTAL_SHOTS=%d", totalShots))
	}
	if totalDuration > 0 {
		env = append(env, fmt.Sprintf("TOTAL_DURATION=%d", totalDuration))
	}
	cmd.Env = env
	logFile, err := os.OpenFile(logPath(p.ID), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		vlog("pipeline %s cannot open log file: %v", p.ID, err)
	} else {
		cmd.Stdout = logFile
		cmd.Stderr = logFile
	}
	p.Cmd = cmd
	p.Status = StatusRunning
	p.Error = ""
	p.Step = stepNum
	p.StartedAt = time.Now()
	savePipelineState(p)

	vlog("pipeline %s step %d command: uv %s (output=%s)", p.ID, p.Step, strings.Join(args, " "), outDir)

	go func() {
		if logFile != nil {
			defer logFile.Close()
		}
		err := cmd.Run()
		mu.Lock()
		defer mu.Unlock()
		if p.Status == StatusCanceled {
			vlog("pipeline %s step %d canceled", p.ID, p.Step)
			return
		}
		p.Duration = time.Since(p.StartedAt).String()
		if err != nil {
			p.Status = StatusFailed
			p.Error = err.Error()
			vlog("pipeline %s step %d failed: %v", p.ID, p.Step, err)
		} else {
			// Verify actual output status
			p.Status = detectStatus(p.ID)
			if p.Status == StatusDone {
				p.Step = 5
			}
			vlog("pipeline %s step %d done status=%s", p.ID, p.Step, p.Status)
		}
		p.UpdatedAt = time.Now()
		savePipelineState(p)
	}()
}

// ============================================================================
// Handlers
// ============================================================================

func handleCreatePipeline(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse multipart form (max 10MB script)
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		http.Error(w, fmt.Sprintf("bad request: %v", err), http.StatusBadRequest)
		return
	}

	file, _, err := r.FormFile("script")
	if err != nil {
		http.Error(w, "missing 'script' file field", http.StatusBadRequest)
		return
	}
	defer file.Close()

	id := fmt.Sprintf("%d", time.Now().UnixNano())
	dir := outputDir(id)
	if err := os.MkdirAll(dir, 0755); err != nil {
		http.Error(w, fmt.Sprintf("cannot create output dir: %v", err), http.StatusInternalServerError)
		return
	}

	// Save uploaded script
	sp := scriptPath(id)
	dst, err := os.Create(sp)
	if err != nil {
		http.Error(w, fmt.Sprintf("cannot save script: %v", err), http.StatusInternalServerError)
		return
	}
	defer dst.Close()
	if _, err := io.Copy(dst, file); err != nil {
		http.Error(w, fmt.Sprintf("cannot write script: %v", err), http.StatusInternalServerError)
		return
	}

	p := &Pipeline{
		ID:        id,
		Name:      generatePipelineName(sp),
		Status:    StatusPending,
		Step:      0,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	mu.Lock()
	pipelines[id] = p
	mu.Unlock()
	savePipelineState(p)

	vlog("pipeline created id=%s script=%s", id, sp)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]any{
		"pipeline_id": id,
		"name":        p.Name,
		"status":      string(StatusPending),
	})
}

func handleGetPipeline(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/pipelines/")
	id = strings.TrimSuffix(id, "/")
	if id == "" {
		http.Error(w, "missing pipeline id", http.StatusBadRequest)
		return
	}

	mu.RLock()
	p, exists := pipelines[id]
	mu.RUnlock()
	if !exists {
		// Try loading from disk (server restart recovery)
		p = loadPipelineState(id)
		if p == nil {
			http.Error(w, "pipeline not found", http.StatusNotFound)
			return
		}
		mu.Lock()
		pipelines[id] = p
		mu.Unlock()
	}

	// Refresh status from filesystem only if still pending
	// Once running/failed/done/canceled, the background goroutine or terminal
	// state owns the status.
	if p.Status == StatusPending {
		p.Status = detectStatus(id)
		p.UpdatedAt = time.Now()
		savePipelineState(p)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"pipeline_id": p.ID,
		"name":        p.Name,
		"status":      string(p.Status),
		"step":        p.Step,
		"error":       p.Error,
		"created_at":  p.CreatedAt,
		"updated_at":  p.UpdatedAt,
		"duration":    p.Duration,
	})
}

func handleStep(w http.ResponseWriter, r *http.Request) {
	// /pipelines/{id}/steps/{n}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) != 4 {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}
	id := parts[1]
	var step int
	if _, err := fmt.Sscanf(parts[3], "%d", &step); err != nil || step < 1 || step > 5 {
		http.Error(w, "step must be 1-5", http.StatusBadRequest)
		return
	}

	mu.RLock()
	p, exists := pipelines[id]
	mu.RUnlock()
	if !exists {
		http.Error(w, "pipeline not found", http.StatusNotFound)
		return
	}

	// Allow re-running a canceled pipeline — reset status
	if p.Status == StatusCanceled || p.Status == StatusDone {
		p.Status = StatusPending
		p.Error = ""
		p.Duration = ""
		p.StartedAt = time.Time{}
		savePipelineState(p)
	}

	// Validate dependencies
	dir := outputDir(id)
	required := map[int][]string{}
	required[2] = []string{"storyboard.json"}
	required[3] = []string{"storyboard.json", "manifest.json"}
	required[4] = []string{"storyboard.json", "clip_manifest.json"}
	required[5] = []string{"clip_manifest.json", "audio_manifest.json"}
	if deps, ok := required[step]; ok {
		for _, f := range deps {
			if !fileExists(filepath.Join(dir, f)) {
				http.Error(w, fmt.Sprintf("missing dependency: %s (run previous steps first)", f), http.StatusConflict)
				return
			}
		}
	}

	// Cancel previous if running
	if p.Status == StatusRunning && p.Cancel != nil {
		p.Cancel()
	}

	sp := scriptPath(id)
	args := []string{"main.py"}
	stepNames := []string{"", "storyboard", "assets", "videos", "audio", "compose"}
	switch step {
	case 1:
		args = append(args, "storyboard", sp)
	case 2:
		args = append(args, "assets", filepath.Join(outputDir(id), "storyboard.json"))
	case 3:
		args = append(args, "videos", filepath.Join(outputDir(id), "storyboard.json"), filepath.Join(outputDir(id), "manifest.json"))
	case 4:
		args = append(args, "audio", filepath.Join(outputDir(id), "storyboard.json"), filepath.Join(outputDir(id), "clip_manifest.json"))
	case 5:
		args = append(args, "compose", filepath.Join(outputDir(id), "clip_manifest.json"), filepath.Join(outputDir(id), "audio_manifest.json"))
	}

	vlog("pipeline %s step %d (%s) starting", id, step, stepNames[step])

	// Parse optional step params from request body
	var maxShotsPerScene, totalShots, totalDuration int
	if r.Body != nil {
		var params struct {
			MaxShotsPerScene int `json:"max_shots_per_scene"`
			TotalShots       int `json:"total_shots"`
			TotalDuration    int `json:"total_duration"`
		}
		if err := json.NewDecoder(r.Body).Decode(&params); err == nil {
			maxShotsPerScene = params.MaxShotsPerScene
			totalShots = params.TotalShots
			totalDuration = params.TotalDuration
		}
	}

	runPythonAsync(p, args, step, maxShotsPerScene, totalShots, totalDuration)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]any{
		"pipeline_id": id,
		"status":      string(StatusRunning),
		"step":        step,
	})
}

func handleSummarize(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	id := strings.TrimPrefix(r.URL.Path, "/pipelines/")
	id = strings.TrimSuffix(id, "/summarize/")
	id = strings.TrimSuffix(id, "/summarize")
	if id == "" {
		http.Error(w, "missing pipeline id", http.StatusBadRequest)
		return
	}

	sp := scriptPath(id)
	if !fileExists(sp) {
		http.Error(w, "script not found", http.StatusNotFound)
		return
	}

	// Run summarize script via Python
	cmd := exec.Command("uv", "run", "python", "main.py", "summarize", sp)
	cmd.Dir = "."
	outDir := outputDir(id)
	dataDir := "."
	if v := os.Getenv("DATA_DIR"); v != "" {
		dataDir = v
	}
	cmd.Env = append(os.Environ(), fmt.Sprintf("DATA_DIR=%s", dataDir), fmt.Sprintf("OUTPUT_DIR=%s", outDir))
	logFile, err := os.OpenFile(logPath(id), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	var buf bytes.Buffer
	if err == nil {
		cmd.Stdout = io.MultiWriter(logFile, &buf)
		cmd.Stderr = io.MultiWriter(logFile, &buf)
		defer logFile.Close()
	} else {
		cmd.Stdout = &buf
		cmd.Stderr = &buf
	}
	err = cmd.Run()
	out := buf.Bytes()
	if err != nil {
		vlog("pipeline %s summarize failed: %v output=%s", id, err, string(out))
		http.Error(w, fmt.Sprintf("summarize failed: %v", err), http.StatusInternalServerError)
		return
	}

	// Parse JSON output (last non-empty line)
	var result map[string]string
	lines := strings.Split(string(out), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if line == "" {
			continue
		}
		if err := json.Unmarshal([]byte(line), &result); err == nil {
			break
		}
	}
	if result == nil {
		result = map[string]string{"title": "Untitled", "summary": ""}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"title":   result["title"],
		"summary": result["summary"],
		"cached":  false,
	})
}

func handleListPipelines(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	base := outputDir("")
	entries, err := os.ReadDir(base)
	if err != nil {
		vlog("list pipelines: read dir error: %v", err)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"pipelines": []any{}})
		return
	}

	var list []map[string]any
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		id := e.Name()
		// Only include directories that have a pipeline.json
		key := pipelineKey(id)
		if !fileExists(key) {
			continue
		}
		p := loadPipelineState(id)
		if p == nil {
			continue
		}
		list = append(list, map[string]any{
			"pipeline_id": p.ID,
			"name":        p.Name,
			"status":      string(p.Status),
			"step":        p.Step,
			"error":       p.Error,
			"created_at":  p.CreatedAt,
			"updated_at":  p.UpdatedAt,
			"duration":    p.Duration,
		})
	}

	// Sort by updated_at descending (newest first)
	sort.Slice(list, func(i, j int) bool {
		ti := list[i]["updated_at"].(time.Time)
		tj := list[j]["updated_at"].(time.Time)
		return ti.After(tj)
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"pipelines": list})
}

func handleDeletePipeline(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/pipelines/")
	id = strings.TrimSuffix(id, "/")
	if id == "" {
		http.Error(w, "missing pipeline id", http.StatusBadRequest)
		return
	}

	mu.Lock()
	p, exists := pipelines[id]
	if exists {
		if p.Cancel != nil {
			p.Cancel()
		}
		delete(pipelines, id)
	}
	mu.Unlock()

	// Best effort cleanup
	errRemoveAll := os.RemoveAll(outputDir(id))
	errRemove := os.Remove(scriptPath(id))
	errRemoveKey := os.Remove(pipelineKey(id))
	if errRemoveAll != nil || errRemove != nil || errRemoveKey != nil {
		vlog("pipeline %s cleanup errors: rmAll=%v rm=%v rmKey=%v", id, errRemoveAll, errRemove, errRemoveKey)
	}

	vlog("pipeline deleted id=%s", id)
	w.WriteHeader(http.StatusNoContent)
}

func handleCancelStep(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/pipelines/")
	id = strings.TrimSuffix(id, "/cancel")
	id = strings.TrimSuffix(id, "/")

	mu.Lock()
	p, exists := pipelines[id]
	if exists && p.Cancel != nil {
		p.Cancel()
		p.Status = StatusCanceled
		p.Error = "canceled by user"
		p.UpdatedAt = time.Now()
		savePipelineState(p)
	}
	mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]any{"status": "canceled"})
}

func serveHome(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	http.ServeFile(w, r, "index.html")
}

func handleArtifacts(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/pipelines/")
	id = strings.TrimSuffix(id, "/")
	parts := strings.Split(id, "/")

	// /pipelines/{id} — list output dir (legacy fallback)
	if len(parts) == 1 {
		dir := outputDir(parts[0])
		entries, err := listArtifactsRecursive(dir)
		if err != nil {
			http.Error(w, "cannot read artifacts", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"files": entries})
		return
	}

	pid := parts[0]

	// /pipelines/{id}/artifacts — list
	if len(parts) == 2 {
		dir := outputDir(pid)
		entries, err := listArtifactsRecursive(dir)
		if err != nil {
			http.Error(w, "cannot read artifacts", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"files": entries})
		return
	}

	// /pipelines/{id}/artifacts/{name} — download single file (may contain subdirs)
	name := strings.Join(parts[2:], "/")

	path := filepath.Join(outputDir(pid), name)
	if !fileExists(path) {
		http.Error(w, "artifact not found", http.StatusNotFound)
		return
	}
	// Set Content-Type based on extension
	ext := strings.ToLower(filepath.Ext(name))
	ct := "application/octet-stream"
	switch ext {
	case ".json":
		ct = "application/json"
	case ".png", ".jpg", ".jpeg", ".gif", ".webp":
		ct = "image/" + strings.TrimPrefix(ext, ".")
	case ".mp4", ".webm", ".mov":
		ct = "video/" + strings.TrimPrefix(ext, ".")
	case ".txt", ".md":
		ct = "text/plain; charset=utf-8"
	case ".wav", ".mp3", ".m4a":
		ct = "audio/" + strings.TrimPrefix(ext, ".")
	}
	w.Header().Set("Content-Type", ct)
	if !strings.HasPrefix(filepath.Clean(path), filepath.Clean(outputDir(pid))+string(filepath.Separator)) {
		http.Error(w, "artifact not found", http.StatusNotFound)
		return
	}
	http.ServeFile(w, r, path)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func handleLogs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	id := strings.TrimPrefix(r.URL.Path, "/pipelines/")
	id = strings.TrimSuffix(id, "/logs")
	id = strings.TrimSuffix(id, "/logs/")
	if id == "" {
		http.Error(w, "missing pipeline id", http.StatusBadRequest)
		return
	}

	path := logPath(id)
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.Write([]byte(""))
			return
		}
		http.Error(w, fmt.Sprintf("cannot read logs: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Write(data)
}

// ============================================================================
// CORS & main
// ============================================================================

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		allowedOrigin := "*"
		if origin != "" {
			allowedOrigin = origin
		}
		w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func main() {
	verbose = flag.Bool("v", false, "verbose logging")
	flag.Parse()

	mux := http.NewServeMux()
	mux.HandleFunc("/", serveHome)
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/pipelines", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			handleCreatePipeline(w, r)
		} else if r.Method == http.MethodGet {
			handleListPipelines(w, r)
		} else {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})
	mux.HandleFunc("/pipelines/", func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if strings.HasSuffix(path, "/logs") || strings.Contains(path, "/logs/") {
			handleLogs(w, r)
			return
		}
		if strings.HasSuffix(path, "/artifacts") || strings.Contains(path, "/artifacts/") {
			handleArtifacts(w, r)
			return
		}
	if strings.HasSuffix(path, "/summarize") {
			handleSummarize(w, r)
			return
		}
		if strings.HasSuffix(path, "/cancel") && r.Method == http.MethodPost {
			handleCancelStep(w, r)
			return
		}
		if r.Method == http.MethodGet {
			handleGetPipeline(w, r)
		} else if r.Method == http.MethodDelete {
			handleDeletePipeline(w, r)
		} else if r.Method == http.MethodPost {
			handleStep(w, r)
		} else {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	addr := ":8080"
	if v := os.Getenv("PORT"); v != "" {
		addr = ":" + v
	}

	// Verify output directory is writable
	testPath := filepath.Join(".", "output", ".write_test")
	if err := os.MkdirAll(filepath.Dir(testPath), 0755); err != nil {
		log.Printf("WARNING: cannot create output dir: %v", err)
	} else if err := os.WriteFile(testPath, []byte("test"), 0644); err != nil {
		log.Printf("WARNING: output dir is not writable: %v", err)
	} else {
		os.Remove(testPath)
	}

	log.Printf("server listening on %s (verbose=%v, output=%s)", addr, *verbose, outputDir(""))
	log.Fatal(http.ListenAndServe(addr, corsMiddleware(mux)))
}
