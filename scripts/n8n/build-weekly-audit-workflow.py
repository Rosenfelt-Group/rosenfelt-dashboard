# Adds the "Email delivery" section to the n8n workflow "Weekly Agent Audit" (live id uFg21tiyeldNB8n3).
# Usage: python3 scripts/n8n/build-weekly-audit-workflow.py backup.json [--test-copy] > wf.json
# Reads the current workflow JSON, inserts "Postmark: Weekly Stats" and "Query: Email Problems" before "Format Report",
# and pastes weekly-audit-email-section.js into the "Format Report" Code node. Output is idempotent on a workflow that
# already has them. The PUT body is name/nodes/connections/settings only (accepted settings keys).
# --test-copy: manual trigger instead of the schedule, nothing after "Format Report" (no Telegram/email/hash update/Log Writer).
# Contains no secrets: the Postmark token is read at run time from $env.POSTMARK_SERVER_TOKEN.
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = open(os.path.join(HERE, "weekly-audit-email-section.js")).read()
w = json.load(open(sys.argv[1]))
test_copy = "--test-copy" in sys.argv
nodes = {n["name"]: n for n in w["nodes"]}
SB_CRED = nodes["Query: Work Items"]["credentials"]
START = "const claudeResp = $input.first().json;"
HOOK = "const reportText = claudeResp.content?.[0]?.text || '⚠️ Audit report generation failed.';"
MARK = "// --- Email delivery section (generated from scripts/n8n/weekly-audit-email-section.js) ---"
END = "// --- end Email delivery section ---"

fr = nodes["Format Report"]
code = fr["parameters"]["jsCode"]
GLUE = """
const stats = $('Postmark: Weekly Stats').first().json;
const problemItems = $('Query: Email Problems').all().map(i => i.json);
const problems = problemItems.some(j => j.error) ? null : problemItems.filter(j => j.record_type);
const reportText = baseReportText + '\\n\\n' + formatEmailSection(stats, problems);
"""
BLOCK = MARK + "\n" + SRC + GLUE + END + "\n"
if MARK in code:
    # Regenerate: replace the previously pasted block (new ones end with END, the first version ended at the reportText line).
    i = code.index(MARK)
    tail = END + "\n" if END in code else "formatEmailSection(stats, problems);\n"
    j = code.index(tail, i) + len(tail)
    code = code[:i] + BLOCK + code[j:]
else:
    assert START in code and HOOK in code
    code = code.replace(START, "const claudeResp = $('Call Claude API').first().json;")
    code = code.replace(HOOK, HOOK.replace("const reportText", "const baseReportText"))
    code = code.replace("const auditDate = prev.auditDate;", "const auditDate = prev.auditDate;\n" + BLOCK, 1)
fr["parameters"]["jsCode"] = code

def http(name, x, params, **kw):
    n = {"parameters": params, "name": name, "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2,
         "position": [x, -520], "executeOnce": True, "alwaysOutputData": True, "continueOnFail": True}
    n.update(kw); return n
WIN = "$('Set Audit Window').first().json"
if "Postmark: Weekly Stats" not in nodes:
    w["nodes"].append(http("Postmark: Weekly Stats", 6320, {
        "method": "GET",
        "url": "={{ 'https://api.postmarkapp.com/stats/outbound?messagestream=outbound&fromdate=' + " + WIN + ".auditStart.substring(0, 10) + '&todate=' + " + WIN + ".auditEnd.substring(0, 10) }}",
        "sendHeaders": True,
        "headerParameters": {"parameters": [
            {"name": "X-Postmark-Server-Token", "value": "={{ $env.POSTMARK_SERVER_TOKEN }}"},
            {"name": "Accept", "value": "application/json"}]},
        "options": {}}))
    w["nodes"].append(http("Query: Email Problems", 6544, {
        "method": "GET",
        "url": "={{ 'https://ukfpmpxwdlpsjqbxreza.supabase.co/rest/v1/email_events?select=recipient,subject,tag,record_type,description,inactive,resolution,occurred_at&record_type=in.(Bounce,SpamComplaint)&occurred_at=gte.' + " + WIN + ".auditStartIso + '&occurred_at=lte.' + " + WIN + ".auditEnd.replace(' ', 'T') + 'Z&order=occurred_at.desc&limit=100' }}",
        "authentication": "predefinedCredentialType", "nodeCredentialType": "supabaseApi", "options": {}},
        credentials=SB_CRED))
    c = w["connections"]
    c["Call Claude API"] = {"main": [[{"node": "Postmark: Weekly Stats", "type": "main", "index": 0}]]}
    c["Postmark: Weekly Stats"] = {"main": [[{"node": "Query: Email Problems", "type": "main", "index": 0}]]}
    c["Query: Email Problems"] = {"main": [[{"node": "Format Report", "type": "main", "index": 0}]]}

if test_copy:
    keep = {"Format Report"}
    drop_after = {"Prepare Telegram Chunks", "Send Telegram", "Check Should Send Email", "Should Send Email?",
                  "Send Email", "Build Hash Update", "Update Stored Hashes", "POST to Log Writer"}
    w["nodes"] = [n for n in w["nodes"] if n["name"] not in drop_after]
    w["connections"] = {k: v for k, v in w["connections"].items() if k not in drop_after and k != "Format Report"}
    for n in w["nodes"]:
        if n["name"] == "Weekly Schedule":
            n["type"] = "n8n-nodes-base.manualTrigger"; n["typeVersion"] = 1; n["parameters"] = {}
    w["name"] = "TEMP verify weekly audit email section"

ok = ("executionOrder", "callerPolicy", "errorWorkflow")  # the keys the n8n API accepts on PUT/POST
body = {"name": w["name"], "nodes": w["nodes"], "connections": w["connections"],
        "settings": {k: v for k, v in w["settings"].items() if k in ok}}
if test_copy: body["settings"].pop("errorWorkflow", None)
json.dump(body, sys.stdout)
