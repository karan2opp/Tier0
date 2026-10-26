# Tier 0: Product Requirements Document

> **Tier 0 is a voice-first AI support desk for Windows laptops. A front-desk agent answers every customer, then routes them to a specialist: warranty and device info, troubleshooting, or repair pickup and delivery. The troubleshooter diagnoses the real machine, fixes what it safely can, and hands everything else to a human engineer with the full case attached.**

Status: Draft v2 (hackathon build, solo)
Stack decision: Node.js + TypeScript (Express backend, React web app), PowerShell tools for Windows. Customers talk to the agents in the browser; no phone number is needed.

---

## 1. Problem

Laptop support today means waiting on hold, repeating yourself to each person, and getting generic scripted advice. Most calls are the same ~50 Windows problems (slow PC, full disk, Wi-Fi drops, missing drive, battery drain), yet each one burns an engineer's time. When a repair is needed, the customer is left guessing about pickup and status.

## 2. Product vision

Today a customer with a laptop problem calls customer care and lands directly on a human. Tier 0 is the layer in front of human support ("Tier 1"). The customer first talks to a voice agent, which transfers them to the right specialist:

1. **Front-desk agent** greets the customer, identifies them, understands the intent, and routes.
2. **Info/Warranty agent** answers questions about the customer's laptop and warranty from device records.
3. **Troubleshoot agent** diagnoses the actual machine with read-only tools, fixes a closed set of well-understood problems using allowlisted, previewed, confirmed, and verified actions, and knows its limits. Anything outside its playbooks, or anything risky, goes to a human engineer with a complete case summary.
4. **Service Concierge agent** owns the repair journey: when the laptop will be picked up, repair status, when it will be delivered back, and rescheduling.
5. **Human engineer** takes over with the whole case attached (warm handoff).

All agents share one case file, so the customer never repeats themselves.

**Core principle: be reliable inside a small scope instead of mediocre across a large one.** Handoff is a feature, not a failure.

## 3. Goals and non-goals

### Goals
- G1. Resolve a defined set of common Windows problems end to end (diagnose, fix, verify).
- G2. Escalate correctly: never guess outside scope, never touch data at risk.
- G3. Show real multi-agent orchestration with a shared case file and visible handoffs.
- G4. Make agent access to a machine demonstrably safe (tool allowlist, consent, audit).
- G5. Measure quality with a repeatable evaluation harness and publish the numbers.
- G6. Cover the post-escalation lifecycle (repair tickets, pickup, ready notifications).

### Non-goals
- Open-ended troubleshooting of arbitrary issues.
- Free-form command execution by the model (never).
- macOS / Linux support.
- Real telephony (Twilio, a purchased phone number). Customers use voice in the browser. Phone support is future work: the same agent backend can sit behind a phone number later, since voice is only the input/output channel.
- Payments, real CRM or ERP integrations. These are mocked.
- Fixing hardware damage, data recovery, or anything involving formatting or partitioning.

## 4. Users

| User | Need |
|---|---|
| **Customer** (laptop owner) | Fast, understandable help; no repeating; clear repair status |
| **Support engineer** (human) | Receives only the cases that need them, with diagnostics and steps already tried |
| **Support manager / judge** | Visibility into what the agents did and why; measurable accuracy |

## 5. Scope and priorities

### P0: must ship
1. **Orchestrator** with shared case file, event log, and agent-to-agent transfer
2. **Front-desk agent**: greeting, customer identification, intent routing
3. **Info/Warranty agent** and **Service Concierge agent** on mock customer/device/ticket data (pickup and delivery answers, "is it ready?")
4. **Tool layer** with interchangeable providers (real Windows, simulated scenario)
5. **Troubleshoot agent** running playbooks, with **8-10 fully built playbooks**
6. **Fix library** (5-6 low-risk fixes) with dry-run, confirm, and verify
7. **Human handoff** with an auto-generated case summary
8. **Web app**: chat with browser voice (Web Speech API in, `speechSynthesis` out), per-agent name/voice badge, live case/trace view, engineer queue
9. **Evaluation harness** and results in the README
10. README, architecture diagram, demo video

