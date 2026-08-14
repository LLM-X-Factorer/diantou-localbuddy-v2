# Codex Product and Agent Benchmark — 2026-08-14

> 一句话结论：LocalBuddy 不缺“再多几个工具”，真正需要补的是可被用户控制的 Agent 工作台——Project/Run/Source 分层、可修订 Goal、可检查的 Agent Session、独立 Reviewer，以及基于 trace 的持续 Eval。

本文保留英文技术术语，便于与 OpenAI 官方文档和代码合同逐项对照；长期产品经验的中文版本见 [`AGENT-PRODUCT-PRINCIPLES.md`](AGENT-PRODUCT-PRINCIPLES.md)。

## 1. Why this benchmark exists

LocalBuddy is not trying to reproduce Codex feature by feature. The useful comparison is at the product-contract level:

- What objects does the user understand and control?
- What context is shared, and what must be attached explicitly?
- How are long tasks steered, reviewed, resumed and evaluated?
- When does parallelism improve quality, and when does it create coordination risk?
- Which state is durable truth, and which state is only helpful recall?

Only public behavior and general architecture patterns are used here. No Codex source code, UI asset, product string or Git history is copied into LocalBuddy.

## 2. Official baseline

This benchmark uses official OpenAI documentation fetched on 2026-08-14:

