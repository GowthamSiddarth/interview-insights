# Setting up GitHub Projects via `gh` CLI

Runbook for how this repo's GitHub Project board, milestone, and issues were
set up — kept here so the same steps can be repeated for a future phase, a
future repo, or if the project needs to be rebuilt from scratch.

This is an operational how-to, not a design doc — see `docs/` for
architecture/data-model/decisions/roadmap.

## Context

- Repo: `GowthamSiddarth/interview-insights` (private)
- Project: a GitHub Projects (v2) **Board** created via the GitHub web UI
  (Projects tab → New project → Board template), owned by the personal
  account, not an org — see the reasoning in the conversation this was set
  up in: solo dev now, collaborators added as repo collaborators later, no
  org needed just for that.
- Everything past project *creation* (linking it to the repo, adding a
  milestone, filing issues, adding them to the board) was scripted with `gh`.

## 1. Authenticate `gh` with the right scopes

A plain `gh auth login` does **not** grant the `project` scope needed for
`gh project` commands — this bit us the first time (issues/milestones
worked, `gh project` calls didn't).

```bash
# Interactive — opens a browser/device-code flow. Run this yourself, not
# something to script/automate.
gh auth login --scopes "repo,project"

# If you already logged in without the project scope, add it after the fact
# (also interactive):
gh auth refresh -s project

# Verify — 'project' must appear in Token scopes:
gh auth status
```

Expected good output:
```
✓ Logged in to github.com account <you> (keyring)
- Token scopes: 'admin:public_key', 'gist', 'project', 'read:org', 'repo'
```

## 2. Confirm the repo is pushed and reachable

```bash
git remote -v                 # confirm origin points at the right repo
git ls-remote origin          # confirms it's reachable without needing gh auth
```

## 3. Find the Project (owner + number)

Project number isn't obvious unless you go dig it out of the project's URL
— easier to list it:

```bash
gh project list --owner <your-github-username>
```

```
NUMBER  TITLE                                    STATE  ID
2       @<you>'s Interview Insights              open   PVT_kwHOAVBf_84BdhUE
```

Inspect its fields (useful to know the Status column's option names before
scripting item edits):

```bash
gh project view <number> --owner <your-github-username>
gh project field-list <number> --owner <your-github-username>
```

## 4. Link the Project to the repo

Makes the Project show up under the repo's own Projects tab, and populates
the Repository/Milestone fields on items automatically.

```bash
gh project link <number> --owner <your-github-username> \
  --repo <owner>/<repo>
```

## 5. Create a milestone per roadmap phase

One milestone per `docs/ROADMAP.md` phase, created just before you start
that phase (not all of them upfront).

```bash
gh api repos/<owner>/<repo>/milestones \
  -f title="Phase 3 — Trust & moderation" \
  -f description="Moderation queue worker, fraud checks, candidate verification. See docs/ROADMAP.md Phase 3 and docs/DECISIONS.md D3."
```

Helpful follow-ups:
```bash
# List milestones (to get numbers/state)
gh api repos/<owner>/<repo>/milestones

# Close a milestone once every issue under it is done
gh api -X PATCH repos/<owner>/<repo>/milestones/<milestone-number> -f state=closed
```

## 6. File issues under the milestone

```bash
gh issue create --repo <owner>/<repo> \
  --title "Moderation queue as its own service/worker" \
  --milestone "Phase 3 — Trust & moderation" \
  --body "$(cat <<'EOF'
Scope, acceptance criteria, and test expectations go here — pull straight
from the relevant docs/ROADMAP.md line and docs/DECISIONS.md entry so the
issue doesn't drift from the reasoning already written down.
EOF
)"
```

Helpful follow-ups:
```bash
# List open issues under a milestone
gh issue list --repo <owner>/<repo> --milestone "Phase 3 — Trust & moderation"

# Edit an existing issue's milestone/labels/assignee later
gh issue edit <issue-number> --repo <owner>/<repo> --milestone "Phase 4 — Analytics"
```

## 7. Add the issues to the Project board

`gh project item-add` takes the issue's URL, not just its number:

```bash
gh project item-add <project-number> --owner <your-github-username> \
  --url "https://github.com/<owner>/<repo>/issues/<issue-number>"
```

Looping over several at once:
```bash
for n in 1 2 3; do
  gh project item-add <project-number> --owner <your-github-username> \
    --url "https://github.com/<owner>/<repo>/issues/$n"
done
```

## 8. Verify

```bash
gh project item-list <project-number> --owner <your-github-username>
```

```
Issue   Moderation queue as its own service/worker                  1  <owner>/<repo>  PVTI_...
Issue   Basic fraud checks (rate limiting, duplicate detection)     2  <owner>/<repo>  PVTI_...
Issue   Candidate verification flow (email domain match at minimum) 3  <owner>/<repo>  PVTI_...
```

## Other commands worth knowing for later

```bash
# Move an item to a different Status column (needs the Status field's
# option ID from `gh project field-list` — the CLI wants IDs, not labels)
gh project item-edit --project-id <project-node-id> --id <item-id> \
  --field-id <status-field-id> --single-select-option-id <option-id>

# Remove an item from the board without closing/deleting the issue itself
gh project item-delete <project-number> --owner <your-github-username> \
  --id <item-id>

# Open the board in a browser instead of scripting further
gh project view <project-number> --owner <your-github-username> --web
```

## Workflow convention: move an issue to "In Progress" when starting work

The moment work actually starts on an issue (not when it's filed), move
its board status from "Todo" to "In Progress" — filing an issue during a
planning pass shouldn't itself flip its status, only starting the real
work should. Also assign every PR to yourself (`gh pr create --assignee
<your-github-username>`), same as issues.

This project's concrete IDs (fetched once via the commands below — these
don't change unless the board itself is rebuilt):

```bash
# Project node ID
gh project view 2 --owner GowthamSiddarth --format json --jq '.id'
# => PVT_kwHOAVBf_84BdhUE

# Status field ID + every option's ID
gh project field-list 2 --owner GowthamSiddarth --format json \
  --jq '.fields[] | select(.name=="Status")'
# => field id PVTSSF_lAHOAVBf_84BdhUEzhYCSEE
#    options: Backlog=846fd570, Todo=f75ad846,
#             In Progress=47fc9ee4, Done=98236657

# An issue's own item ID on the board (needed for item-edit)
gh project item-list 2 --owner GowthamSiddarth --format json --limit 100 \
  --jq '.items[] | select(.content.number==<issue-number>) | .id'
```

Putting it together — move issue `<issue-number>` to "In Progress":

```bash
ITEM_ID=$(gh project item-list 2 --owner GowthamSiddarth --format json \
  --limit 100 --jq '.items[] | select(.content.number==<issue-number>) | .id')

gh project item-edit --project-id "PVT_kwHOAVBf_84BdhUE" \
  --id "$ITEM_ID" \
  --field-id "PVTSSF_lAHOAVBf_84BdhUEzhYCSEE" \
  --single-select-option-id "47fc9ee4"
```

## Epics vs Milestones

Adopted from Phase 18 onward (2026-07-20 strategic review) after noticing
every GitHub Milestone created so far (`due_on: null` on all of them) was
actually being used to mean "themed body of work," not "date-bound
checkpoint" — the two got conflated because GitHub doesn't hand a
personal-account repo a first-class Epic object. Two fixes, kept as
genuinely separate going forward:

- **Epic** = a phase, tracked as a real parent issue with the phase's
  feature issues attached as native **sub-issues** (a real GitHub
  feature — confirmed working on this repo's tier, unlike "Issue Types"
  below).
- **Milestone** = demoted back to a flat, date-less grouping; reserved to
  mean an actual date-bound external commitment once one exists (may span
  issues from more than one phase/epic at that point — unlike today's
  strict 1:1 phase-to-milestone mapping).

Phases 1-17 predate this and are left exactly as they are — no
retroactive epic/sub-issue rewiring, no value in the churn.

**Checked and ruled out**: GitHub's native "Issue Types" feature (which
includes a built-in `Epic` type) — confirmed via `gh api
repos/<owner>/<repo>/issue-types` returning 404 on this repo. It's gated
to Organization-owned repos; this repo is owned by a personal User
account. Same shape of gap as branch protection (issue #18) — always
check availability against the actual repo/account tier before assuming
a GitHub feature applies; don't infer it from GitHub's general docs.

**Create the epic issue** (same milestone as its children, so filtering
by milestone still works):

```bash
gh issue create --title "Epic: Phase 18 — Admin Authentication" \
  --milestone "Phase 18 — Admin Authentication" \
  --assignee <your-github-username> \
  --body "Epic issue for Phase 18 — tracks the phase via native sub-issues. See docs/ROADMAP.md Phase 18."
```

**Attach existing issues as sub-issues** — the API wants the sub-issue's
numeric database `id` (not its issue *number*), and the `-F` flag (not
`-f`) so `gh api` sends it as a JSON integer, not a string:

```bash
# 1. Get each child issue's database id
gh api repos/<owner>/<repo>/issues/<issue-number> --jq '.id'

# 2. Attach it to the epic (issue-number here is the EPIC's number)
gh api repos/<owner>/<repo>/issues/<epic-issue-number>/sub_issues \
  -X POST -F sub_issue_id=<child-issue-database-id>
```

**Verify** — the epic issue's own object gains a live progress summary:

```bash
gh api repos/<owner>/<repo>/issues/<epic-issue-number> --jq '.sub_issues_summary'
# => {"completed":0,"percent_completed":0,"total":3}
```

Add the epic issue to the Project board the same way as any other issue
(section 7 above, `gh project item-add` with its URL).

## Gotchas hit while setting this up

- `docker` and `gh` binaries can exist on disk (e.g. `/usr/local/bin`) while
  still reporting "command not found" if `$PATH` doesn't include that
  directory, or the symlink is broken (stale install left behind after an
  app was removed without a full uninstall). `which <cmd>` + `ls -la` on the
  symlink target is the fastest way to tell which one it is.
- `gh auth login`'s default scopes don't include `project` — always check
  `gh auth status`'s scope list before assuming `gh project` commands will
  work, and use `gh auth refresh -s project` rather than logging out/in
  again.