### P1: should ship
11. Simulated "engineer marks ready" control that triggers proactive outbound messages
12. Warranty decision (covered vs. paid repair) feeding the repair flow
13. Remaining playbooks as guided-steps-only (to reach 50)
14. **Helper** (remote-support companion) with pairing code, see section 6.1

### P2: if time allows
15. Better STT/TTS voices (hosted Whisper, OpenAI TTS)
16. Quote approval flow
17. Post-repair follow-up and case reopening
18. Persistent customer memory across cases
19. Hosted simulation-only deployment so judges can try it with no install

## 6. System architecture

```
 Customer (browser: voice + chat)
        |
        v
 +--------------------------------------------------------------+
 |                        ORCHESTRATOR                          |
 |  shared case file, agent transfer, policy gate, audit log    |
 +---+------------------+------------------+------------------+-+
     |                  |                  |                  |
 +---v---------+  +-----v--------+  +------v-------+  +-------v--------+
 | Front-desk  |  | Info/Warranty|  | Troubleshoot |  | Service        |
 | (greet, ID, |  | (device,     |  | (playbooks,  |  | Concierge      |
 |  intent)    |  |  warranty)   |  |  fixes)      |  | (pickup, ETA,  |
 +-------------+  +--------------+  +------+-------+  |  delivery)     |
                                           |          +----------------+
                                calls only allowlisted tools
                           +---------------v---------------+
                           |          TOOL LAYER           |
                           |    Diagnostics  |  Fixes      |
                           +---+-----------+-----------+---+
                               |           |           |
                       +-------v--+  +-----v-----+  +--v-------------+
                       | Local    |  | Simulated |  | Remote         |
                       | (server  |  | (scenario |  | (via helper    |
                       | machine) |  |  YAML)    |  |  WebSocket)    |
                       +----------+  +-----------+  +----------------+

 Human engineer <--- warm handoff (case summary + readings + steps tried)
```

### Components

**Orchestrator.** Owns the case file (`Case`), decides which agent acts next, enforces the policy gate (risky actions need confirmation; out-of-scope needs escalation), and writes every step to the audit log. Deterministic TypeScript code around LLM calls, not a free-roaming agent framework.

**Front-desk agent.** Opens every conversation. Greets, identifies the customer (mock lookup by phone/email/ticket ID), classifies intent with structured output, and transfers to the right agent or to a human. Asks at most one or two clarifying questions.

**Info/Warranty agent.** Answers laptop and warranty questions (model, purchase date, coverage, expiry) strictly from the device database. If the data is missing it says so; it never invents answers.

**Troubleshoot agent.** Matches the problem to a playbook with a confidence score, runs the listed read-only tools, interprets results by decision rules, proposes a fix, and re-checks after the fix. The LLM interprets and explains; playbook rules and thresholds are data, not prompt text. Low confidence or no match means escalate.

**Service Concierge agent.** Answers repair-journey questions: pickup time, repair status, expected delivery, delay reasons, rescheduling (see section 9). Verifies identity before disclosing anything and only states what the ticket contains.

**Tool layer.** The only way anything touches the machine. Each tool is a named TypeScript function wrapping a fixed PowerShell command. A `provider` switch selects `local` (server and device are the same machine, used for the demo), `simulated`, or `remote` (through the helper).

**Transfers.** Voice is one browser session; a transfer changes the active agent. The UI shows the new agent's name and badge and each agent can use a distinct TTS voice. Agents can transfer to each other (e.g. Troubleshoot to Concierge to book a pickup).

**Human engineer view.** A queue of escalated cases with the generated summary and a "join" action (simulated warm transfer).

### 6.1 Access model: how tools reach the user's machine

A web page cannot read disks, drivers, or logs. Something must run on the machine being diagnosed.

