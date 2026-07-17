import { GetStartedFlow } from '../components/landing/GetStartedFlow';
import { Panel } from '../components/ui/Panel';
import styles from './page.module.css';

const FEATURES = [
  {
    title: 'Acts privately by default',
    body: 'σ-1 executes inside a private zone. Nothing leaves without a disclosed, confirmable escalation.',
  },
  {
    title: 'Hard limits on money',
    body: 'Real-money actions never get an "always allow" toggle — they either fit a session key’s pre-authorized scope, or they’re blocked.',
  },
  {
    title: 'You see what it sees',
    body: 'Every escalation is timestamped and logged. Nothing is buried in a notification wall.',
  },
] as const;

export default function LandingPage() {
  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <p className={styles.kicker}>σ-1 execution agent</p>
        <h1 className={styles.headline}>An agent that acts on your behalf — privately by default.</h1>
        <p className={styles.subhead}>
          σ-1 negotiates, spends, and executes inside a private zone it controls. It asks before it
          steps outside that zone, and it never gets a blank check on real money.
        </p>

        <div className={styles.features}>
          {FEATURES.map((feature) => (
            <Panel key={feature.title} className={styles.feature}>
              <p className={styles.featureTitle}>{feature.title}</p>
              <p className={styles.featureBody}>{feature.body}</p>
            </Panel>
          ))}
        </div>

        <GetStartedFlow />

        <p className={styles.infra}>
          Secured by a post-quantum identity key, underneath. You won&rsquo;t need to think about it.
        </p>
      </div>
    </div>
  );
}
