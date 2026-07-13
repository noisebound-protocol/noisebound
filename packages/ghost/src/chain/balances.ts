import { createPublicClient, http, erc20Abi, formatEther, formatUnits } from 'viem';
import { base } from 'viem/chains';

const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;
const USDC_DECIMALS = 6;

export async function fetchBalances(
  address: string,
  rpcUrl: string,
): Promise<Record<string, string>> {
  const client = createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  });

  const addr = address as `0x${string}`;

  const [ethWei, usdcRaw] = await Promise.all([
    client.getBalance({ address: addr }),
    client.readContract({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [addr],
    }),
  ]);

  return {
    ETH: formatEther(ethWei),
    USDC: formatUnits(usdcRaw as bigint, USDC_DECIMALS),
  };
}
