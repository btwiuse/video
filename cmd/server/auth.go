package main

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"gopkg.in/yaml.v3"
)

const sessionCookieName = "reelix_session"

type User struct {
	ID          string    `yaml:"id" json:"id"`
	Email       string    `yaml:"email" json:"email"`
	PasswordB64 string    `yaml:"password_b64" json:"-"`
	CreatedAt   time.Time `yaml:"created_at" json:"created_at"`
}

type Organization struct {
	ID            string    `yaml:"id" json:"id"`
	Name          string    `yaml:"name" json:"name"`
	InviteCodeB64 string    `yaml:"invite_code_b64" json:"-"`
	CreatedBy     string    `yaml:"created_by" json:"created_by"`
	CreatedAt     time.Time `yaml:"created_at" json:"created_at"`
}

type OrganizationMembership struct {
	OrganizationID string    `yaml:"organization_id" json:"organization_id"`
	UserID         string    `yaml:"user_id" json:"user_id"`
	JoinedAt       time.Time `yaml:"joined_at" json:"joined_at"`
}

type authConfig struct {
	Version       int                      `yaml:"version"`
	SessionSecret string                   `yaml:"session_secret"`
	Users         []User                   `yaml:"users"`
	Organizations []Organization           `yaml:"organizations"`
	Memberships   []OrganizationMembership `yaml:"memberships"`
}

type authStore struct {
	mu     sync.RWMutex
	path   string
	config authConfig
}

type authContextKey struct{}

func loadAuthStore(path string) (*authStore, error) {
	store := &authStore{path: path}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		secret, err := randomToken(32)
		if err != nil {
			return nil, err
		}
		store.config = authConfig{Version: 1, SessionSecret: secret, Users: []User{}, Organizations: []Organization{}, Memberships: []OrganizationMembership{}}
		if err := store.saveLocked(); err != nil {
			return nil, err
		}
		return store, nil
	}
	if err != nil {
		return nil, err
	}
	if err := yaml.Unmarshal(data, &store.config); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	if store.config.SessionSecret == "" {
		secret, err := randomToken(32)
		if err != nil {
			return nil, err
		}
		store.config.SessionSecret = secret
		if err := store.saveLocked(); err != nil {
			return nil, err
		}
	}
	return store, nil
}

func (s *authStore) saveLocked() error {
	if dir := filepath.Dir(s.path); dir != "." && dir != "" {
		if err := os.MkdirAll(dir, 0700); err != nil {
			return err
		}
	}
	data, err := yaml.Marshal(s.config)
	if err != nil {
		return err
	}
	temporary := s.path + ".tmp"
	if err := os.WriteFile(temporary, data, 0600); err != nil {
		return err
	}
	return os.Rename(temporary, s.path)
}

func randomToken(bytes int) (string, error) {
	data := make([]byte, bytes)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return hex.EncodeToString(data), nil
}

func encodePassword(password string) string {
	return "b64:" + base64.StdEncoding.EncodeToString([]byte(password))
}

func (s *authStore) register(email, password string) (*User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if !strings.Contains(email, "@") || len(email) > 320 {
		return nil, errors.New("enter a valid email address")
	}
	if len(password) == 0 || len(password) > 256 {
		return nil, errors.New("password must contain 1 to 256 characters")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, existing := range s.config.Users {
		if existing.Email == email {
			return nil, errors.New("email is already registered")
		}
	}
	id, err := randomToken(12)
	if err != nil {
		return nil, err
	}
	user := User{ID: "usr_" + id, Email: email, PasswordB64: encodePassword(password), CreatedAt: time.Now().UTC()}
	s.config.Users = append(s.config.Users, user)
	if err := s.saveLocked(); err != nil {
		return nil, err
	}
	return &user, nil
}

func (s *authStore) authenticate(email, password string) (*User, bool) {
	email = strings.ToLower(strings.TrimSpace(email))
	expected := encodePassword(password)
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, user := range s.config.Users {
		if user.Email == email && hmac.Equal([]byte(user.PasswordB64), []byte(expected)) {
			copy := user
			return &copy, true
		}
	}
	return nil, false
}

func (s *authStore) user(id string) *User {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, user := range s.config.Users {
		if user.ID == id {
			copy := user
			return &copy
		}
	}
	return nil
}

func (s *authStore) signSession(userID string, expires time.Time) string {
	payload := userID + "|" + fmt.Sprint(expires.Unix())
	s.mu.RLock()
	secret := s.config.SessionSecret
	s.mu.RUnlock()
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString([]byte(payload + "|" + hex.EncodeToString(mac.Sum(nil))))
}

func (s *authStore) sessionUser(cookie string) *User {
	data, err := base64.RawURLEncoding.DecodeString(cookie)
	if err != nil {
		return nil
	}
	parts := strings.Split(string(data), "|")
	if len(parts) != 3 {
		return nil
	}
	unix, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || time.Now().Unix() > unix {
		return nil
	}
	payload := parts[0] + "|" + parts[1]
	s.mu.RLock()
	secret := s.config.SessionSecret
	s.mu.RUnlock()
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payload))
	expected, err := hex.DecodeString(parts[2])
	if err != nil || !hmac.Equal(mac.Sum(nil), expected) {
		return nil
	}
	return s.user(parts[0])
}

