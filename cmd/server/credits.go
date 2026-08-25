package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"
)

type ModelDefinition struct {
	ID             string `json:"id"`
	Kind           string `json:"kind"`
	Name           string `json:"name"`
	Provider       string `json:"provider"`
	ProviderModel  string `json:"provider_model,omitempty"`
	CreditsPerCall int    `json:"credits_per_call"`
}

type UsageEntry struct {
	ID             string    `yaml:"id" json:"id"`
	BillingScope   string    `yaml:"billing_scope" json:"billing_scope"`
	UserID         string    `yaml:"user_id" json:"user_id"`
	OrganizationID string    `yaml:"organization_id,omitempty" json:"organization_id,omitempty"`
	PipelineID     string    `yaml:"pipeline_id,omitempty" json:"pipeline_id,omitempty"`
	Operation      string    `yaml:"operation" json:"operation"`
	ResourceID     string    `yaml:"resource_id,omitempty" json:"resource_id,omitempty"`
	ModelID        string    `yaml:"model_id,omitempty" json:"model_id,omitempty"`
	ModelName      string    `yaml:"model_name,omitempty" json:"model_name,omitempty"`
	Credits        int       `yaml:"credits" json:"credits"`
	Status         string    `yaml:"status" json:"status"`
	CreatedAt      time.Time `yaml:"created_at" json:"created_at"`
	CompletedAt    time.Time `yaml:"completed_at,omitempty" json:"completed_at,omitempty"`
}

var modelCatalog = []ModelDefinition{
	// Default image model first (frontend preselects the first entry)
	{ID: "step-image-edit-2", Kind: "image", Name: "Step Image Edit 2", Provider: "stepfun", CreditsPerCall: 6},
	{ID: "seedream-5", Kind: "image", Name: "Seedream 5.0", Provider: "seedream", CreditsPerCall: 8},
	{ID: "flux-1.1-pro", Kind: "image", Name: "Flux 1.1 Pro", Provider: "flux", CreditsPerCall: 12},
	{ID: "flux-1.1-pro-ultra", Kind: "image", Name: "Flux 1.1 Pro Ultra", Provider: "flux-ultra", CreditsPerCall: 18},
	// Default video model first (frontend preselects the first entry)
	{ID: "tke-seedance-2-5-chaofen", Kind: "video", Name: "Seedance 2.5 Chaofen", Provider: "tokease", ProviderModel: "seedance2.5-chaofen", CreditsPerCall: 25},
	{ID: "tke-seedance-2-0", Kind: "video", Name: "Seedance 2.0", Provider: "tokease", ProviderModel: "seedance 2.0", CreditsPerCall: 240},
	{ID: "tke-seedance-2-0-chaofen", Kind: "video", Name: "Seedance 2.0 Chaofen", Provider: "tokease", ProviderModel: "seedance 2.0-chaofen", CreditsPerCall: 20},
	{ID: "tke-seedance-2-0-fast", Kind: "video", Name: "Seedance 2.0 Fast", Provider: "tokease", ProviderModel: "seedance2.0-fast", CreditsPerCall: 30},
	{ID: "tke-seedance-2-0-fast-kuanshen", Kind: "video", Name: "Seedance 2.0 Fast Kuanshen", Provider: "tokease", ProviderModel: "seedance2.0-fast-kuanshen", CreditsPerCall: 35},
	{ID: "tke-seedance-2-0-huoshan", Kind: "video", Name: "Seedance 2.0 Huoshan", Provider: "tokease", ProviderModel: "seedance2.0-huoshan", CreditsPerCall: 240},
	{ID: "tke-seedance-2-0-kuanshen", Kind: "video", Name: "Seedance 2.0 Kuanshen", Provider: "tokease", ProviderModel: "seedance2.0-kuanshen", CreditsPerCall: 40},
	{ID: "tke-seedance-2-0-mini", Kind: "video", Name: "Seedance 2.0 Mini", Provider: "tokease", ProviderModel: "seedance2.0-mini", CreditsPerCall: 15},
	{ID: "tke-seedance-2-0-mini-kuanshen", Kind: "video", Name: "Seedance 2.0 Mini Kuanshen", Provider: "tokease", ProviderModel: "seedance2.0-mini-kuanshen", CreditsPerCall: 25},
	{ID: "tke-seedance-2-5", Kind: "video", Name: "Seedance 2.5", Provider: "tokease", ProviderModel: "seedance2.5", CreditsPerCall: 40},
	{ID: "tke-seedance-2-5-huoshan", Kind: "video", Name: "Seedance 2.5 Huoshan", Provider: "tokease", ProviderModel: "seedance2.5-huoshan", CreditsPerCall: 40},
	{ID: "seedance-2-fast", Kind: "video", Name: "Seedance 2.0 Fast", Provider: "tokenvoke", ProviderModel: "doubao-seedance-2-0-fast-260128", CreditsPerCall: 30},
	{ID: "seedance-2-pro", Kind: "video", Name: "Seedance 2.0 Pro", Provider: "tokenvoke", ProviderModel: "doubao-seedance-2-0-pro-260215", CreditsPerCall: 50},
}

func modelByID(id, kind string) (ModelDefinition, bool) {
	for _, model := range modelCatalog {
		if model.ID == id && model.Kind == kind {
			return model, true
		}
	}
	return ModelDefinition{}, false
}

func defaultModel(kind string) ModelDefinition {
	for _, model := range modelCatalog {
		if model.Kind == kind {
			return model
		}
	}
	return ModelDefinition{}
}

func pipelineModel(p *Pipeline, kind string) ModelDefinition {
	id := p.ImageModelID
	if kind == "video" {
		id = p.VideoModelID
	}
	if model, ok := modelByID(id, kind); ok {
		return model
	}
	return defaultModel(kind)
}

