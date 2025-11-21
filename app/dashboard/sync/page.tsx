'use client';

import { useEffect, useState } from 'react';
import { Page, Layout } from '@shopify/polaris';
import SyncStatus from '@/components/SyncStatus';

export default function SyncStatusPage() {
  const [syncStatus, setSyncStatus] = useState<any>(null);

  useEffect(() => {
    fetch('/api/health')
      .then(res => res.json())
      .then(data => setSyncStatus(data));
  }, []);

  return (
    <Page
      title="Sync Status & Management"
      subtitle="Monitor data synchronization status and manually trigger syncs"
    >
      <Layout>
        <Layout.Section>
          <SyncStatus data={syncStatus} />
        </Layout.Section>
      </Layout>
    </Page>
  );
}

