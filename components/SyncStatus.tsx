'use client';

import { useState, useEffect } from 'react';
import LoadingSpinner from './LoadingSpinner';

interface SyncStatusProps {
  data: any;
}

export default function SyncStatus({ data }: SyncStatusProps) {
  const [clients, setClients] = useState<any[]>([]);
  const [selectedClient, setSelectedClient] = useState<string>('all');
  const [syncing, setSyncing] = useState(false);
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [testLimit, setTestLimit] = useState<number>(3);
  const [useLimit, setUseLimit] = useState<boolean>(true);
  const [syncProgress, setSyncProgress] = useState<string>('');
  const [syncingTimeDoctor, setSyncingTimeDoctor] = useState(false);
  const [timeDoctorProgress, setTimeDoctorProgress] = useState<string>('');
  const [timeDoctorStartDate, setTimeDoctorStartDate] = useState<string>('');
  const [timeDoctorEndDate, setTimeDoctorEndDate] = useState<string>('');
  const [syncingQITimeTracker, setSyncingQITimeTracker] = useState(false);
  const [qiTimeTrackerProgress, setQiTimeTrackerProgress] = useState<string>('');
  const [syncingTeamMembers, setSyncingTeamMembers] = useState(false);
  const [teamMembersProgress, setTeamMembersProgress] = useState<string>('');
  const [syncingClients, setSyncingClients] = useState(false);
  const [clientsProgress, setClientsProgress] = useState<string>('');

  useEffect(() => {
    // Set default date range (last 30 days)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);

    setTimeDoctorEndDate(endDate.toISOString().split('T')[0]);
    setTimeDoctorStartDate(startDate.toISOString().split('T')[0]);
  }, []);

  useEffect(() => {
    // Fetch clients from MongoDB
    fetch('/api/clients')
      .then(res => res.json())
      .then(data => {
        setClients(data.clients || []);
        setDebugInfo(data.debug || null);
      })
      .catch(err => {
        console.error('[ERROR] Error fetching clients:', err);
      });
  }, []);

  if (!data) {
    return <LoadingSpinner />;
  }

  const isHealthy = data.status === 'healthy';
  const isStale = data.data_freshness?.is_stale;

  const handleSync = async () => {
    setSyncing(true);
    setSyncProgress('Starting sync...');
    try {
      const body: any = { type: 'all' };

      // If a specific client is selected, sync only that client's projects
      if (selectedClient && selectedClient !== 'all') {
        body.client_id = selectedClient;
        body.type = 'projects'; // Only sync projects when client is selected
      }

      // Add test limit if enabled
      if (useLimit && testLimit > 0) {
        body.limit = testLimit;
      }

      setSyncProgress(`Syncing from Notion${useLimit && testLimit ? ` (limit: ${testLimit})` : ''}...`);
      const response = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const result = await response.json();
      console.log('[SYNC] Sync result:', result);

      if (result.success) {
        setSyncProgress(
          `Sync completed! ` +
          `${result.clients?.processed || 0} clients, ` +
          `${result.projects?.processed || 0} projects, ` +
          `${result.team_members?.processed || 0} team members, ` +
          `${result.qi_time_tracker?.processed || 0} QI Time Tracker entries`
        );
      } else {
        setSyncProgress(`Sync failed: ${result.error}`);
      }
      setSyncing(false);
    } catch (error: any) {
      console.error('Sync error:', error);
      setSyncProgress(`Error: ${error.message}`);
      setSyncing(false);
    }
  };

  const handleTimeDoctorSync = async () => {
    setSyncingTimeDoctor(true);
    setTimeDoctorProgress('Starting Time Doctor sync...');
    try {
      const body: any = {};

      if (timeDoctorStartDate) {
        body.start_date = timeDoctorStartDate;
      }
      if (timeDoctorEndDate) {
        body.end_date = timeDoctorEndDate;
      }

      setTimeDoctorProgress(`Syncing Time Doctor data${timeDoctorStartDate && timeDoctorEndDate ? ` from ${timeDoctorStartDate} to ${timeDoctorEndDate}` : ' (last 30 days)'}...`);

      const response = await fetch('/api/timedoctor/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const contentType = response.headers.get('content-type');
      const isJson = contentType && contentType.includes('application/json');

      if (!response.ok) {
        let errorText: string;
        if (isJson) {
          try {
            const errorData = await response.json();
            errorText = errorData.error || errorData.message || 'Unknown error';
          } catch {
            errorText = `HTTP ${response.status} ${response.statusText}`;
          }
        } else {
          try {
            errorText = (await response.text()).substring(0, 200);
          } catch {
            errorText = `HTTP ${response.status} ${response.statusText}`;
          }
        }
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      if (!isJson) {
        const text = await response.text();
        throw new Error(`Expected JSON but got ${contentType}. Response: ${text.substring(0, 200)}`);
      }

      const result = await response.json();
      console.log('[TIMEDOCTOR SYNC] Sync result:', result);

      if (result.success) {
        const { users, projects, worklogs } = result.result || {};
        setTimeDoctorProgress(
          `Time Doctor sync completed! ` +
          `Users: ${users?.processed || 0} (${users?.matched || 0} matched), ` +
          `Projects: ${projects?.processed || 0} (${projects?.matched || 0} matched), ` +
          `Worklogs: ${worklogs?.processed || 0} (${worklogs?.matched || 0} matched)`
        );
      } else {
        setTimeDoctorProgress(`Time Doctor sync failed: ${result.error || 'Unknown error'}`);
      }
      setSyncingTimeDoctor(false);
    } catch (error: any) {
      console.error('Time Doctor sync error:', error);
      setTimeDoctorProgress(`Error: ${error.message}`);
      setSyncingTimeDoctor(false);
    }
  };

  const handleQITimeTrackerSync = async () => {
    setSyncingQITimeTracker(true);
    setQiTimeTrackerProgress('Starting QI Time Tracker sync...');
    try {
      setQiTimeTrackerProgress('Syncing QI Time Tracker entries from Notion...');

      const response = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'qi_time_tracker' })
      });

      const result = await response.json();
      console.log('[QI TIME TRACKER SYNC] Sync result:', result);

      if (result.success) {
        const qiTimeTracker = result.qi_time_tracker || {};
        setQiTimeTrackerProgress(
          `QI Time Tracker sync completed! ` +
          `${qiTimeTracker.processed || 0} entries processed, ` +
          `${qiTimeTracker.failed || 0} failed. ` +
          `Status: ${qiTimeTracker.status || 'unknown'}`
        );
      } else {
        setQiTimeTrackerProgress(`QI Time Tracker sync failed: ${result.error || 'Unknown error'}`);
      }
      setSyncingQITimeTracker(false);
    } catch (error: any) {
      console.error('QI Time Tracker sync error:', error);
      setQiTimeTrackerProgress(`Error: ${error.message}`);
      setSyncingQITimeTracker(false);
    }
  };

  const handleClientsSync = async () => {
    setSyncingClients(true);
    setClientsProgress('Starting Clients sync...');
    try {
      setClientsProgress('Syncing clients from Notion...');

      const response = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'clients' })
      });

      const result = await response.json();
      console.log('[CLIENTS SYNC] Sync result:', result);

      if (result.success) {
        const clients = result.clients || {};
        setClientsProgress(
          `Clients sync completed! ` +
          `${clients.processed || 0} clients processed, ` +
          `${clients.failed || 0} failed. ` +
          `Status: ${clients.status || 'unknown'}`
        );
        // Refresh client list
        fetch('/api/clients')
          .then(res => res.json())
          .then(data => setClients(data.clients || []))
          .catch(err => console.error('Error refreshing clients:', err));
      } else {
        setClientsProgress(`Clients sync failed: ${result.error || 'Unknown error'}`);
      }
      setSyncingClients(false);
    } catch (error: any) {
      console.error('Clients sync error:', error);
      setClientsProgress(`Error: ${error.message}`);
      setSyncingClients(false);
    }
  };

  const handleTeamMembersSync = async () => {
    setSyncingTeamMembers(true);
    setTeamMembersProgress('Starting Team Members sync...');
    try {
      setTeamMembersProgress('Syncing team members from Notion...');

      const response = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'team_members' })
      });

      const result = await response.json();
      console.log('[TEAM MEMBERS SYNC] Sync result:', result);

      if (result.success) {
        const teamMembers = result.team_members || {};
        setTeamMembersProgress(
          `Team Members sync completed! ` +
          `${teamMembers.processed || 0} team members processed, ` +
          `${teamMembers.failed || 0} failed. ` +
          `Status: ${teamMembers.status || 'unknown'}`
        );
      } else {
        setTeamMembersProgress(`Team Members sync failed: ${result.error || 'Unknown error'}`);
      }
      setSyncingTeamMembers(false);
    } catch (error: any) {
      console.error('Team Members sync error:', error);
      setTeamMembersProgress(`Error: ${error.message}`);
      setSyncingTeamMembers(false);
    }
  };

  return (
    <div className={`mb-6 p-4 rounded-lg ${isHealthy && !isStale ? 'bg-green-100' : 'bg-yellow-100'}`}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="text-gray-900">
            <h2 className="font-semibold text-gray-900">System Status</h2>
            <p className="text-sm text-gray-800">
              Status: <span className="font-medium text-gray-900">{data.status}</span>
            </p>
            {data.last_sync && (
              <p className="text-sm text-gray-800">
                Last sync: {new Date(data.last_sync.started_at).toLocaleString()}
                {' '}({data.last_sync.records_processed} processed, {data.last_sync.records_failed} failed)
              </p>
            )}
            {data.data_freshness && (
              <p className="text-sm text-gray-800">
                Data freshness: {data.data_freshness.hours_since_last_sync !== null
                  ? `${data.data_freshness.hours_since_last_sync} hours ago`
                  : 'Unknown'}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2 text-gray-900">
              Sync Options:
              <span className="ml-2 text-xs text-gray-700">
                ({clients.length} client{clients.length !== 1 ? 's' : ''} found)
              </span>
            </label>
            <select
              value={selectedClient}
              onChange={(e) => setSelectedClient(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 bg-white"
              disabled={syncing}
            >
              <option value="all">All Clients</option>
              {clients.length === 0 && (
                <option value="" disabled>No clients found - Run sync first</option>
              )}
              {clients.map((client: any) => (
                <option key={client.client_id} value={client.client_id}>
                  {client.name || 'Unknown'} ({client.project_count || 0} projects)
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="useLimit"
                checked={useLimit}
                onChange={(e) => setUseLimit(e.target.checked)}
                disabled={syncing}
                className="w-4 h-4"
              />
              <label htmlFor="useLimit" className="text-sm text-gray-900">
                Test Limit:
              </label>
            </div>
            <input
              type="number"
              value={testLimit}
              onChange={(e) => setTestLimit(parseInt(e.target.value) || 0)}
              disabled={syncing || !useLimit}
              min="1"
              max="10000"
              className="w-24 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 text-gray-900"
              placeholder="1000"
            />
            <span className="text-xs text-gray-700">
              (for testing - leave unchecked for full sync)
            </span>
          </div>

          <div className="flex gap-2">
            <button
              onClick={async () => {
                const res = await fetch('/api/debug');
                const data = await res.json();
                console.log('[DEBUG] Database stats:', data);
                setDebugInfo(data);
                setShowDebug(true);
              }}
              className="px-3 py-2 text-xs bg-gray-200 hover:bg-gray-300 rounded text-gray-900 font-medium"
            >
              Check DB
            </button>
            <button
              onClick={() => setShowDebug(!showDebug)}
              className="px-3 py-2 text-xs bg-gray-200 hover:bg-gray-300 rounded text-gray-900 font-medium"
            >
              {showDebug ? 'Hide' : 'Show'} Debug
            </button>
            <button
              onClick={handleSync}
              disabled={syncing}
              className={`px-6 py-2 rounded font-medium ${syncing
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-blue-500 hover:bg-blue-600 text-white'
                }`}
            >
              {syncing ? 'Syncing...' : 'Sync Now'}
            </button>
          </div>
          {syncProgress && (
            <div className="text-sm text-gray-900 mt-2 font-medium">
              {syncProgress}
            </div>
          )}
        </div>

        {showDebug && debugInfo && (
          <div className="mt-4 p-4 bg-gray-50 rounded border border-gray-200">
            <h3 className="font-semibold mb-2 text-gray-900">Debug Information:</h3>
            <pre className="text-xs overflow-auto max-h-60 text-gray-900 bg-white p-2 rounded">
              {JSON.stringify(debugInfo, null, 2)}
            </pre>
            <div className="mt-2 text-xs text-gray-800">
              <p>Clients in state: {clients.length}</p>
              <p>Check browser console for more details</p>
            </div>
          </div>
        )}

        {showDebug && clients.length === 0 && (
          <div className="mt-4 p-4 bg-yellow-50 rounded border border-yellow-200">
            <h3 className="font-semibold mb-2 text-yellow-800">No Clients Found</h3>
            <p className="text-sm text-yellow-700">
              This usually means:
            </p>
            <ul className="text-sm text-yellow-700 list-disc list-inside mt-2">
              <li>No sync has been run yet - click "Sync Now" first</li>
              <li>Cards don't have client_id field populated</li>
              <li>Check that projects in Notion have the Client relation field filled</li>
            </ul>
          </div>
        )}

        {/* Time Doctor Sync Section */}
        <div className="mt-6 pt-6 border-t border-gray-300">
          <h3 className="font-semibold text-gray-900 mb-4">Time Doctor Sync</h3>
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium mb-2 text-gray-900">
                  Start Date
                </label>
                <input
                  type="date"
                  value={timeDoctorStartDate}
                  onChange={(e) => setTimeDoctorStartDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 bg-white"
                  disabled={syncingTimeDoctor}
                />
              </div>
              <div className="flex-1">
                <label className="block text-sm font-medium mb-2 text-gray-900">
                  End Date
                </label>
                <input
                  type="date"
                  value={timeDoctorEndDate}
                  onChange={(e) => setTimeDoctorEndDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 bg-white"
                  disabled={syncingTimeDoctor}
                />
              </div>
            </div>
            <p className="text-xs text-gray-700">
              Leave dates empty to sync last 30 days. Requires TIMEDOCTOR_API_TOKEN and TIMEDOCTOR_COMPANY_ID in .env.local
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleTimeDoctorSync}
                disabled={syncingTimeDoctor}
                className={`px-6 py-2 rounded font-medium ${syncingTimeDoctor
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-purple-500 hover:bg-purple-600 text-white'
                  }`}
              >
                {syncingTimeDoctor ? 'Syncing Time Doctor...' : 'Sync Time Doctor'}
              </button>
            </div>
            {timeDoctorProgress && (
              <div className="text-sm text-gray-900 mt-2 font-medium">
                {timeDoctorProgress}
              </div>
            )}
          </div>
        </div>

        {/* Clients Sync Section */}
        <div className="mt-6 pt-6 border-t border-gray-300">
          <h3 className="font-semibold text-gray-900 mb-4">Clients Sync</h3>
          <div className="space-y-4">
            <p className="text-sm text-gray-700">
              Sync clients from Notion database. This will fetch all clients from the Clients database and store them in MongoDB. Client information is used for faster project syncing and displaying client names in dashboards. It's recommended to sync clients before syncing projects.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleClientsSync}
                disabled={syncingClients}
                className={`px-6 py-2 rounded font-medium ${syncingClients
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-teal-500 hover:bg-teal-600 text-white'
                  }`}
              >
                {syncingClients ? 'Syncing Clients...' : 'Sync Clients'}
              </button>
            </div>
            {clientsProgress && (
              <div className="text-sm text-gray-900 mt-2 font-medium">
                {clientsProgress}
              </div>
            )}
          </div>
        </div>

        {/* Team Members Sync Section */}
        <div className="mt-6 pt-6 border-t border-gray-300">
          <h3 className="font-semibold text-gray-900 mb-4">Team Members Sync</h3>
          <div className="space-y-4">
            <p className="text-sm text-gray-700">
              Sync team members from Notion database. This will fetch all team members from the Team Members database and store them in MongoDB. Team members are used for matching Time Doctor users and displaying employee information in dashboards.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleTeamMembersSync}
                disabled={syncingTeamMembers}
                className={`px-6 py-2 rounded font-medium ${syncingTeamMembers
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-indigo-500 hover:bg-indigo-600 text-white'
                  }`}
              >
                {syncingTeamMembers ? 'Syncing Team Members...' : 'Sync Team Members'}
              </button>
            </div>
            {teamMembersProgress && (
              <div className="text-sm text-gray-900 mt-2 font-medium">
                {teamMembersProgress}
              </div>
            )}
          </div>
        </div>

        {/* QI Time Tracker Sync Section */}
        <div className="mt-6 pt-6 border-t border-gray-300">
          <h3 className="font-semibold text-gray-900 mb-4">QI Time Tracker Sync</h3>
          <div className="space-y-4">
            <p className="text-sm text-gray-700">
              Sync QI Time Tracker entries from Notion database. This will fetch all entries from the QI Time Tracker database and store them in MongoDB for faster access.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleQITimeTrackerSync}
                disabled={syncingQITimeTracker}
                className={`px-6 py-2 rounded font-medium ${syncingQITimeTracker
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-green-500 hover:bg-green-600 text-white'
                  }`}
              >
                {syncingQITimeTracker ? 'Syncing QI Time Tracker...' : 'Sync QI Time Tracker'}
              </button>
            </div>
            {qiTimeTrackerProgress && (
              <div className="text-sm text-gray-900 mt-2 font-medium">
                {qiTimeTrackerProgress}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

