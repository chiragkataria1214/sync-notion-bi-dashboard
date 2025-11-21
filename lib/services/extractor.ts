import { getDb } from '@/lib/mongodb';
import { notion, fetchAllPages, extractProperty } from '@/lib/notion';
import { PROJECT_PROPERTIES, findClientProperty, NON_CLIENT_RELATION_PROPERTIES } from '@/lib/notion-properties';
import type { Card, TeamMember, CardStatusHistory, SyncLog, Client } from '@/lib/types';

const PROJECTS_DB_ID = process.env.NOTION_PROJECTS_DB_ID!;
const TEAM_MEMBERS_DB_ID = process.env.NOTION_TEAM_MEMBERS_DB_ID!;
const CLIENTS_DB_ID = 'c844e95e-2960-43da-8a65-15ce0c7eba53'; // Client database ID

// Debug flag for logging page structure once
let hasLoggedPageStructure = false;

/**
 * Convert a property name to a clean, query-friendly snake_case name
 */
function normalizePropertyName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    // Replace special characters and spaces with underscores
    .replace(/[^a-z0-9]+/g, '_')
    // Remove leading/trailing underscores
    .replace(/^_+|_+$/g, '')
    // Remove multiple consecutive underscores
    .replace(/_+/g, '_');
}

/**
 * Transform a Client page from Notion to our database format
 * Extracts ALL properties from the client page and stores them with clean, query-friendly names
 */
function transformClientPage(page: any): Client {
  const notionId = page.id;
  
  // Extract name (use "Name" property - it's a title field with id "title")
  const name = extractProperty(page, 'title', 'title', 'Name') || 
               extractProperty(page, 'Name', 'title') || 
               'Unknown Client';
  
  // Check if client is retired (Type property has "Retired" option)
  // Type property ID: %7Ch%5Cw
  const clientType = extractProperty(page, '%7Ch%5Cw', 'select', 'Type') ||
                     extractProperty(page, 'Type', 'select');
  const isRetired = clientType === 'Retired' || 
                   clientType?.toLowerCase().includes('retired') ||
                   false;
  
  // Extract created and updated times
  const createdTime = extractProperty(page, 'FZsJ', 'created_time', 'Created') ||
                      extractProperty(page, 'Created', 'created_time') ||
                      extractProperty(page, 'Created time', 'created_time') ||
                      new Date();
  const lastEditedTime = extractProperty(page, 'Last Updated', 'last_edited_time') || 
                         extractProperty(page, 'quje', 'last_edited_time', 'Last Updated') ||
                         new Date();
  
  // Extract ALL properties dynamically and store with clean names
  // Skip certain property types that don't need to be saved: button, unique_id, created_by, last_edited_by
  const excludedTypes = ['button', 'unique_id', 'created_by', 'last_edited_by'];
  const metadata: Record<string, any> = {};
  if (page.properties) {
    for (const [propKey, prop] of Object.entries(page.properties)) {
      const property = prop as any;
      if (!property || !property.type) continue;
      
      // Skip excluded property types
      if (excludedTypes.includes(property.type)) {
        continue;
      }
      
      const propName = property.name || propKey;
      const cleanFieldName = normalizePropertyName(propName);
      
      // Skip if we already have this field (avoid duplicates)
      if (metadata[cleanFieldName] !== undefined) {
        continue;
      }
      
      let extractedValue: any = null;
      
      try {
        // Use extractProperty for all property types
        extractedValue = extractProperty(page, propKey, property.type, propName);
        
        // Store the value directly with clean field name
        if (extractedValue !== null && extractedValue !== undefined) {
          metadata[cleanFieldName] = extractedValue;
        }
      } catch (error: any) {
        // If extraction fails, log warning but don't store
        console.warn(`[CLIENT SYNC] Failed to extract property ${propName} (${propKey}):`, error.message);
      }
    }
  }
  
  // Ensure commonly used properties are set (even if they're already in metadata)
  if (clientType) {
    metadata.type = clientType;
  }
  
  return {
    notion_id: notionId,
    name,
    is_retired: isRetired,
    created_at: createdTime || new Date(),
    updated_at: lastEditedTime || new Date(),
    last_synced_at: new Date(),
    metadata: {
      ...metadata,
    },
  };
}

/**
 * Sync Clients from Notion to MongoDB
 */
export async function syncClients(): Promise<SyncLog> {
  const db = await getDb();
  const syncLog: SyncLog = {
    sync_type: 'incremental',
    status: 'success',
    records_processed: 0,
    records_failed: 0,
    error_count: 0,
    started_at: new Date(),
    metadata: {},
  };

  try {
    console.log('Starting clients sync...');
    
    const pages = await fetchAllPages(CLIENTS_DB_ID);
    console.log(`[SYNC] Fetched ${pages.length} clients from Notion`);
    
    for (const page of pages) {
      try {
        const client = transformClientPage(page);
        
        await db.collection('clients').updateOne(
          { notion_id: client.notion_id },
          { $set: client },
          { upsert: true }
        );

        syncLog.records_processed++;
      } catch (error: any) {
        console.error(`Error processing client ${page.id}:`, error);
        syncLog.records_failed++;
        syncLog.error_count++;
      }
    }

    syncLog.completed_at = new Date();
    syncLog.status = syncLog.records_failed > 0 ? 'partial' : 'success';
    
    // Save sync log
    const { _id, ...syncLogToInsert } = syncLog;
    await db.collection('sync_logs').insertOne(syncLogToInsert as any);
    
    console.log(`Clients sync completed: ${syncLog.records_processed} processed, ${syncLog.records_failed} failed`);
    
    return syncLog;
  } catch (error: any) {
    syncLog.status = 'failed';
    syncLog.error_message = error.message;
    syncLog.completed_at = new Date();
    const { _id: syncLogId, ...syncLogToInsert } = syncLog;
    await db.collection('sync_logs').insertOne(syncLogToInsert as any);
    throw error;
  }
}

/**
 * Fetch client information from Notion and build a map of retired clients
 * Now uses cached clients from MongoDB for better performance
 */
async function getRetiredClientsMap(): Promise<Set<string>> {
  const retiredClients = new Set<string>();
  
  try {
    const db = await getDb();
    
    // First try to get from MongoDB (faster)
    const retiredClientsFromDb = await db.collection('clients').find({ is_retired: true }).toArray();
    if (retiredClientsFromDb.length > 0) {
      retiredClientsFromDb.forEach((client: any) => {
        retiredClients.add(client.notion_id);
      });
      console.log(`[SYNC] Found ${retiredClients.size} retired clients from MongoDB cache`);
      return retiredClients;
    }
    
    // Fallback: Fetch from Notion if not in MongoDB
    console.log('[SYNC] No retired clients in MongoDB, fetching from Notion...');
    const clientPages = await fetchAllPages(CLIENTS_DB_ID);
    
    for (const clientPage of clientPages) {
      // Extract Type property from client page (Type property ID: %7Ch%5Cw)
      const clientType = extractProperty(clientPage, '%7Ch%5Cw', 'select', 'Type') ||
                         extractProperty(clientPage, 'Type', 'select');
      
      if (clientType === 'Retired') {
        retiredClients.add(clientPage.id);
        // Extract client name
        const clientName = extractProperty(clientPage, 'title', 'title', 'Name') ||
                          extractProperty(clientPage, 'Name', 'title') ||
                          clientPage.id;
        console.log(`[SYNC] Found retired client: ${clientName} (${clientPage.id})`);
      }
    }
    
    console.log(`[SYNC] Found ${retiredClients.size} retired clients from Notion`);
  } catch (error: any) {
    console.warn(`[SYNC] Warning: Could not fetch client information to filter retired clients: ${error.message}`);
    // Continue with sync even if client fetch fails
  }
  
  return retiredClients;
}

