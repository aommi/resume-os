#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { workDir } from "../engine/config.mjs";

const work = workDir();
const inbox = join(work, "inbox");
const output = join(work, "model-evals", "job-triage-review.html");
const active = new Set(["to_review", "to_apply"]);
const priorCull = new Set(["skipped", "closed"]);
const positive = new Set(["package_ready", "applied", "interviewing"]);

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

const allJobs = readdirSync(inbox, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(inbox, entry.name, "metadata.json")))
  .map((entry) => {
    const folder = join(inbox, entry.name);
    const metadata = JSON.parse(readFileSync(join(folder, "metadata.json"), "utf8"));
    const status = metadata.lifecycle?.status || "to_review";
    return {
      id: entry.name,
      company: text(metadata.company),
      title: text(metadata.title),
      location: text(metadata.location),
      status,
      found: text(metadata.fetched || metadata.found || metadata.postedAt),
      url: text(metadata.url),
      notes: text(metadata.lifecycle?.notes),
      description: text(metadata.description).slice(0, 700),
      jobPath: relative(dirname(output), join(folder, "job.md")).split("\\").join("/"),
    };
  });

const newestFirst = (jobs) => [...jobs].sort((a, b) => b.found.localeCompare(a.found) || a.company.localeCompare(b.company));
const inFlightKeys = new Set(allJobs.filter((job) => positive.has(job.status)).map((job) => job.company.toLowerCase() + "::" + job.title.toLowerCase()));
const candidates = newestFirst(allJobs.filter((job) => active.has(job.status) && !inFlightKeys.has(job.company.toLowerCase() + "::" + job.title.toLowerCase())));
const duplicateReferences = newestFirst(allJobs.filter((job) => active.has(job.status) && inFlightKeys.has(job.company.toLowerCase() + "::" + job.title.toLowerCase())));
const selected = [];
const add = (jobs, cohort, cohortLabel) => {
  for (const job of jobs) {
    if (selected.some((item) => item.id === job.id)) continue;
    selected.push({ ...job, cohort, cohortLabel, reference: cohort !== "review-now" });
  }
};

// Review the freshest actionable work first, while retaining a small, diverse basis for model evaluation.
add(candidates.slice(0, 18), "review-now", "Review now — current backlog");
add(candidates.slice(-4), "backlog-check", "Backlog check — older active role");
add(newestFirst(allJobs.filter((job) => job.company.toLowerCase() === "ground news" && positive.has(job.status))).slice(0, 1), "positive-reference", "Reference — known strong fit (Ground News)");
add(newestFirst(allJobs.filter((job) => positive.has(job.status))).slice(0, 3), "positive-reference", "Reference — role pursued or in flight");
const seenCullReasons = new Set();
const cullReferences = newestFirst(allJobs.filter((job) => priorCull.has(job.status))).filter((job) => {
  const key = (job.notes || job.title || job.company).slice(0, 100).toLowerCase();
  if (seenCullReasons.has(key)) return false;
  seenCullReasons.add(key);
  return true;
}).slice(0, 4);
add(duplicateReferences.filter((job) => job.company.toLowerCase() !== "ground news").slice(0, 2), "cull-reference", "Reference — duplicate of a role already in flight");
add(cullReferences, "cull-reference", "Reference — previously eliminated");

