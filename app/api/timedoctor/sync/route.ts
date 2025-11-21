import { NextRequest, NextResponse } from 'next/server';
import { syncTimeDoctor } from '@/lib/services/timedoctor';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { api_token, company_id, start_date, end_date } = body;

    // Use environment variables as defaults, override with request body if provided
    const apiToken = api_token || process.env.TIMEDOCTOR_API_TOKEN;
    const companyId = company_id || process.env.TIMEDOCTOR_COMPANY_ID;

    if (!apiToken || !companyId) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Missing required fields: api_token and company_id. Provide in request body or set TIMEDOCTOR_API_TOKEN and TIMEDOCTOR_COMPANY_ID in .env.local' 
        },
        { status: 400 }
      );
    }

    const startDate = start_date ? new Date(start_date) : undefined;
    const endDate = end_date ? new Date(end_date) : undefined;

    console.log('[TIMEDOCTOR API] Starting sync...');
    const result = await syncTimeDoctor(
      { apiToken, companyId },
      startDate,
      endDate
    );

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error: any) {
    console.error('[TIMEDOCTOR API] Error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

