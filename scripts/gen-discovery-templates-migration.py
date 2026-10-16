#!/usr/bin/env python3
"""Generate docs/migrations/2026-10-16_discovery_templates.sql.

The seed (question bank, "Standard Discovery", "Small Nonprofit" template and
the backfill of existing invites) is derived from the website repo's
questionnaire-v1.json, so the bank matches what prospects saw exactly.

Usage:
  python3 -I scripts/gen-discovery-templates-migration.py \
      ../website/mu-plugins/rosably-discovery/questionnaire-v1.json \
      > docs/migrations/2026-10-16_discovery_templates.sql
"""
import json
import sys
import uuid

NS = uuid.UUID("6f1c2a8e-3d7b-4b8e-9a51-2e0d5c7f4a10")  # fixed so re-runs produce identical SQL

# Field keys that live in the bank row's own columns; everything else goes in config.
CORE = {"id", "type", "label", "help", "required", "options", "showIf"}

STANDARD_INTRO = (
    "This helps me understand what you have in place today — tools, people, what you've tried — "
    "so our call can focus on solutions. It takes about 15 minutes and saves as you go, so you can "
    "stop and come back with the same link."
)

NONPROFIT_INTRO = (
    "A few questions about your team, the tools you use today, what you've already tried and what a "
    "useful daily summary would look like. It takes about 10 minutes and saves as you go, so you can "
    "stop and come back with the same link."
)

# Seed template exactly as specified. (key, section_id, type, label, options, config)
NONPROFIT_SECTIONS = [
    ("organization", "Organization"),
    ("current_tools", "Current tools"),
    ("past_attempts", "Past attempts"),
    ("meetings", "Meetings and scheduling"),
    ("command_center", "Command center"),
    ("data_ownership", "Data and ownership"),
    ("success", "Success"),
]
NONPROFIT_QUESTIONS = [
    ("snp_team_size", "organization", "text", "How many staff and volunteers would use this?", None, {}),
    ("snp_m365_plan", "organization", "single", "Which Microsoft 365 plan do you have?",
     ["Business Basic", "Business Standard", "Business Premium", "Nonprofit grant", "Not sure"], {}),
    ("snp_it_owner", "organization", "single", "Who handles IT today?",
     ["Nobody", "Staff member part-time", "Volunteer", "Outside provider"], {}),
    ("snp_tools", "current_tools", "multi", "Which tools do you use today?",
     ["Outlook", "Teams", "Zoom", "Calendly", "Microsoft Bookings", "Fathom", "Granola"], {"other": True}),
    ("snp_note_takers", "current_tools", "textarea", "Do you use more than one meeting note-taker? If so, why?", None, {}),
    ("snp_ai_tried", "past_attempts", "textarea", "Which AI or automation tools have you tried?", None, {}),
    ("snp_ai_didnt_work", "past_attempts", "textarea", "What specifically didn't work, and when did you stop using them?", None, {}),
    ("snp_meetings_per_week", "meetings", "single", "About how many external meetings per week?",
     ["Under 5", "5–15", "15+"], {}),
    ("snp_booking", "meetings", "textarea", "How do people book time with you today?", None, {}),
    ("snp_morning_screen", "command_center", "textarea",
     "If you could open one screen each morning, what three things should it tell you?", None, {}),
    ("snp_delivery", "command_center", "single", "Where would you rather receive it?",
     ["Email", "Teams", "Web dashboard", "Not sure"], {}),
    ("snp_sensitive_meetings", "data_ownership", "yes_no",
     "Do meetings include sensitive client or donor information?", None,
     {"followUpOn": "Yes", "followUpLabel": "What kind of information, and how is it handled today?"}),
    ("snp_owner", "data_ownership", "text", "Who would own and maintain this after setup?", None, {}),
    ("snp_success_90", "success", "textarea", "What would make this a success 90 days from now?", None, {}),
]


def uid(name):
    return str(uuid.uuid5(NS, name))


