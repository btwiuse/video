package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAuthStorePersistsBase64PasswordAndOrganizationMembership(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	store, err := loadAuthStore(path)
	if err != nil {
		t.Fatal(err)
	}
	owner, err := store.register("owner@example.com", "secret")
	if err != nil {
		t.Fatal(err)
	}
	if owner.PasswordB64 != "b64:c2VjcmV0" {
		t.Fatalf("password = %q", owner.PasswordB64)
	}
	if _, ok := store.authenticate("owner@example.com", "secret"); !ok {
		t.Fatal("registered user could not authenticate")
	}
	organization, inviteCode, err := store.createOrganization(owner.ID, "Editors")
	if err != nil {
		t.Fatal(err)
	}
	member, err := store.register("member@example.com", "another")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.joinOrganization(member.ID, inviteCode); err != nil {
		t.Fatal(err)
	}
	if !store.isOrganizationMember(member.ID, organization.ID) {
		t.Fatal("joined user is not an organization member")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(data) == 0 {
		t.Fatal("config.yaml was not persisted")
	}
}

func TestPrivatePipelineAccessIsLimitedToOwnerOrOrganization(t *testing.T) {
	store, err := loadAuthStore(filepath.Join(t.TempDir(), "config.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	previous := accounts
	accounts = store
	t.Cleanup(func() { accounts = previous })
	owner, _ := store.register("owner@example.com", "secret")
	other, _ := store.register("other@example.com", "secret")
	pipeline := &Pipeline{OwnerID: owner.ID, Visibility: "private"}
	if !canAccessPipeline(pipeline, owner, true) {
		t.Fatal("owner cannot access private pipeline")
	}
	if canAccessPipeline(pipeline, other, false) || canAccessPipeline(pipeline, nil, false) {
		t.Fatal("private pipeline is visible outside its owner")
	}
	organization, inviteCode, err := store.createOrganization(owner.ID, "Team")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.joinOrganization(other.ID, inviteCode); err != nil {
		t.Fatal(err)
	}
	pipeline.OrganizationID = organization.ID
	if !canAccessPipeline(pipeline, other, true) {
		t.Fatal("organization member cannot access organization pipeline")
	}
	if !canAccessPipeline(&Pipeline{}, nil, false) {
		t.Fatal("legacy public pipeline is not visible to signed-out users")
	}
}