func (s *authStore) createOrganization(userID, name string) (*Organization, string, error) {
	name = strings.TrimSpace(name)
	if name == "" || len([]rune(name)) > 80 {
		return nil, "", errors.New("organization name must contain 1 to 80 characters")
	}
	id, err := randomToken(10)
	if err != nil {
		return nil, "", err
	}
	inviteCode, err := randomToken(18)
	if err != nil {
		return nil, "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	organization := Organization{ID: "org_" + id, Name: name, InviteCodeB64: encodePassword(inviteCode), CreatedBy: userID, CreatedAt: time.Now().UTC()}
	s.config.Organizations = append(s.config.Organizations, organization)
	s.config.Memberships = append(s.config.Memberships, OrganizationMembership{OrganizationID: organization.ID, UserID: userID, JoinedAt: time.Now().UTC()})
	if err := s.saveLocked(); err != nil {
		return nil, "", err
	}
	return &organization, inviteCode, nil
}

func (s *authStore) joinOrganization(userID, inviteCode string) (*Organization, error) {
	expected := encodePassword(strings.TrimSpace(inviteCode))
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, organization := range s.config.Organizations {
		if hmac.Equal([]byte(organization.InviteCodeB64), []byte(expected)) {
			for _, membership := range s.config.Memberships {
				if membership.OrganizationID == organization.ID && membership.UserID == userID {
					copy := organization
					return &copy, nil
				}
			}
			s.config.Memberships = append(s.config.Memberships, OrganizationMembership{OrganizationID: organization.ID, UserID: userID, JoinedAt: time.Now().UTC()})
			if err := s.saveLocked(); err != nil {
				return nil, err
			}
			copy := organization
			return &copy, nil
		}
	}
	return nil, errors.New("organization invitation code is invalid")
}

func (s *authStore) organizationsFor(userID string) []Organization {
	s.mu.RLock()
	defer s.mu.RUnlock()
	memberIDs := make(map[string]bool)
	for _, membership := range s.config.Memberships {
		if membership.UserID == userID {
			memberIDs[membership.OrganizationID] = true
		}
	}
	organizations := make([]Organization, 0)
	for _, organization := range s.config.Organizations {
		if memberIDs[organization.ID] {
			copy := organization
			copy.InviteCodeB64 = ""
			organizations = append(organizations, copy)
		}
	}
	return organizations
}

func (s *authStore) isOrganizationMember(userID, organizationID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, membership := range s.config.Memberships {
		if membership.UserID == userID && membership.OrganizationID == organizationID {
			return true
		}
	}
	return false
}

func currentUser(r *http.Request) *User {
	user, _ := r.Context().Value(authContextKey{}).(*User)
	return user
}

func authMiddleware(store *authStore, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if cookie, err := r.Cookie(sessionCookieName); err == nil {
			if user := store.sessionUser(cookie.Value); user != nil {
				r = r.WithContext(context.WithValue(r.Context(), authContextKey{}, user))
			}
		}
		next.ServeHTTP(w, r)
	})
}

func requireUser(w http.ResponseWriter, r *http.Request) *User {
	user := currentUser(r)
	if user == nil {
		http.Error(w, "authentication required", http.StatusUnauthorized)
	}
	return user
}

func writeUserJSON(w http.ResponseWriter, user *User) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"user": user})
}

func handleRegister(store *authStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var input struct {
			Email    string `json:"email"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&input); err != nil {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		user, err := store.register(input.Email, input.Password)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		setSessionCookie(w, store, user.ID)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]any{"user": user})
	}
}

func handleLogin(store *authStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var input struct {
			Email    string `json:"email"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&input); err != nil {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		user, ok := store.authenticate(input.Email, input.Password)
		if !ok {
			http.Error(w, "invalid email or password", http.StatusUnauthorized)
			return
		}
		setSessionCookie(w, store, user.ID)
		writeUserJSON(w, user)
	}
}

func setSessionCookie(w http.ResponseWriter, store *authStore, userID string) {
	expires := time.Now().Add(7 * 24 * time.Hour)
	http.SetCookie(w, &http.Cookie{Name: sessionCookieName, Value: store.signSession(userID, expires), Path: "/", Expires: expires, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: false})
}

func handleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookieName, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode})
	w.WriteHeader(http.StatusNoContent)
}

func handleMe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	user := currentUser(r)
	if user == nil {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"user": nil})
		return
	}
	writeUserJSON(w, user)
}

func handleOrganizations(store *authStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := requireUser(w, r)
		if user == nil {
			return
		}
		switch r.Method {
		case http.MethodGet:
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"organizations": store.organizationsFor(user.ID)})
		case http.MethodPost:
			var input struct {
				Name string `json:"name"`
			}
			if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&input); err != nil {
				http.Error(w, "invalid JSON body", http.StatusBadRequest)
				return
			}
			organization, inviteCode, err := store.createOrganization(user.ID, input.Name)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{"organization": organization, "invite_code": inviteCode})
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	}
}

func handleJoinOrganization(store *authStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		user := requireUser(w, r)
		if user == nil {
			return
		}
		var input struct {
			InviteCode string `json:"invite_code"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&input); err != nil {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		organization, err := store.joinOrganization(user.ID, input.InviteCode)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"organization": organization})
	}
}