def lit(s):
    if s is None:
        return "null"
    return "'" + str(s).replace("'", "''") + "'"


def jlit(v):
    if v is None:
        return "null"
    return "$j$" + json.dumps(v, ensure_ascii=False, separators=(",", ":")) + "$j$::jsonb"


def arr(v):
    if not v:
        return "null"
    return "array[" + ",".join(lit(x) for x in v) + "]::text[]"


def main(path):
    v1 = json.load(open(path, encoding="utf-8"))
    out = []
    w = out.append

    w(DDL)

    # ---- Question bank: every v1 field -------------------------------------------------
    w("\n-- ── Seed: question bank from questionnaire-v1.json ─────────────────────────────")
    w("insert into crm.discovery_questions (id, key, label, help, section, type, options, required, config) values")
    rows = []
    for s in v1["sections"]:
        for f in s["fields"]:
            config = {k: v for k, v in f.items() if k not in CORE}
            rows.append("  (" + ", ".join([
                lit(uid("question:" + f["id"])), lit(f["id"]), lit(f["label"]), lit(f.get("help")),
                lit(s["title"]), lit(f["type"]), jlit(f.get("options")), "true" if f.get("required") else "false",
                jlit(config),
            ]) + ")")
    for key, sec, typ, label, options, config in NONPROFIT_QUESTIONS:
        title = dict(NONPROFIT_SECTIONS)[sec]
        rows.append("  (" + ", ".join([
            lit(uid("question:" + key)), lit(key), lit(label), "null", lit(title), lit(typ),
            jlit(options), "false", jlit(config),
        ]) + ")")
    w(",\n".join(rows) + ";")

    # ---- Standard Discovery ---------------------------------------------------------
    std = uid("template:standard")
    std_sections = [{k: s[k] for k in ("id", "title", "intro") if k in s} for s in v1["sections"]]
    w("\n-- ── Seed: \"Standard Discovery\" (v1, same order, project-type modules and showIf kept) ──")
    w("insert into crm.discovery_templates (id, name, description, intro_text, estimated_minutes, sections, is_default) values")
    w(f"  ({lit(std)}, 'Standard Discovery', 'The original v1 questionnaire. Workflow sections depend on the project type.', "
      f"{lit(STANDARD_INTRO)}, {int(v1.get('estimated_minutes', 15))}, {jlit(std_sections)}, true);")
    w("insert into crm.discovery_template_items (template_id, question_id, position, section_id, project_types, show_if) values")
    rows, pos = [], 0
    for s in v1["sections"]:
        for f in s["fields"]:
            pos += 1
            rows.append(f"  ({lit(std)}, {lit(uid('question:' + f['id']))}, {pos}, {lit(s['id'])}, "
                        f"{arr(s.get('modules'))}, {jlit(f.get('showIf'))})")
    w(",\n".join(rows) + ";")

    # ---- Small Nonprofit template ---------------------------------------------------
    snp = uid("template:small-nonprofit")
    w("\n-- ── Seed: \"Small Nonprofit: Productivity & Integration\" ──────────────────────────")
    w("insert into crm.discovery_templates (id, name, description, intro_text, estimated_minutes, sections) values")
    w(f"  ({lit(snp)}, 'Small Nonprofit: Productivity & Integration', "
      f"'Microsoft 365, meetings and scheduling, and a daily command center for small nonprofits.', "
      f"{lit(NONPROFIT_INTRO)}, 10, {jlit([{'id': i, 'title': t} for i, t in NONPROFIT_SECTIONS])});")
    w("insert into crm.discovery_template_items (template_id, question_id, position, section_id) values")
    w(",\n".join(f"  ({lit(snp)}, {lit(uid('question:' + q[0]))}, {i + 1}, {lit(q[1])})"
                 for i, q in enumerate(NONPROFIT_QUESTIONS)) + ";")

    # ---- Backfill existing invites ----------------------------------------------------
    w("\n-- ── The v1 definition, frozen onto invites that were created without a snapshot ─────")
    w("-- Used by the backfill below and by the insert trigger, so a dashboard deploy that")
    w("-- predates templates keeps working between this migration and the dashboard merge.")
    w("create or replace function crm.discovery_v1_definition() returns jsonb")
    w("language sql immutable set search_path = '' as $f$")
    w(f"  select {jlit(v1)}")
    w("$f$;")
    w("revoke all on function crm.discovery_v1_definition() from public, anon, authenticated;")
    w("grant execute on function crm.discovery_v1_definition() to service_role;")
    w("\n-- ── Data migration: freeze the v1 definition onto every existing invite ─────────────")
    w("-- Sections keep their `modules`; renderers still filter them by the invite's project type.")
    w("update crm.discovery_invites")
    w("   set questionnaire_snapshot = coalesce(questionnaire_snapshot, crm.discovery_v1_definition()),")
    w(f"       template_id = coalesce(template_id, {lit(std)})")
    w(" where questionnaire_version = 'v1';")
    w(POST.replace("__STD__", std))
    sys.stdout.write("\n".join(out) + "\n")


