import { describe, expect, it } from "vitest";
import { hasPermission, MANAGE_PERMISSIONS, PERMISSION_LABELS } from "./permissions";

describe("hasPermission", () => {
  it("grants admin every permission, even ones missing from an older session", () => {
    expect(hasPermission({ role: "admin", permissions: ["view_overview"] }, "manage_intelligence")).toBe(true);
    expect(hasPermission({ role: "admin", permissions: [] }, "view_intelligence")).toBe(true);
  });

  it("requires other roles to hold the permission explicitly", () => {
    expect(hasPermission({ role: "viewer", permissions: ["view_intelligence"] }, "view_intelligence")).toBe(true);
    expect(hasPermission({ role: "viewer", permissions: ["view_intelligence"] }, "manage_intelligence")).toBe(false);
    expect(hasPermission({ role: "editor", permissions: [] }, "view_overview")).toBe(false);
  });

  it("handles missing permissions", () => {
    expect(hasPermission({ role: "viewer", permissions: null }, "view_overview")).toBe(false);
    expect(hasPermission({}, "view_overview")).toBe(false);
  });
});

describe("manage_intelligence", () => {
  it("is a manage permission with a label", () => {
    expect(MANAGE_PERMISSIONS).toContain("manage_intelligence");
    expect(PERMISSION_LABELS.manage_intelligence).toBe("Edit Agent Prompts & Memory");
  });
});

describe("manage_email", () => {
  it("is a manage permission with a label", () => {
    expect(MANAGE_PERMISSIONS).toContain("manage_email");
    expect(PERMISSION_LABELS.manage_email).toBe("Manage Email");
  });
  it("is held by admin but not by a viewer", () => {
    expect(hasPermission({ role: "admin", permissions: [] }, "manage_email")).toBe(true);
    expect(hasPermission({ role: "viewer", permissions: ["view_overview"] }, "manage_email")).toBe(false);
  });
});