const jobs = selected;
const data = JSON.stringify(jobs).replace(/</g, "\\u003c");
const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Job triage review</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { max-width: 900px; margin: 0 auto; padding: 24px; line-height: 1.45; }
    header, .toolbar, .nav, .choices { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    header { justify-content: space-between; margin-bottom: 18px; }
    h1 { font-size: 1.45rem; margin: 0; }
    .muted { opacity: .7; }
    .card { border: 1px solid #8886; border-radius: 10px; padding: 18px; margin: 14px 0; }
    h2 { margin: 0 0 4px; font-size: 1.2rem; }
    label { display: grid; gap: 5px; margin: 12px 0; font-weight: 600; }
    input, select, textarea, button { font: inherit; padding: 8px; }
    textarea { min-height: 72px; resize: vertical; }
    .choices label { display: flex; align-items: center; font-weight: 400; margin: 0; }
    .choices input { padding: 0; }
    button { cursor: pointer; }
    .decision { min-width: 150px; }
    .reference { color: #8a5a00; }
    .excerpt { white-space: pre-wrap; max-height: 170px; overflow: auto; }
    .counter { font-variant-numeric: tabular-nums; }
    @media (max-width: 600px) { body { padding: 14px; } .toolbar > * { width: 100%; } }
  </style>
</head>
<body>
  <header>
    <div><h1>Job triage review</h1><div id="progress" class="muted counter"></div></div>
    <div class="toolbar"><button id="export-json" type="button">Export JSON</button><button id="export-csv" type="button">Export CSV</button><label><input id="import-file" type="file" accept="application/json"> Import JSON</label></div>
  </header>
  <main class="card" id="review"></main>
  <div class="nav"><button id="previous" type="button">Previous</button><button id="next" type="button">Next</button><button id="next-unlabeled" type="button">Next unlabeled</button></div>
  <script>
    const jobs = ${data};
    const key = "resume-os-job-triage-review-v1";
    let labels = JSON.parse(localStorage.getItem(key) || "{}");
    let index = 0;
    const review = document.getElementById("review");
    const progress = document.getElementById("progress");
    const esc = (value) => String(value || "").replace(/[&<>]/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;"})[char]).replaceAll(String.fromCharCode(34), "&quot;");
    function persist() { localStorage.setItem(key, JSON.stringify(labels)); }
    function current() { return jobs[index]; }
    function labeledCount() { return Object.values(labels).filter((label) => label.disposition).length; }
    function render() {
      const job = current();
      const label = labels[job.id] || {};
      progress.textContent = \`\${index + 1} of \${jobs.length} · \${labeledCount()} labeled\`;
      review.innerHTML = \`<div class="muted">\${job.cohortLabel} · \${esc(job.status)} · \${esc(job.found)}</div>
        <h2>\${esc(job.company || "Unknown company")} — \${esc(job.title || "Unknown title")}</h2>
        <div class="muted">\${esc(job.location || "Location unavailable")} · <a href="\${esc(job.url)}" target="_blank" rel="noreferrer">Source posting</a> · <a href="\${esc(job.jobPath)}" target="_blank">Open full JD</a></div>
        <p class="excerpt">\${esc(job.description || "No stored description excerpt.")}</p>
        <label>Disposition<select class="decision" id="disposition"><option value="">Choose…</option><option value="skipped">Skip — clear non-fit</option><option value="needs_input">Needs my input</option><option value="base_resume">Apply with base resume</option><option value="tailor">Apply with tailoring</option></select></label>
        <label>Optional note<textarea id="note" placeholder="Only add context if this is an edge case or you want the evaluator to notice something specific."></textarea></label>\`;
      document.getElementById("disposition").value = label.disposition || "";
      document.getElementById("reason").value = label.reason || "";
      document.getElementById("evidence").value = label.evidence || "";
      document.getElementById("question").value = label.question || "";
      const outreach = document.querySelector(\`input[name="outreach"][value="\${label.outreach || "none"}"]\`);
      if (outreach) outreach.checked = true;
      review.querySelectorAll("select, textarea, input").forEach((field) => field.addEventListener("input", save));
      review.querySelectorAll("input[type=radio]").forEach((field) => field.addEventListener("change", save));
    }
    function save() {
      const job = current();
      labels[job.id] = {
        job_id: job.id, company: job.company, title: job.title, current_status: job.status, source_url: job.url,
        disposition: document.getElementById("disposition").value,
        note: document.getElementById("note").value.trim(),
        labeled_at: new Date().toISOString()
      };
      persist(); progress.textContent = \`\${index + 1} of \${jobs.length} · \${labeledCount()} labeled\`;
    }
    function download(name, type, content) { const url = URL.createObjectURL(new Blob([content], {type})); const link = document.createElement("a"); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url); }
    function csv(rows) { const fields = ["job_id","company","title","current_status","source_url","disposition","note","labeled_at"]; const q = (v) => \`"\${String(v || "").replaceAll('"','""')}"\`; return [fields.join(","), ...rows.map((row) => fields.map((field) => q(row[field])).join(","))].join("\\n"); }
    document.getElementById("previous").onclick = () => { save(); index = (index - 1 + jobs.length) % jobs.length; render(); };
    document.getElementById("next").onclick = () => { save(); index = (index + 1) % jobs.length; render(); };
    document.getElementById("next-unlabeled").onclick = () => { save(); const next = jobs.findIndex((job, position) => position > index && !labels[job.id]?.disposition); index = next >= 0 ? next : jobs.findIndex((job) => !labels[job.id]?.disposition); if (index < 0) index = 0; render(); };
    document.getElementById("export-json").onclick = () => { save(); download("job-triage-labels.json", "application/json", JSON.stringify(Object.values(labels).filter((label) => label.disposition), null, 2)); };
    document.getElementById("export-csv").onclick = () => { save(); download("job-triage-labels.csv", "text/csv", csv(Object.values(labels).filter((label) => label.disposition))); };
    document.getElementById("import-file").onchange = async (event) => { const file = event.target.files[0]; if (!file) return; const incoming = JSON.parse(await file.text()); for (const label of incoming) if (label.job_id) labels[label.job_id] = label; persist(); render(); };
    render();
  </script>
</body>
</html>`;

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, page);
console.log(`wrote ${output} with ${jobs.length} jobs`);
