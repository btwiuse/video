package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"net/url"
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
	ID          string
	Name        string
	Description string
	ScriptFile  string `json:"script_file"` // original uploaded filename
	Status      PipelineStatus
	Step        int // current step 0-5
	Error       string
	Cmd         *exec.Cmd          `json:"-"` // not serializable
	Ctx         context.Context    `json:"-"` // not serializable
	Cancel      context.CancelFunc `json:"-"` // not serializable
	CreatedAt   time.Time
	UpdatedAt   time.Time
	StartedAt   time.Time
	Duration    string
}

var (
	pipelines = make(map[string]*Pipeline)
	mu        sync.RWMutex
	summaryMu sync.Mutex
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

func summaryPath(id string) string {
	return filepath.Join(outputDir(id), "summary.json")
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
	// Reset pipelines that were running when the server died
	if p.Step > 0 && (p.Status == StatusRunning || p.Status == StatusPending) {
		if p.Cancel == nil {
			p.Status = StatusFailed
			p.Error = "server restarted while step was running"
			p.UpdatedAt = time.Now()
			savePipelineState(&p)
		}
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
		// len(string) counts UTF-8 bytes, so slicing it can split a Chinese
		// character and permanently store U+FFFD in the project name.
		line = truncateRunes(line, 30)
		return line
	}
	return "Untitled Pipeline"
}

func truncateRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit]) + "..."
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
	}
	for i, f := range steps {
		if !fileExists(filepath.Join(dir, f)) {
			return PipelineStatus(fmt.Sprintf("step_%d", i+1))
		}
	}
	return StatusStep4
}

func hasImageMatching(pattern string) bool {
	matches, _ := filepath.Glob(pattern)
	for _, path := range matches {
		switch strings.ToLower(filepath.Ext(path)) {
		case ".jpg", ".jpeg", ".png", ".webp":
			return true
		}
	}
	return false
}

// pipelinePreviewGroups returns fixed asset categories in the same order visual
// assets are produced: character, prop, scene, then the Step 3 start frame.
// Each category contains at most sixteen images for a compact mosaic preview;
// its count is the number of logical assets, not the number of image variants.
func pipelinePreviewGroups(id string) ([][]string, []int) {
	dir := outputDir(id)
	patterns := []string{
		"characters/*.*",
		"props/*_reference.*",
		"scenes/*.*",
		"shots/*/*_startframe.*",
	}
	groups := make([][]string, 0, len(patterns))
	counts := make([]int, 0, len(patterns))
	for category, pattern := range patterns {
		group := make([]string, 0, 16)
		assets := make(map[string]struct{})
		matches, _ := filepath.Glob(filepath.Join(dir, pattern))
		for _, path := range matches {
			switch strings.ToLower(filepath.Ext(path)) {
			case ".jpg", ".jpeg", ".png", ".webp":
				rel, err := filepath.Rel(dir, path)
				if err == nil {
					rel = filepath.ToSlash(rel)
					assets[previewAssetKey(category, rel)] = struct{}{}
					if len(group) < 16 {
						group = append(group, rel)
					}
				}
			}
		}
		groups = append(groups, group)
		counts = append(counts, len(assets))
	}
	return groups, counts
}

func previewAssetKey(category int, rel string) string {
	base := strings.TrimSuffix(filepath.Base(rel), filepath.Ext(rel))
	switch category {
	case 0: // A character usually contributes front/profile/full-body views.
		for _, suffix := range []string{"_front", "_profile", "_fullbody"} {
			base = strings.TrimSuffix(base, suffix)
		}
	case 1:
		base = strings.TrimSuffix(base, "_reference")
	case 2: // A scene usually contributes wide/detail views.
		for _, suffix := range []string{"_wide", "_detail"} {
			base = strings.TrimSuffix(base, suffix)
		}
	case 3:
		return filepath.ToSlash(filepath.Dir(rel))
	}
	return base
}

// visualAssetsComplete verifies the actual asset files rather than relying on
// manifest.json alone. This lets manually generated and uploaded assets finish
// step 2 just like the initial batch generator does.
func visualAssetsComplete(id string) bool {
	data, err := os.ReadFile(filepath.Join(outputDir(id), "storyboard.json"))
	if err != nil {
		return false
	}
	var storyboard map[string]any
	if json.Unmarshal(data, &storyboard) != nil {
		return false
	}
	entities := func(key string) []any {
		items, _ := storyboard[key].([]any)
		return items
	}
	value := func(item any, key string) string {
		if entity, ok := item.(map[string]any); ok {
			value, _ := entity[key].(string)
			return value
		}
		return ""
	}
	dir := outputDir(id)
	for _, character := range entities("characters") {
		refID := value(character, "ref_id")
		if refID == "" || !hasImageMatching(filepath.Join(dir, "characters", refID+"_front.*")) || !hasImageMatching(filepath.Join(dir, "characters", refID+"_profile.*")) || !hasImageMatching(filepath.Join(dir, "characters", refID+"_fullbody.*")) {
			return false
		}
	}
	for _, prop := range entities("props") {
		refID := value(prop, "ref_id")
		if refID == "" || !hasImageMatching(filepath.Join(dir, "props", refID+"_reference.*")) {
			return false
		}
	}
	for _, scene := range entities("scenes") {
		sceneID := value(scene, "scene_id")
		if sceneID == "" || !hasImageMatching(filepath.Join(dir, "scenes", sceneID+"_*")) {
			return false
		}
	}
	return true
}

