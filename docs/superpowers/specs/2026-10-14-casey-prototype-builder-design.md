# Casey Prototype Builder — Design

Date: 2026-10-14
Status: Draft for review
Parent: `2026-10-14-engagement-rooms-design.md` (Engagement Rooms). This spec makes Casey able to run the "Request prototype" loop end to end.

## Problem

Engagement Rooms Phase 1 shipped `publish_prototype_version` in Casey and a "Send to Casey" button in the dashboard. Casey cannot actually complete the loop:

1. **Persona.** Casey's system prompt says she is "NOT a builder, editor, or fixer", and her kickoff instructions (`tools/work_item_tools.py`, `_KICKOFF_INSTRUCTIONS`) tell her to bounce code and content work to Jordan. Her capability map sends `work_type = deliverable` to Avery.
2. **No way to produce a bundle.** She has no tool that writes files to a folder. A prototype is several files; her per-response output limit (`sonnet_max_tokens = 8192` in `agent_config`) truncates a large single tool call.
3. **No way to read a prior version**, although the brief tells her to iterate from one.
4. **Nothing starts her.** The request route creates the work item in the inbox; she only runs after someone dispatches it from the Work page, while the button says "Send to Casey".
5. **Her publish tool accepts any folder.** Casey has credentials mounted (`/app/credentials`); a prompt-injected run must not be able to publish arbitrary paths.

## Goals

- A prototype request starts Casey automatically and ends with a draft version in the dashboard (or a clear logged failure).
- Casey builds bundles through confined tools only; she can iterate from the previous version.
- Her audit behavior and prompt are unchanged for every other work item.
- Nothing she writes or reads can leave her scratch folder or the requested deliverable.

## Non-goals

- A new agent, a model change, or editing her `agent_prompts` row in the database.
- Binary assets (images, fonts): bundles are text only; images are inline SVG or data URIs.
- Replicating the tools to other agents (later).
- Concurrency controls across several simultaneous builds.

## Design

### 1. Recognizing a prototype work item
`buildPrototypeBrief` (dashboard) starts the description with the exact first line `ROOMS_PROTOTYPE_REQUEST v1` and contains a line `deliverable_id: <uuid>` (already present) — both in the trusted, dashboard-written part. Casey treats a work item as a prototype request only when `work_type == "deliverable"`, `source == "manual"`, and the description starts with that marker. Only dashboard users can create work items, so the marker is not prospect-controlled.

### 2. Scoped builder mode (no persona rewrite)
`_run_begin_work` gains one branch: if the item is a prototype request, it uses `PROTOTYPE_KICKOFF_INSTRUCTIONS` (new module `tools/prototype_kickoff.py`) instead of the audit instructions. The instructions state that, for this item only, the build restriction is lifted, but only through the bundle tools and `publish_prototype_version`; they describe the contract, the chunked-writing workflow, the iteration limit, and what to log. The DB prompt and `prompt.py` stay unchanged; `work_item_tools.py` (a file shared in copies across agents) gets a three-line hook only.
She must not call `report_cannot_complete` for these items (it would route to Avery); instructions say to log a `question` instead.

### 3. Bundle tools (`tools/bundle_tools.py`)
Scratch root: `/tmp/rooms-bundles/<work_item_id>/bundle/` (work item id validated as a UUID). All tools confine every path to that folder.
- `write_bundle_file(work_item_id, path, content, append=False)` — creates or overwrites (or appends to) a text file. Limits: 24,000 characters per call; extensions `html htm css js mjs json svg txt`; path segments must match `^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$` (same rule as the validator); at most 200 files and 10 MB total; never follows symlinks; never writes outside the folder.
- `list_bundle_files(work_item_id)`, `read_bundle_file(work_item_id, path)`, `delete_bundle_file(work_item_id, path)`.
- `fetch_prior_version(work_item_id, storage_prefix)` — copies a previous version's files from the `prototypes` bucket into the scratch folder (Storage list + get). The prefix must match `uuid/uuid/vN` **and its deliverable segment must equal the `deliverable_id` in this work item's description**; any other prefix is refused. Downloaded names are validated like writes.
- Scratch folders older than 24 hours are removed at kickoff.

### 4. Publishing
- `publish_prototype_version`: `bundle_path` becomes optional and defaults to the item's scratch bundle; any explicit path must resolve inside `/tmp/rooms-bundles/`. Everything else is as shipped.
- Validator: add a per-file cap of 4 MB (Vercel's response limit) and a **secret scan**: reject any file containing the value of an environment variable whose name contains KEY, SECRET, TOKEN or PASSWORD (length >= 16).

### 5. Dashboard
- `buildPrototypeBrief`: add the marker line and keep the `deliverable_id:` line format fixed; tests pin both.
- `POST /api/engagements/[id]/prototype-request`: after creating the work item, call `POST /api/work/{id}/dispatch` (`begin_work`, `suppress_notify: true`) forwarding the session cookie (the pattern `PATCH /api/work/[id]` already uses). Return `dispatched: boolean`. The UI says "Casey is working on it" or "Created, but dispatch failed — dispatch it from the Work page".

### 6. Limits and failure behavior
Casey's loop is capped at 50 iterations (`iteration_cap` null = default) with 8192 output tokens per response. A three or four screen prototype should fit using chunked writes; if she runs out, the existing handler logs a `question` for Brian. We observe real runs before changing `agent_config`.

## Security
- Confinement: no tool reads or writes outside the scratch folder, except the Storage reads in `fetch_prior_version`, which are bound to the item's own deliverable. Tested with traversal, absolute paths, symlinks, dotfiles, unusual extensions, oversize and over-count inputs.
- Publishing is confined to the scratch root, so a prompt-injected run cannot publish `/app/credentials` or other files.
- Prospect text still reaches Casey only as quoted data (unchanged); the tools take only validated identifiers.
- The secret scan blocks accidental exposure of the service key or the grant secret in a bundle.

## Testing
Unit tests per tool (confinement, limits, chunked write then publish round trip, prior-version isolation); a kickoff-selection test (marker present vs absent); dashboard tests for the brief marker and the dispatch call (mocked fetch); manual: one real request end to end in the acceptance run.

## Phasing
1. **Casey repo:** `bundle_tools.py`, `prototype_kickoff.py`, the kickoff hook, publish confinement, per-file cap and secret scan.
2. **Dashboard repo:** brief marker and auto-dispatch, UI wording.
3. Run the comprehensive test (Phase 1 Task 13).

## Decisions taken
| Question | Decision |
|---|---|
| Agent | Casey, in a scoped builder mode |
| Dispatch | Automatic on "Send to Casey" |
| Persona | Unchanged in the DB and `prompt.py`; builder instructions live in the kickoff |
| Assets | Text only |
| Iteration/token limits | Unchanged for now |
