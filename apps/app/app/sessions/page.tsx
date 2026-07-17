import { AppShell } from '../../components/ui/AppShell';
import { SessionsPageClient } from '../../components/session/SessionsPageClient';

export default function SessionsPage() {
  return (
    <AppShell>
      <SessionsPageClient />
    </AppShell>
  );
}