func markVisualAssetsComplete(id string) {
	if !visualAssetsComplete(id) {
		return
	}
	mu.Lock()
	defer mu.Unlock()
	p, exists := pipelines[id]
	if !exists || p.Status == StatusRunning || p.Step > 2 || p.Status == StatusDone {
		return
	}
	p.Step = 2
	p.Status = StatusStep2
	p.Error = ""
	savePipelineState(p)
	vlog("pipeline %s visual assets complete", id)
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
			// Use detectStatus only for initial sequential runs (stepNum == 0).
			// For explicit step runs, set status directly to the completed step.
			if stepNum == 0 {
				p.Status = detectStatus(p.ID)
				if p.Status == StatusDone {
					p.Step = 4
				}
			} else {
				if stepNum >= 4 {
					p.Status = StatusDone
				} else {
					p.Status = PipelineStatus(fmt.Sprintf("step_%d", stepNum))
				}
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

	file, header, err := r.FormFile("script")
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

	// Save uploaded file with original filename (preserves extension for correct Content-Type)
	filename := header.Filename
	if filename == "" {
		filename = "script.txt"
	}
	sp := filepath.Join(dir, filename)
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
		ID:         id,
		Name:       generatePipelineName(sp),
		ScriptFile: filename,
		Status:     StatusPending,
		Step:       0,
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
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

	// Refresh status from filesystem only if the pipeline had actually
	// started (step > 0). A brand new pipeline (step == 0) should stay
	// pending until the user explicitly runs a step.
	if p.Status == StatusPending && p.Step > 0 {
		p.Status = detectStatus(id)
		p.UpdatedAt = time.Now()
		savePipelineState(p)
	}
	// Manual asset generation can finish after the original Step 2 run. Recheck
	// the actual files whenever the detail view polls so existing projects are
	// promoted without requiring another image generation request.
	if p.Step <= 2 && p.Status != StatusRunning {
		markVisualAssetsComplete(id)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"pipeline_id": p.ID,
		"name":        p.Name,
		"description": p.Description,
		"status":      string(p.Status),
		"step":        p.Step,
		"error":       p.Error,
		"created_at":  p.CreatedAt,
		"updated_at":  p.UpdatedAt,
		"duration":    p.Duration,
	})
}

func handleUpdatePipeline(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	id := strings.Trim(strings.TrimPrefix(r.URL.Path, "/pipelines/"), "/")
	if id == "" || strings.Contains(id, "/") {
		http.Error(w, "invalid pipeline id", http.StatusBadRequest)
		return
	}

	var update struct {
		Name        *string `json:"name"`
		Description *string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&update); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}
	if update.Name == nil && update.Description == nil {
		http.Error(w, "provide name or description", http.StatusBadRequest)
		return
	}

	mu.Lock()
	p, exists := pipelines[id]
	if !exists {
		p = loadPipelineState(id)
		if p != nil {
			pipelines[id] = p
			exists = true
		}
	}
	if !exists {
		mu.Unlock()
		http.Error(w, "pipeline not found", http.StatusNotFound)
		return
	}
	if update.Name != nil {
		name := strings.TrimSpace(*update.Name)
		if name == "" {
			mu.Unlock()
			http.Error(w, "name cannot be empty", http.StatusBadRequest)
			return
		}
		p.Name = truncateRunes(name, 100)
	}
	if update.Description != nil {
		p.Description = truncateRunes(strings.TrimSpace(*update.Description), 500)
	}
	savePipelineState(p)
	mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"pipeline_id": p.ID,
		"name":        p.Name,
		"description": p.Description,
		"updated_at":  p.UpdatedAt,
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
	if _, err := fmt.Sscanf(parts[3], "%d", &step); err != nil || step < 1 || step > 4 {
		http.Error(w, "step must be 1-4", http.StatusBadRequest)
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
	required[4] = []string{"clip_manifest.json"}
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

	sp := filepath.Join(dir, p.ScriptFile)
	args := []string{"main.py"}
	stepNames := []string{"", "storyboard", "assets", "videos", "compose"}
	switch step {
	case 1:
		args = append(args, "storyboard", sp)
	case 2:
		args = append(args, "assets", filepath.Join(outputDir(id), "storyboard.json"))
	case 3:
		args = append(args, "videos", filepath.Join(outputDir(id), "storyboard.json"), filepath.Join(outputDir(id), "manifest.json"))
	case 4:
		// Audio generation is intentionally optional. Compose directly from the
		// video manifest so the product workflow stays four steps long.
		args = append(args, "compose", filepath.Join(outputDir(id), "clip_manifest.json"))
	}

	vlog("pipeline %s step %d (%s) starting", id, step, stepNames[step])

	// Clear this step's output files so regeneration actually re-generates
	stepOutputs := map[int]string{
		1: "storyboard.json",
		2: "manifest.json",
		3: "clip_manifest.json",
		4: "final.mp4",
	}
	if f := stepOutputs[step]; f != "" {
		fp := filepath.Join(dir, f)
		if fileExists(fp) {
			os.Remove(fp)
			vlog("pipeline %s cleared stale output: %s", id, f)
		}
	}
	// Also clear generated artifacts for this step
	switch step {
	case 1:
		for _, pattern := range []string{"characters/*.md", "props/*.md", "scenes/*.md", "shots/*/*.md", "shots/*/deps.json"} {
			matches, _ := filepath.Glob(filepath.Join(dir, pattern))
			for _, m := range matches {
				os.Remove(m)
			}
		}
		vlog("pipeline %s cleared stale storyboard artifacts", id)
	case 2:
		for _, pattern := range []string{"characters/*.jpg", "characters/*.png", "scenes/*.jpg", "scenes/*.png", "props/*.jpg", "props/*.png", "props/*.webp", "shots/*/*_startframe.jpg", "shots/*/*_startframe.png"} {
			matches, _ := filepath.Glob(filepath.Join(dir, pattern))
			for _, m := range matches {
				os.Remove(m)
			}
		}
		vlog("pipeline %s cleared stale image artifacts", id)
	case 3:
		matches, _ := filepath.Glob(filepath.Join(dir, "shots/*/*.mp4"))
		matches2, _ := filepath.Glob(filepath.Join(dir, "shots/*/*.webm"))
		matches3, _ := filepath.Glob(filepath.Join(dir, "shots/*/*.mov"))
		for _, m := range append(append(matches, matches2...), matches3...) {
			os.Remove(m)
		}
		vlog("pipeline %s cleared stale video artifacts", id)
	}

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

	p := loadPipelineState(id)
	if p == nil || p.ScriptFile == "" {
		http.Error(w, "script not found", http.StatusNotFound)
		return
	}
	sp := filepath.Join(outputDir(id), p.ScriptFile)
	if !fileExists(sp) {
		http.Error(w, "script not found", http.StatusNotFound)
		return
	}
	scriptData, err := os.ReadFile(sp)
	if err != nil {
		http.Error(w, "cannot read script", http.StatusInternalServerError)
		return
	}
	sourceHash := fmt.Sprintf("%x", sha256.Sum256(scriptData))

	// The detail page requests this endpoint whenever it mounts. Serialize the
	// cache lookup and generation so even concurrent page opens result in one
	// model call per script version.
	summaryMu.Lock()
	defer summaryMu.Unlock()
	var cached struct {
		SourceHash string `json:"source_hash"`
		Title      string `json:"title"`
		Summary    string `json:"summary"`
	}
	if data, readErr := os.ReadFile(summaryPath(id)); readErr == nil && json.Unmarshal(data, &cached) == nil && cached.SourceHash == sourceHash && cached.Title != "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"title":   cached.Title,
			"summary": cached.Summary,
			"cached":  true,
		})
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
	cacheData, cacheErr := json.MarshalIndent(map[string]string{
		"source_hash": sourceHash,
		"title":       result["title"],
		"summary":     result["summary"],
	}, "", "  ")
	if cacheErr != nil {
		vlog("pipeline %s cannot encode summary cache: %v", id, cacheErr)
	} else if err := os.WriteFile(summaryPath(id), cacheData, 0644); err != nil {
		vlog("pipeline %s cannot save summary cache: %v", id, err)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"title":   result["title"],
		"summary": result["summary"],
		"cached":  false,
	})
}

