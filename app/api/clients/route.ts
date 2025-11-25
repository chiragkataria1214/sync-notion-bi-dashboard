import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const db = await getDb();

        // Fetch clients from the clients collection
        const clientsFromDb = await db.collection('clients')
            .find({})
            .project({
                _id: 0,
                notion_id: 1,
                name: 1,
                is_retired: 1
            })
            .sort({ name: 1 })
            .toArray();

        // Get project counts for all clients in one aggregation
        const projectCounts = await db.collection('cards').aggregate([
            {
                $match: {
                    client_id: { $exists: true, $ne: null }
                }
            },
            {
                $group: {
                    _id: '$client_id',
                    count: { $sum: 1 }
                }
            }
        ]).toArray();

        // Create a map of client_id to project count
        const projectCountMap = new Map<string, number>();
        projectCounts.forEach((pc: any) => {
            projectCountMap.set(pc._id, pc.count);
        });

        // Combine client data with project counts
        const clientsWithProjectCounts = clientsFromDb.map((client) => ({
            client_id: client.notion_id,
            name: client.name || 'Unknown',
            project_count: projectCountMap.get(client.notion_id) || 0,
            is_retired: client.is_retired || false
        }));

        // Filter out retired clients for the main list (but keep them in debug)
        const activeClients = clientsWithProjectCounts.filter(c => !c.is_retired);
        const retiredClients = clientsWithProjectCounts.filter(c => c.is_retired);

        // DEBUG: Check total cards count
        const totalCards = await db.collection('cards').countDocuments();
        const cardsWithClient = await db.collection('cards').countDocuments({
            client_id: { $exists: true, $ne: null }
        });

        return NextResponse.json({
            clients: activeClients,
            debug: {
                total_cards: totalCards,
                cards_with_client_id: cardsWithClient,
                clients_found: activeClients.length,
                retired_clients_count: retiredClients.length,
                total_clients_in_db: clientsFromDb.length
            }
        });
    } catch (error: any) {
        console.error('[ERROR] Error fetching clients:', error);
        return NextResponse.json(
            { error: error.message, debug: { error_stack: error.stack } },
            { status: 500 }
        );
    }
}

