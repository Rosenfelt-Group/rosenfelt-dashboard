// Code-node logic for the n8n workflow "Postmark Events" (webhook path postmark-events).
// Plain JS with no imports: the n8n Code nodes run this whole file followed by one `return <fn>Node(...)` line,
// and the tests load it through require(). Keep labels in step with src/components/status/tabs/helpers.ts.

var DASHBOARD_EMAIL_LINK = "https://dashboard.rosably.com/status?tab=email";
var RECENT_PING_WINDOW_MS = 10 * 60 * 1000;
var SOURCE_GROUPS = ["dashboard", "n8n", "wordpress"];
var SUPPRESSION_REASONS = {
  HardBounce: "hard bounce",
  SpamComplaint: "spam complaint",
  ManualSuppression: "blocked manually",
};

// Constant-time comparison (the Code node sandbox has no crypto builtin). Empty/missing expected never matches.
function secretMatches(given, expected) {
  if (typeof given !== "string" || typeof expected !== "string" || expected.length === 0) return false;
  var diff = given.length ^ expected.length;
  for (var i = 0; i < expected.length; i++) {
    var g = i < given.length ? given.charCodeAt(i) : 0;
    diff |= g ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

function sourceLabel(tag) {
  if (!tag) return "Other";
  if (tag === "dashboard-room-invite") return "Dashboard · room invite";
  if (tag === "dashboard-discovery-invite") return "Dashboard · discovery invite";
  if (tag.indexOf("n8n-") === 0) return "n8n · " + tag.slice(4);
  if (tag === "wordpress") return "WordPress";
  return "Other";
}

function sourceGroup(tag) {
  if (!tag) return "other";
  var prefix = tag.split("-")[0];
  return SOURCE_GROUPS.indexOf(prefix) >= 0 ? prefix : "other";
}

function text(v) {
  return typeof v === "string" && v !== "" ? v : null;
}

function bool(v) {
  return typeof v === "boolean" ? v : null;
}

function eventKey(b) {
  switch (b.RecordType) {
    case "Bounce": return "bounce:" + b.ID;
    case "SpamComplaint": return "spam:" + b.ID;
    case "Delivery": return "delivery:" + b.MessageID;
    case "SubscriptionChange":
      return "sub:" + (b.MessageID || "") + ":" + String(b.Recipient || "").toLowerCase() + ":" + b.ChangedAt;
    default: return null;
  }
}

function buildPing(b, row) {
  var subject = row.subject || "(no subject)";
  var source = sourceLabel(row.tag);
  if (b.RecordType === "Bounce" && b.Inactive === true) {
    var reason = String(b.Description || "unknown").trim().replace(/\.+$/, "");
    return "📧 Bounce — " + row.recipient + " didn't get \"" + subject + "\" (" + source + "). Reason: " + reason +
      ". Postmark has blocked this address. " + DASHBOARD_EMAIL_LINK;
  }
  if (b.RecordType === "SpamComplaint") {
    return "🚨 Spam complaint — " + row.recipient + " marked \"" + subject + "\" (" + source +
      ") as spam. They're permanently blocked. " + DASHBOARD_EMAIL_LINK;
  }
  if (b.RecordType === "SubscriptionChange" && b.SuppressSending === true) {
    var why = SUPPRESSION_REASONS[b.SuppressionReason] || b.SuppressionReason || "no reason given";
    return "⛔ Blocked — Postmark will no longer send to " + row.recipient + " (" + why + "). " + DASHBOARD_EMAIL_LINK;
  }
  return null;
}

// One Postmark webhook body -> the email_events row to insert and the Telegram ping text (null = no ping).
// Record types we don't store (Open, Click, ...) give { row: null, ping: null }.
function normalize(body) {
  var b = body || {};
  var key = eventKey(b);
  if (!key) return { row: null, ping: null };
  var isProblem = b.RecordType === "Bounce" || b.RecordType === "SpamComplaint";
  var tag = text(b.Tag);
  var occurredAt = isProblem ? b.BouncedAt : b.RecordType === "Delivery" ? b.DeliveredAt : b.ChangedAt;
  var row = {
    event_key: key,
    record_type: b.RecordType,
    message_id: text(b.MessageID),
    recipient: isProblem ? b.Email : b.Recipient,
    subject: text(b.Subject),
    tag: tag,
    source_group: sourceGroup(tag),
    bounce_type: isProblem ? text(b.Type) : null,
    description: isProblem ? text(b.Description) : null,
    inactive: isProblem ? bool(b.Inactive) : b.RecordType === "SubscriptionChange" ? bool(b.SuppressSending) : null,
    can_activate: isProblem ? bool(b.CanActivate) : null,
    metadata: b.Metadata && typeof b.Metadata === "object" ? b.Metadata : {},
    occurred_at: occurredAt || new Date().toISOString(),
    payload: body,
  };
  return { row: row, ping: buildPing(b, row) };
}

// PostgREST query for a bounce/complaint ping to the same recipient in the last 10 minutes.
// Only a block (SubscriptionChange) is deduped this way; other rows need no lookup (null).
function recentPingQuery(row, nowMs) {
  if (!row || row.record_type !== "SubscriptionChange") return null;
  var since = new Date(nowMs - RECENT_PING_WINDOW_MS).toISOString();
  var address = String(row.recipient).toLowerCase().replace(/[\\%_]/g, "\\$&");
  return [
    "select=id",
    "recipient=" + encodeURIComponent("ilike." + address),
    "received_at=" + encodeURIComponent("gte." + since),
    "or=" + encodeURIComponent("(record_type.eq.SpamComplaint,and(record_type.eq.Bounce,inactive.is.true))"),
    "limit=1",
  ].join("&");
}

function parseRows(responseText) {
  var parsed = typeof responseText === "string" && responseText !== "" ? JSON.parse(responseText) : [];
  return Array.isArray(parsed) ? parsed : [];
}

// insertResponse: body of the email_events insert (return=representation; [] means duplicate -> no ping).
// recentResponse: body of the recentPingQuery lookup ("[]" when none was needed).
function pingDecision(normalized, insertResponse, recentResponse) {
  var none = { send: false, text: null };
  if (!normalized.ping || parseRows(insertResponse).length === 0) return none;
  if (normalized.row.record_type === "SubscriptionChange" && parseRows(recentResponse).length > 0) return none;
  return { send: true, text: normalized.ping };
}

// ---- n8n node entry points (each Code node body = this file + "return <name>(...)") ----

function checkSecretNode(item, env) {
  var headers = item.json.headers || {};
  return [{ json: {
    authorized: secretMatches(headers["x-rosably-webhook-secret"], env.POSTMARK_WEBHOOK_SECRET),
    body: item.json.body,
  } }];
}

function normalizeNode(item, nowMs) {
  var n = normalize(item.json.body);
  return [{ json: { row: n.row, ping: n.ping, recent_query: recentPingQuery(n.row, nowMs) || "select=id&limit=0" } }];
}

function decidePingNode(normalizedItem, insertItem, recentItem) {
  return [{ json: pingDecision(normalizedItem.json, insertItem.json.data, recentItem.json.data) }];
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    secretMatches: secretMatches,
    sourceLabel: sourceLabel,
    normalize: normalize,
    recentPingQuery: recentPingQuery,
    pingDecision: pingDecision,
    checkSecretNode: checkSecretNode,
    normalizeNode: normalizeNode,
    decidePingNode: decidePingNode,
  };
}
