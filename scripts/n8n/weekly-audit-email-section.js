// Pure formatter for the "Email delivery" section of the n8n "Weekly Agent Audit" workflow (id uFg21tiyeldNB8n3).
// Plain JS with no imports: build-weekly-audit-workflow.py pastes the whole file into the "Format Report" Code node,
// and the tests load it through require(). Keep thresholds in step with src/lib/email/health.ts and labels with
// src/components/status/tabs/helpers.ts.

var MIN_SENDS_FOR_RATES = 50;
var BOUNCE_WARN = 0.02;

function sourceLabel(tag) {
  if (!tag) return "Other";
  if (tag === "dashboard-room-invite") return "Dashboard · room invite";
  if (tag === "dashboard-discovery-invite") return "Dashboard · discovery invite";
  if (tag.indexOf("n8n-") === 0) return "n8n · " + tag.slice(4);
  if (tag === "wordpress") return "WordPress";
  return "Other";
}

function pct(r) {
  return (Math.round(r * 1000) / 10).toFixed(1) + "%";
}

function problemType(p) {
  if (p.record_type === "SpamComplaint") return "Spam complaint";
  return p.inactive === true ? "Hard bounce" : "Bounce";
}

function problemLine(p) {
  var line = problemType(p) + " — " + p.recipient + " — \"" + (p.subject || "(no subject)") + "\" (" + sourceLabel(p.tag) + ")";
  if (p.resolution) line += " — fixed: " + p.resolution;
  return line;
}

// stats: Postmark /stats/outbound JSON, or anything without a numeric Sent when the call failed.
// problems: array of email_events rows (Bounce / SpamComplaint in the window), or null when that query failed.
function formatEmailSection(stats, problems) {
  var out = ["## Email delivery"];
  if (!stats || typeof stats.Sent !== "number") {
    out.push("Email delivery: couldn't reach Postmark this week.");
    return out.join("\n");
  }
  var sent = stats.Sent;
  var bounced = typeof stats.Bounced === "number" ? stats.Bounced : 0;
  var list = Array.isArray(problems) ? problems : [];
  var complaints = typeof stats.SpamComplaints === "number" ? stats.SpamComplaints : 0;
  var rate = sent > 0 ? bounced / sent : null;
  var delivered = sent > 0 ? (sent - bounced) / sent : null;

  out.push("Sent " + sent + " · Delivered " + (delivered === null ? "—" : pct(delivered)) +
    " · Bounce rate " + (rate === null ? "—" : pct(rate)) + " · Spam complaints " + complaints);

  if (problems === null || problems === undefined) out.push("Couldn't read bounce details this week.");
  list.forEach(function (p) { out.push(problemLine(p)); });

  // The warning counts only unresolved rows; resolved ones are still listed above with "fixed: ...".
  var open = list.filter(function (p) { return !p.resolution; });
  var hardBounces = open.filter(function (p) { return p.record_type === "Bounce" && p.inactive === true; }).length;
  var openComplaints = open.filter(function (p) { return p.record_type === "SpamComplaint"; }).length;
  var reasons = [];
  if (sent >= MIN_SENDS_FOR_RATES && rate !== null && rate >= BOUNCE_WARN) reasons.push("bounce rate " + pct(rate));
  if (hardBounces > 0) reasons.push(hardBounces + " hard bounce" + (hardBounces === 1 ? "" : "s"));
  if (openComplaints > 0) reasons.push(openComplaints + " spam complaint" + (openComplaints === 1 ? "" : "s"));
  if (reasons.length) out.push("⚠️ Email needs attention: " + reasons.join(", ") + ".");
  return out.join("\n");
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { formatEmailSection: formatEmailSection, sourceLabel: sourceLabel };
}
