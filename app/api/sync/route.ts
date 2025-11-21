import { NextRequest, NextResponse } from 'next/server';
import { syncProjects, syncTeamMembers, syncQITimeTrackerEntries, syncClients } from '@/lib/services/extractor';
import { calculateMetrics } from '@/lib/services/metrics-calculator';
import { getDb } from '@/lib/mongodb';

export async function POST(request: NextRequest) {
  try {
    const { type, client_id, limit } = await request.json(); // type: 'projects' | 'team_members' | 'qi_time_tracker' | 'all', client_id: optional, limit: optional

    console.log(`[SYNC API] Starting sync - type: ${type}, client_id: ${client_id || 'none'}, limit: ${limit || 'none'}`);

    let projectsLog = null;
    let teamMembersLog = null;
    let qiTimeTrackerLog = null;
    let clientsLog = null;

    if (type === 'clients' || type === 'all') {
      console.log('[SYNC API] Syncing clients...');
      clientsLog = await syncClients();
      console.log(`[SYNC API] Clients sync completed: ${clientsLog.records_processed} processed, ${clientsLog.records_failed} failed`);
    }

    if (type === 'projects' || type === 'all') {
      console.log(`[SYNC API] Syncing projects${client_id ? ` for client: ${client_id}` : ' (all clients)'}${limit ? ` (limit: ${limit})` : ''}...`);
      const startTime = Date.now();
      projectsLog = await syncProjects(client_id, limit);
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`[SYNC API] Projects sync completed in ${duration}s: ${projectsLog.records_processed} processed, ${projectsLog.records_failed} failed`);
      
      // Calculate metrics (pushbacks now come from Notion properties, not status transitions)
      console.log(`[SYNC API] Calculating metrics...`);
      await calculateMetrics('daily');
    }

    if (type === 'team_members' || type === 'all') {
      console.log('[SYNC API] Syncing team members...');
      teamMembersLog = await syncTeamMembers();
      console.log(`[SYNC API] Team members sync completed: ${teamMembersLog.records_processed} processed`);
    }

    if (type === 'qi_time_tracker' || type === 'all') {
      console.log('[SYNC API] Syncing QI Time Tracker entries...');
      qiTimeTrackerLog = await syncQITimeTrackerEntries();
      console.log(`[SYNC API] QI Time Tracker entries sync completed: ${qiTimeTrackerLog.records_processed} processed, ${qiTimeTrackerLog.records_failed} failed`);
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Sync completed',
      projects: projectsLog ? {
        processed: projectsLog.records_processed,
        failed: projectsLog.records_failed,
        status: projectsLog.status,
      } : null,
      team_members: teamMembersLog ? {
        processed: teamMembersLog.records_processed,
        failed: teamMembersLog.records_failed,
        status: teamMembersLog.status,
      } : null,
      qi_time_tracker: qiTimeTrackerLog ? {
        processed: qiTimeTrackerLog.records_processed,
        failed: qiTimeTrackerLog.records_failed,
        status: qiTimeTrackerLog.status,
      } : null,
      clients: clientsLog ? {
        processed: clientsLog.records_processed,
        failed: clientsLog.records_failed,
        status: clientsLog.status,
      } : null,
    });
  } catch (error: any) {
    console.error('[SYNC API] Sync error:', error);
    return NextResponse.json(
      { success: false, error: error.message, stack: error.stack },
      { status: 500 }
    );
  }
}

export async function GET() {
  const db = await getDb();
  const lastSync = await db.collection('sync_logs')
    .findOne({}, { sort: { started_at: -1 } });

  return NextResponse.json({
    last_sync: lastSync,
    status: lastSync?.status || 'unknown',
  });
}