func handleReindex(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	id := strings.TrimPrefix(r.URL.Path, "/pipelines/")
	id = strings.TrimSuffix(id, "/reindex")
	parts := strings.Split(id, "/")
	id = parts[0]

	mu.RLock()
	p, exists := pipelines[id]
	mu.RUnlock()
	if !exists {
		http.Error(w, "pipeline not found", http.StatusNotFound)
		return
	}

	sbPath := filepath.Join(outputDir(id), "storyboard.json")
	if !fileExists(sbPath) {
		http.Error(w, "storyboard.json not found; run step 1 first", http.StatusConflict)
		return
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	mu.Lock()
	if p.Cancel != nil {
		p.Cancel()
	}
	p.Cancel = cancel
	mu.Unlock()

	cmd := exec.CommandContext(ctx, "uv", "run", "python", "main.py", "reindex", sbPath)
	cmd.Dir = "."
	outDir := outputDir(id)
	dataDir := "."
	if v := os.Getenv("DATA_DIR"); v != "" {
		dataDir = v
	}
	cmd.Env = append(os.Environ(), fmt.Sprintf("DATA_DIR=%s", dataDir), fmt.Sprintf("OUTPUT_DIR=%s", outDir))

	logFile, err := os.OpenFile(logPath(id), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err == nil {
		cmd.Stdout = logFile
		cmd.Stderr = logFile
		defer logFile.Close()
	}

	vlog("pipeline %s reindex starting", id)
	err = cmd.Run()
	vlog("pipeline %s reindex done (err=%v)", id, err)

	if err != nil {
		http.Error(w, fmt.Sprintf("reindex failed: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status": "ok",
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
		previewGroups, previewCounts := pipelinePreviewGroups(p.ID)
		list = append(list, map[string]any{
			"pipeline_id":    p.ID,
			"name":           p.Name,
			"description":    p.Description,
			"status":         string(p.Status),
			"step":           p.Step,
			"error":          p.Error,
			"created_at":     p.CreatedAt,
			"updated_at":     p.UpdatedAt,
			"duration":       p.Duration,
			"preview_groups": previewGroups,
			"preview_counts": previewCounts,
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
	if !exists {
		p = loadPipelineState(id)
		if p == nil {
			mu.Unlock()
			http.Error(w, "pipeline not found", http.StatusNotFound)
			return
		}
		pipelines[id] = p
	}
	if p.Cancel != nil {
		p.Cancel()
	}
	if p.Status == StatusRunning {
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

func handleAddCharacter(w http.ResponseWriter, r *http.Request) {
	// POST /pipelines/{id}/characters
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) != 3 || parts[0] != "pipelines" || parts[2] != "characters" {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}
	id := parts[1]

	mu.RLock()
	_, exists := pipelines[id]
	mu.RUnlock()
	if !exists {
		if p := loadPipelineState(id); p != nil {
			mu.Lock()
			pipelines[id] = p
			mu.Unlock()
		} else {
			http.Error(w, "pipeline not found", http.StatusNotFound)
			return
		}
	}

	var params struct {
		Name       string `json:"name"`
		Identity   string `json:"identity"`
		Appearance string `json:"appearance"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 16<<10)).Decode(&params); err != nil {
		http.Error(w, fmt.Sprintf("bad request: %v", err), http.StatusBadRequest)
		return
	}
	params.Name = strings.TrimSpace(params.Name)
	params.Identity = strings.TrimSpace(params.Identity)
	params.Appearance = strings.TrimSpace(params.Appearance)
	if params.Name == "" || params.Appearance == "" {
		http.Error(w, "name and appearance are required", http.StatusBadRequest)
		return
	}
	if len(params.Name) > 240 || len(params.Identity) > 480 || len(params.Appearance) > 8000 {
		http.Error(w, "character fields are too long", http.StatusBadRequest)
		return
	}

	sbPath := filepath.Join(outputDir(id), "storyboard.json")
	sbData, err := os.ReadFile(sbPath)
	if err != nil {
		http.Error(w, "storyboard.json not found; run step 1 first", http.StatusConflict)
		return
	}
	var storyboard map[string]any
	if err := json.Unmarshal(sbData, &storyboard); err != nil {
		http.Error(w, "invalid storyboard.json", http.StatusInternalServerError)
		return
	}

	characters, _ := storyboard["characters"].([]any)
	existing := make(map[string]bool)
	for _, raw := range characters {
		if character, ok := raw.(map[string]any); ok {
			if refID, ok := character["ref_id"].(string); ok {
				existing[refID] = true
			}
		}
	}
	refID := ""
	for n := 1; ; n++ {
		candidate := fmt.Sprintf("MANUAL_%02d", n)
		if !existing[candidate] {
			refID = candidate
			break
		}
	}
	character := map[string]string{"ref_id": refID, "name": params.Name}
	characters = append(characters, character)
	storyboard["characters"] = characters

	clean := func(value string) string {
		return strings.ReplaceAll(value, "```", "")
	}
	identity := clean(params.Identity)
	if identity == "" {
		identity = "未设定"
	}
	appearance := clean(params.Appearance)
	md := fmt.Sprintf(
		"# %s | %s\n\n"+
			"## 基本信息\n"+
			"- 姓名：%s\n"+
			"- 身份：%s\n\n"+
			"## 外貌与人物设定\n"+
			"%s\n\n"+
			"## 定妆照 Prompt — 正面胸像\n"+
			"\x60\x60\x60\n"+
			"%s，%s，正面胸像，视线看向镜头，干净的中性背景，柔和电影棚拍光，85mm portrait lens，photorealistic，cinematic，8K\n"+
			"\x60\x60\x60\n\n"+
			"## 定妆照 Prompt — 45°侧面\n"+
			"\x60\x60\x60\n"+
			"%s，%s，45度侧面胸像，保留人物标志性外貌与服装，电影感侧光，85mm portrait lens，photorealistic，cinematic，8K\n"+
			"\x60\x60\x60\n\n"+
			"## 定妆照 Prompt — 全身\n"+
			"\x60\x60\x60\n"+
			"%s，%s，全身立姿，完整展示服装与体态，干净场景，电影感自然光，35mm lens，photorealistic，cinematic，8K\n"+
			"\x60\x60\x60\n",
		refID, clean(params.Name), clean(params.Name), identity, appearance,
		clean(params.Name), appearance, clean(params.Name), appearance, clean(params.Name), appearance,
	)

	charsDir := filepath.Join(outputDir(id), "characters")
	if err := os.MkdirAll(charsDir, 0755); err != nil {
		http.Error(w, fmt.Sprintf("cannot create character directory: %v", err), http.StatusInternalServerError)
		return
	}
	if err := os.WriteFile(filepath.Join(charsDir, refID+".md"), []byte(md), 0644); err != nil {
		http.Error(w, fmt.Sprintf("cannot save character prompt: %v", err), http.StatusInternalServerError)
		return
	}
	updated, err := json.MarshalIndent(storyboard, "", "  ")
	if err != nil {
		http.Error(w, "cannot encode storyboard", http.StatusInternalServerError)
		return
	}
	if err := os.WriteFile(sbPath, updated, 0644); err != nil {
		http.Error(w, fmt.Sprintf("cannot update storyboard: %v", err), http.StatusInternalServerError)
		return
	}

	vlog("pipeline %s added manual character %s", id, refID)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]any{"status": "created", "character": character})
}

func handleEntities(w http.ResponseWriter, r *http.Request) {
	// POST /pipelines/{id}/entities, DELETE /pipelines/{id}/entities/{kind}/{entity},
	// POST /pipelines/{id}/entities/{kind}/{entity}/upload
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 3 || parts[0] != "pipelines" || parts[2] != "entities" {
		http.Error(w, "invalid entity path", http.StatusBadRequest)
		return
	}
	id := parts[1]
	mu.RLock()
	_, exists := pipelines[id]
	mu.RUnlock()
	if !exists {
		p := loadPipelineState(id)
		if p == nil {
			http.Error(w, "pipeline not found", http.StatusNotFound)
			return
		}
		mu.Lock()
		pipelines[id] = p
		mu.Unlock()
	}
	sbPath := filepath.Join(outputDir(id), "storyboard.json")
	loadStoryboard := func() (map[string]any, error) {
		data, err := os.ReadFile(sbPath)
		if err != nil {
			return nil, err
		}
		var storyboard map[string]any
		err = json.Unmarshal(data, &storyboard)
		return storyboard, err
	}
	saveStoryboard := func(storyboard map[string]any) error {
		data, err := json.MarshalIndent(storyboard, "", "  ")
		if err != nil {
			return err
		}
		return os.WriteFile(sbPath, data, 0644)
	}

	if len(parts) == 3 && r.Method == http.MethodPost {
		var params struct {
			Kind           string   `json:"kind"`
			Name           string   `json:"name"`
			Identity       string   `json:"identity"`
			Appearance     string   `json:"appearance"`
			Prompt         string   `json:"prompt"`
			Gender         string   `json:"gender"`
			Age            string   `json:"age"`
			GenerationMode string   `json:"generation_mode"`
			CharacterRefs  []string `json:"character_refs"`
			PropRefs       []string `json:"prop_refs"`
			SceneID        string   `json:"scene_id"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 16<<10)).Decode(&params); err != nil {
			http.Error(w, fmt.Sprintf("bad request: %v", err), http.StatusBadRequest)
			return
		}
		params.Kind = strings.TrimSpace(params.Kind)
		params.Name = strings.TrimSpace(params.Name)
		params.Appearance = strings.TrimSpace(params.Appearance)
		if (params.Kind != "characters" && params.Kind != "props" && params.Kind != "scenes" && params.Kind != "shots") || params.Name == "" || params.Appearance == "" {
			http.Error(w, "kind, name and appearance are required", http.StatusBadRequest)
			return
		}
		storyboard, err := loadStoryboard()
		if err != nil {
			http.Error(w, "storyboard.json not found; run step 1 first", http.StatusConflict)
			return
		}
		idKey, prefix, directory := "", "", ""
		switch params.Kind {
		case "characters":
			idKey, prefix, directory = "ref_id", "MANUAL", "characters"
		case "props":
			idKey, prefix, directory = "ref_id", "PROP_MANUAL", "props"
		case "scenes":
			idKey, prefix, directory = "scene_id", "SC_MANUAL", "scenes"
		case "shots":
			idKey, prefix, directory = "full_shot_id", "SHOT_MANUAL", "shots"
		}
		existing, _ := storyboard[params.Kind].([]any)
		used := map[string]bool{}
		for _, raw := range existing {
			if item, ok := raw.(map[string]any); ok {
				if value, ok := item[idKey].(string); ok {
					used[value] = true
				}
			}
		}
		entityID := ""
		for n := 1; ; n++ {
			candidate := fmt.Sprintf("%s_%02d", prefix, n)
			if !used[candidate] {
				entityID = candidate
				break
			}
		}
		clean := func(value string) string { return strings.ReplaceAll(strings.TrimSpace(value), "```", "") }
		prompt := clean(params.Prompt)
		if prompt == "" {
			prompt = clean(params.Appearance)
		}
		filterRefs := func(refs []string, collection, key string) []string {
			valid, seen, filtered := map[string]bool{}, map[string]bool{}, []string{}
			for _, raw := range storyboard[collection].([]any) {
				if item, ok := raw.(map[string]any); ok {
					if value, ok := item[key].(string); ok {
						valid[value] = true
					}
				}
			}
			for _, ref := range refs {
				ref = strings.TrimSpace(ref)
				if valid[ref] && !seen[ref] {
					filtered = append(filtered, ref)
					seen[ref] = true
				}
			}
			return filtered
		}
		characterRefs := filterRefs(params.CharacterRefs, "characters", "ref_id")
		propRefs := filterRefs(params.PropRefs, "props", "ref_id")
		sceneID := ""
		for _, raw := range storyboard["scenes"].([]any) {
			if scene, ok := raw.(map[string]any); ok && scene["scene_id"] == strings.TrimSpace(params.SceneID) {
				sceneID = strings.TrimSpace(params.SceneID)
				break
			}
		}
		entity := map[string]any{idKey: entityID, "name": params.Name, "description": clean(params.Appearance)}
		if params.Kind == "characters" {
			entity["identity"] = clean(params.Identity)
			entity["gender"] = clean(params.Gender)
			entity["age"] = clean(params.Age)
		} else if params.Kind == "props" {
			entity["category"] = "手动添加"
			entity["narrative_function"] = clean(params.Appearance)
		} else if params.Kind == "scenes" {
			entity["character_refs"] = characterRefs
			entity["prop_refs"] = propRefs
		} else if params.Kind == "shots" {
			entity["start_frame_prompt"] = prompt
			entity["duration_sec"] = 5
			entity["transition_type"] = "B"
			entity["startframe_file"] = filepath.Join("shots", entityID, entityID+"_startframe.jpg")
			entity["character_refs"] = characterRefs
			entity["prop_refs"] = propRefs
			entity["scene_id"] = sceneID
		}
		storyboard[params.Kind] = append(existing, entity)
		if err := os.MkdirAll(filepath.Join(outputDir(id), directory), 0755); err != nil {
			http.Error(w, "cannot create entity directory", http.StatusInternalServerError)
			return
		}
		md := ""
		switch params.Kind {
		case "characters":
			md = fmt.Sprintf("# %s | %s\n\n## 基本信息\n- 姓名：%s\n- 性别：%s\n- 年龄：%s\n- 身份：%s\n\n## 外貌与人物设定\n%s\n\n## 定妆照 Prompt — 正面胸像\n\x60\x60\x60\n%s，正面胸像，电影棚拍光，85mm portrait lens，photorealistic，cinematic，8K\n\x60\x60\x60\n\n## 定妆照 Prompt — 45°侧面\n\x60\x60\x60\n%s，45度侧面胸像，电影感侧光，photorealistic，cinematic，8K\n\x60\x60\x60\n\n## 定妆照 Prompt — 全身\n\x60\x60\x60\n%s，全身立姿，完整展示服装与体态，photorealistic，cinematic，8K\n\x60\x60\x60\n", entityID, clean(params.Name), clean(params.Name), clean(params.Gender), clean(params.Age), clean(params.Identity), clean(params.Appearance), prompt, prompt, prompt)
		case "props":
			md = fmt.Sprintf("# %s | %s\n\n## 道具设定\n%s\n\n## 道具参考图 Prompt\n\x60\x60\x60\n%s，isolated product reference image，clean background，photorealistic，8K，1:1\n\x60\x60\x60\n", entityID, clean(params.Name), clean(params.Appearance), prompt)
		case "scenes":
			md = fmt.Sprintf("# %s | %s\n\n## 场景设定\n%s\n\n## 场景参考图 Prompt — 广角\n\x60\x60\x60\n%s，wide establishing shot，cinematic lighting，photorealistic，16:9\n\x60\x60\x60\n\n## 场景参考图 Prompt — 细节特写\n\x60\x60\x60\n%s，detail close-up，cinematic lighting，photorealistic，16:9\n\x60\x60\x60\n", entityID, clean(params.Name), clean(params.Appearance), prompt, prompt)
		case "shots":
			md = prompt
		}
		mdPath := filepath.Join(outputDir(id), directory, entityID+".md")
		if params.Kind == "shots" {
			if err := os.MkdirAll(filepath.Join(outputDir(id), directory, entityID), 0755); err != nil {
				http.Error(w, "cannot create shot directory", http.StatusInternalServerError)
				return
			}
			mdPath = filepath.Join(outputDir(id), directory, entityID, entityID+"_startframe.md")
		}
		if err := os.WriteFile(mdPath, []byte(md), 0644); err != nil {
			http.Error(w, "cannot save entity prompt", http.StatusInternalServerError)
			return
		}
		if params.Kind == "shots" {
			// Step 2 and Step 3 use deps.json to resolve linked visual assets.
			// A hand-created start frame has no such links, but still needs the
			// same file so it can be generated like every other shot.
			deps := map[string]any{
				"character_refs":     characterRefs,
				"character_md_files": []string{},
				"scene_id":           sceneID,
				"scene_md_file":      filepath.Join("scenes", sceneID+".md"),
				"prop_refs":          propRefs,
				"prop_md_files":      []string{},
				"startframe_md_file": filepath.Join("shots", entityID, entityID+"_startframe.md"),
			}
			depsData, err := json.MarshalIndent(deps, "", "  ")
			if err != nil {
				http.Error(w, "cannot encode shot dependencies", http.StatusInternalServerError)
				return
			}
			depsPath := filepath.Join(outputDir(id), directory, entityID, "deps.json")
			if err := os.WriteFile(depsPath, depsData, 0644); err != nil {
				http.Error(w, "cannot save shot dependencies", http.StatusInternalServerError)
				return
			}
		}
		if err := saveStoryboard(storyboard); err != nil {
			http.Error(w, "cannot save storyboard", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]any{"status": "created", "entity": entity})
		return
	}

	if len(parts) < 5 || (r.Method != http.MethodDelete && !(r.Method == http.MethodPost && len(parts) == 6 && parts[5] == "upload")) {
		http.Error(w, "unsupported entity operation", http.StatusBadRequest)
		return
	}
	kind, entityID := parts[3], parts[4]
	decodedEntityID, err := url.PathUnescape(entityID)
	if err != nil {
		http.Error(w, "invalid entity id", http.StatusBadRequest)
		return
	}
	entityID = decodedEntityID
	if (kind != "characters" && kind != "props" && kind != "scenes" && kind != "shots") || entityID != filepath.Base(entityID) || entityID == "." || entityID == "" {
		http.Error(w, "invalid entity", http.StatusBadRequest)
		return
	}
	if r.Method == http.MethodPost {
		if err := r.ParseMultipartForm(12 << 20); err != nil {
			http.Error(w, "invalid upload", http.StatusBadRequest)
			return
		}
		file, header, err := r.FormFile("file")
		if err != nil {
			http.Error(w, "missing image file", http.StatusBadRequest)
			return
		}
		defer file.Close()
		ext := strings.ToLower(filepath.Ext(header.Filename))
		if ext != ".jpg" && ext != ".jpeg" && ext != ".png" && ext != ".webp" {
			http.Error(w, "only jpg, png, and webp images are supported", http.StatusBadRequest)
			return
		}
		dir, name := "", ""
		switch kind {
		case "characters":
			dir, name = "characters", entityID+"_front"+ext
		case "props":
			dir, name = "props", entityID+"_reference"+ext
		case "scenes":
			dir, name = "scenes", entityID+"_wide"+ext
		case "shots":
			dir, name = filepath.Join("shots", entityID), entityID+"_startframe"+ext
		}
		if err := os.MkdirAll(filepath.Join(outputDir(id), dir), 0755); err != nil {
			http.Error(w, "cannot create asset directory", http.StatusInternalServerError)
			return
		}
		destination, err := os.Create(filepath.Join(outputDir(id), dir, name))
		if err != nil {
			http.Error(w, "cannot save image", http.StatusInternalServerError)
			return
		}
		defer destination.Close()
		if _, err := io.Copy(destination, io.LimitReader(file, 10<<20)); err != nil {
			http.Error(w, "cannot write image", http.StatusInternalServerError)
			return
		}
		markVisualAssetsComplete(id)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"status": "uploaded"})
		return
	}

	storyboard, err := loadStoryboard()
	if err != nil {
		http.Error(w, "storyboard.json not found", http.StatusConflict)
		return
	}
	collection, idKey := kind, "ref_id"
	if kind == "scenes" {
		idKey = "scene_id"
	}
	if kind == "shots" {
		collection, idKey = "shots", "full_shot_id"
	}
	items, _ := storyboard[collection].([]any)
	updated := make([]any, 0, len(items))
	deleted := false
	for _, item := range items {
		if object, ok := item.(map[string]any); ok && object[idKey] == entityID {
			deleted = true
			continue
		}
		updated = append(updated, item)
	}
	if !deleted {
		http.Error(w, "entity not found or already deleted", http.StatusNotFound)
		return
	}
	storyboard[collection] = updated
	if err := saveStoryboard(storyboard); err != nil {
		http.Error(w, "cannot save storyboard", http.StatusInternalServerError)
		return
	}
	patterns := map[string][]string{"characters": {"characters/" + entityID + "_*"}, "props": {"props/" + entityID + "_*"}, "scenes": {"scenes/" + entityID + "_*"}, "shots": {"shots/" + entityID + "/*"}}
	for _, pattern := range patterns[kind] {
		matches, _ := filepath.Glob(filepath.Join(outputDir(id), pattern))
		for _, match := range matches {
			os.RemoveAll(match)
		}
	}
	if kind == "characters" || kind == "props" || kind == "scenes" {
		os.Remove(filepath.Join(outputDir(id), kind, entityID+".md"))
	}
	vlog("pipeline %s deleted %s entity %s", id, kind, entityID)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"status": "deleted", "entity_id": entityID})
}

func handleRegenerateAsset(w http.ResponseWriter, r *http.Request) {
	// /pipelines/{id}/regenerate
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 2 {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}
	id := parts[1]

	mu.RLock()
	_, exists := pipelines[id]
	mu.RUnlock()
	if !exists {
		http.Error(w, "pipeline not found", http.StatusNotFound)
		return
	}

	var params struct {
		Characters      []string `json:"characters"`
		CharacterImages []string `json:"character_images"`
		Scenes          []string `json:"scenes"`
		SceneImages     []string `json:"scene_images"`
		Shots           []string `json:"shots"`
		PropImages      []string `json:"prop_images"`
	}
	if err := json.NewDecoder(r.Body).Decode(&params); err != nil {
		http.Error(w, fmt.Sprintf("bad request: %v", err), http.StatusBadRequest)
		return
	}

	// Validate step 2 has been run at least once
	dir := outputDir(id)
	if !fileExists(filepath.Join(dir, "storyboard.json")) {
		http.Error(w, "missing storyboard.json (run step 1 first)", http.StatusConflict)
		return
	}

	if len(params.Characters) == 0 && len(params.CharacterImages) == 0 && len(params.Scenes) == 0 && len(params.SceneImages) == 0 && len(params.Shots) == 0 && len(params.PropImages) == 0 {
		http.Error(w, "must specify at least one character, character_image, scene, scene_image, shot, or prop to regenerate", http.StatusBadRequest)
		return
	}

	// Build CLI args
	args := []string{"run", "python", "main.py", "assets", filepath.Join(dir, "storyboard.json")}
	for _, c := range params.Characters {
		args = append(args, "--regenerate-char", c)
	}
	for _, c := range params.CharacterImages {
		args = append(args, "--regenerate-char-image", c)
	}
	for _, s := range params.Scenes {
		args = append(args, "--regenerate-scene", s)
	}
	for _, s := range params.SceneImages {
		args = append(args, "--regenerate-scene-image", s)
	}
	for _, s := range params.Shots {
		args = append(args, "--regenerate-shot", s)
	}
	for _, p := range params.PropImages {
		args = append(args, "--regenerate-prop", p)
	}

	vlog("pipeline %s regenerate assets: uv %s", id, strings.Join(args, " "))

	// Run synchronously (single image should be fast)
	cmd := exec.Command("uv", args...)
	cmd.Dir = "."
	outDir := outputDir(id)
	dataDir := "."
	if v := os.Getenv("DATA_DIR"); v != "" {
		dataDir = v
	}
	cmd.Env = append(os.Environ(),
		fmt.Sprintf("DATA_DIR=%s", dataDir),
		fmt.Sprintf("OUTPUT_DIR=%s", outDir),
		fmt.Sprintf("PIPELINE_ID=%s", id),
	)
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
	out := strings.TrimSpace(buf.String())
	if err != nil {
		vlog("pipeline %s regenerate failed: %v output=%s", id, err, out)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]any{
			"status": "failed",
			"error":  fmt.Sprintf("regeneration failed: %v", err),
			"output": out,
		})
		return
	}

	vlog("pipeline %s regenerate done: %s", id, out)
	markVisualAssetsComplete(id)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status": "done",
		"output": out,
	})
}