DDL = """-- Discovery templates: question bank, templates, per-invite snapshots.
-- Generated by scripts/gen-discovery-templates-migration.py from website
-- mu-plugins/rosably-discovery/questionnaire-v1.json. Edit the script, not this file.
--
-- Access model unchanged from 2026-10-14_crm_discovery.sql: RLS on with no
-- policies, so only the service role (dashboard API routes, the rosably.com
-- mu-plugin) can read or write. The public form reaches its own invite only,
-- through the token check in rosably-discovery.php; the questions it renders
-- come from that invite's questionnaire_snapshot, never from these tables.

create table crm.discovery_questions (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique check (key ~ '^[a-z][a-z0-9_]{1,62}$'),  -- answer id in responses
  label       text not null check (length(label) between 1 and 500),
  help        text,
  section     text not null default 'General',
  type        text not null check (type in ('text','textarea','single','multi','scale','yes_no','email','tool_rows')),
  options     jsonb check (options is null or jsonb_typeof(options) = 'array'),
  required    boolean not null default false,
  -- Type-specific settings: other, placeholder, max, prefill, columns, min_rows,
  -- min/max/minLabel/maxLabel (scale), followUpOn/followUpLabel (yes_no).
  config      jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table crm.discovery_templates (
  id                uuid primary key default gen_random_uuid(),
  name              text not null unique check (length(name) between 1 and 200),
  description       text,
  intro_text        text,
  estimated_minutes integer check (estimated_minutes between 1 and 120),
  -- Ordered section definitions: [{id, title, intro?}]
  sections          jsonb not null default '[]'::jsonb check (jsonb_typeof(sections) = 'array'),
  is_default        boolean not null default false,
  archived_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index discovery_templates_one_default on crm.discovery_templates(is_default) where is_default;

create table crm.discovery_template_items (
  id            uuid primary key default gen_random_uuid(),
  template_id   uuid not null references crm.discovery_templates(id) on delete cascade,
  question_id   uuid not null references crm.discovery_questions(id) on delete restrict,
  position      integer not null,
  section_id    text not null,
  required      boolean,          -- null = use the question's own flag
  project_types text[],           -- null = every project type
  show_if       jsonb,            -- {field, in?|notIn?}; reserved for Phase 2 branching UI
  unique (template_id, position),
  unique (template_id, question_id)
);
create index discovery_template_items_question_idx on crm.discovery_template_items(question_id);

alter table crm.discovery_invites
  add column template_id            uuid references crm.discovery_templates(id) on delete set null,
  add column questionnaire_snapshot jsonb;
alter table crm.discovery_invites alter column sent_at drop not null;
alter table crm.discovery_invites drop constraint discovery_invites_status_check;
alter table crm.discovery_invites add constraint discovery_invites_status_check
  check (status in ('draft','sent','opened','in_progress','submitted','archived'));

create trigger set_updated_at before update on crm.discovery_questions
  for each row execute function crm.set_updated_at();
create trigger set_updated_at before update on crm.discovery_templates
  for each row execute function crm.set_updated_at();

alter table crm.discovery_questions      enable row level security;
alter table crm.discovery_templates      enable row level security;
alter table crm.discovery_template_items enable row level security;
grant all on crm.discovery_questions, crm.discovery_templates, crm.discovery_template_items to service_role;
revoke all on crm.discovery_questions, crm.discovery_templates, crm.discovery_template_items from anon, authenticated;"""

