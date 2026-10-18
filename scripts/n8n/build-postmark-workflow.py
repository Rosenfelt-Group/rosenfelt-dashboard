# Builds the "Postmark Events" n8n workflow JSON (live id MnNSI2qF4ENMkKn9) and prints it to stdout.
# Code node bodies are the whole postmark-events.code.js plus one entry-point call.
# Contains no secrets: every key/token is read by n8n at run time from $env.
# Usage: python3 scripts/n8n/build-postmark-workflow.py > wf.json, then PUT name/nodes/connections/settings
# to the n8n API (/api/v1/workflows/MnNSI2qF4ENMkKn9) and confirm it is still active.
import json, os, sys
SRC = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "postmark-events.code.js")).read()
def code(entry): return SRC + "\n" + entry + "\n"
SB_HEADERS = [
  {"name": "apikey", "value": "={{ $env.SUPABASE_SERVICE_ROLE_KEY }}"},
  {"name": "Authorization", "value": "=Bearer {{ $env.SUPABASE_SERVICE_ROLE_KEY }}"},
]
TEXT_RESPONSE = {"response": {"response": {"responseFormat": "text", "outputPropertyName": "data"}}}
def node(name, typ, ver, x, params, **kw):
  n = {"parameters": params, "name": name, "type": typ, "typeVersion": ver, "position": [x, kw.pop("y", 300)]}
  n.update(kw); return n
def iff(name, x, left, y=300):
  return node(name, "n8n-nodes-base.if", 2.2, x, {
    "conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 2},
      "conditions": [{"id": name, "leftValue": left, "rightValue": "",
        "operator": {"type": "boolean", "operation": "true", "singleValue": True}}], "combinator": "and"},
    "options": {}}, y=y)
def respond(name, x, code_, body, y=300):
  return node(name, "n8n-nodes-base.respondToWebhook", 1.1, x,
    {"respondWith": "json", "responseBody": body, "options": {"responseCode": code_}}, y=y)
nodes = [
  node("Webhook", "n8n-nodes-base.webhook", 2, 0, {"httpMethod": "POST", "path": "postmark-events",
       "responseMode": "responseNode", "options": {}}, webhookId="postmark-events"),
  node("Check secret", "n8n-nodes-base.code", 2, 220, {"jsCode": code("return checkSecretNode($input.first(), $env);")}),
  iff("Authorized?", 440, "={{ $json.authorized }}"),
  respond("Respond 401", 660, 401, '{ "error": "unauthorized" }', y=500),
  node("Normalize", "n8n-nodes-base.code", 2, 660, {"jsCode": code("return normalizeNode($input.first(), Date.now());")}),
  iff("Stored type?", 880, "={{ $json.row !== null }}"),
  node("Recent pings", "n8n-nodes-base.httpRequest", 4.2, 1100, {
    "url": "={{ $env.SUPABASE_URL }}/rest/v1/email_events?{{ $json.recent_query }}",
    "sendHeaders": True, "headerParameters": {"parameters": SB_HEADERS}, "options": TEXT_RESPONSE}),
  node("Insert event", "n8n-nodes-base.httpRequest", 4.2, 1320, {
    "method": "POST", "url": "={{ $env.SUPABASE_URL }}/rest/v1/email_events?on_conflict=event_key",
    "sendHeaders": True, "headerParameters": {"parameters": SB_HEADERS + [
      {"name": "Prefer", "value": "resolution=ignore-duplicates,return=representation"}]},
    "sendBody": True, "contentType": "raw", "rawContentType": "application/json",
    "body": "={{ JSON.stringify($('Normalize').first().json.row) }}",
    # Autodetect + full response: one item whose body is the row array ([] = duplicate). With a raw request body,
    # an explicit "text"/"json" format leaves the response as an unread stream (n8n 2.12), so don't set one.
    "options": {"response": {"response": {"fullResponse": True}}}}),
  node("Decide ping", "n8n-nodes-base.code", 2, 1540, {"jsCode": code(
    "return decidePingNode($('Normalize').first(), $('Insert event').first(), $('Recent pings').first());")}),
  iff("Send ping?", 1760, "={{ $json.send }}"),
  node("Ping Brian", "n8n-nodes-base.httpRequest", 4.2, 1980, {
    "method": "POST", "url": "=https://api.telegram.org/bot{{ $env.RILEY_BOT_TOKEN }}/sendMessage",
    "sendBody": True, "specifyBody": "json",
    "jsonBody": "={{ JSON.stringify({ chat_id: $env.BRIAN_CHAT_ID, text: $json.text }) }}", "options": {}}, y=200),
  respond("Respond 200", 2200, 200, '{ "ok": true }'),
  # Failures: without these, n8n answers 200 with an empty body and Postmark would never retry.
  respond("Respond 500", 1760, 500, '{ "error": "intake failed" }', y=600),
  node("Fail intake", "n8n-nodes-base.stopAndError", 1, 1980, {
    "errorMessage": "=Postmark event not stored (Postmark will retry): {{ $json.error && $json.error.message || 'see execution' }}"}, y=600),
  respond("Respond 200 (ping failed)", 2200, 200, '{ "ok": true }', y=100),
  node("Fail ping", "n8n-nodes-base.stopAndError", 1, 2420, {
    "errorMessage": "=Postmark event stored but the Telegram ping failed: {{ $json.error && $json.error.message || 'see execution' }}"}, y=100),
]
for n in nodes:
  if n["name"] in ("Normalize", "Recent pings", "Insert event", "Decide ping", "Ping Brian"):
    n["onError"] = "continueErrorOutput"
def to(*names): return {"main": [[{"node": n, "type": "main", "index": 0}] for n in names]}
def branch(t, f): return {"main": [[{"node": t, "type": "main", "index": 0}], [{"node": f, "type": "main", "index": 0}]]}
connections = {
  "Webhook": to("Check secret"), "Check secret": to("Authorized?"),
  "Authorized?": branch("Normalize", "Respond 401"),
  "Stored type?": branch("Recent pings", "Respond 200"),
  "Normalize": branch("Stored type?", "Respond 500"),
  "Recent pings": branch("Insert event", "Respond 500"), "Insert event": branch("Decide ping", "Respond 500"),
  "Decide ping": branch("Send ping?", "Respond 500"), "Respond 500": to("Fail intake"),
  "Send ping?": branch("Ping Brian", "Respond 200"), "Ping Brian": branch("Respond 200", "Respond 200 (ping failed)"),
  "Respond 200 (ping failed)": to("Fail ping"),
}
wf = {"name": "Postmark Events", "nodes": nodes, "connections": connections,
      "settings": {"executionOrder": "v1", "errorWorkflow": "DQuYN8PNE7UF3uSV", "callerPolicy": "workflowsFromSameOwner"}}
json.dump(wf, sys.stdout)
