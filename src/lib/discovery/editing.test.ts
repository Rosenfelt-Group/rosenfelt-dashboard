import { describe, it, expect } from "vitest";
import { DiscoveryQuestionnaireDef } from "@/types";
import { addFields, moveAt, moveField, moveFieldToSection, removeField, uniqueSectionId, updateField } from "./editing";

const def: DiscoveryQuestionnaireDef = {
  version: "x", title: "t",
  sections: [
    { id: "a", title: "A", fields: [{ id: "a1", type: "text", label: "A1" }, { id: "a2", type: "text", label: "A2" }] },
    { id: "b", title: "B", fields: [{ id: "b1", type: "text", label: "B1" }] },
  ],
};
const ids = (d: DiscoveryQuestionnaireDef) => d.sections.map(s => `${s.id}:${s.fields.map(f => f.id).join(",")}`);

describe("editing helpers", () => {
  it("moveAt swaps neighbours and ignores the ends", () => {
    expect(moveAt([1, 2, 3], 1, -1)).toEqual([2, 1, 3]);
    expect(moveAt([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
    expect(moveAt([1, 2, 3], 2, 1)).toEqual([1, 2, 3]);
  });

  it("reorders within a section only", () => {
    expect(ids(moveField(def, "a2", -1))).toEqual(["a:a2,a1", "b:b1"]);
    expect(ids(moveField(def, "b1", -1))).toEqual(["a:a1,a2", "b:b1"]);
  });

  it("moves a field to the end of another section", () => {
    expect(ids(moveFieldToSection(def, "a1", "b"))).toEqual(["a:a2", "b:b1,a1"]);
    expect(moveFieldToSection(def, "a1", "missing")).toBe(def);
  });

  it("adds, updates and removes without duplicating keys", () => {
    const added = addFields(def, "b", [{ id: "a1", type: "text", label: "dup" }, { id: "new", type: "yes_no", label: "New" }]);
    expect(ids(added)).toEqual(["a:a1,a2", "b:b1,new"]);
    expect(updateField(added, "new", f => ({ ...f, label: "Renamed" })).sections[1].fields[1].label).toBe("Renamed");
    expect(ids(removeField(added, "a2"))).toEqual(["a:a1", "b:b1,new"]);
  });

  it("makes unique section ids", () => {
    expect(uniqueSectionId("Current tools", [])).toBe("current_tools");
    expect(uniqueSectionId("Current tools", ["current_tools", "current_tools_2"])).toBe("current_tools_3");
  });
});
