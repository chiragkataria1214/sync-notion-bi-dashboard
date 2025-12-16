import { Client, LogLevel } from '@notionhq/client';

if (!process.env.NOTION_API_KEY) {
  throw new Error('NOTION_API_KEY is not set');
}

export const notion = new Client({
  auth: process.env.NOTION_API_KEY,
  logLevel: LogLevel.ERROR, // reduce SDK console warnings
});

export async function fetchAllPages(
  databaseId: string,
  filter?: any,
  limit?: number // Optional limit for testing
): Promise<any[]> {
  const allPages: any[] = [];
  let cursor: string | undefined = undefined;
  let pageCount = 0;

  do {
    // If limit is set and smaller than 100, use limit as page_size
    // Otherwise use 100 (Notion's max) but respect the limit when accumulating
    const remainingLimit = limit ? limit - allPages.length : undefined;
    const pageSize = remainingLimit && remainingLimit < 100 ? remainingLimit : 100;

    const response = await notion.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
      filter: filter,
      page_size: pageSize,
    });

    // If we have a limit, only take what we need
    if (limit && remainingLimit) {
      allPages.push(...response.results.slice(0, remainingLimit));
    } else {
      allPages.push(...response.results);
    }

    cursor = response.has_more && response.next_cursor ? response.next_cursor : undefined;
    pageCount++;

    console.log(`[NOTION API] Fetched page ${pageCount}, total pages so far: ${allPages.length}${limit ? ` (limit: ${limit})` : ''}`);

    // Stop if we hit the limit
    if (limit && allPages.length >= limit) {
      console.log(`[NOTION API] Reached limit of ${limit} pages, stopping fetch`);
      break;
    }

    // Rate limiting: wait a bit between requests (Notion allows 3 requests per second)
    if (cursor) {
      await new Promise(resolve => setTimeout(resolve, 400)); // ~2.5 requests per second
    }
  } while (cursor && (!limit || allPages.length < limit));

  console.log(`[NOTION API] Total pages fetched: ${allPages.length}${limit ? ` (limited to ${limit})` : ''}`);
  return allPages;
}

export function extractProperty(page: any, propertyId: string, propertyType: string, propertyName?: string): any {
  // Try by ID first
  let prop = page.properties[propertyId];

  // If not found by ID and name is provided, try by name
  if (!prop && propertyName) {
    prop = page.properties[propertyName];
  }

  if (!prop) return null;

  switch (propertyType) {
    case 'title':
      // Concatenate all title segments to get the full title text
      if (prop.title && Array.isArray(prop.title) && prop.title.length > 0) {
        return prop.title.map((segment: any) => segment.plain_text || '').join('') || '';
      }
      return '';
    case 'rich_text':
      // Concatenate all rich_text segments to get the full text
      if (prop.rich_text && Array.isArray(prop.rich_text) && prop.rich_text.length > 0) {
        return prop.rich_text.map((segment: any) => segment.plain_text || '').join('') || '';
      }
      return '';
    case 'select':
      return prop.select?.name || null;
    case 'date':
      return prop.date ? {
        start: prop.date.start,
        end: prop.date.end,
        time_zone: prop.date.time_zone,
      } : null;
    case 'people':
      return prop.people?.map((p: any) => p.id) || [];
    case 'relation':
      return prop.relation?.map((r: any) => r.id) || [];
    case 'number':
      return prop.number;
    case 'checkbox':
      return prop.checkbox;
    case 'formula':
      // Formulas can return different types - extract the actual value
      if (prop.formula?.type === 'number') {
        return prop.formula.number;
      } else if (prop.formula?.type === 'string') {
        return prop.formula.string;
      } else if (prop.formula?.type === 'boolean') {
        return prop.formula.boolean;
      } else if (prop.formula?.type === 'date') {
        return prop.formula.date;
      }
      return null;
    case 'rollup':
      // Rollups can return different types - extract the actual value
      if (prop.rollup?.type === 'number') {
        return prop.rollup.number;
      } else if (prop.rollup?.type === 'array') {
        // For arrays, check if it contains people, relations, or other data - if so, extract IDs
        const array = prop.rollup.array || [];
        if (array.length > 0) {
          // Check if array items are people objects (for show_original rollups)
          const firstItem = array[0];

          // Case 1: Items have type 'people' and contain a people property with array
          if (firstItem?.type === 'people' && firstItem.people) {
            // Rollup with show_original - each item has type 'people' and a people array
            return array.flatMap((item: any) => {
              if (item.people && Array.isArray(item.people)) {
                return item.people.map((p: any) => p.id).filter((id: any) => id);
              }
              return [];
            }).filter((id: any) => id) || [];
          }

          // Case 2: Items have type 'relation' and contain a relation property with array
          // This handles rollups from relation properties (like Account Manager which is a rollup of Client's AM relation)
          if (firstItem?.type === 'relation' && firstItem.relation) {
            // console.log('[DEBUG] Relation Rollup Item:', JSON.stringify(firstItem));
            // Rollup with show_original on relation - each item has type 'relation' and a relation array
            return array.flatMap((item: any) => {
              // Check if relation is an array
              if (item.relation && Array.isArray(item.relation)) {
                return item.relation.map((r: any) => r.id).filter((id: any) => id);
              }
              return [];
            }).filter((id: any) => id) || [];
          }

          // Case 3: Items are people objects directly (each item IS a person)
          if (firstItem?.object === 'user' || (firstItem?.id && firstItem?.type === undefined)) {
            // Direct person objects in the array
            return array.map((item: any) => item.id).filter((id: any) => id) || [];
          }

          // Case 4: Items are relation objects directly
          if (firstItem?.id && !firstItem?.object) {
            // Direct relation IDs in the array (simple relation structure)
            return array.map((item: any) => item.id).filter((id: any) => id) || [];
          }

          // Case 5: Items might have nested structure - try to find people IDs
          if (firstItem?.people) {
            // Each array item has a people property (could be single person or array)
            return array.flatMap((item: any) => {
              if (Array.isArray(item.people)) {
                return item.people.map((p: any) => p.id || p).filter((id: any) => id);
              } else if (item.people?.id) {
                return [item.people.id];
              }
              return [];
            }).filter((id: any) => id) || [];
          }
        }
        // Otherwise return the array as-is
        return array;
      }
      return null;
    case 'url':
      return prop.url;
    case 'email':
      return prop.email;
    case 'phone_number':
      return prop.phone_number;
    case 'multi_select':
      return prop.multi_select?.map((item: any) => item.name) || [];
    case 'files':
      // Return array of file URLs (both file and external types)
      return prop.files?.map((file: any) => {
        return file.file?.url || file.external?.url || null;
      }).filter((url: any) => url !== null) || [];
    case 'created_time':
      return prop.created_time ? new Date(prop.created_time) : null;
    case 'last_edited_time':
      return prop.last_edited_time ? new Date(prop.last_edited_time) : null;
    default:
      return null;
  }
}

/**
 * Fetch user information from Notion by user ID
 * Returns the user's name or null if not found
 */
export async function getUserName(userId: string): Promise<string | null> {
  try {
    const user = await notion.users.retrieve({ user_id: userId });
    if (user && 'name' in user && user.name) {
      return user.name;
    }
    return null;
  } catch (error: any) {
    // console.warn(`[NOTION] Could not fetch user ${userId}:`, error.message);
    return null;
  }
}

