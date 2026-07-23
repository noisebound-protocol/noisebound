# Spec: money-send flow through the confirmation dialog (Base Sepolia)

Scope: `ActionTriggerForm` -> `evaluateSendActionTrigger` -> `ActionOutcomeDialog`
on `/notifications`, covering both the single-confirmation UI state
(`awaiting-confirmation`) and the secondary-confirmation UI state
(`requires-secondary-confirmation`). Assertions stop at the confirmation
dialog: click "Stay private, reduced capability" to dismiss instead of the
warning/primary confirm button, since confirming triggers a real on-chain
broadcast via `executeOnChainMoneyAction` — that belongs to the separate
live-broadcast test called out as out of scope in the task.

Preconditions:
- Dev server running via `scripts/start-dev-server.sh` (or `.ps1`), which
  seeds the recipient-history store from
  `fixtures/recipient-history.seed.json` — this pre-seeds
  `0x70997970c51812dc3a010c7d01b50e0d17dc79c8` as a "known" recipient so the
  novelty gate (`evaluateEscalation`, `packages/sigma-core/src/escalation.ts`)
  doesn't force secondary confirmation on every case regardless of amount.
- An identity exists in the browser (run Case B or C from
  `01-wallet-import.md` first, or load `fixtures/identity-keypair.valid.json`
  via the same import flow) — `/notifications` doesn't require a session key
  to *evaluate* an action, only to actually execute one.

## Case A — single confirmation (known recipient, amount within spend limit)

Threshold logic: an amount ≤ 1 ETH (`DEFAULT_MAX_SPEND_WEI`,
`packages/sigma-core/src/escalation.ts`) to an already-known recipient
resolves to `awaiting-confirmation` — a single confirmation, no typed-amount
step.

1. Navigate to `http://localhost:3000/notifications`.
2. In the "Trigger an action" panel, fill "Recipient address"
   (`#action-recipient`) with `0x70997970c51812dc3a010c7d01b50e0d17dc79c8`
   and "Amount (ETH)" (`#action-amount`) with `0.01`.
3. Click "Evaluate action". Assert the button shows "Evaluating…" while
   pending.
4. Assert a modal appears titled "Leave the private zone?" with body text
   `Send 0.01 ETH to 0x709...9c8` (the confirmation summary truncates the
   recipient to first-5/last-3 chars — see
   `packages/sigma-execute/src/confirmation.ts` `truncateAddress`, a
   different helper than `apps/app/lib/format.ts`'s) and two buttons: one showing that same
   truncated summary (the confirm action) and "Stay private, reduced
   capability".
5. Assert there is **no** "Type ... to confirm" input in this state (that
   only appears for secondary confirmation).
6. Click "Stay private, reduced capability". Assert the dialog closes and no
   navigation/execution occurred (still on `/notifications`).

## Case B — secondary confirmation via amount over spend limit

Same known recipient, amount `1.5` ETH (> 1 ETH threshold) forces
`requires-secondary-confirmation` purely on amount, independent of recipient
novelty.

1. Navigate to `http://localhost:3000/notifications` (fresh evaluation; a
   full page reload is fine).
2. Fill recipient with `0x70997970c51812dc3a010c7d01b50e0d17dc79c8` and
   amount with `1.5`.
3. Click "Evaluate action".
4. Assert a modal titled "Extra confirmation required" appears, with the
   banner text "This exceeds your spend-limit threshold" and body
   `Send 1.5 ETH to 0x709...9c8` (same truncated-recipient summary format as
   Case A).
5. Assert the initial (un-armed) state shows a warning-styled confirm button
   and "Stay private, reduced capability" — no typed-amount input yet.
6. Click the warning confirm button to arm it. Assert a label "Type 1.50 to
   confirm" and a text input (`#secondary-confirm-amount`) now appear, and
   the confirm button is disabled.
7. Type `1.49` into the input. Assert the confirm button stays disabled
   (mismatch).
8. Clear and type `1.50`. Assert the confirm button becomes enabled.
9. **Do not click the now-enabled confirm button** — that would execute a
   real Base Sepolia transaction, which is out of scope for this suite.
   Instead click "Stay private, reduced capability" and assert the dialog
   closes cleanly.

## Case C — secondary confirmation via unknown recipient (novelty gate)

Confirms the novelty gate independently of the amount threshold: any
first-time recipient forces secondary confirmation even for a tiny amount.

1. Navigate to `http://localhost:3000/notifications` with the recipient
   history fixture still only seeded with the address from Case A/B (i.e.
   don't reuse an address already sent to in this run).
2. Fill recipient with a fresh, never-before-used, well-formed 40-hex-char
   address, e.g. `0x1111111111111111111111111111111111111110`, and amount
   `0.001`. (The recipient field's client-side validation
   (`RECIPIENT_PATTERN` in `ActionTriggerForm.tsx`) requires exactly 40 hex
   chars after `0x` — a shorter placeholder like `...0000f0` will be
   rejected before it ever reaches the escalation check.)
3. Click "Evaluate action".
4. Assert the same "Extra confirmation required" modal as Case B appears
   (banner "This exceeds your spend-limit threshold" — the app doesn't
   distinguish novelty-triggered vs. amount-triggered secondary confirmation
   in copy, so assert on the modal state itself, not the specific reason).
5. Dismiss via "Stay private, reduced capability" without arming/confirming.

## Out of scope

- Clicking the final confirm/warning button that calls
  `executeOnChainMoneyAction` and broadcasts a real Base Sepolia transaction,
  and asserting on tx hash / on-chain finality — that's the separate
  live-broadcast test referenced in the Phase 3 QA plan.
- The `deny` outcome path (flagged-pattern recipients) — not part of the
  wallet-import/money-send scope requested for this harness.
- The fixture-driven `EscalationDialog` "Escalation demo" scenario buttons
  further down `/notifications` — those simulate non-money categories and
  aren't part of the money-send flow.
- `base-mainnet` — this harness is Base Sepolia only.
