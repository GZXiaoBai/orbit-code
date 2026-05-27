# Orbit Code Agent Source Study

Updated: 2026-05-26

This document summarizes lessons from public agent codebases cloned into:

`/Users/zhoujunjie/PersonalProjects/agent-source-study`

Closed-source products such as Claude Code, Cursor, and Antigravity should be studied from official docs and observable product behavior only. Do not clone leaked or reverse-engineered proprietary source.

## Repositories Reviewed

| Project | Local path | Useful focus |
| --- | --- | --- |
| OpenCode | `/Users/zhoujunjie/PersonalProjects/agent-source-study/opencode` | compact Go architecture, permission gate, sessions, diff parser |
| Codex | `/Users/zhoujunjie/PersonalProjects/agent-source-study/codex` | thread event protocol, sandbox/approval shape, command protocol |
| Gemini CLI | `/Users/zhoujunjie/PersonalProjects/agent-source-study/gemini-cli` | project-scoped sessions, memory files, plan/read-only mode, slash commands |
| Goose | `/Users/zhoujunjie/PersonalProjects/agent-source-study/goose` | action-required API, retry/success checks, extensions/subagents |
| Cline | `/Users/zhoujunjie/PersonalProjects/agent-source-study/cline` | provider/model catalog, tool-use prompt discipline, VS Code agent UX |
| Roo Code | `/Users/zhoujunjie/PersonalProjects/agent-source-study/Roo-Code` | checkpoints, modes, provider capability metadata, delegation tests |
| Continue | `/Users/zhoujunjie/PersonalProjects/agent-source-study/continue` | rules, context providers, streaming tool calls, Plan Mode boundary |
| Aider | `/Users/zhoujunjie/PersonalProjects/agent-source-study/aider` | edit formats, git safety, auto-lint/test loops, token/cost reporting |
| OpenHands | `/Users/zhoujunjie/PersonalProjects/agent-source-study/OpenHands` | sandbox/runtime architecture, repo integrations, conversation metadata |

## High-Value Patterns

### 1. Permission Requests Need A Real Blocking Primitive

OpenCode has a small and useful pattern in `internal/permission/permission.go`: a permission request is published as an event and the tool execution waits on a response channel. It also distinguishes one-time grant, persistent session grant, deny, and auto-approve session.

Orbit already has an approval queue, but it should converge on this shape:

- `requestApproval()` creates a durable approval event.
- Tool execution blocks until approve/deny/cancel.
- A restored approval does not pretend to recover the old Promise; it maps to a concrete resume action.
- Session-scoped grants are explicit and visible.

Concrete Orbit work:

- Make `useApprovalQueue` the only command/write approval gate.
- Store `grantScope: "once" | "session" | "project"` on approvals.
- Add a UI affordance for “本次允许 / 当前会话允许 / 当前项目允许”.
- Ensure deny is a tool result consumed by the agent, not just a UI state.

### 2. Thread Events Should Be A Typed Protocol, Not Ad-Hoc Timeline Items

Codex exposes a strong `ThreadItem` union: user messages, agent messages, plan, reasoning, command execution, file change, MCP tool call, dynamic tool call, web search, image, context compaction, etc.

Orbit should copy the idea, not the exact schema. A mature desktop UI becomes simpler when ThreadCanvas and ReviewDock read the same event protocol.

Concrete Orbit work:

- Replace scattered `AgentEvent` display-specific fields with a typed `ThreadEvent`.
- Keep UI-specific labels in i18n, not in the stored event.
- Treat `commandExecution`, `patchProposal`, `verification`, `question`, and `contextCompaction` as first-class event types.
- Let ThreadCanvas render summaries and ReviewDock render operations from the same source.

### 3. Command Execution Should Always Be Structured

Codex command protocol uses an argv vector plus cwd, environment, PTY, output caps, timeout, and sandbox policy. This aligns with Orbit's current direction.

Concrete Orbit work:

