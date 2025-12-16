import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { notion } from '@/lib/notion';
import { transformProjectPage } from '@/lib/services/extractor';
import { recordStatusHistory } from '@/lib/services/extractor';

export const dynamic = 'force-dynamic';

/**
 * Notion Webhook Handler
 * Receives webhook events from Notion when pages are updated
 * 
 * Webhook URL: https://notion-bi-dashboard.vercel.app/api/webhooks/notion
 * 
 * To set up in Notion:
 * 1. Go to your Notion integration settings
 * 2. Add webhook subscription
 * 3. Set URL to: https://notion-bi-dashboard.vercel.app/api/webhooks/notion
 * 4. Select event types: page.content_updated, page.added_to_database, page.removed_from_database
 */
export async function POST(request: NextRequest) {
  try {
    // Parse webhook payload
    let payload: any;
    try {
      payload = await request.json();
    } catch (error) {
      console.error('[WEBHOOK] Invalid JSON payload:', error);
      return NextResponse.json(
        { error: 'Invalid JSON payload' },
        { status: 400 }
      );
    }

    console.log('[WEBHOOK] Received webhook event:', {
      type: payload.type,
      object: payload.object,
      has_pageData: !!payload.pageData,
      page_id: payload.pageData?.id || payload.data?.id || payload.object_id,
    });

    // Handle different webhook payload formats
    // Format 1: Custom format with pageData (from custom integrations)
    // Format 2: Standard Notion webhook format with type/object/data
    let page: any = null;
    let pageId: string | null = null;
    let eventType: string | null = null;

    // Check for custom pageData format first
    if (payload.pageData) {
      page = payload.pageData;
      pageId = page.id;
      // Determine event type from pageData
      if (page.archived || page.in_trash) {
        eventType = 'page.removed_from_database';
      } else {
        eventType = 'page.content_updated';
      }
    } else {
      // Standard Notion webhook format
      eventType = payload.type || payload.event_type;
      pageId = payload.data?.id || payload.object_id || payload.page_id || payload.id;
    }

    if (!pageId) {
      console.warn('[WEBHOOK] No page ID in webhook payload:', JSON.stringify(payload, null, 2));
      return NextResponse.json(
        { error: 'No page ID in payload' },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Handle page deletion/archival
    if (eventType === 'page.removed_from_database' || eventType === 'page.deleted' || (page && (page.archived || page.in_trash))) {
      console.log(`[WEBHOOK] Page ${pageId} removed/deleted/archived - marking as archived`);

      // Mark as archived instead of deleting
      await db.collection('cards').updateOne(
        { notion_id: pageId },
        {
          $set: {
            status: '♻️ Archive',
            updated_at: new Date(),
            last_synced_at: new Date(),
          }
        }
      );

      return NextResponse.json({
        success: true,
        message: 'Page marked as archived',
        page_id: pageId
      });
    }

    // For page updates or additions
    if (eventType === 'page.content_updated' || eventType === 'page.added_to_database' || eventType === 'page.updated' || page) {
      try {
        // If we already have the page data from pageData, use it directly
        // Otherwise, fetch it from Notion API
        if (!page) {
          console.log(`[WEBHOOK] Fetching updated page ${pageId} from Notion...`);
          page = await notion.pages.retrieve({ page_id: pageId });
        } else {
          console.log(`[WEBHOOK] Using page data from webhook payload for ${pageId}`);
        }

        // Type guard: Check if this is a full page object (not a partial response)
        // Full page objects have 'object' === 'page' and 'properties' field
        if (page.object !== 'page' || !('properties' in page)) {
          console.log(`[WEBHOOK] Page ${pageId} is not a full page object or not a database page, skipping`);
          return NextResponse.json({
            success: true,
            message: 'Not a database page, skipped',
            page_id: pageId
          });
        }

        // Check if this page belongs to our Projects database
        const projectsDbId = process.env.NOTION_PROJECTS_DB_ID;
        if (page.parent && projectsDbId) {
          let parentDbId: string | null = null;

          // Handle different parent formats
          if ('type' in page.parent) {
            if (page.parent.type === 'database_id' && 'database_id' in page.parent) {
              parentDbId = page.parent.database_id;
            } else if (page.parent.type === 'data_source_id' && 'database_id' in page.parent) {
              // Custom format with data_source_id
              parentDbId = page.parent.database_id;
            }
          }

          if (parentDbId) {
            // Normalize database IDs by removing hyphens for comparison
            // Notion sometimes returns IDs with or without hyphens
            const normalizeId = (id: string) => id.replace(/-/g, '').toLowerCase();
            const normalizedParentId = normalizeId(parentDbId);
            const normalizedProjectsId = normalizeId(projectsDbId);

            if (normalizedParentId !== normalizedProjectsId) {
              console.log(`[WEBHOOK] Page ${pageId} is not from Projects database (${parentDbId} vs ${projectsDbId}), skipping`);
              return NextResponse.json({
                success: true,
                message: 'Not from Projects database, skipped',
                page_id: pageId
              });
            }
          }
        }


        // Transform the page to our Card format
        // This automatically handles Team Members  relation properties and resolves IDs to names
        const card = await transformProjectPage(page);

        // Get existing card to check if status changed
        const existingCard = await db.collection('cards').findOne({ notion_id: pageId });
        const previousStatus = existingCard?.status;

        // Upsert the card in MongoDB
        const result = await db.collection('cards').updateOne(
          { notion_id: card.notion_id },
          { $set: card },
          { upsert: true }
        );

        console.log(`[WEBHOOK] Card ${card.notion_id} updated: upserted=${result.upsertedCount > 0}, modified=${result.modifiedCount > 0}`);

        // Record status history if status changed
        if (previousStatus && previousStatus !== card.status) {
          console.log(`[WEBHOOK] Status changed from "${previousStatus}" to "${card.status}"`);
          await recordStatusHistory(card);
        }

        // If this was a new page, record initial status
        if (result.upsertedCount > 0 && card.status) {
          await recordStatusHistory(card);
        }

        return NextResponse.json({
          success: true,
          message: 'Page updated successfully',
          page_id: pageId,
          upserted: result.upsertedCount > 0,
          modified: result.modifiedCount > 0,
        });

      } catch (error: any) {
        console.error(`[WEBHOOK] Error processing page ${pageId}:`, error);

        // If page doesn't exist or access denied, log but don't fail
        if (error.code === 'object_not_found' || error.status === 404) {
          console.log(`[WEBHOOK] Page ${pageId} not found in Notion, may have been deleted`);
          return NextResponse.json({
            success: true,
            message: 'Page not found (may have been deleted)',
            page_id: pageId
          });
        }

        // Return error but don't fail the webhook (Notion will retry)
        return NextResponse.json(
          {
            success: false,
            error: error.message,
            page_id: pageId
          },
          { status: 500 }
        );
      }
    }

    // Handle other event types (acknowledge but don't process)
    console.log(`[WEBHOOK] Unhandled event type: ${eventType}`);
    return NextResponse.json({
      success: true,
      message: 'Event type not processed',
      event_type: eventType
    });

  } catch (error: any) {
    console.error('[WEBHOOK] Webhook processing error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message
      },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint for webhook verification/testing
 */
export async function GET() {
  return NextResponse.json({
    message: 'Notion webhook endpoint is active',
    endpoint: '/api/webhooks/notion',
    method: 'POST',
    events: [
      'page.content_updated',
      'page.added_to_database',
      'page.removed_from_database',
      'page.updated'
    ]
  });
}

