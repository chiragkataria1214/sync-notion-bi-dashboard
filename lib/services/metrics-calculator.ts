import { getDb } from '@/lib/mongodb';
import type { MetricsCache } from '@/lib/types';

export async function calculateMetrics(periodType: 'daily' | 'weekly' | 'monthly' = 'daily'): Promise<void> {
  const db = await getDb();
  
  // Calculate QI pushback rates
  await calculatePushbackMetrics('qi_pushbacks', 'qi', periodType);
  
  // Calculate client pushback rates
  await calculatePushbackMetrics('client_pushbacks', 'client', periodType);
  
  // Calculate days late metrics
  await calculateDaysLateMetrics(periodType);
}

async function calculatePushbackMetrics(
  metricType: string,
  pushbackType: 'qi' | 'client',
  periodType: 'daily' | 'weekly' | 'monthly'
): Promise<void> {
  const db = await getDb();
  
  const now = new Date();
  let periodStart: Date;
  let periodEnd: Date;

  if (periodType === 'daily') {
    periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    periodEnd = new Date(periodStart);
    periodEnd.setDate(periodEnd.getDate() + 1);
  } else if (periodType === 'weekly') {
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    periodStart = new Date(now.setDate(diff));
    periodStart.setHours(0, 0, 0, 0);
    periodEnd = new Date(periodStart);
    periodEnd.setDate(periodEnd.getDate() + 7);
  } else {
    periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  }

  // Aggregate pushbacks by team member from cards
  // Using Push Back Count (internal) for qi_pushbacks
  // Using Quantifiable Client Push Back (quantifiable_client) for client_pushbacks
  // Group by first developer in metadata.developer_ids array
  const pushbackAggregation = await db.collection('cards').aggregate([
    {
      $match: {
        created_at: { $gte: periodStart, $lt: periodEnd },
      },
    },
    {
      $addFields: {
        primaryDeveloper: {
          $ifNull: [
            { $arrayElemAt: ['$metadata.developer_ids', 0] },
            { $arrayElemAt: ['$metadata.developer', 0] }
          ]
        }
      }
    },
    {
      $match: {
        primaryDeveloper: { $exists: true, $ne: null }
      }
    },
    {
      $group: {
        _id: '$primaryDeveloper',
        cardsWithPushbacks: {
          $sum: {
            $cond: [
              {
                $gt: [
                    metricType === 'qi_pushbacks'
                    ? { $ifNull: ['$metadata.pushback_count', 0] }
                    : { $ifNull: ['$metadata.quantifiable_client_pushback', 0] },
                  0
                ]
              },
              1,
              0
            ]
          }
        },
        totalCards: { $sum: 1 }
      }
    }
  ]).toArray();

  // Store metrics per team member
  for (const result of pushbackAggregation) {
    const developerId = result._id; // This is now a Notion user ID from developer_ids array
    if (!developerId) continue;
    
    const cardsWithPushbacks = result.cardsWithPushbacks || 0;
    const totalCards = result.totalCards || 1;
    const rate = (cardsWithPushbacks / totalCards) * 100;

    const metric: MetricsCache = {
      metric_type: metricType,
      period_type: periodType,
      period_start: periodStart,
      period_end: periodEnd,
      team_member_id: developerId.toString(),
      value: rate,
      calculated_at: new Date(),
    };

    await db.collection('metrics_cache').updateOne(
      {
        metric_type: metricType,
        period_type: periodType,
        period_start: periodStart,
        team_member_id: developerId.toString(),
      },
      { $set: metric },
      { upsert: true }
    );
  }

  // Overall metric (no team_member_id)
  const overallResult = pushbackAggregation.reduce((acc, r) => ({
    cardsWithPushbacks: acc.cardsWithPushbacks + (r.cardsWithPushbacks || 0),
    totalCards: acc.totalCards + (r.totalCards || 0)
  }), { cardsWithPushbacks: 0, totalCards: 0 });

  const overallRate = overallResult.totalCards > 0 
    ? (overallResult.cardsWithPushbacks / overallResult.totalCards) * 100 
    : 0;

  const overallMetric: MetricsCache = {
    metric_type: metricType,
    period_type: periodType,
    period_start: periodStart,
    period_end: periodEnd,
    value: overallRate,
    calculated_at: new Date(),
  };

  await db.collection('metrics_cache').updateOne(
    {
      metric_type: metricType,
      period_type: periodType,
      period_start: periodStart,
      team_member_id: { $exists: false },
    },
    { $set: overallMetric },
    { upsert: true }
  );
}