- Keep agent tool schema as `{ command, args, cwd?, reason }`.
- Forbid `cd x && y` in agent-generated commands.
- Store `cwd`, timeout, env overrides, output cap, risk category, approval id, and terminal run id.
- Parse shell fallback only for legacy/manual input, never for model tool calls.

### 4. Plan Mode Must Be A Real Read-Only Mode

Continue explicitly adds a Plan Mode context that says the agent only has read-only tools and must not write/delete/create files. This is the clean boundary Orbit needs.

Concrete Orbit work:

- In Plan mode, register only read/search/list tools.
- Emit detailed plans in the user's language.
- Make Plan output include questions, recommended choices, task breakdown, files/interfaces, validation, risks, assumptions.
- If the user asks to proceed, switch to Build with the plan attached as context rather than reinterpreting free text.

### 5. Project-Scoped Sessions And Checkpoints Are Non-Negotiable

Gemini CLI stores sessions by project hash and supports session browser/checkpoints. Roo Code uses shadow checkpoint repositories to isolate task changes from the user's real repo. Aider commits/checkpoints before edits when git is available.

Orbit cannot depend on Git for all projects, but it still needs a comparable safety model.

Concrete Orbit work:

- Finish `ThreadSession` per `workspacePath`.
- Add task-level checkpoint metadata:
  - pre-patch file snapshots for non-git projects
  - optional shadow git store for git projects
  - rollback button in ReviewDock history
- Make every patch proposal linked to `workspacePath + threadId + taskId`.

### 6. Model Capability Catalog Should Be Separate From Provider Runtime

Cline/Roo keep rich provider/model metadata: context window, max output, images, prompt cache, reasoning effort, pricing, special request shape. They also treat API-reported metadata as incomplete and supplement it from a catalog.

Concrete Orbit work:

- Keep `ProviderAdapter` for runtime calls.
- Keep `ModelCapabilityCatalog` for metadata and official fallbacks.
- Model selection should show:
  - context length
  - max output
  - tool call support
  - streaming
  - reasoning levels
  - build support
  - source: API / official table / manual
- Build guard should use capability, not provider id.

### 7. Context Management Needs Policy, Not Just Truncation

Gemini CLI documents automatic chat compression. Aider summarizes history based on token budget and model limits. Continue loads local rules and context providers deliberately.

Concrete Orbit work:

- Use model `maxContextTokens` to compute warning/compact thresholds.
- Store `ContextCompactionState`.
- Prefer provider-based structured summary; fallback to deterministic local summary.
- Preserve: user goal, constraints, files read, tool results, pending approvals, patch proposals, validation status.
- Show “上下文已压缩” as a timeline event with expandable details.

### 8. Tool Call Parsing Needs Repair Loops And Telemetry

Continue validates tool call args before execution and turns validation failures into tool results. Aider explicitly handles malformed edit formats and can ask the model to retry. Goose has retry/success-check primitives.

Concrete Orbit work:

- Treat invalid JSON/tool schema as a recoverable model error for N attempts.
- Store `toolCallParseError` events with the raw model excerpt.
- Add user actions: “重新规划”, “降低任务粒度”, “换模型”, “复制调试信息”.
- Add model-specific repair prompts for DeepSeek and OpenAI-compatible providers.

### 9. Review Dock Should Be A Work Queue, Not A Misc Panel

Across Codex/OpenCode/Goose, the operation surface is event-driven: action required, command result, file change, retry, session state.

Concrete Orbit work:

- `ReviewDockQueueModel` should group current scoped work:
  - command approvals
  - questions
  - patch reviews
  - verification approvals
  - terminal runs
  - history
- The center thread should never duplicate full approval cards or full diffs.
- Counts should only include pending current-scope work by default.
- History should be folded and searchable.

### 10. Rules, Memories, Skills, Hooks Should Be Added In This Order

Mature agents all converge on persistent instruction layers:

- Gemini CLI: `GEMINI.md`
- Claude Code behavior: project instructions / skills / hooks
- Continue: `.continue/rules`, context providers
- Goose: extensions, subagents, recipes
- Cline/Roo: modes, rules, skills, custom instructions