1. **Local (demo default):** the Express server runs on the demo laptop and executes the fixed PowerShell scripts directly. Fully real, zero install.
2. **Helper (P1):** a small Node program the customer runs (`pnpm helper`, optionally compiled to a single `.exe`). They enter a pairing code shown in the web app. The helper connects **outbound** to the server over WebSocket (no inbound ports) and executes only allowlisted tools. The server sends a tool name, never a command. Consent, fix-confirm, and an activity log appear in a small page served on `localhost` by the helper; closing it ends access.
3. **Simulated:** scenario files, used for repeatable demos, tests, and an optional hosted version.

The agent code is identical in all three; only the provider changes.

### 6.2 Voice

Browser-only: `SpeechRecognition` (Web Speech API, Chrome/Edge) for input and `speechSynthesis` for output, wrapped around the same chat endpoint. Text chat remains the fallback. Better hosted STT/TTS is an optional upgrade.

## 7. Playbooks

A playbook is a YAML file:

```yaml
id: disk-full
title: Low disk space
phrases: ["no space", "disk full", "storage almost full", "c drive red"]
diagnostics: [get_disk_usage, get_reclaimable_temp]
rules:
  - if: disk.free_percent < 10
    then: propose_fix clear_temp_files
  - if: disk.smart_status != "Healthy"
    then: escalate "Drive health warning"
fixes: [clear_temp_files, empty_recycle_bin]
verify: get_disk_usage          # must improve
escalate_when:
  - fix_failed_twice
  - unexpected_tool_output
risk: low
```

### Problem catalogue (target: 50; P0 builds 8-10 fully)

| Area | Problems |
|---|---|
| Performance (10) | slow overall; high CPU; high RAM; 100% disk; slow boot; too many startup apps; random freezes; apps not responding; slow after update; suspicious process |
| Battery and power (8) | drains fast; not charging; plugged in not charging; stuck percentage; sudden shutdown; sleep not working; won't wake; wrong power plan |
| Heat and noise (4) | overheating; loud fan; thermal throttling; hot while idle |
| Storage (5) | low space; SMART warning; **drive not showing**; temp files; large files |
| Network (8) | Wi-Fi won't connect; keeps dropping; connected no internet; slow; DNS errors; Wi-Fi option missing; Bluetooth; VPN |
| Display and audio (6) | flicker; scaling; external monitor; no sound; mic; brightness |
| Input and peripherals (4) | keyboard; touchpad; USB; webcam |
| Windows and software (5) | update failing; BSOD; driver issue; locked out *(always escalate)*; install/uninstall failure |

**Always escalate (by design):** cracked screen, liquid damage, swollen battery, drive health failing, RAW/unallocated disks, data loss, security incidents, account lockout.

### P0 fully-built set (suggested)
disk-full, drive-not-showing, high-cpu, high-ram, slow-boot/startup-apps, battery-health, not-charging, overheating, wifi-drops, no-internet, dns-errors, power-plan, windows-update-stuck, bsod-info, driver-problem, 100%-disk, sound-no-output.

## 8. Tools

### 8.1 Diagnostic tools (read-only)
| Tool | Source |
|---|---|
| `get_battery_health` | `powercfg /batteryreport` or WMI |
| `get_temperatures`, `get_cpu_usage`, `get_ram_usage` | WMI / performance counters |
| `get_disk_usage`, `get_disk_health` | `Get-Volume`, `Get-PhysicalDisk` |
| `detect_drives` | `Get-Disk`, `Get-Partition`, `Get-Volume` |
| `get_startup_apps` | startup registry keys / Task Manager data |
| `get_top_processes` | `Get-Process` |
| `get_network_status` | `Get-NetAdapter`, ping, DNS resolve test |
| `get_recent_errors` | `Get-WinEvent` (critical/errors, last N, scrubbed) |
| `get_driver_versions` | `Get-PnpDevice` |
| `get_system_info` | model, OS build, uptime (serial/hostname scrubbed) |

### 8.2 Fix tools
Each has: `preview()`, `apply()`, `verify()`, `risk`, `reversible`, `needs_admin`.

