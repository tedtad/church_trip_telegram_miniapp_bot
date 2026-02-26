import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminPermission } from '@/lib/admin-rbac';

function isMissingColumn(error: unknown, columnName: string) {
  const message = String((error as any)?.message || '').toLowerCase();
  return message.includes('column') && message.includes(columnName.toLowerCase());
}

function isMissingRelation(error: unknown, relationName: string) {
  const message = String((error as any)?.message || '').toLowerCase();
  return (
    message.includes('relation') &&
    message.includes(relationName.toLowerCase()) &&
    message.includes('does not exist')
  );
}

function isTripActive(statusInput: unknown) {
  const status = String(statusInput || '').trim().toLowerCase();
  return !['cancelled', 'canceled', 'completed', 'inactive', 'archived', 'closed'].includes(status);
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createAdminClient();
    const auth = await requireAdminPermission({
      supabase,
      request,
      permission: 'invitations_manage',
    });
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    let trips: Array<any> = [];
    const tripSelectCandidates = [
      'id, name, destination, status, trip_status, departure_date',
      'id, name, destination, status, departure_date',
      'id, name, destination, trip_status, departure_date',
      'id, name, destination',
      'id, name',
    ];
    for (const selectClause of tripSelectCandidates) {
      const result = await supabase.from('trips').select(selectClause).order('departure_date', { ascending: true });
      if (!result.error) {
        trips = result.data || [];
        break;
      }
      if (
        isMissingColumn(result.error, 'status') ||
        isMissingColumn(result.error, 'trip_status') ||
        isMissingColumn(result.error, 'departure_date') ||
        isMissingColumn(result.error, 'destination')
      ) {
        continue;
      }
      throw result.error;
    }

    const activeTrips = (trips || []).filter((trip) => {
      const status = String((trip as any).status ?? (trip as any).trip_status ?? 'active').toLowerCase();
      if (!isTripActive(status)) return false;
      const departure = (trip as any).departure_date ? new Date((trip as any).departure_date) : null;
      if (departure && !Number.isNaN(departure.getTime()) && departure.getTime() < Date.now()) {
        return false;
      }
      return true;
    });

    let campaigns: Array<any> = [];
    const campaignSelectCandidates = [
      'id, name, status, end_date',
      'id, name, status',
      'id, name',
    ];
    for (const selectClause of campaignSelectCandidates) {
      const result = await supabase
        .from('charity_campaigns')
        .select(selectClause)
        .order('created_at', { ascending: false });
      if (!result.error) {
        campaigns = result.data || [];
        break;
      }
      if (isMissingRelation(result.error, 'charity_campaigns')) {
        campaigns = [];
        break;
      }
      if (
        isMissingColumn(result.error, 'status') ||
        isMissingColumn(result.error, 'end_date')
      ) {
        continue;
      }
      throw result.error;
    }

    const activeCampaigns = (campaigns || []).filter(
      (campaign) => String((campaign as any).status || 'active').toLowerCase() === 'active'
    );

    return NextResponse.json({
      ok: true,
      trips: activeTrips,
      campaigns: activeCampaigns,
    });
  } catch (error) {
    console.error('[admin-invitations-options] GET error:', error);
    return NextResponse.json(
      { ok: false, error: 'Failed to load invitation options' },
      { status: 500 }
    );
  }
}