async function calculateDaysLateMetrics(periodType: 'daily' | 'weekly' | 'monthly'): Promise<void> {
  const db = await getDb();
  
  const now = new Date();
  let periodStart: Date;
  let periodEnd: Date;

  if (periodType === 'daily') {
    periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    periodEnd = new Date(periodStart);
    periodEnd.setDate(periodEnd.getDate() + 1);
  } else if (periodType === 'weekly') {
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    periodStart = new Date(now.setDate(diff));
    periodStart.setHours(0, 0, 0, 0);
    periodEnd = new Date(periodStart);
    periodEnd.setDate(periodEnd.getDate() + 7);
  } else {
    periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  }

  // Get cards created in the period (will filter by original_due and completion dates in code) - using flat metadata structure
  const cards = await db.collection('cards').find({
    created_at: { $gte: periodStart, $lt: periodEnd },
    'metadata.original_due_date': { $exists: true, $ne: null },
  }).toArray();

  // Group days late by developer (using first developer in developer_ids array)
  const byDeveloper: Record<string, number[]> = {};
  
  for (const card of cards) {
    // Get primary developer from developer_ids or developer array
    const primaryDeveloper = card.metadata?.developer_ids?.[0] || card.metadata?.developer?.[0];
    if (!primaryDeveloper) continue;
    
    // Get deadline from Original Due Date ONLY (using flat metadata structure)
    let deadline: Date | null = null;
    if (card.metadata?.original_due_date) {
      const originalDue = card.metadata.original_due_date;
      if (typeof originalDue === 'object' && originalDue.start) {
        deadline = new Date(originalDue.start);
      } else if (typeof originalDue === 'object' && originalDue.end) {
        deadline = new Date(originalDue.end);
      } else if (originalDue instanceof Date) {
        deadline = originalDue;
      }
    }
    
    // Skip if deadline is not available
    if (!deadline || isNaN(deadline.getTime())) {
      continue;
    }

    // Get completion date - prioritize ready_for_client date over deployment date (using flat metadata structure)
    let completedDate: Date | null = null;
    if (card.metadata?.ready_for_client_date) {
      const readyDate = card.metadata.ready_for_client_date;
      completedDate = readyDate instanceof Date ? readyDate : new Date(readyDate);
    } else if (card.metadata?.done_date) {
      const doneDate = card.metadata.done_date;
      completedDate = doneDate instanceof Date ? doneDate : new Date(doneDate);
    } else if (card.metadata?.deployment_date) {
      const deploymentDate = card.metadata.deployment_date;
      completedDate = deploymentDate instanceof Date ? deploymentDate : new Date(deploymentDate);
    }

    // Skip if completed date is not available
    if (!completedDate || isNaN(completedDate.getTime())) {
      continue;
    }

    if (completedDate > deadline) {
      const daysLate = Math.floor((completedDate.getTime() - deadline.getTime()) / (1000 * 60 * 60 * 24));
      const developerId = primaryDeveloper.toString();
      if (!byDeveloper[developerId]) {
        byDeveloper[developerId] = [];
      }
      byDeveloper[developerId].push(daysLate);
    }
  }

  // Calculate average days late per developer and store in cache
  for (const [developerId, daysLateArray] of Object.entries(byDeveloper)) {
    if (daysLateArray.length === 0) continue;
    
    const avgDaysLate = daysLateArray.reduce((a, b) => a + b, 0) / daysLateArray.length;

    const metric: MetricsCache = {
      metric_type: 'avg_days_late',
      period_type: periodType,
      period_start: periodStart,
      period_end: periodEnd,
      team_member_id: developerId,
      value: avgDaysLate,
      calculated_at: new Date(),
    };

    await db.collection('metrics_cache').updateOne(
      {
        metric_type: 'avg_days_late',
        period_type: periodType,
        period_start: periodStart,
        team_member_id: developerId,
      },
      { $set: metric },
      { upsert: true }
    );
  }

  // Overall metric (no team_member_id)
  const allDaysLate: number[] = [];
  Object.values(byDeveloper).forEach(arr => allDaysLate.push(...arr));
  
  const overallAvgDaysLate = allDaysLate.length > 0
    ? allDaysLate.reduce((a, b) => a + b, 0) / allDaysLate.length
    : 0;

  const overallMetric: MetricsCache = {
    metric_type: 'avg_days_late',
    period_type: periodType,
    period_start: periodStart,
    period_end: periodEnd,
    value: overallAvgDaysLate,
    calculated_at: new Date(),
  };

  await db.collection('metrics_cache').updateOne(
    {
      metric_type: 'avg_days_late',
      period_type: periodType,
      period_start: periodStart,
      team_member_id: { $exists: false },
    },
    { $set: overallMetric },
    { upsert: true }
  );
}

