'use client';

import { useEffect, useMemo, useState } from 'react';
import { evaluateEscalation } from '@noisebound/sigma-core';
import { EscalationDialog } from '../escalation/EscalationDialog';
import { ESCALATION_SCENARIOS } from '../../lib/fixtures/escalationFixtures';
import type { EscalationScenario } from '../../lib/fixtures/escalationFixtures';
import { NOTIFICATION_FIXTURES } from '../../lib/fixtures/notificationFixtures';
import { appendEscalationLogEntry, loadEscalationLog } from '../../lib/escalationLogStore';
import { processNotificationFixtures } from '../../lib/notifications';
import type { EscalationLogEntry } from '../../lib/types';
import { Panel } from '../ui/Panel';
import { Button } from '../ui/Button';
import { NotificationFeed } from './NotificationFeed';
import { SuppressedCounter } from './SuppressedCounter';
import styles from './NotificationsPageClient.module.css';

const DAILY_TIER2_LIMIT = 4;

export function NotificationsPageClient() {
  const [log, setLog] = useState<EscalationLogEntry[]>([]);
  const [activeScenario, setActiveScenario] = useState<EscalationScenario | null>(null);

  useEffect(() => {
    setLog(loadEscalationLog());
  }, []);

  const processed = useMemo(
    () => processNotificationFixtures(NOTIFICATION_FIXTURES, DAILY_TIER2_LIMIT),
    [],
  );

  function handleTrigger(scenario: EscalationScenario) {
    const decision = evaluateEscalation(scenario.request);
    if (decision === 'allow') {
      setLog(
        appendEscalationLogEntry({
          id: `${scenario.id}-${Date.now()}`,
          timestamp: Date.now(),
          description: scenario.request.description,
          decision,
          outcome: 'auto-allowed',
        }),
      );
      return;
    }
    setActiveScenario(scenario);
  }

  function closeWithOutcome(outcome: EscalationLogEntry['outcome']) {
    if (!activeScenario) return;
    const decision = evaluateEscalation(activeScenario.request);
    setLog(
      appendEscalationLogEntry({
        id: `${activeScenario.id}-${Date.now()}`,
        timestamp: Date.now(),
        description: activeScenario.request.description,
        decision,
        outcome,
      }),
    );
    setActiveScenario(null);
  }

  return (
    <div>
      <h1 className={styles.title}>Notifications</h1>

      <div className={styles.section}>
        <SuppressedCounter count={processed.suppressedTier3Count} />
        <NotificationFeed items={processed.visible} />
      </div>

      <div className={styles.section}>
        <p className={styles.sectionTitle}>Escalation demo</p>
        <p className={styles.sectionHint}>
          These simulate requests σ-1 would raise while acting on your behalf.
        </p>
        <div className={styles.scenarioList}>
          {ESCALATION_SCENARIOS.map((scenario) => (
            <Panel className={styles.scenarioRow} key={scenario.id}>
              <span className={styles.scenarioDescription}>{scenario.request.description}</span>
              <Button variant="secondary" onClick={() => handleTrigger(scenario)}>
                Simulate
              </Button>
            </Panel>
          ))}
        </div>
      </div>

      {activeScenario ? (
        <EscalationDialog
          request={activeScenario.request}
          dataDisclosure={activeScenario.dataDisclosure}
          actionText={activeScenario.actionText}
          log={log}
          onConfirm={() => closeWithOutcome('confirmed')}
          onStayPrivate={() => closeWithOutcome('declined')}
          onAcknowledgeBlocked={() => closeWithOutcome('blocked')}
        />
      ) : null}
    </div>
  );
}