func handleGenerateShotVideo(w http.ResponseWriter, r *http.Request) {
	// POST /pipelines/{id}/videos/{shot_id}/generate
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) != 5 || parts[0] != "pipelines" || parts[2] != "videos" || parts[4] != "generate" {
		http.Error(w, "invalid video generation path", http.StatusBadRequest)
		return
	}
	id, shotID := parts[1], parts[3]
	if shotID != filepath.Base(shotID) || shotID == "." || shotID == "" {
		http.Error(w, "invalid shot id", http.StatusBadRequest)
		return
	}

	mu.RLock()
	p, exists := pipelines[id]
	mu.RUnlock()
	if !exists {
		http.Error(w, "pipeline not found", http.StatusNotFound)
		return
	}
	dir := outputDir(id)
	for _, required := range []string{"storyboard.json", "manifest.json"} {
		if !fileExists(filepath.Join(dir, required)) {
			http.Error(w, fmt.Sprintf("missing dependency: %s", required), http.StatusConflict)
			return
		}
	}

	args := []string{
		"main.py", "videos", filepath.Join(dir, "storyboard.json"), filepath.Join(dir, "manifest.json"),
		"--shot", shotID,
	}
	runPythonAsync(p, args, 3, 0, 0, 0)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]any{"status": "running", "shot_id": shotID})
}

