/**
 * Notion Property IDs and Configuration
 * 
 * This file contains all known Notion property IDs and names for the Projects database.
 * These are used to reliably extract data from Notion pages.
 */

export const PROJECT_PROPERTIES = {
  // Core properties
  TITLE: { id: 'title', name: 'Name', type: 'title' },
  STATUS: { id: '%7BjDe', name: 'Status', type: 'select' },
  TYPE: { id: 'XqH%3C', name: 'Type', type: 'select' },
  
  // Dates
  CREATED_TIME: { id: 'OH%3BV', name: 'Created time', type: 'created_time' },
  LAST_EDITED_TIME: { id: 'quje', name: 'Last Updated', type: 'last_edited_time' },
  DEV_DUE_DATE: { id: 'pD%7BQ', name: 'Dev Due Date', type: 'date' },
  ORIGINAL_DUE_DATE: { id: 'tkxZ', name: 'Original Due Date', type: 'date' },
  QI_START_TIME: { id: 'pOnD', name: 'QI Start Time', type: 'date' },
  QI_END_TIME: { id: 'QZL%7D', name: 'QI End Time', type: 'date' },
  STATUS_SET_TO_QI_TIME: { id: 'mYDg', name: 'Status Set To QI (Time)', type: 'date' },
  DONE_DATE: { id: 'PEKf', name: 'Done date', type: 'date' },
  READY_FOR_CLIENT_DATE: { id: 'W__Q', name: 'Ready for Client Date', type: 'date' },
  DEPLOYMENT_DATE: { id: 'LTLM', name: 'Deployment date', type: 'date' },
  
  // People
  DEVELOPER: { id: 'l%7DQv', name: 'Developer', type: 'people' },
  LEAD_DEVELOPER: { id: 'k%7BYW', name: 'Lead Developer', type: 'people' },
  QUALITY_INSPECTOR: { id: '%3D%3CLL', name: 'Quality Inspector', type: 'people' },
  DESIGNER: { id: 'IQRm', name: 'Designer', type: 'people' },
  ACCOUNT_MANAGER: { id: 'iJO%3E', name: 'Account Manager', type: 'rollup' },
  
  // Relations
  CLIENT: { id: 'em%7D%3B', name: 'Client', type: 'relation' },
  TASKS: { id: 'Jxmx', name: 'Tasks', type: 'relation' },
  ALL_QI_TIME_TRACKER_ENTRIES: { id: 'BnWp', name: 'All QI Time Tracker Entries', type: 'relation' },
  
  // Numbers
  PUSHBACK_COUNT: { id: 'VmGU', name: 'Push Back Count', type: 'number' },
  CLIENT_PUSHBACK_COUNT: { id: '%7CM%5DM', name: 'Client Pushback Count', type: 'number' },
  QUANTIFIABLE_CLIENT_PUSHBACK: { id: 'wSLQ', name: 'Quantifiable Client Push Back', type: 'number' },
  
  // Hours (formulas/rollups)
  PROJECTED_DEV_HOURS: { id: '%3Fknr', name: 'Projected Dev Hours', type: 'rollup' },
  ACTUAL_DEV_HOURS_NUM: { id: '%3Eg_X', name: 'Actual Dev Hours (Number)', type: 'formula' },
  TOTAL_PROJECT_HOURS: { id: 'cWSl', name: 'Total Project Hours', type: 'formula' },
  PROJECTED_QI_HOURS: { id: 'dOi%40', name: 'Projected QI Hours', type: 'formula' },
  TOTAL_QI_HOURS_DECIMAL: { id: 'Q%3DT%3E', name: 'Total QI Hours (Decimal)', type: 'rollup' },
  BUFFER_HOURS: { id: '%3C_%5Ec', name: 'Buffer Hours', type: 'formula' },
  DAYS_LATE: { id: '_c%7BP', name: 'Days Late', type: 'formula' },
  LATE: { id: 'vHpl', name: 'Late?', type: 'formula' },
  EXCEEDED_PROJECTED_DEV_HOURS: { id: 'UzRl', name: 'Exceeded Projected Dev Hours', type: 'formula' },
  
  // Time Doctor
  TIME_DOCTOR_PROJECT_ID: { id: 'fTcG', name: 'Time Doctor Project ID', type: 'rich_text' },
  TIME_DOCTOR_CLIENT_PROJECT_ID: { id: 'lXQC', name: 'Time Doctor (Client) Project ID', type: 'formula' },
} as const;

/**
 * List of relation properties that are NOT clients
 * Used to exclude these when searching for client property
 */
export const NON_CLIENT_RELATION_PROPERTIES = [
  'Tasks',
  'tasks',
  'Sub-Tasks',
  'Bugs',
  'Developer',
  'Lead Developer',
  'Quality Inspector',
  'Designer',
  'All QI Time Tracker Entries',
  'All QI Time Tracker Entries'.toLowerCase(),
] as const;

/**
 * Get the Client property using the exact property ID or name
 * Tries ID first, then falls back to name if ID doesn't exist
 */
export function findClientProperty(page: any, extractProperty: (page: any, propertyId: string, propertyType: string, propertyName?: string) => any): string[] | null {
  // Try property ID first, with name fallback
  let client = extractProperty(page, PROJECT_PROPERTIES.CLIENT.id, 'relation', PROJECT_PROPERTIES.CLIENT.name);
  
  // Return null if empty or invalid
  if (!client || !Array.isArray(client) || client.length === 0) {
    return null;
  }
  
  return client;
}

