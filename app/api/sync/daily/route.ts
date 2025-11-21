// Daily sync endpoint for Team Members, QI Time Tracker, and Time Doctor
// Can be called by Vercel Cron Jobs or external cron services
import { NextRequest, NextResponse } from 'next/server';
import { syncTeamMembers, syncQITimeTrackerEntries } from '@/lib/services/extractor';
import { syncTimeDoctor } from '@/lib/services/timedoctor';
import { getDb } from '@/lib/mongodb';

export async function GET(request: NextRequest) {
  return await handleDailySync(request);
}

export async function POST(request: NextRequest) {
  return await handleDailySync(request);
}

async function handleDailySync(request: NextRequest) {
  const startTime = Date.now();
  const syncResults: any = {
    success: true,
    started_at: new Date().toISOString(),
    syncs: {},
    errors: [],
  };

  try {
    // Check authorization if SYNC_SECRET is set
    const authHeader = request.headers.get('authorization');
    const syncSecret = process.env.SYNC_SECRET;
    
    if (syncSecret && authHeader !== `Bearer ${syncSecret}`) {
      // If SYNC_SECRET is set, require auth
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[DAILY SYNC] Starting daily sync job...');

    // 1. Sync Team Members
    try {
      console.log('[DAILY SYNC] Syncing Team Members...');
      const teamMembersLog = await syncTeamMembers();
      syncResults.syncs.team_members = {
        success: true,
        records_processed: teamMembersLog.records_processed,
        records_failed: teamMembersLog.records_failed,
        status: teamMembersLog.status,
      };
      console.log(`[DAILY SYNC] Team Members sync completed: ${teamMembersLog.records_processed} processed, ${teamMembersLog.records_failed} failed`);
    } catch (error: any) {
      console.error('[DAILY SYNC] Team Members sync error:', error);
      syncResults.syncs.team_members = {
        success: false,
        error: error.message,
      };
      syncResults.errors.push({ sync: 'team_members', error: error.message });
    }

    // 2. Sync QI Time Tracker
    try {
      console.log('[DAILY SYNC] Syncing QI Time Tracker...');
      const qiTimeTrackerLog = await syncQITimeTrackerEntries();
      syncResults.syncs.qi_time_tracker = {
        success: true,
        records_processed: qiTimeTrackerLog.records_processed,
        records_failed: qiTimeTrackerLog.records_failed,
        status: qiTimeTrackerLog.status,
      };
      console.log(`[DAILY SYNC] QI Time Tracker sync completed: ${qiTimeTrackerLog.records_processed} processed, ${qiTimeTrackerLog.records_failed} failed`);
    } catch (error: any) {
      console.error('[DAILY SYNC] QI Time Tracker sync error:', error);
      syncResults.syncs.qi_time_tracker = {
        success: false,
        error: error.message,
      };
      syncResults.errors.push({ sync: 'qi_time_tracker', error: error.message });
    }

    // 3. Sync Time Doctor
    try {
      console.log('[DAILY SYNC] Syncing Time Doctor...');
      
      const apiToken = process.env.TIMEDOCTOR_API_TOKEN;
      const companyId = process.env.TIMEDOCTOR_COMPANY_ID;

      if (!apiToken || !companyId) {
        throw new Error('Missing TIMEDOCTOR_API_TOKEN or TIMEDOCTOR_COMPANY_ID environment variables');
      }

      // Sync last 30 days by default
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);

      const timeDoctorResult = await syncTimeDoctor(
        { apiToken, companyId },
        startDate,
        endDate
      );

      syncResults.syncs.time_doctor = {
        success: true,
        users: timeDoctorResult.users,
        projects: timeDoctorResult.projects,
        worklogs: timeDoctorResult.worklogs,
      };
      console.log(`[DAILY SYNC] Time Doctor sync completed: Users: ${timeDoctorResult.users.processed}, Projects: ${timeDoctorResult.projects.processed}, Worklogs: ${timeDoctorResult.worklogs.processed}`);
    } catch (error: any) {
      console.error('[DAILY SYNC] Time Doctor sync error:', error);
      syncResults.syncs.time_doctor = {
        success: false,
        error: error.message,
      };
      syncResults.errors.push({ sync: 'time_doctor', error: error.message });
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    syncResults.completed_at = new Date().toISOString();
    syncResults.duration_seconds = parseFloat(duration);
    
    // Mark as partial success if any syncs failed
    if (syncResults.errors.length > 0) {
      syncResults.success = false;
      syncResults.status = 'partial';
    } else {
      syncResults.status = 'success';
    }

    // Save sync log to database
    try {
      const db = await getDb();
      await db.collection('sync_logs').insertOne({
        sync_type: 'daily',
        status: syncResults.status,
        started_at: new Date(syncResults.started_at),
        completed_at: new Date(syncResults.completed_at),
        duration_seconds: syncResults.duration_seconds,
        metadata: {
          team_members: syncResults.syncs.team_members,
          qi_time_tracker: syncResults.syncs.qi_time_tracker,
          time_doctor: syncResults.syncs.time_doctor,
        },
        errors: syncResults.errors,
      });
    } catch (dbError: any) {
      console.error('[DAILY SYNC] Error saving sync log to database:', dbError);
      // Don't fail the entire request if logging fails
    }

    console.log(`[DAILY SYNC] Daily sync job completed in ${duration}s`);

    return NextResponse.json(syncResults, {
      status: syncResults.success ? 200 : 207, // 207 Multi-Status if partial
    });
  } catch (error: any) {
    console.error('[DAILY SYNC] Fatal error:', error);
    syncResults.success = false;
    syncResults.status = 'failed';
    syncResults.error = error.message;
    syncResults.completed_at = new Date().toISOString();
    syncResults.duration_seconds = ((Date.now() - startTime) / 1000).toFixed(2);

    // Try to save error log
    try {
      const db = await getDb();
      await db.collection('sync_logs').insertOne({
        sync_type: 'daily',
        status: 'failed',
        started_at: new Date(syncResults.started_at),
        completed_at: new Date(syncResults.completed_at),
        duration_seconds: syncResults.duration_seconds,
        error_message: error.message,
        errors: syncResults.errors,
      });
    } catch (dbError: any) {
      console.error('[DAILY SYNC] Error saving error log to database:', dbError);
    }

    return NextResponse.json(syncResults, { status: 500 });
  }
}