export async function syncProjects(clientId?: string, limit?: number): Promise<SyncLog> {
  const db = await getDb();
  const syncLog: SyncLog = {
    sync_type: 'incremental',
    status: 'success',
    records_processed: 0,
    records_failed: 0,
    error_count: 0,
    started_at: new Date(),
    metadata: clientId ? { client_id: clientId } : {},
  };

  try {
    console.log(`Starting projects sync${clientId ? ` for client: ${clientId}` : ' (all clients)'}${limit ? ` (limit: ${limit})` : ''}...`);
    
    // Build Notion query filter
    let notionFilter: any = undefined;
    let retiredClients: Set<string> = new Set();
    
    if (clientId) {
      // When syncing for a specific client, query Notion directly for projects with that client relation
      // This is much more efficient than fetching all projects and filtering
      notionFilter = {
        property: PROJECT_PROPERTIES.CLIENT.id, // Use the Client property ID
        relation: {
          contains: clientId
        }
      };
      console.log(`[SYNC] Using Notion filter to fetch only projects for client ${clientId}`);
      // Skip retired client check when syncing specific client (user wants to sync it)
    } else {
      // Only fetch retired clients map when syncing ALL clients (to filter them out)
      retiredClients = await getRetiredClientsMap();
      if (retiredClients.size > 0) {
        console.log(`[SYNC] Found ${retiredClients.size} retired clients - will filter out their projects`);
        if (!syncLog.metadata) {
          syncLog.metadata = {};
        }
        syncLog.metadata.retired_clients_count = retiredClients.size;
      }
    }
    
    // Fetch pages from Notion with filter (if client specified, only that client's projects)
    const pages = await fetchAllPages(PROJECTS_DB_ID, notionFilter, limit);
    console.log(`[SYNC] Fetched ${pages.length} pages from Notion${clientId ? ` (filtered for client ${clientId})` : ''}${limit ? ` (limited to ${limit})` : ''}`);
    
    // Filter out retired clients only when syncing ALL clients
    let filteredPages = pages;
    if (!clientId && retiredClients.size > 0) {
      const beforeFilter = filteredPages.length;
      filteredPages = filteredPages.filter(page => {
        const client = findClientProperty(page, extractProperty);
        if (client && Array.isArray(client) && client.length > 0) {
          // Check if any of the client IDs are in the retired set
          const hasRetiredClient = client.some((cid: string) => retiredClients.has(cid));
          if (hasRetiredClient) {
            console.log(`[SYNC] Filtering out project ${page.id} - client is retired`);
            return false;
          }
        }
        return true;
      });
      console.log(`[SYNC] Filtered out ${beforeFilter - filteredPages.length} projects from retired clients`);
    }
    
    console.log(`[SYNC] Processing ${filteredPages.length} pages in batches...`);
    
    // Process in batches to avoid rate limits and timeouts
    const BATCH_SIZE = 50; // Process 50 at a time
    const DELAY_BETWEEN_BATCHES = 2000; // 2 seconds between batches
    
    for (let i = 0; i < filteredPages.length; i += BATCH_SIZE) {
      const batch = filteredPages.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(filteredPages.length / BATCH_SIZE);
      
      console.log(`[SYNC] Processing batch ${batchNumber}/${totalBatches} (${batch.length} items)...`);
      
      for (const page of batch) {
      try {
        const card = await transformProjectPage(page);
        
        // console.log(`[DEBUG] Card transformed for ${card.notion_id}: client_id=${card.client_id}, client_name=${card.client_name}`);
        
        // Upsert card by notion_id
        const result = await db.collection('cards').updateOne(
          { notion_id: card.notion_id },
          { $set: card },
          { upsert: true }
        );
        
        // console.log(`[DEBUG] Card saved to DB: ${card.notion_id}, upserted: ${result.upsertedCount > 0}, modified: ${result.modifiedCount > 0}`);

        // Get the inserted/updated card ID
        let cardDoc = await db.collection('cards').findOne({ notion_id: card.notion_id });
        if (cardDoc && !card._id) {
          card._id = cardDoc._id.toString();
        }
        
        // Verify client data was saved
        if (card.client_id) {
          const savedCard = await db.collection('cards').findOne(
            { notion_id: card.notion_id },
            { projection: { client_id: 1, client_name: 1 } }
          );
        }

        // Record status history if status changed
        await recordStatusHistory(card);

        syncLog.records_processed++;
      } catch (error: any) {
        console.error(`[ERROR] Error processing page ${page.id}:`, error);
        syncLog.records_failed++;
        syncLog.error_count++;
      }
      
      // Small delay between items to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
      // Delay between batches to avoid rate limits
      if (i + BATCH_SIZE < filteredPages.length) {
        console.log(`[SYNC] Waiting ${DELAY_BETWEEN_BATCHES}ms before next batch...`);
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
      }
    }
    
    console.log(`[SYNC] Sync completed: ${syncLog.records_processed} processed, ${syncLog.records_failed} failed`);

    syncLog.completed_at = new Date();
    syncLog.status = syncLog.records_failed > 0 ? 'partial' : 'success';
    
    // Save sync log (remove _id if present, MongoDB will generate it)
    const { _id, ...syncLogToInsert } = syncLog;
    await db.collection('sync_logs').insertOne(syncLogToInsert as any);
    
    console.log(`Sync completed: ${syncLog.records_processed} processed, ${syncLog.records_failed} failed`);
    
    return syncLog;
  } catch (error: any) {
    syncLog.status = 'failed';
    syncLog.error_message = error.message;
    syncLog.completed_at = new Date();
    // Save sync log (remove _id if present, MongoDB will generate it)
    const { _id: syncLogId, ...syncLogToInsert } = syncLog;
    await db.collection('sync_logs').insertOne(syncLogToInsert as any);
    throw error;
  }
}

export async function syncTeamMembers(): Promise<SyncLog> {
  const db = await getDb();
  const syncLog: SyncLog = {
    sync_type: 'incremental',
    status: 'success',
    records_processed: 0,
    records_failed: 0,
    error_count: 0,
    started_at: new Date(),
    metadata: {},
  };

  try {
    console.log('Starting team members sync...');
    
    const pages = await fetchAllPages(TEAM_MEMBERS_DB_ID);
    
    let membersWithUserId = 0;
    let membersWithLeadId = 0;
    
    for (const page of pages) {
      try {
        const member = transformTeamMemberPage(page);
        
        if (member.notion_user_id) {
          membersWithUserId++;
        }
        if (member.metadata?.lead_id) {
          membersWithLeadId++;
        }
        
        await db.collection('team_members').updateOne(
          { notion_id: member.notion_id || { $exists: false } },
          { $set: member },
          { upsert: true }
        );

        syncLog.records_processed++;
      } catch (error: any) {
        console.error(`Error processing team member ${page.id}:`, error);
        syncLog.records_failed++;
        syncLog.error_count++;
      }
    }
    
    console.log(`[TEAM MEMBER SYNC] Summary:`);
    console.log(`  - Total processed: ${syncLog.records_processed}`);
    console.log(`  - With notion_user_id: ${membersWithUserId}`);
    console.log(`  - With lead_id: ${membersWithLeadId}`);

    syncLog.completed_at = new Date();
    syncLog.status = syncLog.records_failed > 0 ? 'partial' : 'success';
    
    // Save sync log (remove _id if present, MongoDB will generate it)
    const { _id, ...syncLogToInsert } = syncLog;
    await db.collection('sync_logs').insertOne(syncLogToInsert as any);
    
    console.log(`Team members sync completed: ${syncLog.records_processed} processed`);
    
    return syncLog;
  } catch (error: any) {
    syncLog.status = 'failed';
    syncLog.error_message = error.message;
    syncLog.completed_at = new Date();
    // Save sync log (remove _id if present, MongoDB will generate it)
    const { _id: syncLogId2, ...syncLogToInsert2 } = syncLog;
    await db.collection('sync_logs').insertOne(syncLogToInsert2 as any);
    throw error;
  }
}

export async function transformProjectPage(page: any): Promise<Card> {
  const notionId = page.id;
  
  // Extract title (try both ID and name)
  const title = extractProperty(page, PROJECT_PROPERTIES.TITLE.id, PROJECT_PROPERTIES.TITLE.type, PROJECT_PROPERTIES.TITLE.name) || 'Untitled';
  
  // Extract status and type
  const status = extractProperty(page, PROJECT_PROPERTIES.STATUS.id, PROJECT_PROPERTIES.STATUS.type, PROJECT_PROPERTIES.STATUS.name);
  const type = extractProperty(page, PROJECT_PROPERTIES.TYPE.id, PROJECT_PROPERTIES.TYPE.type, PROJECT_PROPERTIES.TYPE.name);
  
  // Extract dates
  const createdTime = extractProperty(page, PROJECT_PROPERTIES.CREATED_TIME.id, PROJECT_PROPERTIES.CREATED_TIME.type, PROJECT_PROPERTIES.CREATED_TIME.name);
  const lastEditedTime = extractProperty(page, PROJECT_PROPERTIES.LAST_EDITED_TIME.id, PROJECT_PROPERTIES.LAST_EDITED_TIME.type, PROJECT_PROPERTIES.LAST_EDITED_TIME.name);
  const devDueDate = extractProperty(page, PROJECT_PROPERTIES.DEV_DUE_DATE.id, PROJECT_PROPERTIES.DEV_DUE_DATE.type, PROJECT_PROPERTIES.DEV_DUE_DATE.name);
  const originalDueDate = extractProperty(page, PROJECT_PROPERTIES.ORIGINAL_DUE_DATE.id, PROJECT_PROPERTIES.ORIGINAL_DUE_DATE.type, PROJECT_PROPERTIES.ORIGINAL_DUE_DATE.name);
  const doneDate = extractProperty(page, PROJECT_PROPERTIES.DONE_DATE.id, PROJECT_PROPERTIES.DONE_DATE.type, PROJECT_PROPERTIES.DONE_DATE.name);
  const readyForClientDate = extractProperty(page, PROJECT_PROPERTIES.READY_FOR_CLIENT_DATE.id, PROJECT_PROPERTIES.READY_FOR_CLIENT_DATE.type, PROJECT_PROPERTIES.READY_FOR_CLIENT_DATE.name);
  const deploymentDate = extractProperty(page, PROJECT_PROPERTIES.DEPLOYMENT_DATE.id, PROJECT_PROPERTIES.DEPLOYMENT_DATE.type, PROJECT_PROPERTIES.DEPLOYMENT_DATE.name);
  
  // Extract people (developer, lead developer, account manager, quality inspector, designer)
  const developer = extractProperty(page, PROJECT_PROPERTIES.DEVELOPER.id, PROJECT_PROPERTIES.DEVELOPER.type, PROJECT_PROPERTIES.DEVELOPER.name);
  const leadDeveloper = extractProperty(page, PROJECT_PROPERTIES.LEAD_DEVELOPER.id, PROJECT_PROPERTIES.LEAD_DEVELOPER.type, PROJECT_PROPERTIES.LEAD_DEVELOPER.name);
  const accountManager = extractProperty(page, PROJECT_PROPERTIES.ACCOUNT_MANAGER.id, PROJECT_PROPERTIES.ACCOUNT_MANAGER.type, PROJECT_PROPERTIES.ACCOUNT_MANAGER.name);
  const qualityInspector = extractProperty(page, PROJECT_PROPERTIES.QUALITY_INSPECTOR.id, PROJECT_PROPERTIES.QUALITY_INSPECTOR.type, PROJECT_PROPERTIES.QUALITY_INSPECTOR.name);
  const designer = extractProperty(page, PROJECT_PROPERTIES.DESIGNER.id, PROJECT_PROPERTIES.DESIGNER.type, PROJECT_PROPERTIES.DESIGNER.name);
  
  // Debug: Log account manager extraction for troubleshooting
  if (accountManager && Array.isArray(accountManager) && accountManager.length > 0) {
    // console.log(`[DEBUG] Account Manager extracted for ${notionId}:`, accountManager);
  } else if (page.properties?.[PROJECT_PROPERTIES.ACCOUNT_MANAGER.id]) {
    const amProp = page.properties[PROJECT_PROPERTIES.ACCOUNT_MANAGER.id];
    console.log(`[DEBUG] Account Manager property exists but extraction failed. Structure:`, {
      type: amProp.type,
      rollup_type: amProp.rollup?.type,
      rollup_array_length: amProp.rollup?.array?.length,
      first_item: amProp.rollup?.array?.[0]
    });
  }
  
  // Extract pushback counts
  const pushbackCount = extractProperty(page, PROJECT_PROPERTIES.PUSHBACK_COUNT.id, PROJECT_PROPERTIES.PUSHBACK_COUNT.type, PROJECT_PROPERTIES.PUSHBACK_COUNT.name);
  const clientPushbackCount = extractProperty(page, PROJECT_PROPERTIES.CLIENT_PUSHBACK_COUNT.id, PROJECT_PROPERTIES.CLIENT_PUSHBACK_COUNT.type, PROJECT_PROPERTIES.CLIENT_PUSHBACK_COUNT.name);
  const quantifiableClientPushback = extractProperty(page, PROJECT_PROPERTIES.QUANTIFIABLE_CLIENT_PUSHBACK.id, PROJECT_PROPERTIES.QUANTIFIABLE_CLIENT_PUSHBACK.type, PROJECT_PROPERTIES.QUANTIFIABLE_CLIENT_PUSHBACK.name);
  
  // Extract Days Late and Late? properties (will be stored later after all other extractions)
  
  // Extract QI data
  const qiStartTime = extractProperty(page, PROJECT_PROPERTIES.QI_START_TIME.id, PROJECT_PROPERTIES.QI_START_TIME.type, PROJECT_PROPERTIES.QI_START_TIME.name);
  const qiEndTime = extractProperty(page, PROJECT_PROPERTIES.QI_END_TIME.id, PROJECT_PROPERTIES.QI_END_TIME.type, PROJECT_PROPERTIES.QI_END_TIME.name);
  const statusSetToQITime = extractProperty(page, PROJECT_PROPERTIES.STATUS_SET_TO_QI_TIME.id, PROJECT_PROPERTIES.STATUS_SET_TO_QI_TIME.type, PROJECT_PROPERTIES.STATUS_SET_TO_QI_TIME.name);
  
  // Extract hours
  const projectedDevHours = extractProperty(page, PROJECT_PROPERTIES.PROJECTED_DEV_HOURS.id, PROJECT_PROPERTIES.PROJECTED_DEV_HOURS.type, PROJECT_PROPERTIES.PROJECTED_DEV_HOURS.name);
  const actualDevHoursNum = extractProperty(page, PROJECT_PROPERTIES.ACTUAL_DEV_HOURS_NUM.id, PROJECT_PROPERTIES.ACTUAL_DEV_HOURS_NUM.type, PROJECT_PROPERTIES.ACTUAL_DEV_HOURS_NUM.name);
  const totalProjectHours = extractProperty(page, PROJECT_PROPERTIES.TOTAL_PROJECT_HOURS.id, PROJECT_PROPERTIES.TOTAL_PROJECT_HOURS.type, PROJECT_PROPERTIES.TOTAL_PROJECT_HOURS.name);
  const projectedQIHours = extractProperty(page, PROJECT_PROPERTIES.PROJECTED_QI_HOURS.id, PROJECT_PROPERTIES.PROJECTED_QI_HOURS.type, PROJECT_PROPERTIES.PROJECTED_QI_HOURS.name);
  const totalQIHoursDecimal = extractProperty(page, PROJECT_PROPERTIES.TOTAL_QI_HOURS_DECIMAL.id, PROJECT_PROPERTIES.TOTAL_QI_HOURS_DECIMAL.type, PROJECT_PROPERTIES.TOTAL_QI_HOURS_DECIMAL.name);
  const bufferHours = extractProperty(page, PROJECT_PROPERTIES.BUFFER_HOURS.id, PROJECT_PROPERTIES.BUFFER_HOURS.type, PROJECT_PROPERTIES.BUFFER_HOURS.name);
  
  // Extract Time Doctor Project IDs
  const timeDoctorProjectId = extractProperty(page, PROJECT_PROPERTIES.TIME_DOCTOR_PROJECT_ID.id, PROJECT_PROPERTIES.TIME_DOCTOR_PROJECT_ID.type, PROJECT_PROPERTIES.TIME_DOCTOR_PROJECT_ID.name);
  const timeDoctorClientProjectId = extractProperty(page, PROJECT_PROPERTIES.TIME_DOCTOR_CLIENT_PROJECT_ID.id, PROJECT_PROPERTIES.TIME_DOCTOR_CLIENT_PROJECT_ID.type, PROJECT_PROPERTIES.TIME_DOCTOR_CLIENT_PROJECT_ID.name);
  
  // Extract relations - Client property using robust detection
  // Using centralized property configuration for maintainability
  const client = findClientProperty(page, extractProperty);
  
  // Debug: Check if property exists at all
  if (!client || client.length === 0) {
    const clientProp = page.properties?.[PROJECT_PROPERTIES.CLIENT.id];
    if (clientProp) {
      console.log(`[DEBUG] Client property exists but is empty. Property structure:`, {
        type: clientProp.type,
        relation: clientProp.relation,
        has_more: clientProp.has_more
      });
    } else {
      // Check if property exists by name
      const clientPropByName = page.properties?.[PROJECT_PROPERTIES.CLIENT.name];
      if (clientPropByName) {
        console.log(`[DEBUG] Client property found by name '${PROJECT_PROPERTIES.CLIENT.name}' but not by ID '${PROJECT_PROPERTIES.CLIENT.id}'`);
      } else {
        console.log(`[DEBUG] Client property not found. Available relation properties:`, 
          Object.keys(page.properties || {}).filter(key => {
            const prop = page.properties[key];
            return prop && typeof prop === 'object' && 'type' in prop && prop.type === 'relation';
          })
        );
      }
    }
  }
  
  
  const tasks = extractProperty(page, PROJECT_PROPERTIES.TASKS.id, PROJECT_PROPERTIES.TASKS.type, PROJECT_PROPERTIES.TASKS.name);
  const allQITimeTrackerEntries = extractProperty(page, PROJECT_PROPERTIES.ALL_QI_TIME_TRACKER_ENTRIES.id, PROJECT_PROPERTIES.ALL_QI_TIME_TRACKER_ENTRIES.type, PROJECT_PROPERTIES.ALL_QI_TIME_TRACKER_ENTRIES.name);
  
  // Calculate projected design hours from Tasks Duration (for Design/CRO projects)
  let projectedDesignHours = 0;
  const isDesignProject = type === 'Design' || type === 'CRO';
  if (isDesignProject && tasks && Array.isArray(tasks) && tasks.length > 0) {
    try {
      // Fetch tasks and sum Duration field
      for (const taskId of tasks) {
        try {
          const taskPage = await notion.pages.retrieve({ page_id: taskId });
          
          // Try multiple approaches to find Duration property
          let duration = extractProperty(taskPage, '_DxC', 'number', 'Duration') || 0;
          if (duration === 0 || duration === null) {
            duration = extractProperty(taskPage, 'Duration', 'number', 'Duration') || 0;
          }
          
          // If still not found, search all properties
          if (duration === 0 || duration === null) {
            const props = (taskPage as any).properties || {};
            for (const [propKey, prop] of Object.entries(props)) {
              const propObj = prop as any;
              if (propObj.type === 'number' || propObj.type === 'formula') {
                const propName = propObj.name?.toLowerCase() || '';
                if (propName.includes('duration') || propName.includes('hours')) {
                  const extracted = extractProperty(taskPage, propKey, propObj.type, propObj.name);
                  if (extracted && typeof extracted === 'number' && extracted > 0) {
                    duration = extracted;
                    break;
                  }
                }
              }
            }
          }
          
          projectedDesignHours += duration || 0;
          
          // Small delay to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error: any) {
          console.warn(`[EXTRACTOR] Could not fetch task ${taskId} for design hours:`, error.message);
          // Continue with other tasks
        }
      }
    } catch (error: any) {
      console.warn(`[EXTRACTOR] Error calculating projected design hours for ${notionId}:`, error.message);
    }
  }
  
  // Extract client information
  let client_id: string | undefined;
  let client_name: string | undefined;
  
  
  if (client && Array.isArray(client) && client.length > 0) {
    client_id = client[0]; // Store first client ID
    // Look up client name from MongoDB (much faster than fetching from Notion)
    try {
      const db = await getDb();
      const clientDoc = await db.collection('clients').findOne({ notion_id: client[0] });
      
      if (clientDoc) {
        client_name = clientDoc.name;
        // console.log(`[DEBUG] Client name found in MongoDB: ${client_name}`);
      } else {
        // Fallback: If not in MongoDB, try fetching from Notion (shouldn't happen if clients are synced)
        console.warn(`[DEBUG] Client ${client[0]} not found in MongoDB, fetching from Notion (should sync clients first)`);
        try {
          const clientPage = await notion.pages.retrieve({ page_id: client[0] });
      if (clientPage && 'properties' in clientPage) {
        const clientNameProp = extractProperty(clientPage, 'Name', 'title');
        if (clientNameProp) {
          client_name = clientNameProp;
        } else {
              const nameProp = (clientPage as any).properties?.Name as any;
          if (nameProp?.type === 'title' && nameProp?.title && Array.isArray(nameProp.title)) {
            client_name = nameProp.title.map((segment: any) => segment.plain_text || '').join('') || '';
          }
        }
      }
    } catch (error: any) {
      console.warn(`[DEBUG] Could not fetch client name for ${client[0]}:`, error.message);
        }
      }
    } catch (error: any) {
      console.warn(`[DEBUG] Error looking up client in MongoDB:`, error.message);
      // Don't fail - we still have client_id
    }
  } else {
    console.log(`[DEBUG] No client relation found for project ${notionId} (${title}). Client value:`, client);
  }
  
  // console.log(`[DEBUG] Final client data for ${notionId}: client_id=${client_id}, client_name=${client_name}`);

  // Extract ALL properties from the page and store them with clean, query-friendly names
  // Skip certain property types that don't need to be saved: button, unique_id, created_by, last_edited_by
  const excludedTypes = ['button', 'unique_id', 'created_by', 'last_edited_by'];
  
  // Properties that are already extracted above - store them with clean names
  const extractedProperties: Record<string, any> = {};
  const propertyMapping: Record<string, string> = {}; // Maps Notion property names to normalized field names
  
  // Store all extracted values with clean names
  if (pushbackCount !== null && pushbackCount !== undefined) {
    extractedProperties.pushback_count = pushbackCount;
  }
  if (clientPushbackCount !== null && clientPushbackCount !== undefined) {
    extractedProperties.client_pushback_count = clientPushbackCount;
  }
  if (quantifiableClientPushback !== null && quantifiableClientPushback !== undefined) {
    extractedProperties.quantifiable_client_pushback = quantifiableClientPushback;
  }
  
  if (qiStartTime?.start) {
    extractedProperties.qi_start_time = new Date(qiStartTime.start);
  }
  if (qiEndTime?.start) {
    extractedProperties.qi_end_time = new Date(qiEndTime.end);
  }
  if (statusSetToQITime?.start) {
    extractedProperties.status_set_to_qi_time = new Date(statusSetToQITime.start);
  }
  
  if (projectedDevHours) {
    extractedProperties.projected_dev_hours = projectedDevHours;
  }
  if (actualDevHoursNum) {
    extractedProperties.actual_dev_hours = actualDevHoursNum;
    // Also store as alternative field name for compatibility
    extractedProperties.actual_dev_hours_number = actualDevHoursNum;
  }
  if (totalProjectHours) {
    extractedProperties.total_project_hours = totalProjectHours;
  }
  if (projectedQIHours) {
    extractedProperties.projected_qi_hours = projectedQIHours;
  }
  if (totalQIHoursDecimal) {
    extractedProperties.total_qi_hours_decimal = totalQIHoursDecimal;
    // Also store as alternative field name for compatibility
    extractedProperties.actual_qi_hours = totalQIHoursDecimal;
  }
  if (bufferHours) {
    extractedProperties.buffer_hours = bufferHours;
  }
  if (projectedDesignHours) {
    extractedProperties.projected_design_hours = projectedDesignHours;
  }
  
  if (originalDueDate) {
    extractedProperties.original_due_date = originalDueDate;
  }
  if (doneDate?.start) {
    extractedProperties.done_date = new Date(doneDate.start);
  }
  if (readyForClientDate?.start) {
    extractedProperties.ready_for_client_date = new Date(readyForClientDate.start);
  }
  if (deploymentDate?.start) {
    extractedProperties.deployment_date = new Date(deploymentDate.start);
  }
  
  // Store Days Late (formula returns number or can be calculated)
  // Extract directly here to ensure it's fresh
  const daysLateProp = page.properties?.[PROJECT_PROPERTIES.DAYS_LATE.id] || page.properties?.[PROJECT_PROPERTIES.DAYS_LATE.name];
  const daysLateValue = extractProperty(page, PROJECT_PROPERTIES.DAYS_LATE.id, PROJECT_PROPERTIES.DAYS_LATE.type, PROJECT_PROPERTIES.DAYS_LATE.name);
  
  // Always add to property mapping if property exists (use property name as key, like other properties)
  if (daysLateProp) {
    propertyMapping[PROJECT_PROPERTIES.DAYS_LATE.name] = 'days_late';
  }
  
  if (daysLateValue !== null && daysLateValue !== undefined) {
    const daysLateNum = Number(daysLateValue);
    // Store if it's a valid number (including 0, but not NaN)
    if (!isNaN(daysLateNum)) {
      extractedProperties.days_late = daysLateNum;
    } else {
      console.warn(`[CARD SYNC] Days Late formula returned invalid number for project ${notionId}:`, daysLateValue, 'Raw property:', daysLateProp);
      // Store as 0 if invalid to indicate property exists
      extractedProperties.days_late = 0;
    }
  } else if (daysLateProp) {
    // Property exists but formula returned null - store as 0 to indicate property exists
    console.warn(`[CARD SYNC] Days Late property exists but formula returned null/undefined for project ${notionId}. Property structure:`, JSON.stringify(daysLateProp, null, 2));
    extractedProperties.days_late = 0;
  }
  
  // Store Late? property - both as string and boolean
  // Extract directly here to ensure it's fresh
  const lateProp = page.properties?.[PROJECT_PROPERTIES.LATE.id] || page.properties?.[PROJECT_PROPERTIES.LATE.name];
  const lateValue = extractProperty(page, PROJECT_PROPERTIES.LATE.id, PROJECT_PROPERTIES.LATE.type, PROJECT_PROPERTIES.LATE.name);
  
  // Always add to property mapping if property exists (use property name as key, like other properties)
  if (lateProp) {
    propertyMapping[PROJECT_PROPERTIES.LATE.name] = 'late';
  }
  
  if (lateValue !== null && lateValue !== undefined) {
    // Store the original string value
    if (typeof lateValue === 'string') {
      extractedProperties.late = lateValue;
    }
    // Also store as boolean for easier querying
    extractedProperties.is_late = lateValue === true || 
                                   lateValue === 'true' || 
                                   lateValue === 'Yes' || 
                                   lateValue === 'yes' || 
                                   lateValue === '💀 LATE' || 
                                   (typeof lateValue === 'string' && lateValue.includes('LATE'));
  } else if (lateProp) {
    // Property exists but formula returned null - store default values to indicate property exists
    console.warn(`[CARD SYNC] Late? property exists but formula returned null/undefined for project ${notionId}. Property structure:`, JSON.stringify(lateProp, null, 2));
    extractedProperties.late = '⌚️ On Time'; // Default value
    extractedProperties.is_late = false;
  }
  
  if (client && Array.isArray(client) && client.length > 0) {
    extractedProperties.client_ids = client;
  }
  if (tasks && Array.isArray(tasks) && tasks.length > 0) {
    extractedProperties.task_ids = tasks;
  }
  if (allQITimeTrackerEntries && Array.isArray(allQITimeTrackerEntries) && allQITimeTrackerEntries.length > 0) {
    extractedProperties.qi_time_tracker_entry_ids = allQITimeTrackerEntries;
  }
  
  if (developer && Array.isArray(developer) && developer.length > 0) {
    extractedProperties.developer_ids = developer;
  }
  if (leadDeveloper && Array.isArray(leadDeveloper) && leadDeveloper.length > 0) {
    extractedProperties.lead_developer_ids = leadDeveloper;
  }
  if (accountManager && Array.isArray(accountManager) && accountManager.length > 0) {
    extractedProperties.account_manager_ids = accountManager;
  }
  if (qualityInspector && Array.isArray(qualityInspector) && qualityInspector.length > 0) {
    extractedProperties.quality_inspector_ids = qualityInspector;
  }
  if (designer && Array.isArray(designer) && designer.length > 0) {
    extractedProperties.designer_ids = designer;
  }
  
  if (timeDoctorProjectId) {
    extractedProperties.time_doctor_task_id = timeDoctorProjectId;
  }
  if (timeDoctorClientProjectId) {
    extractedProperties.time_doctor_client_project_id = timeDoctorClientProjectId;
  }
  
  // Extract ALL other properties from the page
  if (page.properties) {
    for (const [propKey, prop] of Object.entries(page.properties)) {
      const property = prop as any;
      if (!property || !property.type) continue;
      
      // Skip excluded property types
      if (excludedTypes.includes(property.type)) {
        continue;
      }
      
      const propName = property.name || propKey;
      const cleanFieldName = normalizePropertyName(propName);
      
      // Skip if we already have this field (avoid duplicates with extracted properties above)
      // Also skip "Days Late" and "Late?" as they're handled explicitly above
      if (extractedProperties[cleanFieldName] !== undefined ||
          cleanFieldName === 'days_late' ||
          cleanFieldName === 'late' ||
          cleanFieldName === 'is_late' ||
          propKey === PROJECT_PROPERTIES.DAYS_LATE.id ||
          propKey === PROJECT_PROPERTIES.LATE.id) {
        continue;
      }
      
      let extractedValue: any = null;
      
      try {
        // Use extractProperty for all property types
        extractedValue = extractProperty(page, propKey, property.type, propName);
        
        // Store the value directly with clean field name
        if (extractedValue !== null && extractedValue !== undefined) {
          // Handle date objects - convert to Date if needed
          if (typeof extractedValue === 'object' && extractedValue !== null && 'start' in extractedValue) {
            extractedProperties[cleanFieldName] = new Date(extractedValue.start);
          } else {
            extractedProperties[cleanFieldName] = extractedValue;
          }
          // Keep mapping for reference (use property name as key, not ID, for consistency)
          propertyMapping[propName] = cleanFieldName;
        }
      } catch (error: any) {
        // If extraction fails, log warning but don't store
        console.warn(`[CARD SYNC] Failed to extract property ${propName} (${propKey}):`, error.message);
      }
    }
  }

  // Store property mapping for reference (maps Notion property names to normalized field names)
  if (Object.keys(propertyMapping).length > 0) {
    extractedProperties._notion_property_mapping = propertyMapping;
  }
  
  // Ensure status and type are also in metadata (as mentioned in reference doc)
  if (status) {
    extractedProperties.status = status;
  }
  if (type) {
    extractedProperties.type = type;
  }
  
  // Store name in metadata (duplicate of top-level title, as mentioned in reference)
  extractedProperties.name = title;
  
  // Store client name in metadata (duplicate, as mentioned in reference)
  if (client_name) {
    extractedProperties.client_name_duplicate = client_name;
  }
  
  // Store client relation with alternative field name
  if (client && Array.isArray(client) && client.length > 0) {
    extractedProperties.client = client; // Alternative to client_ids
  }
  
  // Store developer with alternative field name
  if (developer && Array.isArray(developer) && developer.length > 0) {
    extractedProperties.developer = developer; // Alternative to developer_ids
  }
  
  // Store lead developer with alternative field name
  if (leadDeveloper && Array.isArray(leadDeveloper) && leadDeveloper.length > 0) {
    extractedProperties.lead_developer = leadDeveloper; // Alternative to lead_developer_ids
  }
  
  // Store account manager with alternative field name
  if (accountManager && Array.isArray(accountManager) && accountManager.length > 0) {
    extractedProperties.account_manager = accountManager; // Alternative to account_manager_ids
  }
  
  // Store designer with alternative field name
  if (designer && Array.isArray(designer) && designer.length > 0) {
    extractedProperties.designer = designer; // Alternative to designer_ids
  }
  
  // Store quality inspector with alternative field name
  if (qualityInspector && Array.isArray(qualityInspector) && qualityInspector.length > 0) {
    extractedProperties.quality_inspector = qualityInspector; // Alternative to quality_inspector_ids
  }
  
  // Store tasks with alternative field name
  if (tasks && Array.isArray(tasks) && tasks.length > 0) {
    extractedProperties.tasks = tasks; // Alternative to task_ids
  }
  
  // Store all QI time tracker entries with alternative field name
  if (allQITimeTrackerEntries && Array.isArray(allQITimeTrackerEntries) && allQITimeTrackerEntries.length > 0) {
    extractedProperties.all_qi_time_tracker_entries = allQITimeTrackerEntries; // Alternative to qi_time_tracker_entry_ids
  }
  
  // Store Time Doctor project ID with alternative field name
  if (timeDoctorProjectId) {
    extractedProperties.time_doctor_project_id = timeDoctorProjectId; // Alternative to time_doctor_task_id
  }

  return {
    notion_id: notionId,
    title,
    status: status || null,
    type: type || null,
    client_id,
    client_name,
    created_at: createdTime || new Date(),
    updated_at: lastEditedTime || new Date(),
    last_synced_at: new Date(),
    metadata: {
      // Store all properties with clean, flat names for easy querying
      // All properties are stored directly in metadata (flat structure) as per MongoDB reference
      ...extractedProperties,
    },
  };
}

const QI_TIME_TRACKER_DB_ID = '26a9ca8db0d780b2a85afbe21cdb4885';

/**
 * Transform a QI Time Tracker page from Notion to our database format
 */
function transformQITimeTrackerPage(page: any): any {
  const notionId = page.id;
  const projectName = extractProperty(page, 'title', 'title', 'Project Name') || 'Unknown Project';
  const projectId = extractProperty(page, 'C^un', 'rich_text', 'Project ID') || '';
  const projectLink = extractProperty(page, 'RGbS', 'url', 'Project Link') || '';
  const clientName = extractProperty(page, 'cWVR', 'rich_text', 'Client Name') || '';
  const qualityInspector = extractProperty(page, '~syV', 'rich_text', 'Quality Inspector') || '';
  const date = extractProperty(page, 'SM~y', 'date', 'Date');
  const time = extractProperty(page, 'b^si', 'rich_text', 'Time') || '';
  const numberOfHours = extractProperty(page, '%40arI', 'number', 'Number Of Hours') || 0;

  // Parse date if available
  let parsedDate: Date | undefined;
  if (date && typeof date === 'object' && 'start' in date) {
    parsedDate = new Date(date.start);
  } else if (date && typeof date === 'string') {
    parsedDate = new Date(date);
  }

  return {
    notion_id: notionId,
    project_name: projectName,
    project_id: projectId,
    project_link: projectLink,
    client_name: clientName,
    quality_inspector: qualityInspector,
    date: parsedDate,
    time: time,
    number_of_hours: numberOfHours || 0,
    created_at: page.created_time ? new Date(page.created_time) : new Date(),
    updated_at: page.last_edited_time ? new Date(page.last_edited_time) : new Date(),
    last_synced_at: new Date(),
  };
}

/**
 * Sync QI Time Tracker entries from Notion to MongoDB
 */
export async function syncQITimeTrackerEntries(): Promise<SyncLog> {
  const db = await getDb();
  const syncLog: SyncLog = {
    sync_type: 'incremental',
    status: 'success',
    records_processed: 0,
    records_failed: 0,
    error_count: 0,
    started_at: new Date(),
    metadata: {},
  };

  try {
    console.log('[SYNC] Starting QI Time Tracker entries sync...');
    
    const pages = await fetchAllPages(QI_TIME_TRACKER_DB_ID);
    console.log(`[SYNC] Fetched ${pages.length} QI Time Tracker entries from Notion`);
    
    for (const page of pages) {
      try {
        const entry = transformQITimeTrackerPage(page);
        
        await db.collection('qi_time_tracker_entries').updateOne(
          { notion_id: entry.notion_id },
          { $set: entry },
          { upsert: true }
        );

        syncLog.records_processed++;
      } catch (error: any) {
        console.error(`[SYNC] Error processing QI Time Tracker entry ${page.id}:`, error);
        syncLog.records_failed++;
        syncLog.error_count++;
      }
    }

    syncLog.completed_at = new Date();
    syncLog.status = syncLog.records_failed > 0 ? 'partial' : 'success';
    
    // Save sync log
    const { _id, ...syncLogToInsert } = syncLog;
    await db.collection('sync_logs').insertOne(syncLogToInsert as any);
    
    console.log(`[SYNC] QI Time Tracker entries sync completed: ${syncLog.records_processed} processed, ${syncLog.records_failed} failed`);
    
    return syncLog;
  } catch (error: any) {
    syncLog.status = 'failed';
    syncLog.error_message = error.message;
    syncLog.completed_at = new Date();
    // Save sync log
    const { _id: syncLogId, ...syncLogToInsert } = syncLog;
    await db.collection('sync_logs').insertOne(syncLogToInsert as any);
    throw error;
  }
}

function transformTeamMemberPage(page: any): TeamMember {
  const notionId = page.id;
  
  // Debug: Log page structure for first page to understand what's available
  if (!hasLoggedPageStructure) {
    console.log('[TEAM MEMBER SYNC] Sample page object keys:', Object.keys(page));
    console.log('[TEAM MEMBER SYNC] created_by available?', !!page.created_by);
    console.log('[TEAM MEMBER SYNC] created_by value:', page.created_by);
    hasLoggedPageStructure = true;
  }
  
  // Basic Info - Extract name first for logging
  const name = extractProperty(page, 'title', 'title', 'Name') || 'Unknown';
  
  // Extract Notion User ID for mapping people properties to page IDs
  // We'll try multiple sources in order of preference:
  // 1. "Notion User" property (if it exists in your database)
  // 2. created_by field from the page metadata
  let notionUserId: string | undefined = undefined;
  
  // Try to find a "Notion User" property (people type)
  // Common property IDs: Try multiple possibilities
  const possiblePropertyIds = ['S%3DgW', 'Notion User', 'notion_user', '%60_Su'];
  for (const propId of possiblePropertyIds) {
    try {
      const notionUserProp = extractProperty(page, propId, 'people', 'Notion User');
      if (notionUserProp && Array.isArray(notionUserProp) && notionUserProp.length > 0) {
        notionUserId = notionUserProp[0];
        console.log(`[TEAM MEMBER SYNC] Found Notion User property for ${name}: ${notionUserId}`);
        break;
      }
    } catch (e) {
      // Property doesn't exist, try next
    }
  }
  
  // Fallback to created_by - this is the Notion user who created this page
  // This works well if each team member's page is created by themselves
  if (!notionUserId && page.created_by?.id) {
    notionUserId = page.created_by.id;
    console.log(`[TEAM MEMBER SYNC] Using created_by for ${name}: ${notionUserId}`);
  }
  
  if (!notionUserId) {
    console.warn(`[TEAM MEMBER SYNC] No Notion user ID found for ${name} (page: ${notionId})`);
  }
  
  // Continue with other basic info
  const companyEmail = extractProperty(page, 'eb%40P', 'email', 'Company Email');
  const personalEmail = extractProperty(page, 'l%60%3Bs', 'email', 'Email');
  const phone = extractProperty(page, 'agCw', 'phone_number', 'Phone');
  
  // Position & Organization
  const position = extractProperty(page, 'l%40D%3C', 'rich_text', 'Position');
  const departments = extractProperty(page, '%7B%7DOp', 'multi_select', 'Department') || [];
  const level = extractProperty(page, 'sTk%3A', 'select', 'Level');
  const country = extractProperty(page, 'gs%3FE', 'select', 'Country');
  const techStack = extractProperty(page, 'lwRA', 'multi_select', 'Tech Stack') || [];
  
  // People Relations
  const lead = extractProperty(page, 'ku%3Dm', 'people', 'Lead');
  const referral = extractProperty(page, 't%60EQ', 'people', 'Referal');
  
  // Employment Status
  const employmentStatus = extractProperty(page, 'LrTw', 'select', 'Employment Status');
  const reasonLeaving = extractProperty(page, '%3A%3Dbr', 'select', 'Reason Leaving');
  const interviewStage = extractProperty(page, 'b%7B%40p', 'select', 'Interview Stage');
  const source = extractProperty(page, 'Ix%3B%3E', 'select', 'Source');
  
  // Dates
  const hireDate = extractProperty(page, '%5DLJl', 'date', 'Hire Date');
  const lastDay = extractProperty(page, 'ZtU%3D', 'date', 'Last Day');
  const birthday = extractProperty(page, '%60~jQ', 'date', 'Birthday');
  const lastIncrease = extractProperty(page, 'kdi%3A', 'date', 'Last Increase');
  const nextIncrease = extractProperty(page, 'kwxi', 'date', 'Next Increase');
  const payday = extractProperty(page, '%60adN', 'date', 'PayDay');
  const lastBalanceUpdate = extractProperty(page, '%40%3DH%7D', 'date', 'Last Balance Update');
  
  // Rates & Compensation
  const salary = extractProperty(page, '%7DtKx', 'number', 'Salary');
  const futureSalary = extractProperty(page, 'a%7CAO', 'number', 'Future Salary');
  
  // Leave Balances
  const vacationBalance = extractProperty(page, 'M%3BSW', 'number', 'Vacation Leave Balance');
  const sickBalance = extractProperty(page, 'Cpl_', 'number', 'Sick Leave Balance');
  const emergencyBalance = extractProperty(page, 'wc%3CA', 'number', 'Emergency Leave Balance');
  const maternityBalance = extractProperty(page, '_XR~', 'number', 'Maternity Leave Balance');
  
  // URLs & Links
  const linkedin = extractProperty(page, 'd~b%5C', 'url', 'LinkedIn');
  const github = extractProperty(page, 'dr%5Ee', 'url', 'Github');
  const invoices = extractProperty(page, 'dRo~', 'url', 'Invoices');
  
  // Files (extract URLs - returns array, take first)
  const profilePictureFiles = extractProperty(page, '%5De%5Em', 'files', 'Profile Picture');
  const cvFiles = extractProperty(page, 'Jd%3F%7D', 'files', 'CV');
  const profilePictureUrl = Array.isArray(profilePictureFiles) && profilePictureFiles.length > 0 ? profilePictureFiles[0] : undefined;
  const cvUrl = Array.isArray(cvFiles) && cvFiles.length > 0 ? cvFiles[0] : undefined;
  
  // Additional
  const gender = extractProperty(page, '%5DK%3Ez', 'select', 'Gender');
  const notes = extractProperty(page, 'Al%3En', 'rich_text', 'Notes');
  
  // Get lead and referral IDs (these are Notion user IDs from people properties)
  const leadId = Array.isArray(lead) && lead.length > 0 ? lead[0] : undefined;
  const referralId = Array.isArray(referral) && referral.length > 0 ? referral[0] : undefined;
  
  // Debug: Log lead information for first few members
  if (leadId) {
    console.log(`[TEAM MEMBER SYNC] ${name} has lead_id: ${leadId} (type: ${typeof leadId})`);
  }
  
  // Debug logging
  // console.log(`[DEBUG] Team Member ${notionId} (${name}):`, {
  //   position,
  //   departments,
  //   level,
  //   country,
  //   techStack,
  //   employmentStatus,
  //   salary,
  //   leadId,
  //   referralId
  // });
  
  return {
    notion_id: notionId,
    notion_user_id: notionUserId, // Add Notion user ID for mapping
    name,
    email: companyEmail || personalEmail || undefined,
    role: position || undefined,
    team: Array.isArray(departments) && departments.length > 0 ? departments[0] : undefined,
    active: employmentStatus === 'Active',
    created_at: hireDate?.start ? new Date(hireDate.start) : new Date(),
    metadata: {
      // Performance & Organization
      level: level || undefined,
      departments: Array.isArray(departments) ? departments : undefined,
      country: country || undefined,
      tech_stack: Array.isArray(techStack) && techStack.length > 0 ? techStack : undefined,
      lead_id: leadId, // This is a Notion user ID from the Lead people property
      referral_id: referralId,
      
      // Rates & Compensation
      salary: salary !== null && salary !== undefined ? salary : undefined,
      future_salary: futureSalary !== null && futureSalary !== undefined ? futureSalary : undefined,
      last_increase_date: lastIncrease?.start ? new Date(lastIncrease.start) : undefined,
      next_increase_date: nextIncrease?.start ? new Date(nextIncrease.start) : undefined,
      
      // Contact & Profile
      phone: phone || undefined,
      company_email: companyEmail || undefined,
      personal_email: personalEmail || undefined,
      linkedin_url: linkedin || undefined,
      github_url: github || undefined,
      profile_picture_url: profilePictureUrl,
      cv_url: cvUrl,
      
      // Dates
      birthday: birthday?.start ? new Date(birthday.start) : undefined,
      hire_date: hireDate?.start ? new Date(hireDate.start) : undefined,
      last_day: lastDay?.start ? new Date(lastDay.start) : undefined,
      
      // Leave Balances
      vacation_balance: vacationBalance !== null && vacationBalance !== undefined ? vacationBalance : undefined,
      sick_balance: sickBalance !== null && sickBalance !== undefined ? sickBalance : undefined,
      emergency_balance: emergencyBalance !== null && emergencyBalance !== undefined ? emergencyBalance : undefined,
      maternity_balance: maternityBalance !== null && maternityBalance !== undefined ? maternityBalance : undefined,
      last_balance_update: lastBalanceUpdate?.start ? new Date(lastBalanceUpdate.start) : undefined,
      
      // Hiring & Status
      source: source || undefined,
      interview_stage: interviewStage || undefined,
      employment_status: employmentStatus || undefined,
      reason_leaving: reasonLeaving || undefined,
      gender: gender || undefined,
      
      // Additional
      payday: payday?.start ? new Date(payday.start) : undefined,
      invoices_url: invoices || undefined,
      notes: notes || undefined,
    },
  };
}

export async function recordStatusHistory(card: Card): Promise<void> {
  const db = await getDb();
  
  // Find the card in DB to get its _id
  const cardDoc = await db.collection('cards').findOne({ notion_id: card.notion_id });
  const cardId = cardDoc?._id?.toString() || card.notion_id;
  
  // Get last status from history
  const lastHistory = await db.collection('card_status_history')
    .findOne(
      { card_id: cardId },
      { sort: { changed_at: -1 } }
    );

  // Only record if status changed
  if (!lastHistory || lastHistory.status !== card.status) {
    const history: CardStatusHistory = {
      card_id: cardId,
      status: card.status || 'Unknown',
      changed_at: card.updated_at,
      detected_at: new Date(),
      source: 'notion',
    };

    // Remove _id if present, MongoDB will generate it
    const { _id: historyId, ...historyToInsert } = history;
    await db.collection('card_status_history').insertOne(historyToInsert as any);
  }
}

