import { getActiveNetwork } from '@noisebound/networks';
import { AppShell } from '../../components/ui/AppShell';
import { DashboardClient } from '../../components/dashboard/DashboardClient';

export default function DashboardPage() {
  const network = getActiveNetwork();

  return (
    <AppShell>
      <DashboardClient network={network} />
    </AppShell>
  );
}