| Fix | Risk |
|---|---|
| `clear_temp_files` (older than 24h, fixed paths, skip locked) | low |
| `empty_recycle_bin` (extra-clear warning, irreversible) | low |
| `flush_dns` | low |
| `restart_wifi_adapter` | low |
| `restart_explorer` | low |
| `set_power_plan` | low |
| `disable_startup_app` | low |
| `end_process` (approved, non-critical only) | low |
| `rescan_disks` | low |
| `reset_network_stack` | medium (reboot) |
| `bring_disk_online`, `assign_drive_letter` | medium (admin) |
| `run_sfc` / `run_dism` | medium (slow, admin) |

**Never automated:** initialize, format, partition, `chkdsk /f`, registry-wide edits, disabling AV/firewall, anything under Documents/Desktop/Downloads.

### 8.3 Drive detection flow (example)
`detect_drives` reports each physical disk, state, partition style, letters, and health, and compares with what the user expects.

| Finding | Action |
|---|---|
| Volume without letter | `assign_drive_letter` |
| Disk offline | `bring_disk_online` |
| RAW / unallocated | **escalate, do not touch** |
| Not listed | `rescan_disks`, then guided checks, then escalate |
| Health Warning/Unhealthy | escalate and advise backup |

## 9. Service Concierge (repair lifecycle)

### Ticket states
```
Created > Pickup scheduled > Pickup confirmed > Received > Diagnosing
 > [Awaiting approval (quote)] > [Awaiting parts] > Repairing > QA check
 > Ready > Delivered/Picked up > Follow-up > Closed
```

### Behaviours
- **Inbound:** "Is my laptop ready?", "Change my pickup time", "Why is it delayed?" Answers come only from ticket data. If the data doesn't say, the agent says it doesn't know and flags it.
- **Outbound (event-driven):** pickup confirmation request, status changes, ready-for-pickup, post-delivery follow-up.
- **Scheduler loop:** detects missed pickups and stale tickets and acts without being asked.
- **Identity check** (ticket ID plus OTP, mocked) before disclosing or changing anything.
- **Escalation:** angry customer, repeated delay, or out-of-policy request goes to a human.

## 10. Simulation layer

- Every tool call goes through `provider.call(tool, args)`.
- **Simulated provider** reads a scenario YAML describing machine state per tool plus `fix_effects` (what changes after a fix) and `expected_outcome`.
- UI always labels runs: `Simulation mode: <scenario id>`.
- Scenarios double as test cases for the evaluation harness.
- Demo also includes one **real, live** segment (e.g. CPU-stress script as culprit, or USB stick set offline).

Starter scenarios: disk-full (fixable), runaway-cpu (fixable), wifi-dns (fixable), drive-offline (fixable), battery-degraded (warranty escalate), raw-disk (escalate, refuse), unknown-issue (escalate), bsod-hardware (escalate).

## 11. Safety requirements

| ID | Requirement |
|---|---|
| S1 | The model never writes or edits commands. It selects a named tool and the code decides the rest. |
| S2 | All tool arguments are validated; values like disk numbers must come from earlier tool output; the system disk is never targeted. |
| S3 | Consent screen shows exactly what will be collected before the first diagnostic. |
| S4 | Every fix shows a dry-run preview and needs an explicit confirm. |
| S5 | Fixes verify themselves; before/after values are shown. |
| S6 | Usernames, hostnames, serials, and file paths are scrubbed before data leaves the machine. |
| S7 | Tool output is treated as data. System prompt states that text in logs is never an instruction. |
| S8 | Full audit log of tool calls, results, decisions, and confirmations. |
| S9 | Kill switch: stop button cancels the run and further tool calls. |
| S10 | Secrets (API keys) live on the backend only, in `.env`, never committed. |

## 12. Data model (SQLite)

