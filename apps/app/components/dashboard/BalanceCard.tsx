import { formatUnits, formatWeiAsEth } from '../../lib/format';
import { Panel } from '../ui/Panel';
import styles from './BalanceCard.module.css';

interface BalanceCardProps {
  readonly nativeWei: bigint;
  readonly usdcRaw: bigint;
}

export function BalanceCard({ nativeWei, usdcRaw }: BalanceCardProps) {
  return (
    <div className={styles.grid}>
      <Panel className={styles.card}>
        <span className={styles.label}>Native balance</span>
        <span className={styles.value} data-mono>
          {formatWeiAsEth(nativeWei)}
          <span className={styles.symbol}>ETH</span>
        </span>
      </Panel>
      <Panel className={styles.card}>
        <span className={styles.label}>USDC balance</span>
        <span className={styles.value} data-mono>
          {formatUnits(usdcRaw, 6)}
          <span className={styles.symbol}>USDC</span>
        </span>
      </Panel>
    </div>
  );
}
