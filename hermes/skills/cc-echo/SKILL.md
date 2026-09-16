---
name: cc-echo
description: Prove the Command Center job runner works end to end.
version: 1.0.0
author: Ark Commerce
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [command-center, diagnostics]
    category: Tools
---

# cc-echo

## When to Use

A `cc-echo` job is queued (manually, for diagnostics) to prove the
command_center job runner claims jobs, runs them with only job skills and
`cc_*` tools loaded, and marks them done. Never used in production flows.

## Procedure

1. Read the job payload (`note` field, defaults to `echo-ok`).
2. POST a status note through `cc_status` with
   `status_sentence: "cc-echo: <note>"`, `waiting_on: "none"`, `next_step: ""`.
3. Finish. The runner marks the job done. Do nothing else.

## Pitfalls

- No messaging tools are available in a job run. Do not try to send messages.
- No terminal access. Only `cc_*` tools plus this skill.
- If `cc_status` fails, report the error and stop; do not retry in a loop.

## Verification

The job row ends `done`, and a status note containing the payload note exists.
