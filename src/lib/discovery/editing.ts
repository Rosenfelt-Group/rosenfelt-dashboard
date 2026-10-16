import { DiscoveryFieldDef, DiscoveryQuestionnaireDef } from "@/types";
import { slugify } from "./snapshot";

// Pure list operations shared by the template editor and the draft editor.

/** Swap the item at `i` with its neighbour in direction `dir`; no-op at the ends. */
export function moveAt<T>(arr: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (i < 0 || i >= arr.length || j < 0 || j >= arr.length) return arr;
  const next = [...arr];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** A section id unique among `taken`, derived from its title. */
export function uniqueSectionId(title: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = slugify(title, 40);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

type Sec = DiscoveryQuestionnaireDef["sections"][number];

function mapSections(def: DiscoveryQuestionnaireDef, fn: (s: Sec) => Sec): DiscoveryQuestionnaireDef {
  return { ...def, sections: def.sections.map(fn) };
}

export function updateField(def: DiscoveryQuestionnaireDef, id: string, patch: (f: DiscoveryFieldDef) => DiscoveryFieldDef) {
  return mapSections(def, s => ({ ...s, fields: s.fields.map(f => f.id === id ? patch(f) : f) }));
}

export function removeField(def: DiscoveryQuestionnaireDef, id: string) {
  return mapSections(def, s => ({ ...s, fields: s.fields.filter(f => f.id !== id) }));
}

export function moveField(def: DiscoveryQuestionnaireDef, id: string, dir: -1 | 1) {
  return mapSections(def, s => {
    const i = s.fields.findIndex(f => f.id === id);
    return i === -1 ? s : { ...s, fields: moveAt(s.fields, i, dir) };
  });
}

/** Move a field to the end of another section. */
export function moveFieldToSection(def: DiscoveryQuestionnaireDef, id: string, sectionId: string) {
  const field = def.sections.flatMap(s => s.fields).find(f => f.id === id);
  if (!field || !def.sections.some(s => s.id === sectionId)) return def;
  return mapSections(removeField(def, id), s => s.id === sectionId ? { ...s, fields: [...s.fields, field] } : s);
}

export function addFields(def: DiscoveryQuestionnaireDef, sectionId: string, fields: DiscoveryFieldDef[]) {
  const have = new Set(def.sections.flatMap(s => s.fields.map(f => f.id)));
  const fresh = fields.filter(f => !have.has(f.id));
  return mapSections(def, s => s.id === sectionId ? { ...s, fields: [...s.fields, ...fresh] } : s);
}
