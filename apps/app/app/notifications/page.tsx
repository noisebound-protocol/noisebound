import { AppShell } from '../../components/ui/AppShell';
import { NotificationsPageClient } from '../../components/notifications/NotificationsPageClient';

export default function NotificationsPage() {
  return (
    <AppShell>
      <NotificationsPageClient />
    </AppShell>
  );
}