- `Customer(id, name, phone, email)`
- `Device(id, customer_id, model, purchase_date, warranty_until)`
- `Case(id, customer_id, device_id, status, playbook_id, confidence, summary, created_at)`
- `CaseEvent(id, case_id, ts, actor, type, payload)` (the audit/trace log)
- `ToolRun(id, case_id, tool, args, result, provider, ts)`
- `Fix(id, case_id, fix_name, preview, approved_by, result, verified)`
- `RepairTicket(id, case_id, state, pickup_slot, eta, notes)`
- `Slot(id, technician, start, end, booked)`
- `Message(id, case_id, direction, channel, body, ts)`

## 13. API (Express, sketch)

```
POST /cases                      create case from customer message
POST /cases/{id}/message         customer message -> orchestrator
POST /cases/{id}/fixes/{n}/approve | /skip
GET  /cases/{id}                 case, trace, tool runs
GET  /cases/{id}/stream          SSE live trace for dashboard
POST /cases/{id}/escalate        manual handoff
GET  /engineer/cases             escalated queue
POST /tickets/{id}/state         engineer changes repair state (demo button)
GET  /tickets/{id}
POST /simulate/scenario/{id}     load a scenario
POST /eval/run                   run evaluation suite
```

## 14. UI

1. **Customer panel:** chat (optional mic), consent dialog, fix preview cards with Approve/Skip/Talk to engineer, verification result.
2. **Live trace panel:** timeline of routing, tool calls, readings, decisions, handoffs, with provider badge (real/simulated).
3. **Engineer queue:** escalated cases with generated summary (complaint, readings, steps tried, suggested next step).
4. **Repair ticket view:** state machine, "engineer marks ready" demo button, outbound message log.
5. **Eval page:** latest accuracy numbers.

## 15. Models and cost

- Provider abstraction (`llm.complete(role, messages)`) so models can be swapped.
- Open models (Groq / OpenRouter / local Ollama) for most calls; OpenAI ($5 credit) reserved for routing and diagnosis reasoning where reliability matters.
- Structured output (JSON) for triage and decisions; low temperature.
- Cache playbook-matching results; cap tokens per case. Target < $0.02 per resolved case.
- Alan AI usage is optional. If time allows, report feedback for bonus points.

## 16. Evaluation

| Metric | Method | Target |
|---|---|---|
| Routing accuracy | 3-5 phrasings per playbook (about 75 test queries) | >= 90% |
| Correct escalation | about 20 out-of-scope / risky queries must escalate | >= 95% |
| Fix success (simulated) | every fixable scenario ends verified | 100% |
| Unsafe action rate | prompt-injection tests (log lines with instructions), forbidden-fix attempts | 0 |
| Handoff quality | case summary contains complaint, readings, steps tried | manual check |

Results go into the README as a table.

## 17. Tech stack and repo layout

- Node.js 22 + TypeScript across server, web, and helper
- Server: Express + `ws` (WebSocket relay for the helper)
- Validation: Zod (tool args, WebSocket messages, LLM structured output)
- LLM: OpenAI-compatible SDK (works with OpenAI, Groq, OpenRouter)
- DB: better-sqlite3
- Windows tools: PowerShell 5.1 via `execFile` with fixed scripts (JSON output via `ConvertTo-Json`, parsed and validated with Zod)
- Web: React + Vite + TypeScript; live trace over Server-Sent Events; voice via Web Speech API and `speechSynthesis`
- Dev runner: `tsx`; tests and eval: Vitest

### Helper (remote-support companion, P1)
- A Node program (`pnpm helper`) that connects **outbound** to the server over WebSocket using a pairing code.
- Accepts only allowlisted tool names; arguments validated with Zod.
- Consent, fix-confirm, and live log run in a small page served on `localhost` by the helper.
- Optional single-file `.exe` via `bun build --compile` or Node SEA.
- Built after the local version works. The tool layer's provider switch makes it an extra provider (`remote`), not a rewrite.

