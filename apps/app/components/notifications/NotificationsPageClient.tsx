'use client';

import { useEffect, useMemo, useState } from 'react';
import { evaluateEscalation } from '@noisebound/sigma-core';
import type { ActionRequest, ExecutionOutcome } from '@noisebound/sigma-execute';
import { EscalationDialog } from '../escalation/EscalationDialog';
import { ActionTriggerForm } from '../actions/ActionTriggerForm';
import type { ActionTriggerResult } from '../actions/ActionTriggerForm';
import { ActionOutcomeDialog } from '../actions/ActionOutcomeDialog';
import { ESCALATION_SCENARIOS } from '../../lib/fixtures/escalationFixtures';
import type { EscalationScenario } from '../../lib/fixtures/escalationFixtures';
import { NOTIFICATION_FIXTURES } from '../../lib/fixtures/notificationFixtures';
import { appendEscalationLogEntry, loadEscalationLog } from '../../lib/escalationLogStore';
import { processNotificationFixtures } from '../../lib/notifications';
import { executeOnChainMoneyAction } from '../../app/actions/onChainExecution';
import { pickPrimaryCapability } from '../../lib/sessionCapabilities';
import { loadStoredSessionCapabilities } from '../../lib/sessionStore';
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
  const [activeAction, setActiveAction] = useState<{
    request: ActionRequest;
    outcome: ExecutionOutcome;
  } | null>(null);

  useEffect(() => {
    setLog(loadEscalationLog());
  }, []);

  const processed = useMemo(
    () => processNotificationFixtures(NOTIFICATION_FIXTURES, DAILY_TIER2_LIMIT),
    [],
  );

  function handleActionEvaluated({ request, outcome }: ActionTriggerResult) {
    setActiveAction({ request, outcome });
  }

  function dismissAction(outcomeLabel: EscalationLogEntry['outcome']) {
    if (!activeAction) return;
    setLog(
      appendEscalationLogEntry({
        id: `${activeAction.request.id}-${Date.now()}`,
        timestamp: Date.now(),
        description: activeAction.request.description,
        decision: activeAction.outcome.status === 'denied' ? 'deny' : 'require-disclosure',
        outcome: outcomeLabel,
      }),
    );
    setActiveAction(null);
  }

  async function handleConfirmAction() {
    if (!activeAction || activeAction.outcome.status !== 'awaiting-confirmation') return;
    const { request } = activeAction;
    if (request.kind !== 'on-chain-money') return;

    const primaryCapability = pickPrimaryCapability(loadStoredSessionCapabilities(), Date.now());
    if (!primaryCapability) {
      setActiveAction({
        request,
        outcome: {
          status: 'execution-failed',
          requestId: request.id,
          reason: 'No active session key — issue one on the Sessions page before sending.',
          timestamp: new Date(),
        },
      });
      return;
    }

    try {
      const txHash = await executeOnChainMoneyAction(
        {
          id: request.id,
          description: request.description,
          amountCents: request.amountCents,
          currency: request.currency,
          amountWei: request.amountWei.toString(),
          recipient: request.recipient,
          asset: request.asset,
        },
        { payload: primaryCapability.payload, signature: primaryCapability.signature },
      );
      setActiveAction({
        request,
        outcome: {
          status: 'executed',
          requestId: request.id,
          result: { kind: 'on-chain-money', txHash },
          timestamp: new Date(),
        },
      });
      setLog(
        appendEscalationLogEntry({
          id: `${request.id}-${Date.now()}`,
          timestamp: Date.now(),
          description: request.description,
          decision: 'require-disclosure',
          outcome: 'confirmed',
        }),
      );
    } catch (error) {
      setActiveAction({
        request,
        outcome: {
          status: 'execution-failed',
          requestId: request.id,
          reason: error instanceof Error ? error.message : String(error),
          timestamp: new Date(),
        },
      });
    }
  }

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
        <p className={styles.sectionTitle}>Trigger an action</p>
        <p className={styles.sectionHint}>
          Build a real action request and run it through σ-1&rsquo;s escalation policy.
        </p>
        <ActionTriggerForm onEvaluated={handleActionEvaluated} />
      </div>

      <div className={styles.section}>
        <p className={styles.sectionTitle}>Escalation demo (fixture scenarios)</p>
        <p className={styles.sectionHint}>
          These simulate other request categories σ-1 would raise while acting on your behalf.
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

      {activeAction ? (
        <ActionOutcomeDialog
          request={activeAction.request}
          outcome={activeAction.outcome}
          log={log}
          onConfirm={() => void handleConfirmAction()}
          onDismiss={() => {
            switch (activeAction.outcome.status) {
              case 'denied':
                dismissAction('blocked');
                return;
              case 'awaiting-confirmation':
                dismissAction('declined');
                return;
              default:
                setActiveAction(null);
            }
          }}
        />
      ) : null}
    </div>
  );
}
