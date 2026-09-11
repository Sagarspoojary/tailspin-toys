// Extension: kanban-triage
// A lightweight Kanban board for prioritizing and attaching GitHub issues.

import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { createCanvas, joinSession } from "@github/copilot-sdk/extension";

const execFileAsync = promisify(execFile);
const servers = new Map();
let activeSession;

const issueSchema = {
    type: "object",
    properties: {
        repo: { type: "string", minLength: 1 },
    },
    additionalProperties: false,
};

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function issueUrl(repo, number) {
    return `https://github.com/${repo}/issues/${number}`;
}

function scoreIssue(issue) {
    const ageInDays = Math.max(0, (Date.now() - Date.parse(issue.updatedAt)) / 86_400_000);
    const labels = issue.labels.map(({ name }) => name.toLowerCase());
    let score = Math.max(0, 10 - ageInDays);
    if (labels.some((label) => ["bug", "security", "critical", "urgent"].includes(label))) score += 8;
    if (labels.some((label) => ["enhancement", "feature"].includes(label))) score += 2;
    if (issue.assignees.length === 0) score += 3;
    if (issue.comments > 0) score += Math.min(issue.comments, 5);
    return score;
}

async function loadIssues(repo) {
    const { stdout } = await execFileAsync("gh", [
        "issue",
        "list",
        "--repo",
        repo,
        "--state",
        "open",
        "--limit",
        "50",
        "--json",
        "number,title,body,labels,updatedAt,comments,assignees",
    ]);
    const issues = JSON.parse(stdout);
    return issues
        .map((issue) => ({ ...issue, score: scoreIssue(issue) }))
        .sort((a, b) => b.score - a.score || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function issueCard(issue, repo, highlighted) {
    const body = issue.body?.trim() || "No description provided.";
    const labels = issue.labels.map(({ name }) => `<span class="label">${escapeHtml(name)}</span>`).join("");
    const justification = highlighted
        ? `<p class="why"><strong>Why now:</strong> ${escapeHtml(
              issue.assignees.length === 0
                  ? "It is unassigned and therefore a good candidate for immediate triage."
                  : "Its recent activity and issue signals put it ahead of the remaining open work.",
          )}</p>`
        : "";
    return `<article class="card">
  <div class="card-heading"><span class="issue-number">#${issue.number}</span><span class="labels">${labels}</span></div>
  <h3><a href="${issueUrl(repo, issue.number)}" target="_blank" rel="noreferrer">${escapeHtml(issue.title)}</a></h3>
  <p class="description">${escapeHtml(body.slice(0, 280))}${body.length > 280 ? "…" : ""}</p>
  ${justification}
  <button data-issue="${issue.number}" data-testid="add-issue-${issue.number}">Add to current context</button>
</article>`;
}

function renderHtml(instanceId, repo, issues, errorMessage = "") {
    const top = issues.slice(0, 3);
    const remainder = issues.slice(3);
    const error = errorMessage ? `<p class="error" role="alert">${escapeHtml(errorMessage)}</p>` : "";
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Issue triage</title>
<style>
:root { color-scheme: light dark; }
body { margin:0; padding:24px; background:var(--background-color-default,#fff); color:var(--text-color-default,#1f2328); font-family:var(--font-sans,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif); }
main { max-width:900px; margin:auto; } h1 { margin:0 0 6px; font-size:26px; } h2 { margin:28px 0 12px; font-size:18px; }
.subtle { color:var(--text-color-muted,#656d76); margin-top:0; } .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(250px,1fr)); gap:12px; }
.card { border:1px solid var(--border-color-default,#d0d7de); border-radius:10px; padding:16px; background:var(--background-color-default,#fff); }
.card-heading { display:flex; justify-content:space-between; gap:8px; } .issue-number { font-weight:700; color:var(--true-color-blue,#0969da); }
h3 { margin:10px 0 8px; font-size:16px; } a { color:inherit; } .description { color:var(--text-color-muted,#656d76); min-height:42px; }
.label { display:inline-block; border:1px solid var(--border-color-default,#d0d7de); border-radius:999px; padding:2px 7px; margin:0 3px 3px 0; font-size:11px; }
.why { font-size:13px; } button { border:0; border-radius:6px; padding:8px 10px; cursor:pointer; color:#fff; background:var(--true-color-blue,#0969da); } button:focus-visible { outline:2px solid var(--color-focus-outline,#0969da); outline-offset:2px; }
.status { min-height:20px; color:var(--text-color-muted,#656d76); font-size:13px; } .error { color:var(--true-color-red,#cf222e); }
</style>
</head>
<body><main>
<h1>Issue triage</h1><p class="subtle">Top candidates for immediate attention in <strong>${escapeHtml(repo)}</strong>.</p>
${error}
<section aria-labelledby="priority-heading"><h2 id="priority-heading">Most likely to need attention</h2><div class="grid">${top.length ? top.map((issue) => issueCard(issue, repo, true)).join("") : "<p>No open issues found.</p>"}</div></section>
<section aria-labelledby="remaining-heading"><h2 id="remaining-heading">Remaining open issues</h2><div class="grid">${remainder.length ? remainder.map((issue) => issueCard(issue, repo, false)).join("") : "<p class=\"subtle\">No remaining issues.</p>"}</div></section>
<p class="status" id="status" role="status" aria-live="polite"></p>
</main>
<script>
document.querySelectorAll("button[data-issue]").forEach((button) => {
  button.addEventListener("click", async () => {
    button.disabled = true;
    document.querySelector("#status").textContent = "Adding issue to the current context…";
    try {
      const response = await fetch("/attach", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ number:button.dataset.issue }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to add issue");
      document.querySelector("#status").textContent = result.message;
    } catch (error) {
      document.querySelector("#status").textContent = error.message;
      button.disabled = false;
    }
  });
});
</script>
</body></html>`;
}

async function startServer(instanceId, repo) {
    let issues = [];
    let errorMessage = "";
    try {
        issues = await loadIssues(repo);
    } catch (error) {
        errorMessage = `Could not load GitHub issues: ${error.message}`;
    }
    const server = createServer(async (req, res) => {
        if (req.method === "POST" && req.url === "/attach") {
            let payload = "";
            for await (const chunk of req) payload += chunk;
            try {
                const { number } = JSON.parse(payload);
                const issue = issues.find((candidate) => String(candidate.number) === String(number));
                if (!issue || !activeSession) throw new Error("Issue is no longer available.");
                await activeSession.send({
                    prompt: `Please work on GitHub issue #${issue.number}: ${issue.title}\n\n${issue.body || "No description provided."}\n\nIssue URL: ${issueUrl(repo, issue.number)}`,
                });
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ message: `Issue #${issue.number} added to the current context.` }));
            } catch (error) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: error.message }));
            }
            return;
        }
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(renderHtml(instanceId, repo, issues, errorMessage));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return { server, url: `http://127.0.0.1:${port}/` };
}

activeSession = await joinSession({
    canvases: [
        createCanvas({
            id: "kanban-triage",
            displayName: "Issue triage board",
            description: "A Kanban board that prioritizes open GitHub issues and adds selected issues to the current session context.",
            inputSchema: issueSchema,
            open: async (ctx) => {
                const repo = typeof ctx.input?.repo === "string" ? ctx.input.repo : "Sagarspoojary/tailspin-toys";
                let entry = servers.get(ctx.instanceId);
                if (!entry) {
                    entry = await startServer(ctx.instanceId, repo);
                    servers.set(ctx.instanceId, entry);
                }
                return { title: "Issue triage", url: entry.url };
            },
            onClose: async (ctx) => {
                const entry = servers.get(ctx.instanceId);
                if (entry) {
                    servers.delete(ctx.instanceId);
                    await new Promise((resolve) => entry.server.close(() => resolve()));
                }
            },
        }),
    ],
});
