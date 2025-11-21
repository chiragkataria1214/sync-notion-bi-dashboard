/**
 * Time Doctor Integration Service
 * 
 * Fetches and syncs Time Doctor data (users, projects, worklogs) with NotionBI database.
 * Based on the Pipedream workflow structure.
 */

import { getDb } from '@/lib/mongodb';
import type { TimeDoctorUser, TimeDoctorProject, TimeDoctorWorklog, TeamMember, Card } from '@/lib/types';

const TIME_DOCTOR_API_BASE = 'https://api2.timedoctor.com/api/1.0';

interface TimeDoctorConfig {
  apiToken: string;
  companyId: string;
}

interface TimeDoctorApiUser {
  id: string;
  name: string;
  email?: string;
  role?: string;
}

interface TimeDoctorApiProject {
  id: string;
  name: string;
}

interface TimeDoctorApiWorklog {
  userId: string;
  projectId: string;
  time: number; // seconds
  start?: string;
  projectName?: string;
  taskName?: string;
  mode?: string;
}

/**
 * Fetch Time Doctor users from API
 */
export async function fetchTimeDoctorUsers(config: TimeDoctorConfig): Promise<TimeDoctorApiUser[]> {
  try {
    const response = await fetch(`${TIME_DOCTOR_API_BASE}/users?company=${config.companyId}`, {
      method: 'GET',
      headers: {
        'Authorization': `JWT ${config.apiToken}`,
        'accept': 'application/json',
        'content-type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[TIMEDOCTOR] Users API Error:', response.status, errorText);
      throw new Error(`Time Doctor Users API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const users = Array.isArray(data) ? data : (data?.data && Array.isArray(data.data) ? data.data : []);
    console.log(`[TIMEDOCTOR] Fetched ${users.length} users from API`);
    return users;
  } catch (error: any) {
    console.error('[TIMEDOCTOR] Error fetching users:', error.message);
    throw error;
  }
}

/**
 * Fetch Time Doctor projects from API
 */
export async function fetchTimeDoctorProjects(config: TimeDoctorConfig): Promise<TimeDoctorApiProject[]> {
  try {
    const response = await fetch(`${TIME_DOCTOR_API_BASE}/projects?company=${config.companyId}`, {
      method: 'GET',
      headers: {
        'Authorization': `JWT ${config.apiToken}`,
        'accept': 'application/json',
        'content-type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[TIMEDOCTOR] Projects API Error:', response.status, errorText);
      throw new Error(`Time Doctor Projects API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const projects = Array.isArray(data) ? data : (data?.data && Array.isArray(data.data) ? data.data : []);
    console.log(`[TIMEDOCTOR] Fetched ${projects.length} projects from API`);
    return projects;
  } catch (error: any) {
    console.error('[TIMEDOCTOR] Error fetching projects:', error.message);
    throw error;
  }
}

/**
 * Fetch Time Doctor worklogs for a date range
 * Uses the /activity/worklog endpoint which is the correct endpoint for worklog data
 */
export async function fetchTimeDoctorWorklogs(
  config: TimeDoctorConfig,
  startDate: Date,
  endDate: Date,
  userIds?: string[]
): Promise<TimeDoctorApiWorklog[]> {
  // Format dates as ISO strings (YYYY-MM-DDTHH:mm:ss.sssZ)
  const fromDate = startDate.toISOString();
  const toDate = endDate.toISOString();

  try {
    // Build query parameters
    const params = new URLSearchParams({
      company: config.companyId,
      from: fromDate,
      to: toDate,
      'task-project-names': 'true',
      limit: '10000',
    });

    // Add user IDs if provided (comma-separated)
    if (userIds && userIds.length > 0) {
      params.append('user', userIds.join(','));
    }

    const response = await fetch(
      `${TIME_DOCTOR_API_BASE}/activity/worklog?${params.toString()}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `JWT ${config.apiToken}`,
          'accept': 'application/json',
          'content-type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[TIMEDOCTOR] API Error Response:', errorText);
      throw new Error(`Time Doctor API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    // Check for API errors first
    if (data?.error) {
      const errorMsg = data.error;
      console.error('[TIMEDOCTOR] API returned error:', errorMsg);
      // If it's a range error, throw it so we can handle chunking
      if (errorMsg.includes('range too wide') || errorMsg.includes('mergeRange')) {
        throw new Error(`Time Doctor API range error: ${errorMsg}`);
      }
      throw new Error(`Time Doctor API error: ${errorMsg}`);
    }
    
    console.log('[TIMEDOCTOR] Raw API response type:', typeof data, Array.isArray(data) ? 'array' : 'object');
    
    // Handle different response formats
    let worklogData: any[] = [];
    
    if (Array.isArray(data)) {
      worklogData = data;
      console.log('[TIMEDOCTOR] Response is direct array');
    } else if (data?.data) {
      // Detailed logging to understand the structure
      console.log('[TIMEDOCTOR] data.data details:', {
        type: typeof data.data,
        isArray: Array.isArray(data.data),
        constructor: data.data?.constructor?.name,
        keys: typeof data.data === 'object' && data.data !== null ? Object.keys(data.data).slice(0, 5) : 'N/A',
        firstChars: typeof data.data === 'string' ? data.data.substring(0, 100) : 'N/A',
      });
      
      // Check if data.data is a string (JSON string) or already parsed
      if (typeof data.data === 'string') {
        console.log('[TIMEDOCTOR] data.data is a JSON string, parsing...');
        try {
          const parsed = JSON.parse(data.data);
          worklogData = Array.isArray(parsed) ? parsed : [];
          console.log('[TIMEDOCTOR] Parsed JSON string, got', worklogData.length, 'entries');
        } catch (parseError) {
          console.error('[TIMEDOCTOR] Failed to parse JSON string:', parseError);
        }
      } else if (Array.isArray(data.data)) {
        // Check if the array contains a single string that's a JSON array
        if (data.data.length === 1 && typeof data.data[0] === 'string' && data.data[0].trim().startsWith('[')) {
          console.log('[TIMEDOCTOR] Array contains a single JSON string, parsing...');
          try {
            const parsed = JSON.parse(data.data[0]);
            worklogData = Array.isArray(parsed) ? parsed : [];
            console.log('[TIMEDOCTOR] Parsed JSON string from array, got', worklogData.length, 'entries');
          } catch (parseError) {
            console.error('[TIMEDOCTOR] Failed to parse JSON string from array:', parseError);
            worklogData = data.data; // Fallback to original
          }
        } else {
          // Double-check: if it's an array but accessing [0] gives weird results, it might be array-like
          const testEntry = data.data[0];
          if (testEntry && typeof testEntry === 'object' && testEntry !== null && Object.keys(testEntry).every(k => /^\d+$/.test(k))) {
            // It's an array but entries are array-like objects - convert them
            console.log('[TIMEDOCTOR] Array contains array-like objects, converting...');
            worklogData = data.data.map((item: any) => {
              if (typeof item === 'object' && item !== null) {
                const itemKeys = Object.keys(item);
                if (itemKeys.length > 0 && itemKeys.every(k => /^\d+$/.test(k))) {
                  // This item is an array-like object, convert it
                  return itemKeys.map((k: string) => item[k]);
                }
              }
              return item;
            }).flat();
            console.log('[TIMEDOCTOR] Converted array-like objects, got', worklogData.length, 'entries');
          } else {
            worklogData = data.data;
            console.log('[TIMEDOCTOR] Response is object with data array, length:', worklogData.length);
          }
        }
      } else if (typeof data.data === 'object' && data.data !== null) {
        // Handle array-like object (object with numeric string keys)
        // Check if it has numeric string keys (like {'0': {...}, '1': {...}})
        const keys = Object.keys(data.data);
        const hasNumericKeys = keys.length > 0 && keys.every(k => /^\d+$/.test(k));
        
        if (hasNumericKeys) {
          // Convert array-like object to actual array
          worklogData = keys.map(k => data.data[k]);
          console.log('[TIMEDOCTOR] Converted array-like object to array, got', worklogData.length, 'entries');
        } else {
          // Try to extract if it's a nested structure
          console.warn('[TIMEDOCTOR] data.data is object but not array-like. Keys:', keys.slice(0, 10));
        }
      } else {
        console.warn('[TIMEDOCTOR] data.data is unexpected type:', typeof data.data);
      }
    } else if (data?.results && Array.isArray(data.results)) {
      worklogData = data.results;
      console.log('[TIMEDOCTOR] Response is object with results array');
    } else if (data?.items && Array.isArray(data.items)) {
      worklogData = data.items;
      console.log('[TIMEDOCTOR] Response is object with items array');
    } else if (data?.entries && Array.isArray(data.entries)) {
      worklogData = data.entries;
      console.log('[TIMEDOCTOR] Response is object with entries array');
    } else {
      console.warn('[TIMEDOCTOR] Unknown response format:', Object.keys(data || {}));
    }

    console.log(`[TIMEDOCTOR] Fetched ${worklogData.length} worklog entries from API`);
    
    if (worklogData.length === 0) {
      console.warn('[TIMEDOCTOR] No worklog data returned. Response structure:', JSON.stringify(data).substring(0, 500));
    }

    // Log a sample entry to debug structure
    if (worklogData.length > 0) {
      const sample = worklogData[0];
      console.log('[TIMEDOCTOR] Sample worklog entry (before processing):', {
        type: typeof sample,
        isArray: Array.isArray(sample),
        isString: typeof sample === 'string',
        keys: typeof sample === 'object' && sample !== null ? Object.keys(sample).slice(0, 10) : 'N/A',
        firstChars: typeof sample === 'string' ? sample.substring(0, 100) : 'N/A',
        userId: typeof sample === 'object' && sample !== null ? sample.userId : 'N/A',
        projectId: typeof sample === 'object' && sample !== null ? sample.projectId : 'N/A',
      });
      
      // If entries are JSON strings, parse them
      if (worklogData.length > 0 && typeof worklogData[0] === 'string') {
        console.log('[TIMEDOCTOR] Entries are JSON strings, parsing each entry...');
        try {
          worklogData = worklogData.map((entry: any) => {
            if (typeof entry === 'string') {
              try {
                return JSON.parse(entry);
              } catch (e) {
                console.warn('[TIMEDOCTOR] Failed to parse entry:', entry.substring(0, 100));
                return null;
              }
            }
            return entry;
          }).filter((entry: any) => entry !== null);
          console.log('[TIMEDOCTOR] Parsed', worklogData.length, 'entries from JSON strings');
        } catch (parseError) {
          console.error('[TIMEDOCTOR] Failed to parse JSON strings:', parseError);
        }
      }
      
      // Log again after processing
      if (worklogData.length > 0) {
        const processedSample = worklogData[0];
        console.log('[TIMEDOCTOR] Sample worklog entry (after processing):', {
          keys: typeof processedSample === 'object' && processedSample !== null ? Object.keys(processedSample).slice(0, 10) : 'N/A',
          userId: processedSample?.userId,
          projectId: processedSample?.projectId,
          time: processedSample?.time,
          timeType: typeof processedSample?.time,
        });
      }
    }

    const mappedWorklogs = worklogData.map((entry: any) => {
      // Extract values - handle both camelCase and snake_case
      const userId = entry.userId || entry.user_id || entry.user?.id || null;
      const projectId = entry.projectId || entry.project_id || entry.project?.id || null;
      // Convert time to number if it's a string
      const timeValue = entry.time || entry.totalSec || entry.total_sec || entry.total_time || 0;
      const time = typeof timeValue === 'string' ? parseFloat(timeValue) : (typeof timeValue === 'number' ? timeValue : 0);
      
      const mapped = {
        userId: userId ? String(userId) : null,
        projectId: projectId ? String(projectId) : null,
        time: time,
        start: entry.start || entry.period_start || entry.date || entry.created_at || entry.timestamp,
        projectName: entry.projectName || entry.project_name || entry.project?.name,
        taskName: entry.taskName || entry.task_name || entry.task?.name,
        mode: entry.mode || entry.tracking_mode,
      };
      
      // Debug log for first few entries
      if (worklogData.indexOf(entry) < 3) {
        console.log(`[TIMEDOCTOR] Mapped worklog ${worklogData.indexOf(entry)}:`, {
          original: { 
            userId: entry.userId, 
            projectId: entry.projectId, 
            time: entry.time,
            timeType: typeof entry.time
          },
          mapped: { 
            userId: mapped.userId, 
            projectId: mapped.projectId, 
            time: mapped.time,
            timeType: typeof mapped.time
          }
        });
      }
      
      return mapped;
    });

    // Filter out entries with missing critical data
    const validWorklogs = mappedWorklogs.filter((w, index) => {
      // Check if userId exists and is a valid string
      const hasUserId = !!(w.userId && typeof w.userId === 'string' && w.userId.trim().length > 0);
      // Check if projectId exists and is a valid string  
      const hasProjectId = !!(w.projectId && typeof w.projectId === 'string' && w.projectId.trim().length > 0);
      // Check if time is a positive number
      const hasTime = !!(w.time && typeof w.time === 'number' && !isNaN(w.time) && w.time > 0);
      
      const isValid = hasUserId && hasProjectId && hasTime;
      
      // Log first few for debugging
      if (index < 3) {
        console.log(`[TIMEDOCTOR] Worklog ${index} validation:`, {
          userId: w.userId,
          userIdType: typeof w.userId,
          projectId: w.projectId,
          projectIdType: typeof w.projectId,
          time: w.time,
          timeType: typeof w.time,
          hasUserId,
          hasProjectId,
          hasTime,
          isValid
        });
      }
      
      if (!isValid && index < 5) {
        console.warn(`[TIMEDOCTOR] Filtering invalid worklog ${index}:`, {
          userId: w.userId,
          projectId: w.projectId,
          time: w.time,
          reason: !hasUserId ? 'missing userId' : !hasProjectId ? 'missing projectId' : !hasTime ? 'invalid time' : 'unknown'
        });
      }
      
      return isValid;
    });
    
    if (validWorklogs.length < mappedWorklogs.length) {
      console.warn(`[TIMEDOCTOR] Filtered out ${mappedWorklogs.length - validWorklogs.length} invalid worklog entries`);
    }

    // Type assertion - we've filtered out all nulls, so these are valid
    return validWorklogs as TimeDoctorApiWorklog[];
  } catch (error: any) {
    console.error('[TIMEDOCTOR] Error fetching worklogs:', error);
    // Return empty array instead of throwing to allow partial sync
    return [];
  }
}

/**
 * Match Time Doctor users to Notion team members
 */
async function matchTimeDoctorUsers(
  tdUsers: TimeDoctorApiUser[],
  teamMembers: TeamMember[]
): Promise<Map<string, string>> {
  const matchMap = new Map<string, string>(); // TD User ID -> Notion User ID

  const teamMemberByEmail = new Map<string, TeamMember>();
  const teamMemberByName = new Map<string, TeamMember>();

  teamMembers.forEach(member => {
    if (member.email) {
      teamMemberByEmail.set(member.email.toLowerCase().trim(), member);
    }
    if (member.name) {
      teamMemberByName.set(member.name.toLowerCase().trim(), member);
    }
  });

  tdUsers.forEach(tdUser => {
    if (tdUser.email) {
      const matched = teamMemberByEmail.get(tdUser.email.toLowerCase().trim());
      if (matched && matched.notion_id) {
        matchMap.set(tdUser.id, matched.notion_id);
      }
    }
    if (!matchMap.has(tdUser.id) && tdUser.name) {
      const matched = teamMemberByName.get(tdUser.name.toLowerCase().trim());
      if (matched && matched.notion_id) {
        matchMap.set(tdUser.id, matched.notion_id);
      }
    }
  });

  return matchMap;
}

/**
 * Match Time Doctor projects to Notion cards
 */
async function matchTimeDoctorProjects(
  tdProjects: TimeDoctorApiProject[],
  cards: Card[]
): Promise<Map<string, { cardId: string; clientId?: string }>> {
  const matchMap = new Map<string, { cardId: string; clientId?: string }>();

  // Build a map of Time Doctor project IDs for quick lookup
  const tdProjectMap = new Map<string, TimeDoctorApiProject>();
  tdProjects.forEach(tdProject => {
    tdProjectMap.set(tdProject.id, tdProject);
  });

  console.log(`[TIMEDOCTOR] Matching ${cards.length} cards against ${tdProjects.length} Time Doctor projects`);
  
  let cardsWithTdIds = 0;
  let matchesFound = 0;

  cards.forEach(card => {
    const tdTaskId = card.metadata?.time_doctor?.task_id;
    const tdClientProjectId = card.metadata?.time_doctor?.client_project_id;
    
    if (tdTaskId || tdClientProjectId) {
      cardsWithTdIds++;
      
      // Match task_id (task-level project) - this is what worklogs use
      if (tdTaskId && tdProjectMap.has(tdTaskId)) {
        const tdProject = tdProjectMap.get(tdTaskId)!;
        // Store match - if already exists, keep the first one (or we could store array)
        if (!matchMap.has(tdProject.id)) {
          matchMap.set(tdProject.id, {
            cardId: card.notion_id,
            clientId: card.client_id,
          });
        }
        matchesFound++;
        console.log(`[TIMEDOCTOR] Matched card "${card.title}" (${card.notion_id}) to TD project "${tdProject.name}" (${tdProject.id}) via task_id`);
      }
      
      // Match client_project_id (client-level project) - this is separate
      if (tdClientProjectId && tdProjectMap.has(tdClientProjectId)) {
        const tdProject = tdProjectMap.get(tdClientProjectId)!;
        // For client projects, we want to store the client_id but card_id is less critical
        // Store match - if already exists, prefer one with client_id
        const existingMatch = matchMap.get(tdProject.id);
        if (!existingMatch || !existingMatch.clientId) {
          matchMap.set(tdProject.id, {
            cardId: card.notion_id, // Keep first card, or could be null for client-level
            clientId: card.client_id,
          });
        }
        matchesFound++;
        console.log(`[TIMEDOCTOR] Matched card "${card.title}" (${card.notion_id}) to TD project "${tdProject.name}" (${tdProject.id}) via client_project_id`);
      }
      
      // If neither matched, log for debugging
      if ((!tdTaskId || !tdProjectMap.has(tdTaskId)) && 
          (!tdClientProjectId || !tdProjectMap.has(tdClientProjectId))) {
        console.log(`[TIMEDOCTOR] No match for card "${card.title}": looking for TD IDs [task_id: ${tdTaskId || 'none'}, client_project_id: ${tdClientProjectId || 'none'}]`);
      }
    }
  });

  console.log(`[TIMEDOCTOR] Matching summary: ${cardsWithTdIds} cards with TD IDs, ${matchesFound} matches found`);
  
  // Debug: Log sample Time Doctor project IDs
  if (tdProjects.length > 0) {
    const sampleTdIds = tdProjects.slice(0, 5).map(p => p.id);
    console.log(`[TIMEDOCTOR] Sample Time Doctor project IDs:`, sampleTdIds);
  }

  return matchMap;
}

/**
 * Sync Time Doctor users to database
 */
export async function syncTimeDoctorUsers(
  config: TimeDoctorConfig
): Promise<{ processed: number; matched: number }> {
  try {
    const db = await getDb();
    console.log('[TIMEDOCTOR] Fetching users from Time Doctor API...');
    const tdUsers = await fetchTimeDoctorUsers(config);
    
    if (tdUsers.length === 0) {
      console.warn('[TIMEDOCTOR] No users returned from Time Doctor API');
      return { processed: 0, matched: 0 };
    }
    
    // Get all team members
    const teamMembers = await db.collection('team_members').find({}).toArray();
    console.log(`[TIMEDOCTOR] Found ${teamMembers.length} team members in database`);
    const userMatchMap = await matchTimeDoctorUsers(tdUsers, teamMembers as unknown as TeamMember[]);

    let processed = 0;
    let matched = 0;

    for (const tdUser of tdUsers) {
      const notionUserId = userMatchMap.get(tdUser.id);
      
      await db.collection('timedoctor_users').updateOne(
        { time_doctor_id: tdUser.id },
        {
          $set: {
            time_doctor_id: tdUser.id,
            notion_user_id: notionUserId,
            name: tdUser.name,
            email: tdUser.email,
            role: tdUser.role,
            active: true,
            last_synced_at: new Date(),
          },
          $setOnInsert: {
            created_at: new Date(),
          },
        },
        { upsert: true }
      );

      processed++;
      if (notionUserId) matched++;
    }

    console.log(`[TIMEDOCTOR] Synced ${processed} users, ${matched} matched to Notion`);
    return { processed, matched };
  } catch (error: any) {
    console.error('[TIMEDOCTOR] Error syncing users:', error.message);
    throw error;
  }
}

/**
 * Sync Time Doctor projects to database
 */
export async function syncTimeDoctorProjects(
  config: TimeDoctorConfig
): Promise<{ processed: number; matched: number }> {
  try {
    const db = await getDb();
    console.log('[TIMEDOCTOR] Fetching projects from Time Doctor API...');
    const tdProjects = await fetchTimeDoctorProjects(config);
    
    if (tdProjects.length === 0) {
      console.warn('[TIMEDOCTOR] No projects returned from Time Doctor API');
      return { processed: 0, matched: 0 };
    }
    
    // Get all cards
    const cards = await db.collection('cards').find({}).toArray();
    console.log(`[TIMEDOCTOR] Found ${cards.length} cards in database`);
    const projectMatchMap = await matchTimeDoctorProjects(tdProjects, cards as unknown as Card[]);

    // Build client name map for matching projects to clients when no card exists
    const clientNameMap = new Map<string, string>(); // client_name -> client_id
    const cardsByClient = await db.collection('cards').aggregate([
      { $match: { client_id: { $exists: true, $ne: null }, client_name: { $exists: true, $ne: null } } },
      { $group: { _id: '$client_id', client_name: { $first: '$client_name' } } }
    ]).toArray();
    
    cardsByClient.forEach((item: any) => {
      if (item._id && item.client_name) {
        // Store both exact name and lowercase for matching
        clientNameMap.set(item.client_name.toLowerCase().trim(), item._id);
        clientNameMap.set(item.client_name, item._id);
      }
    });

    let processed = 0;
    let matched = 0;
    let clientMatchedWithoutCard = 0;

    for (const tdProject of tdProjects) {
      const match = projectMatchMap.get(tdProject.id);
      const isInternal = tdProject.name.toLowerCase().includes('ecomexperts') || 
                         tdProject.name.toLowerCase().includes('internal');

      let notionCardId = match?.cardId;
      let notionClientId = match?.clientId;

      // If no card match but we have a project name, try to match to client by name
      if (!notionClientId && !isInternal && tdProject.name) {
        const projectNameLower = tdProject.name.toLowerCase().trim();
        
        // Try exact match first
        if (clientNameMap.has(projectNameLower)) {
          notionClientId = clientNameMap.get(projectNameLower);
          clientMatchedWithoutCard++;
          console.log(`[TIMEDOCTOR] Matched project "${tdProject.name}" to client ${notionClientId} by name (no card found)`);
        } else {
          // Try partial match - check if project name contains client name or vice versa
          for (const [clientName, clientId] of clientNameMap.entries()) {
            if (clientName.length > 3 && // Only match if client name is substantial
                (projectNameLower.includes(clientName) || clientName.includes(projectNameLower))) {
              notionClientId = clientId;
              clientMatchedWithoutCard++;
              console.log(`[TIMEDOCTOR] Matched project "${tdProject.name}" to client "${clientName}" (${clientId}) by partial name match (no card found)`);
              break;
            }
          }
        }
      }

      await db.collection('timedoctor_projects').updateOne(
        { time_doctor_id: tdProject.id },
        {
          $set: {
            time_doctor_id: tdProject.id,
            notion_card_id: notionCardId,
            notion_client_id: notionClientId,
            name: tdProject.name,
            is_internal: isInternal,
            last_synced_at: new Date(),
          },
          $setOnInsert: {
            created_at: new Date(),
          },
        },
        { upsert: true }
      );

      processed++;
      if (match) matched++;
    }

    console.log(`[TIMEDOCTOR] Synced ${processed} projects, ${matched} matched to cards, ${clientMatchedWithoutCard} matched to clients without cards`);
    return { processed, matched };
  } catch (error: any) {
    console.error('[TIMEDOCTOR] Error syncing projects:', error.message);
    throw error;
  }
}

/**
 * Sync Time Doctor worklogs to database
 * Chunks large date ranges into smaller periods to avoid API limits
 */
export async function syncTimeDoctorWorklogs(
  config: TimeDoctorConfig,
  startDate: Date,
  endDate: Date
): Promise<{ processed: number; matched: number }> {
  const db = await getDb();
  
  // Get all Time Doctor user IDs to fetch worklogs for all users
  const tdUsers = await db.collection('timedoctor_users').find({}).toArray();
  const userIds = tdUsers.map((u: any) => u.time_doctor_id).filter(Boolean);
  
  if (userIds.length === 0) {
    console.warn('[TIMEDOCTOR] No Time Doctor users found in database. Sync users first.');
    return { processed: 0, matched: 0 };
  }
  
  // Time Doctor API has a limit on date ranges (typically 7-14 days max)
  // Chunk the date range into smaller periods
  const CHUNK_DAYS = 7; // Use 7-day chunks to be safe
  const allWorklogs: TimeDoctorApiWorklog[] = [];
  
  // Calculate total days
  const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  const chunks = Math.ceil(totalDays / CHUNK_DAYS);
  
  console.log(`[TIMEDOCTOR] Fetching worklogs for ${userIds.length} users (${startDate.toISOString()} to ${endDate.toISOString()})...`);
  console.log(`[TIMEDOCTOR] Date range: ${totalDays} days, splitting into ${chunks} chunks of ${CHUNK_DAYS} days each`);
  
  // Fetch worklogs in chunks
  let currentStart = new Date(startDate);
  
  for (let i = 0; i < chunks; i++) {
    const chunkEnd = new Date(currentStart);
    chunkEnd.setDate(chunkEnd.getDate() + CHUNK_DAYS);
    
    // Don't go past the end date
    const chunkEndDate = chunkEnd > endDate ? new Date(endDate) : chunkEnd;
    
    console.log(`[TIMEDOCTOR] Fetching chunk ${i + 1}/${chunks}: ${currentStart.toISOString()} to ${chunkEndDate.toISOString()}`);
    
    try {
      const chunkWorklogs = await fetchTimeDoctorWorklogs(config, currentStart, chunkEndDate, userIds);
      allWorklogs.push(...chunkWorklogs);
      console.log(`[TIMEDOCTOR] Chunk ${i + 1} completed: ${chunkWorklogs.length} worklogs`);
    } catch (error: any) {
      // If chunk fails due to range error, try smaller chunks
      if (error.message?.includes('range too wide') || error.message?.includes('mergeRange')) {
        console.warn(`[TIMEDOCTOR] Chunk ${i + 1} failed due to range limit, trying smaller 3-day chunks...`);
        // Try 3-day chunks instead
        const smallChunkStart = new Date(currentStart);
        while (smallChunkStart < chunkEndDate) {
          const smallChunkEnd = new Date(smallChunkStart);
          smallChunkEnd.setDate(smallChunkEnd.getDate() + 3);
          const finalChunkEnd = smallChunkEnd > chunkEndDate ? new Date(chunkEndDate) : smallChunkEnd;
          
          try {
            const smallChunkWorklogs = await fetchTimeDoctorWorklogs(config, smallChunkStart, finalChunkEnd, userIds);
            allWorklogs.push(...smallChunkWorklogs);
            console.log(`[TIMEDOCTOR] Small chunk completed: ${smallChunkWorklogs.length} worklogs`);
          } catch (smallError: any) {
            console.error(`[TIMEDOCTOR] Small chunk failed:`, smallError.message);
          }
          
          smallChunkStart.setDate(smallChunkStart.getDate() + 3);
        }
      } else {
        console.error(`[TIMEDOCTOR] Chunk ${i + 1} failed:`, error.message);
      }
    }
    
    // Move to next chunk
    currentStart = new Date(chunkEndDate);
    currentStart.setDate(currentStart.getDate() + 1); // Start next day
    
    // Small delay between chunks to avoid rate limiting (except for last chunk)
    if (i < chunks - 1) {
      await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay
    }
  }
  
  console.log(`[TIMEDOCTOR] Total worklogs fetched across all chunks: ${allWorklogs.length}`);
  
  if (allWorklogs.length === 0) {
    console.warn('[TIMEDOCTOR] No worklogs returned from API after chunking');
    return { processed: 0, matched: 0 };
  }
  
  const worklogs = allWorklogs;

  // Get mappings for matching
  const tdProjects = await db.collection('timedoctor_projects').find({}).toArray();
  const teamMembers = await db.collection('team_members').find({}).toArray();

  // Build hourly rate map (from team members)
  const hourlyRateMap = new Map<string, number>();
  teamMembers.forEach((member: any) => {
    if (member.notion_id && member.metadata?.salary) {
      // Estimate hourly rate from salary (assuming 160 hours/month)
      const hourlyRate = member.metadata.salary / 160;
      hourlyRateMap.set(member.notion_id, hourlyRate);
    }
  });

  // Get all cards to backfill client_id if needed
  const allCards = await db.collection('cards').find({}).toArray();
  const cardClientMap = new Map<string, string>();
  allCards.forEach((card: any) => {
    if (card.notion_id && card.client_id) {
      cardClientMap.set(card.notion_id, card.client_id);
    }
  });

  // Build a map of Time Doctor client_project_id -> card/client for matching worklogs
  // Worklogs use client_project_id (project_id in Time Doctor), so we match via client_project_id
  const tdClientProjectIdToCardMap = new Map<string, { cardId: string; clientId: string }>();
  allCards.forEach((card: any) => {
    const taskId = card.metadata?.time_doctor?.task_id;
    const clientProjectId = card.metadata?.time_doctor?.client_project_id;
    
    // Primary: Map client_project_id (what worklogs use)
    if (clientProjectId && card.client_id) {
      tdClientProjectIdToCardMap.set(clientProjectId, {
        cardId: card.notion_id,
        clientId: card.client_id,
      });
    }
    
    // Secondary: Map task_id for reference (fallback)
    if (taskId && card.client_id) {
      const existing = tdClientProjectIdToCardMap.get(taskId);
      if (!existing || !existing.clientId) {
        tdClientProjectIdToCardMap.set(taskId, {
          cardId: card.notion_id,
          clientId: card.client_id,
        });
      }
    }
  });

  let processed = 0;
  let matched = 0;

  for (const worklog of worklogs) {
    const tdUser = tdUsers.find((u: any) => u.time_doctor_id === worklog.userId);
    const tdProject = tdProjects.find((p: any) => p.time_doctor_id === worklog.projectId);
    
    const notionUserId = tdUser?.notion_user_id;
    let notionCardId = tdProject?.notion_card_id;
    let notionClientId = tdProject?.notion_client_id;

    // Primary matching: Worklogs use client_project_id (project_id in Time Doctor), match via client_project_id
    if (!notionClientId && worklog.projectId) {
      const cardMatch = tdClientProjectIdToCardMap.get(worklog.projectId);
      if (cardMatch) {
        notionCardId = cardMatch.cardId;
        notionClientId = cardMatch.clientId;
        console.log(`[TIMEDOCTOR] Matched worklog client_project_id ${worklog.projectId} to card ${notionCardId} (client: ${notionClientId}) via card client_project_id`);
      }
    }

    // Backfill: If we have card_id but no client_id, try to get it from the card
    if (notionCardId && !notionClientId) {
      const cardClientId = cardClientMap.get(notionCardId);
      if (cardClientId) {
        notionClientId = cardClientId;
        console.log(`[TIMEDOCTOR] Backfilled client_id ${cardClientId} for card ${notionCardId}`);
      }
    }

    // Final fallback: If we have client_id from project but no card_id, that's OK - save worklog with client only
    // This handles the case where a TimeDoctor project belongs to a client but no card exists yet
    if (!notionCardId && notionClientId) {
      console.log(`[TIMEDOCTOR] Worklog has client_id ${notionClientId} but no card_id - saving with client only`);
    }

    // Validate required fields BEFORE processing
    if (!worklog.userId || !worklog.projectId || !worklog.time || worklog.time <= 0) {
      console.warn(`[TIMEDOCTOR] Skipping invalid worklog entry:`, {
        userId: worklog.userId,
        projectId: worklog.projectId,
        time: worklog.time,
        start: worklog.start,
      });
      continue; // Skip this entry entirely
    }

    // Store hours as decimal (same as Pipedream workflow: hours = time / 3600)
    const hours = worklog.time / 3600; // Direct decimal conversion from seconds to hours
    const minutes = (worklog.time % 3600) / 60; // Keep minutes for backward compatibility (not used in calculations)
    const hourlyRate = notionUserId ? (hourlyRateMap.get(notionUserId) || 0) : 0;
    const cost = hours * hourlyRate; // Use decimal hours for cost calculation

    // Time Doctor uses UTC-05:00 (America/New_York) timezone
    // Parse the timestamp and extract the date in that timezone
    let worklogDate: Date;
    let periodStartDate: Date | undefined;
    
    if (worklog.start) {
      // Parse the ISO timestamp (Time Doctor returns timestamps in UTC)
      const timestamp = new Date(worklog.start);
      
      // Convert UTC timestamp to America/New_York timezone (UTC-05:00)
      // To get the date in NY timezone, subtract 5 hours from UTC
      const nyOffsetHours = -5; // UTC-05:00
      const nyTime = new Date(timestamp.getTime() + (nyOffsetHours * 60 * 60 * 1000));
      
      // Extract date components from the NY-adjusted time
      // Use UTC methods since we've already adjusted the time
      const year = nyTime.getUTCFullYear();
      const month = nyTime.getUTCMonth();
      const day = nyTime.getUTCDate();
      
      // Create date at midnight in NY timezone (stored as 5 AM UTC = midnight NY)
      // This ensures queries can match by date correctly
      worklogDate = new Date(Date.UTC(year, month, day, 5, 0, 0, 0));
      
      // Store period_start as the original timestamp for reference
      periodStartDate = timestamp;
    } else {
      // If no start date, use startDate but ensure it's in UTC
      worklogDate = new Date(Date.UTC(
        startDate.getUTCFullYear(),
        startDate.getUTCMonth(),
        startDate.getUTCDate(),
        0, 0, 0, 0
      ));
    }

    // Use upsert to avoid duplicates (based on unique combination)
    await db.collection('timedoctor_worklogs').updateOne(
      {
        time_doctor_user_id: worklog.userId,
        time_doctor_project_id: worklog.projectId,
        date: worklogDate,
        period_start: periodStartDate || worklogDate,
      },
      {
        $set: {
          notion_user_id: notionUserId,
          notion_card_id: notionCardId,
          notion_client_id: notionClientId,
          hours,
          minutes,
          task_name: worklog.taskName,
          cost,
          hourly_rate: hourlyRate,
          period_start: periodStartDate || undefined,
          mode: worklog.mode,
          synced_at: new Date(),
          metadata: {
            project_name: worklog.projectName,
            timezone: 'America/New_York', // Store timezone info for reference
          },
        },
        $setOnInsert: {
          created_at: new Date(),
        },
      },
      { upsert: true }
    );

    // Count as processed (we already validated before saving)
    processed++;
    if (notionUserId && notionCardId) matched++;
  }

  console.log(`[TIMEDOCTOR] Processed ${processed} valid worklogs, ${matched} matched to Notion`);
  return { processed, matched };
}

/**
 * Full Time Doctor sync
 */
export async function syncTimeDoctor(
  config: TimeDoctorConfig,
  startDate?: Date,
  endDate?: Date
): Promise<{
  users: { processed: number; matched: number };
  projects: { processed: number; matched: number };
  worklogs: { processed: number; matched: number };
}> {
  const defaultEndDate = endDate || new Date();
  const defaultStartDate = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Last 30 days

  console.log('[TIMEDOCTOR] Starting full sync...');
  
  const users = await syncTimeDoctorUsers(config);
  console.log(`[TIMEDOCTOR] Users: ${users.processed} processed, ${users.matched} matched`);
  
  const projects = await syncTimeDoctorProjects(config);
  console.log(`[TIMEDOCTOR] Projects: ${projects.processed} processed, ${projects.matched} matched`);
  
  const worklogs = await syncTimeDoctorWorklogs(config, defaultStartDate, defaultEndDate);
  console.log(`[TIMEDOCTOR] Worklogs: ${worklogs.processed} processed, ${worklogs.matched} matched`);

  return { users, projects, worklogs };
}