func handleOptimizeShotSkills(w http.ResponseWriter, r *http.Request) {
	// POST /pipelines/{id}/shots/{shot_id}/skills/optimize
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) != 6 || parts[0] != "pipelines" || parts[2] != "shots" || parts[4] != "skills" || parts[5] != "optimize" {
		http.Error(w, "invalid Skill optimization path", http.StatusBadRequest)
		return
	}
	id, shotID := parts[1], parts[3]
	if shotID != filepath.Base(shotID) || shotID == "." || shotID == "" {
		http.Error(w, "invalid shot id", http.StatusBadRequest)
		return
	}

	mu.RLock()
	p, exists := pipelines[id]
	mu.RUnlock()
	if !exists {
		http.Error(w, "pipeline not found", http.StatusNotFound)
		return
	}
	if p.Status == StatusRunning {
		http.Error(w, "wait for the active pipeline step to finish before optimizing a shot", http.StatusConflict)
		return
	}

	var params struct {
		Skills            []string `json:"skills"`
		CustomInstruction string   `json:"custom_instruction"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 16<<10)).Decode(&params); err != nil {
		http.Error(w, fmt.Sprintf("bad request: %v", err), http.StatusBadRequest)
		return
	}
	if len([]rune(strings.TrimSpace(params.CustomInstruction))) > 2000 {
		http.Error(w, "custom instruction must be at most 2000 characters", http.StatusBadRequest)
		return
	}
	if len(params.Skills) == 0 && strings.TrimSpace(params.CustomInstruction) == "" {
		http.Error(w, "select a Skill or enter a custom instruction", http.StatusBadRequest)
		return
	}

	dir := outputDir(id)
	storyboardPath := filepath.Join(dir, "storyboard.json")
	if !fileExists(storyboardPath) {
		http.Error(w, "missing storyboard.json (run step 1 first)", http.StatusConflict)
		return
	}

	args := []string{"run", "python", "main.py", "optimize-shot-skills", storyboardPath, "--shot", shotID}
	for _, skill := range params.Skills {
		args = append(args, "--skill", skill)
	}
	if strings.TrimSpace(params.CustomInstruction) != "" {
		args = append(args, "--instruction", params.CustomInstruction)
	}
	cmd := exec.Command("uv", args...)
	cmd.Dir = "."
	dataDir := "."
	if v := os.Getenv("DATA_DIR"); v != "" {
		dataDir = v
	}
	cmd.Env = append(os.Environ(),
		fmt.Sprintf("DATA_DIR=%s", dataDir),
		fmt.Sprintf("OUTPUT_DIR=%s", dir),
		fmt.Sprintf("PIPELINE_ID=%s", id),
	)

	var output bytes.Buffer
	logFile, err := os.OpenFile(logPath(id), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err == nil {
		defer logFile.Close()
		cmd.Stdout = io.MultiWriter(logFile, &output)
		cmd.Stderr = logFile
	} else {
		cmd.Stdout = &output
		cmd.Stderr = &output
	}

	vlog("pipeline %s optimizing shot %s with Skills: %s", id, shotID, strings.Join(params.Skills, ", "))
	if err := cmd.Run(); err != nil {
		message := strings.TrimSpace(output.String())
		vlog("pipeline %s Skill optimization failed: %v output=%s", id, err, message)
		http.Error(w, fmt.Sprintf("Skill optimization failed: %v", err), http.StatusInternalServerError)
		return
	}
	result := bytes.TrimSpace(output.Bytes())
	if !json.Valid(result) {
		vlog("pipeline %s Skill optimization returned invalid JSON: %s", id, string(result))
		http.Error(w, "Skill optimization returned invalid data", http.StatusInternalServerError)
		return
	}

	mu.Lock()
	p.UpdatedAt = time.Now()
	savePipelineState(p)
	mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	w.Write(result)
}

func serveHome(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	data, err := os.ReadFile("index.html")
	if err != nil {
		http.Error(w, "index page not found", http.StatusInternalServerError)
		return
	}
	scheme := "http"
	if r.TLS != nil || strings.EqualFold(strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Proto"), ",")[0]), "https") {
		scheme = "https"
	}
	origin := (&url.URL{Scheme: scheme, Host: r.Host}).String()
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(strings.ReplaceAll(string(data), "{{SITE_URL}}", origin)))
}

func serveManifest(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/manifest+json")
	http.ServeFile(w, r, "public/manifest.json")
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
	if !strings.HasPrefix(filepath.Clean(path), filepath.Clean(outputDir(pid))+string(filepath.Separator)) {
		http.Error(w, "artifact not found", http.StatusNotFound)
		return
	}

	// PUT — save/overwrite text artifact (.md, .json)
	if r.Method == http.MethodPut {
		ext := strings.ToLower(filepath.Ext(name))
		if ext != ".md" && ext != ".json" && ext != ".txt" {
			http.Error(w, "only .md, .json, .txt files can be saved", http.StatusBadRequest)
			return
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, fmt.Sprintf("cannot read body: %v", err), http.StatusBadRequest)
			return
		}
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			http.Error(w, fmt.Sprintf("cannot create dir: %v", err), http.StatusInternalServerError)
			return
		}
		if err := os.WriteFile(path, body, 0644); err != nil {
			http.Error(w, fmt.Sprintf("cannot write file: %v", err), http.StatusInternalServerError)
			return
		}
		vlog("pipeline %s artifact saved: %s (%d bytes)", pid, name, len(body))
		// Auto-reindex storyboard.json after saving any .md file
		if ext == ".md" {
			sbPath := filepath.Join(outputDir(pid), "storyboard.json")
			if fileExists(sbPath) {
				reindexCmd := exec.Command("uv", "run", "python", "main.py", "reindex", sbPath)
				reindexCmd.Dir = "."
				dataDir := "."
				if v := os.Getenv("DATA_DIR"); v != "" {
					dataDir = v
				}
				reindexCmd.Env = append(os.Environ(), fmt.Sprintf("DATA_DIR=%s", dataDir), fmt.Sprintf("OUTPUT_DIR=%s", outputDir(pid)))
				if err := reindexCmd.Run(); err != nil {
					vlog("pipeline %s auto-reindex failed after .md save: %v", pid, err)
				} else {
					vlog("pipeline %s auto-reindexed after .md save", pid)
				}
			}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"status": "saved", "path": name, "size": len(body)})
		return
	}

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
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
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
	mime.AddExtensionType(".css", "text/css")
	mime.AddExtensionType(".js", "application/javascript")
	mime.AddExtensionType(".jsx", "application/javascript")
	mime.AddExtensionType(".svg", "image/svg+xml")
	mux.HandleFunc("/", serveHome)
	mux.HandleFunc("/manifest.json", serveManifest)
	mux.HandleFunc("/health", handleHealth)
	mux.Handle("/js/", http.StripPrefix("/js/", http.FileServer(http.Dir("js"))))
	mux.Handle("/css/", http.StripPrefix("/css/", http.FileServer(http.Dir("css"))))
	mux.Handle("/assets/", http.StripPrefix("/assets/", http.FileServer(http.Dir("public/assets"))))
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
		if strings.HasSuffix(path, "/characters") && r.Method == http.MethodPost {
			handleAddCharacter(w, r)
			return
		}
		if strings.Contains(path, "/entities") {
			handleEntities(w, r)
			return
		}
		if strings.HasSuffix(path, "/summarize") {
			handleSummarize(w, r)
			return
		}
		if strings.HasSuffix(path, "/reindex") && r.Method == http.MethodPost {
			handleReindex(w, r)
			return
		}
		if strings.Contains(path, "/videos/") && strings.HasSuffix(path, "/generate") && r.Method == http.MethodPost {
			handleGenerateShotVideo(w, r)
			return
		}
		if strings.Contains(path, "/shots/") && strings.HasSuffix(path, "/skills/optimize") && r.Method == http.MethodPost {
			handleOptimizeShotSkills(w, r)
			return
		}
		if strings.HasSuffix(path, "/cancel") && r.Method == http.MethodPost {
			handleCancelStep(w, r)
			return
		}
		if strings.HasSuffix(path, "/regenerate") && r.Method == http.MethodPost {
			handleRegenerateAsset(w, r)
			return
		}
		if r.Method == http.MethodGet {
			handleGetPipeline(w, r)
		} else if r.Method == http.MethodPatch {
			handleUpdatePipeline(w, r)
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
