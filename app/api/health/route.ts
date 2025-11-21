import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export async function GET() {
  try {
    const db = await getDb();
    
    // Get last sync status
    const lastSync = await db.collection('sync_logs')
      .findOne({}, { sort: { started_at: -1 } });

    // Get data freshness
    const latestCard = await db.collection('cards')
      .findOne({}, { sort: { last_synced_at: -1 } });

    const hoursSinceLastSync = latestCard?.last_synced_at
      ? Math.floor((Date.now() - new Date(latestCard.last_synced_at).getTime()) / (1000 * 60 * 60))
      : null;

    // Get error rate (last 24 hours)
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentLogs = await db.collection('sync_logs')
      .find({ started_at: { $gte: last24h } })
      .toArray();

    const totalSyncs = recentLogs.length;
    const failedSyncs = recentLogs.filter((log: any) => log.status === 'failed').length;
    const errorRate = totalSyncs > 0 ? (failedSyncs / totalSyncs) * 100 : 0;

    return NextResponse.json({
      status: 'healthy',
      last_sync: lastSync ? {
        started_at: lastSync.started_at,
        completed_at: lastSync.completed_at,
        status: lastSync.status,
        records_processed: lastSync.records_processed,
        records_failed: lastSync.records_failed,
      } : null,
      data_freshness: {
        hours_since_last_sync: hoursSinceLastSync,
        is_stale: hoursSinceLastSync !== null && hoursSinceLastSync > 2,
      },
      error_rate_24h: {
        total_syncs: totalSyncs,
        failed_syncs: failedSyncs,
        error_percentage: errorRate,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { status: 'unhealthy', error: error.message },
      { status: 500 }
    );
  }
}