```
tier0/
  README.md
  docs/PRD.md
  .env.example
  server/
    src/
      index.ts
      orchestrator/        # case file, agent transfer, policy gate, audit log
      agents/              # front-desk, info-warranty, troubleshoot, concierge
      tools/               # registry + provider switch (local | simulated | remote)
      fixes/               # preview/apply/verify
      playbooks/           # *.ts or *.yaml
      relay/               # pairing + WebSocket routing to helper (P1)
      db/                  # schema, seed data (customers, devices, tickets)
      llm/                 # provider abstraction
    eval/                  # query sets, runner
  web/                     # React + Vite: chat/voice, trace, engineer queue
  helper/                  # P1: WebSocket client, allowlist, localhost consent page
  scenarios/               # simulated machine states (*.yaml)
```

A simple two-folder layout (`server/`, `web/`) keeps setup fast; shared Zod schemas can move into a `shared/` folder if the helper is built.

## 18. Build plan (one-day scope; adjust to the deadline)

The local build (server on the demo laptop) comes first and is the guaranteed demo. The helper is layered on top only if time remains.

| Phase | Deliverable |
|---|---|
| 1. Foundations | Express + React scaffold, DB with seed data (customers, devices, tickets), LLM provider abstraction, tool interface with local + simulated providers, `detect_drives` working for real |
| 2. Core loop | Orchestrator and case file, front-desk agent with intent routing, Info/Warranty and Service Concierge agents on mock data (text only) |
| 3. Troubleshoot | Playbook runner, first 5 playbooks, escalation with case summary |
| 4. Web UI | Chat, agent badge per transfer, live trace, engineer queue, then browser voice |
| 5. Fixes | 5-6 fixes with preview/confirm/verify, tested on own machine (disposable USB for storage) |
| 6. Breadth and eval | 8-10 playbooks built, eval harness, safety tests |
| 7. Helper (stretch) | WebSocket relay, pairing code, helper with allowlist and localhost consent page |
| 8. Polish (reserve 2-3 h) | README, architecture diagram, demo video, X post, submit |

Cut order if time runs short: helper, extra voices, playbook count. Never cut the README, video, or evaluation numbers.

Commit at the end of each phase. Keep a running "thought process" section in the README.

## 19. Demo script (1-2 min)

1. (10s) Problem: hold music and repeating yourself. Tier 0 answers first, routes to the right specialist, and hands off to a human with the full case.
2. (15s) **Front desk and Info:** customer speaks, the front-desk agent identifies them and transfers to the Info/Warranty agent for "is my laptop under warranty?".
3. (30s) **Troubleshoot (live):** "laptop is slow and fan is loud". Consent, real diagnostics, culprit found, approve fix, verified.
4. (15s) **Handoff:** raw disk / battery failure. Agent refuses to touch it and builds the engineer summary.
5. (20s) **Concierge:** "when will you pick it up / when is it ready?" Engineer clicks "ready"; customer gets a proactive message and reschedules.
6. (10s) Eval numbers and the safety design in one slide.

## 20. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Scope creep | Strict P0/P1/P2; only 8-10 playbooks built deep |
| Flaky live demo | Simulation as default; one short, rehearsed live segment |
| LLM misrouting | Confidence threshold, clarifying question, escalate on doubt, eval harness |
| Dangerous fix | Allowlist, preview, confirm, never-automate list, test on disposable USB / VM |
| Prompt injection via logs | Scrubbing, "data not instructions", no free-form commands |
| API budget ($5) | Open models by default, token caps, caching |
| Windows permission quirks | Separate admin-needed fixes; show UAC; test early |
| Time | Helper is a stretch goal; voice is a thin browser layer over the chat endpoint, text chat is the fallback |

## 21. Submission checklist

- [ ] Public GitHub repo with regular commits
- [ ] README: problem, architecture, safety design, eval results, how to run (real and simulation), thought process
- [ ] 1-2 min demo video: problem, working product, brief architecture
- [ ] X post quoting the official launch post with the video; tag Prasad and Alan AI
- [ ] Submission form: name, project name, contact, repo URL, X video link

## 22. Open questions

- Which open model gives the best tool-use/JSON reliability within free tiers?
- Is a spare USB drive or VM available for storage-fix testing?
- Final deadline for submission (to set phase dates)?
