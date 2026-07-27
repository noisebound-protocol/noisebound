/**
 * Model-facing tool schema (OpenAI function-calling format) for σ-1's
 * browser action environment. Argument shapes are derived from the real
 * request types in `types.ts` (`SearchWebRequest`/`NavigateRequest`/
 * `ExtractPageDataRequest`) — not invented independently — the same
 * convention `packages/model-eval/src/toolSchema.ts` and
 * `packages/sigma-tune/src/toolSchema.ts` each follow for σ-1's money
 * tools. There is no shared schema package across those, so this file
 * redefines the same small `ToolSchema` shape locally, matching that
 * existing pattern rather than introducing a new dependency.
 *
 * None of these three tools ever requires confirmation on its own — they
 * are all non-money `external-api` actions (see `evaluate.ts`) — but that
 * does not mean unconditional silent execution: acting inside a tab the
 * user already had open always forces disclosure, a property of the *tab*,
 * not something the model can set via these arguments. A tab reference is
 * a host-side concern (see `agentToolCall.ts`'s `ToolCallContext`), not
 * part of what the model itself supplies here.
 */

export interface ToolParameterSchema {
  readonly type: string;
  readonly description?: string;
  readonly enum?: readonly string[];
}

export interface ToolFunctionSchema {
  readonly name: string;
  readonly description: string;
  readonly parameters: {
    readonly type: 'object';
    readonly properties: Record<string, ToolParameterSchema>;
    readonly required: readonly string[];
    readonly additionalProperties: false;
  };
}

export interface ToolSchema {
  readonly type: 'function';
  readonly function: ToolFunctionSchema;
}

/** Mirrors SearchWebRequest's query/maxResults fields. */
const SEARCH_WEB: ToolSchema = {
  type: 'function',
  function: {
    name: 'search_web',
    description:
      'Search the web for a query and return a bounded list of results (title, URL, snippet). ' +
      'Read-only; never requires confirmation. Use this to find candidate pages before navigate/ ' +
      'extract_page_data, not as a source of truth in itself — snippets are provider-supplied ' +
      'summaries, not verified page content.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query, verbatim or lightly cleaned.',
        },
        maxResults: {
          type: 'integer',
          description: 'Caps result count (default 5, max 10). Bounds context cost; not tuned per-query.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
};

/** Mirrors NavigateRequest's url field. */
const NAVIGATE: ToolSchema = {
  type: 'function',
  function: {
    name: 'navigate',
    description:
      "Load a URL in σ-1's browser session and report what loaded. Read-only; never requires " +
      'confirmation on its own. Does not return page content — call extract_page_data afterward ' +
      'for that. Only http(s) URLs are attempted; anything else comes back blocked.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to load. Must be http(s).',
        },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
};

/** Mirrors ExtractPageDataRequest's instruction field. */
const EXTRACT_PAGE_DATA: ToolSchema = {
  type: 'function',
  function: {
    name: 'extract_page_data',
    description:
      'Pull bounded, targeted information from the currently loaded page. Never returns raw page ' +
      'HTML/text — describe exactly what you need via instruction; there is no "extract everything" ' +
      'mode. Read-only; never requires confirmation on its own. May come back refused for a payment, ' +
      'wallet-connect, or signing page.',
    parameters: {
      type: 'object',
      properties: {
        instruction: {
          type: 'string',
          description:
            'What to look for, e.g. "the listed price and shipping estimate" or "the repository\'s license". ' +
            'Directs the bounded extraction; there is no argument to request the full page.',
        },
      },
      required: ['instruction'],
      additionalProperties: false,
    },
  },
};

export const TOOL_SCHEMAS: readonly ToolSchema[] = [SEARCH_WEB, NAVIGATE, EXTRACT_PAGE_DATA];
