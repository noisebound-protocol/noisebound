/**
 * Distinguishes a tab σ-1 opened itself from a tab the user already had
 * open before σ-1 touched it. This is a type-level distinction, not just a
 * naming convention: a `TabHandle` can only be produced through
 * `tagAgentOwnedTab`/`tagUserOpenedTab` below (or `BrowserAutomation.
 * openAgentOwnedTab`, which tags internally) — a caller cannot construct
 * one by writing a plain object literal, because `TAB_BRAND` is a real,
 * module-private runtime symbol that never leaves this file. See
 * `evaluate.ts` for how `origin` feeds the escalation gate: acting inside a
 * user-opened tab always forces `require-disclosure`, with no field on
 * either handle type that can suppress it.
 */

const TAB_BRAND: unique symbol = Symbol('sigma-browser.tabOrigin');

export type TabOrigin = 'agent-owned' | 'user-opened';

interface BrandedTabHandle<Origin extends TabOrigin> {
  readonly [TAB_BRAND]: Origin;
  readonly origin: Origin;
  readonly tabId: string;
}

/** A tab σ-1 opened itself. Never a tab the user already had open. */
export type AgentOwnedTabHandle = BrandedTabHandle<'agent-owned'>;

/**
 * A tab the user already had open before σ-1 acted in it. Deliberately has
 * no field that lets a caller mark it as low-risk or pre-disclosed — the
 * mere presence of a `UserOpenedTabHandle` on a request is what forces
 * disclosure in `evaluate.ts`, and that can't be opted out of here.
 */
export type UserOpenedTabHandle = BrandedTabHandle<'user-opened'>;

export type TabHandle = AgentOwnedTabHandle | UserOpenedTabHandle;

/** Tags a raw tab id as agent-owned. Only call this for a tab σ-1 itself opened. */
export function tagAgentOwnedTab(tabId: string): AgentOwnedTabHandle {
  return { [TAB_BRAND]: 'agent-owned', origin: 'agent-owned', tabId };
}

/**
 * Tags a raw tab id as user-opened. Call this only for a tab that existed
 * before σ-1 touched it — doing so is exactly what forces disclosure in
 * `evaluate.ts`, by design; there is no way to tag a user's tab and skip
 * that. This is the sanctioned seam for a future host integration (e.g. a
 * Tauri "user opened this tab" event) to attribute a tab to the user.
 */
export function tagUserOpenedTab(tabId: string): UserOpenedTabHandle {
  return { [TAB_BRAND]: 'user-opened', origin: 'user-opened', tabId };
}