- [Projects and chats](https://developers.openai.com/codex/projects)
- [Long-running work](https://developers.openai.com/codex/long-running-work)
- [Permissions](https://developers.openai.com/codex/permission-modes)
- [Subagents](https://developers.openai.com/codex/agent-configuration/subagents)
- [Worktrees](https://developers.openai.com/codex/environments/git-worktrees)
- [Code review](https://developers.openai.com/codex/code-review)
- [Custom instructions with AGENTS.md](https://developers.openai.com/codex/agent-configuration/agents-md)
- [Skills and plugins](https://developers.openai.com/codex/skills-and-plugins)
- [Record and Replay](https://developers.openai.com/codex/extend/record-and-replay)
- [Scheduled tasks](https://developers.openai.com/codex/automations)
- [Memories](https://developers.openai.com/codex/customization/memories)
- [Evaluate agent workflows](https://developers.openai.com/api/docs/guides/agent-evals)

The comparison below is our product inference from those documented behaviors, not a claim about OpenAI's private implementation.

## 3. Executive verdict

LocalBuddy already has strong foundations in append-only audit, effect approval, deterministic recovery, write isolation and explicit integration. Its largest gap is not “more tools”; it is a clearer, more steerable control plane.

| Product dimension | Codex design signal | LocalBuddy today | Decision |
|---|---|---|---|
| Context boundary | Projects, chats and sources are separate objects | v0.11.2 separates Run location from selected Research sources | Keep; add Project-level source sets without making them implicit Run evidence |
| Long work | Goal contains outcome, constraints and verification; user can steer/pause/resume | Run goal is persisted but effectively immutable after start | P0: versioned Goal Contract and append-only revisions |
| Agent visibility | Each subagent has an inspectable thread and lifecycle | Task cards expose status but not the Agent's distilled working thread | P0: Agent Session projection, cost/status, interrupt and follow-up |
| Parallel safety | Read-heavy work parallelizes well; write-heavy work needs care | Research shares reads; Coding uses isolated worktrees and serialized integration | Preserve; make the reason visible in UI |
| Permissions | Sandbox and approval reviewer are orthogonal controls | Seven permissions, three trust profiles and per-call approval already exist | Keep; explain as scope × reviewer rather than one vague “trust” slider |
| Review | Dedicated review reports findings without changing the tree | Integration preflight checks patches but no independent Reviewer stage | P0: read-only Reviewer/Critic with explicit acceptance criteria |
| Worktree lifecycle | Background worktree, foreground Local, Handoff, restore after cleanup | Per-task detached worktrees, retained/cleanup states, apply/commit/revert | P1: Run-to-foreground handoff and recoverable cleanup snapshot |
| Reusable workflows | Skill for instructions/resources; plugin for installable tool bundles | Signed local Skills plus MCP/Browser exist, but selection is ID-centric | P1: discoverable capability cards and per-Run permission preview |
| Quality improvement | Traces first, then graders, datasets and repeatable eval runs | Rich JSONL events and many tests, but no named agent-quality dataset | P0: local trace grader and versioned regression cases |
| Memory | Optional recall; checked-in rules remain canonical | No cross-Run memory | P2: local opt-in recall only; never replace project truth or source selection |
| Unattended work | Scheduled inbox, isolated worktrees, narrow sandbox and reviewed first runs | Automation profile rejects external effects; no scheduler UI | P2: only after Goal, Review and Eval contracts are mature |

## 4. Product points worth learning

### 4.1 Project, chat, Run and source must not collapse into one object

Official Codex guidance distinguishes a project that carries shared context from a chat that owns one outcome. It also distinguishes project sources from files attached only to one chat. The important lesson is not the sidebar layout; it is that persistence scope is explicit.

LocalBuddy v0.11.2 applies the first part of this lesson:

- Run location is storage, not evidence;
- selected source roots are evidence scope;
- files actually read become recovery evidence.

Next, LocalBuddy should add a Project object with reusable source collections, but every Run must still show and persist the exact subset it uses. “Available to the Project” must never silently mean “sent to this Run.”

### 4.2 A long task needs a Goal Contract, not just a prompt

Official Codex long-running guidance defines done through outcome, constraints and verification. The product also lets the user pause, resume and steer work without pretending the original goal never changed.

LocalBuddy should persist:

```text
Goal Contract
├─ outcome
├─ constraints
├─ verification criteria
├─ source set
└─ revision
```

Active revisions must be append-only events such as `goal.revision_requested`, `goal.revised` and `plan.rebuilt`. A revision that changes sources, permissions or owned paths must pass a new gate; it must not mutate the original Run Request in place.

### 4.3 Parallel agents need inspectable threads, not only task boxes

Official Codex subagent guidance highlights two benefits: bounded parallel work and protection of the main context from noisy exploration. It also warns that subagents cost more tokens and that parallel writes create conflicts.

LocalBuddy already schedules Tasks and audits model/tool events. The missing product surface is an Agent Session view that shows:

- assignment and required capabilities;
- current phase and last meaningful update;
- model calls, tool calls, tokens and elapsed time;
- distilled result returned to the parent;
- whether it is safe to interrupt, follow up or retry;
- which workspace/source scope it owns.

The main Run should stay decision-focused. Raw traces remain available for diagnostics, while the normal UI shows a bounded, inspectable summary.

### 4.4 Sandbox scope and approval policy are different controls

Official Codex permission guidance explicitly separates what the sandbox can access from who reviews an attempt to cross a boundary. Changing the reviewer does not expand the sandbox.

LocalBuddy's runtime already models permissions and approval well, but the Composer presents `strict / balanced / automation` as a single trust choice. The next UI should explain two axes:

- **Scope**: selected sources, worktree, allowed network origins and tools;
- **Review**: prompt every time, remember a narrow grant, or deny unattended effects.

Child agents inherit the parent Run boundary by default. A specialized child may be narrower, never broader without a new user decision.

### 4.5 Review is its own role

Official Codex review runs as a dedicated reviewer, reports prioritized findings and does not modify the working tree. It supports exact scopes such as uncommitted changes, one commit or a branch diff.

LocalBuddy's Artifact Gate and Coding preflight validate structure and repository state, but they do not provide an independent semantic review. Add a Reviewer/Critic Task that:

- is read-only;
- receives the original Goal Contract and verification criteria;
- inspects the proposed Artifact or combined patch;
- returns prioritized findings with evidence;
- cannot silently repair its own findings;
- requires an explicit “accept / send back / override with reason” decision.

### 4.6 Worktree is an environment lifecycle, not just a temporary directory

Official Codex worktree behavior frames Local as foreground, Worktree as background, and Handoff as a safe movement of work and chat context. It snapshots managed work before automatic cleanup and can offer restoration.

LocalBuddy already has the harder low-level pieces: detached per-worker worktrees, patch capture, serialized integration, retained states and explicit cleanup. The product opportunity is to expose:

- “bring this Run to foreground” after a verified patch;
- “continue in isolated worktree” after inspection;
- recoverable snapshot metadata before cleanup;
- disk-usage policy and protected/pinned states.

Secrets and ignored files must never be copied by default. Any include list needs an explicit, inspectable policy.

### 4.7 Skills encode repeatable judgment; plugins package tools

Official OpenAI documentation distinguishes focused workflow instructions from installable bundles that can include connected tools. LocalBuddy already implements signed Skills and MCP, but its UI asks users to type IDs.

The next product layer should show capability cards with:

- when to use it;
- required inputs and expected Artifact;
- files/resources it loads;
- tools and permissions it requests;
- publisher, version, signature and lock state;
- one realistic test case and last validation result.

Record and Replay is worth studying later as a skill-authoring experience: demonstrate a stable workflow, extract variable inputs and verification, then review the generated skill. It should not be introduced before Computer Use permissions and recording privacy are explicit.

### 4.8 Event logs should become an evaluation flywheel

Official agent-eval guidance starts with traces while debugging, then promotes known-good criteria into graders, datasets and repeatable eval runs. LocalBuddy already emits the required raw material: model calls, tool calls, approvals, handoffs, checkpoints and Artifacts.

Create a local, versioned eval harness with deterministic graders first:

| Case | Required grader |
|---|---|
| Large unrelated run directory | No whole-directory enumeration or hashing; resume succeeds |
| Explicit source scope | No read outside selected roots; no absolute path in model context |
| Source mutation | Changed read evidence blocks resume; unrelated drift does not |
| Parallel Coding | No overlapping ownership; primary checkout unchanged before approval |
| Ambiguous effect | Started-without-completed effect blocks automatic replay |
| Artifact grounding | Source references resolve to tool receipts; missing evidence is stated |
| Review loop | Reviewer cannot write; override requires recorded reason |

Model-based graders may supplement these later, but they cannot replace deterministic security and state-transition checks.

### 4.9 Memory is optional recall, never authority

Official Codex memory guidance treats checked-in instructions as the durable source of truth and memory as a helpful layer. It is opt-in, locally stored and controllable per chat; external-context sessions can be excluded from generation.

If LocalBuddy adds memory, it should be:

- off by default;
- local-only for the single-user product;
- separated into “may read memories” and “may contribute to memories”;
- excluded when a Run uses sensitive sources or external tools unless the user opts in;
- inspectable and deletable;
- prohibited from granting permissions or silently adding sources.

### 4.10 Unattended scheduling comes last

Official scheduled-task guidance emphasizes testing prompts first, reviewing early runs, using the narrowest sandbox and isolating Git writes in worktrees. LocalBuddy should not add a cron UI simply because it is visible in Codex.

Scheduling should wait until Goal Contract, independent Review, trace grading, notifications and a clear “needs attention” inbox exist. `automation` must continue to deny external effects unless a future product decision introduces a separately scoped unattended capability.

## 5. Proposed LocalBuddy roadmap

### P0 — control plane and quality gates

1. **Goal Contract + Plan Review**
   - outcome, constraints, verification and source set;
   - plan preview before Provider workers start;
   - append-only revisions and explicit replan gate.
2. **Agent Session visibility and steering**
   - inspectable child threads, phase, budget and distilled return;
   - interrupt/follow-up/retry with audited semantics;
   - no automatic broader scope for children.
3. **Independent Reviewer/Critic**
   - read-only review of research Artifact or coding diff;
   - prioritized findings and explicit disposition.
4. **Trace Eval harness**
   - named regression dataset under repository fixtures;
   - deterministic graders in CI;
   - release comparison by runtime/version/contract.

### P1 — durable work organization

5. **Project + Thread + Run model**
   - Project carries instructions and reusable source collections;
   - Thread carries one evolving outcome;
   - Run is one immutable execution attempt;
   - each Run persists its exact source subset.
6. **Foreground/background Handoff**
   - move verified Coding work between isolated and primary environments;
   - snapshot before cleanup and offer safe restore.
7. **Discoverable Skills and Plugins**
   - capability cards, permission preview, version/signature state and test evidence.

### P2 — only after repeated dogfood demand

8. local opt-in memory;
9. Record-and-Replay skill authoring;
10. scheduled/background tasks and attention inbox;
11. richer cross-Run analytics and cost policies.

## 6. What LocalBuddy should not copy

- Do not make the repository or project folder implicit Research evidence again.
- Do not add proactive parallelism without a token/cost budget and visible child lifecycle.
- Do not make `Full access`-style convenience the default for a local single-user runtime.
- Do not use memory as a hidden permission, source or policy channel.
- Do not launch unattended schedules before review and failure-attention flows are trustworthy.
- Do not treat feature parity as product progress; every new surface needs a state contract, audit events, recovery behavior and acceptance case.

## 7. Immediate product lesson from v0.11.2

The snapshot bug was not primarily a filesystem-performance defect. It was a product-object defect: one field called “workspace” silently meant run storage, evidence repository, permission scope and recovery identity. M10.4 fixes that by giving each responsibility its own explicit object.

That pattern is the main benchmark result: when an Agent product feels magical but unpredictable, the missing feature is often not a smarter model. It is a missing boundary the user can see and control.
