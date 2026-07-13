import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('node-fetch', () => ({
  default: vi.fn(),
}));

import fetch from 'node-fetch';
import { PQCLLMClient } from '../src/llm/PQCLLMClient.js';
import { pqcTransport } from '../src/crypto/PQCTransport.js';
import type { UserContext } from '../src/parser/types.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PQCLLMClient', () => {
  it('de-identifies user messages before sending, reidentifies the response, and passes raw response to audit envelope', async () => {
    const mockFetch = vi.mocked(fetch);
    const walletAddress = '0x1234567890123456789012345678901234567890';

    // Simulate the LLM echoing the placeholder back
    mockFetch.mockResolvedValueOnce({
      ok: true,
      statusText: 'OK',
      json: async () => ({
        content: [{ type: 'text', text: 'I will process the transfer from [WALLET_0] now.' }],
      }),
    } as ReturnType<typeof fetch> extends Promise<infer R> ? R : never);

    const sealSpy = vi.spyOn(pqcTransport, 'seal').mockResolvedValue({} as never);

    const client = new PQCLLMClient({ apiKey: 'test-key' });
    const context: UserContext = { address: walletAddress, network: 'base', balances: {} };

    const result = await client.chat(
      [{ role: 'user', content: `Send 1 ETH from ${walletAddress}` }],
      context,
    );

    // Returned value must have placeholder reidentified to the real address
    expect(result).toContain(walletAddress);
    expect(result).not.toContain('[WALLET_0]');

    // Message sent to Anthropic must use the placeholder, not the real address
    const fetchCall = mockFetch.mock.calls[0];
    const requestBody = JSON.parse(fetchCall[1]?.body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(requestBody.messages[0].content).not.toContain(walletAddress);
    expect(requestBody.messages[0].content).toContain('[WALLET_0]');

    // Allow fire-and-forget seal to resolve
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    // Audit envelope receives the raw (unmodified) LLM response — original PII never present
    expect(sealSpy).toHaveBeenCalled();
    const auditPayload = sealSpy.mock.calls[0][0] as {
      sanitizedMessages: unknown;
      response: string;
      timestamp: number;
    };
    expect(auditPayload.response).toBe('I will process the transfer from [WALLET_0] now.');
    // The actual wallet address must never appear in the audit envelope response
    expect(auditPayload.response).not.toContain(walletAddress);
    expect(typeof auditPayload.timestamp).toBe('number');
  });
});