Orbit should add these cautiously:

1. `ORBIT.md` project instructions, read-only and always visible.
2. User-level instructions in settings.
3. Project memories, explicitly reviewed and deletable.
4. Hooks for local events: before command, after patch, after verification.
5. Skills as local prompt/tool bundles.
6. MCP after command/patch/review basics are stable.

## What Orbit Should Not Copy

- Do not bypass Orbit's ReviewDock transaction flow by copying direct write tools.
- Do not make Git mandatory for rollback; many user projects are not repositories.
- Do not add fake provider support. If Build is not wired, show “执行未接入”.
- Do not copy Codex UI assets or closed-source implementation details.
- Do not expand subagents before single-task resume/patch/verification is reliable.

## Prioritized Backlog For Orbit

### P0: Make One Real Task Reliable

- Stable `AgentRunSession` scoped by `workspacePath + threadId + taskId`.
- Strict structured command and patch tool schema.
- Real approval blocking and restored resume actions.
- Patch proposal → sandbox → diff → transactional apply → verification approval.
- DeepSeek repair loop for invalid tool output.
- Manual smoke: create `orbit-mini-lab` in `/Users/zhoujunjie/PersonalProjects/test for orbit`.

### P1: Make The Workbench Understand Its Own History

- Project-scoped multi-thread sessions.
- Typed `ThreadEvent` protocol.
- ReviewDock scoped queues with folded history.
- Terminal run records linked to approvals/tasks.
- Context compaction events.
- Session browser and search.

### P2: Make Provider/Model Handling Mature

- Capability catalog separate from provider adapters.
- API import memory and recovery.
- Build guard by capability.
- Provider smoke status.
- Context length and reasoning levels in Composer.

### P3: Add Power-User Extensibility

- `ORBIT.md` project instructions.
- Local memories with review/delete.
- Hooks.
- Skills.
- MCP.
- Subagents only after the above is stable.

## Suggested Orbit Interfaces

```ts
type ThreadEvent =
  | { type: "userMessage"; id: string; threadId: string; content: UserInput[] }
  | { type: "plan"; id: string; threadId: string; text: string; language: string }
  | { type: "agentSummary"; id: string; threadId: string; eventKey: string; params?: unknown }
  | { type: "commandExecution"; id: string; taskId: string; command: string; args: string[]; cwd: string; status: TerminalStatus }
  | { type: "patchProposal"; id: string; taskId: string; status: PatchStatus; files: PatchFileSummary[] }
  | { type: "question"; id: string; taskId: string; status: QuestionStatus; question: string }
  | { type: "verification"; id: string; taskId: string; command: string; args: string[]; status: ApprovalStatus }
  | { type: "contextCompaction"; id: string; threadId: string; summaryId: string };
```

```ts
type ApprovalGrantScope = "once" | "session" | "project";

type ApprovalRequest = {
  id: string;
  workspacePath: string;
  threadId: string;
  taskId: string;
  kind: "command" | "write" | "install" | "network" | "verification";
  risk: "low" | "medium" | "high" | "blocked";
  grantScope?: ApprovalGrantScope;
  payload: unknown;
  status: "pending" | "approved" | "denied" | "cancelled";
};
```

```ts
type ModelCapability = {
  maxContextTokens?: number;
  maxOutputTokens?: number;
  reasoningLevels: string[];
  toolCalls: boolean;
  streaming: boolean;
  buildSupported: boolean;
  capabilitySource: "api" | "officialTable" | "manual";
};
```

## Immediate Recommendation

Do not start with MCP, hooks, or subagents. The most useful lesson from these mature agents is that the “boring” contract layer matters most:

1. Typed events.
2. Scoped sessions.
3. Blocking approvals.
4. Structured tools.
5. Recoverable model/tool errors.
6. Durable file-change history.

Once those are solid, Orbit's desktop UI can become genuinely stronger than CLI-only agents because it can make approvals, diffs, terminal output, project memory, and model capability visible without flooding the center conversation.