func operationCredits(operation string, pipeline *Pipeline, units int) (int, ModelDefinition) {
	if units < 1 {
		units = 1
	}
	switch operation {
	case "storyboard":
		return 6, ModelDefinition{ID: "deepseek-storyboard", Name: "剧本分镜模型"}
	case "script_summary":
		return 1, ModelDefinition{ID: "deepseek-summary", Name: "剧本摘要模型"}
	case "shot_optimize":
		return 2, ModelDefinition{ID: "deepseek-optimize", Name: "镜头优化模型"}
	case "image_batch":
		model := pipelineModel(pipeline, "image")
		return model.CreditsPerCall * 10, model
	case "image_regenerate":
		model := pipelineModel(pipeline, "image")
		return model.CreditsPerCall * units, model
	case "video_batch":
		model := pipelineModel(pipeline, "video")
		return model.CreditsPerCall * 5, model
	case "video_shot":
		model := pipelineModel(pipeline, "video")
		return model.CreditsPerCall, model
	default:
		return 0, ModelDefinition{}
	}
}

func usageOperationLabel(operation string) string {
	labels := map[string]string{
		"storyboard":       "剧本分镜",
		"script_summary":   "剧本摘要",
		"shot_optimize":    "镜头优化",
		"image_batch":      "批量视觉素材",
		"image_regenerate": "视觉素材生成",
		"video_batch":      "批量视频生成",
		"video_shot":       "镜头视频生成",
	}
	return labels[operation]
}

func (s *authStore) recordUsage(user *User, pipeline *Pipeline, operation, resourceID string, units int) (*UsageEntry, error) {
	credits, model := operationCredits(operation, pipeline, units)
	if credits == 0 {
		return nil, nil
	}
	id, err := randomToken(12)
	if err != nil {
		return nil, err
	}
	entry := UsageEntry{
		ID:           "use_" + id,
		BillingScope: "user",
		UserID:       user.ID,
		PipelineID:   pipeline.ID,
		Operation:    operation,
		ResourceID:   resourceID,
		ModelID:      model.ID,
		ModelName:    model.Name,
		Credits:      credits,
		Status:       "recorded",
		CreatedAt:    time.Now().UTC(),
	}
	if pipeline.OrganizationID != "" {
		entry.BillingScope = "organization"
		entry.OrganizationID = pipeline.OrganizationID
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.config.Usage = append(s.config.Usage, entry)
	if err := s.saveLocked(); err != nil {
		return nil, err
	}
	return &entry, nil
}

func (s *authStore) completeUsage(id, status string) {
	if id == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for index := range s.config.Usage {
		if s.config.Usage[index].ID == id {
			s.config.Usage[index].Status = status
			s.config.Usage[index].CompletedAt = time.Now().UTC()
			if err := s.saveLocked(); err != nil {
				vlog("cannot save usage %s: %v", id, err)
			}
			return
		}
	}
}

func (s *authStore) usageFor(user *User, organizationID string, days int) []UsageEntry {
	if days < 1 || days > 30 {
		days = 30
	}
	cutoff := time.Now().AddDate(0, 0, -days)
	s.mu.RLock()
	defer s.mu.RUnlock()
	isMember := false
	if organizationID != "" {
		for _, membership := range s.config.Memberships {
			if membership.UserID == user.ID && membership.OrganizationID == organizationID {
				isMember = true
				break
			}
		}
	}
	entries := make([]UsageEntry, 0)
	for _, entry := range s.config.Usage {
		if entry.CreatedAt.Before(cutoff) {
			continue
		}
		if organizationID != "" {
			if entry.OrganizationID != organizationID || !isMember {
				continue
			}
		} else if entry.UserID != user.ID || entry.OrganizationID != "" {
			continue
		}
		entries = append(entries, entry)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].CreatedAt.After(entries[j].CreatedAt) })
	return entries
}

func makeUsageReport(entries []UsageEntry) map[string]any {
	byOperation := make(map[string]int)
	byModel := make(map[string]int)
	byDay := make(map[string]int)
	total := 0
	for _, entry := range entries {
		if entry.Status == "failed" {
			continue
		}
		total += entry.Credits
		byOperation[usageOperationLabel(entry.Operation)] += entry.Credits
		byModel[entry.ModelName] += entry.Credits
		byDay[entry.CreatedAt.Format("2006-01-02")] += entry.Credits
	}
	return map[string]any{
		"tracking_only": true,
		"total_credits": total,
		"by_operation":  byOperation,
		"by_model":      byModel,
		"by_day":        byDay,
		"entries":       entries,
	}
}

func handleModels(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	images := make([]ModelDefinition, 0)
	videos := make([]ModelDefinition, 0)
	for _, model := range modelCatalog {
		if model.Kind == "image" {
			images = append(images, model)
		} else if model.Kind == "video" {
			videos = append(videos, model)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"image_models": images, "video_models": videos})
}

func handleUsage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	user := requireUser(w, r)
	if user == nil {
		return
	}
	days := 30
	if raw := strings.TrimSpace(r.URL.Query().Get("days")); raw != "" {
		if _, err := fmt.Sscanf(raw, "%d", &days); err != nil {
			http.Error(w, "days must be a number", http.StatusBadRequest)
			return
		}
	}
	organizationID := strings.TrimSpace(r.URL.Query().Get("organization_id"))
	if organizationID != "" && !accounts.isOrganizationMember(user.ID, organizationID) {
		http.Error(w, "organization not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(makeUsageReport(accounts.usageFor(user, organizationID, days)))
}
