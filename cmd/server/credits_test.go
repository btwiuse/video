package main

import (
	"path/filepath"
	"testing"
)

func TestUsageUsesSelectedModelAndOrganizationScope(t *testing.T) {
	store, err := loadAuthStore(filepath.Join(t.TempDir(), "config.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	owner, err := store.register("owner@example.com", "secret")
	if err != nil {
		t.Fatal(err)
	}
	member, err := store.register("member@example.com", "secret")
	if err != nil {
		t.Fatal(err)
	}
	organization, inviteCode, err := store.createOrganization(owner.ID, "Editors")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.joinOrganization(member.ID, inviteCode); err != nil {
		t.Fatal(err)
	}
	pipeline := &Pipeline{ID: "project-1", OwnerID: owner.ID, OrganizationID: organization.ID, ImageModelID: "flux-1.1-pro-ultra", VideoModelID: "seedance-2-pro"}
	entry, err := store.recordUsage(owner, pipeline, "image_regenerate", "SC01", 2)
	if err != nil {
		t.Fatal(err)
	}
	if entry.BillingScope != "organization" || entry.OrganizationID != organization.ID {
		t.Fatalf("entry has wrong organization scope: %#v", entry)
	}
	if entry.ModelID != "flux-1.1-pro-ultra" || entry.Credits != 36 {
		t.Fatalf("unexpected image usage: %#v", entry)
	}
	if entries := store.usageFor(member, organization.ID, 30); len(entries) != 1 || entries[0].ID != entry.ID {
		t.Fatalf("organization member cannot see organization usage: %#v", entries)
	}
	if entries := store.usageFor(member, "", 30); len(entries) != 0 {
		t.Fatalf("organization usage leaked into personal usage: %#v", entries)
	}
}

func TestUsageReportExcludesFailedCallsFromTotals(t *testing.T) {
	pipeline := &Pipeline{ImageModelID: "seedream-5"}
	completedCredits, _ := operationCredits("image_regenerate", pipeline, 1)
	report := makeUsageReport([]UsageEntry{
		{Operation: "image_regenerate", ModelName: "Seedream 5.0", Credits: completedCredits, Status: "completed"},
		{Operation: "image_regenerate", ModelName: "Seedream 5.0", Credits: completedCredits, Status: "failed"},
	})
	if report["total_credits"] != completedCredits {
		t.Fatalf("total credits = %#v, want %d", report["total_credits"], completedCredits)
	}
}