POST = """
-- ── Freeze: snapshot required once sent, and immutable after that ────────────────
alter table crm.discovery_invites add constraint discovery_invites_snapshot_when_sent
  check (status = 'draft' or questionnaire_snapshot is not null);

create or replace function crm.discovery_invites_freeze() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status <> 'draft' and new.status = 'draft' then
    raise exception 'discovery invite % has been sent and cannot return to draft', old.id;
  end if;
  if old.status <> 'draft' and new.questionnaire_snapshot is distinct from old.questionnaire_snapshot then
    raise exception 'discovery invite % has been sent; its questionnaire is frozen', old.id;
  end if;
  return new;
end $$;
revoke all on function crm.discovery_invites_freeze() from public, anon, authenticated;

create trigger discovery_invites_freeze before update on crm.discovery_invites
  for each row execute function crm.discovery_invites_freeze();

-- Invites inserted as sent without a snapshot (the pre-templates dashboard) get v1.
create or replace function crm.discovery_invites_default_snapshot() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status <> 'draft' and new.questionnaire_snapshot is null and new.questionnaire_version = 'v1' then
    new.questionnaire_snapshot := crm.discovery_v1_definition();
    new.template_id := coalesce(new.template_id, '__STD__'::uuid);
  end if;
  return new;
end $$;
revoke all on function crm.discovery_invites_default_snapshot() from public, anon, authenticated;

create trigger discovery_invites_default_snapshot before insert on crm.discovery_invites
  for each row execute function crm.discovery_invites_default_snapshot();

-- ── Atomic template save: metadata + full ordered item list in one transaction ──────
-- p_items: [{question_id, section_id, required?, project_types?, show_if?}] in display order.
create or replace function crm.discovery_template_save(p_template uuid, p_fields jsonb, p_items jsonb)
returns void language plpgsql set search_path = '' as $$
begin
  if jsonb_typeof(p_items) <> 'array' then raise exception 'items must be an array'; end if;
  update crm.discovery_templates set
    name              = coalesce(p_fields->>'name', name),
    description       = case when p_fields ? 'description' then p_fields->>'description' else description end,
    intro_text        = case when p_fields ? 'intro_text' then p_fields->>'intro_text' else intro_text end,
    estimated_minutes = case when p_fields ? 'estimated_minutes' then (p_fields->>'estimated_minutes')::int else estimated_minutes end,
    sections          = coalesce(p_fields->'sections', sections)
  where id = p_template;
  if not found then raise exception 'template % not found', p_template using errcode = 'P0002'; end if;
  delete from crm.discovery_template_items where template_id = p_template;
  insert into crm.discovery_template_items (template_id, question_id, position, section_id, required, project_types, show_if)
  select p_template,
         (e->>'question_id')::uuid,
         ord::int,
         e->>'section_id',
         (e->>'required')::boolean,
         case when jsonb_typeof(e->'project_types') = 'array' and jsonb_array_length(e->'project_types') > 0
              then array(select jsonb_array_elements_text(e->'project_types')) end,
         case when jsonb_typeof(e->'show_if') = 'object' then e->'show_if' end
    from jsonb_array_elements(p_items) with ordinality as t(e, ord);
end $$;
revoke all on function crm.discovery_template_save(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function crm.discovery_template_save(uuid, jsonb, jsonb) to service_role;"""

if __name__ == "__main__":
    main(sys.argv[1])
