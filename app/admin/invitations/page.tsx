'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Copy, Download, Plus, RotateCw, Share2, Trash2 } from 'lucide-react';

type InvitationTargetType = 'booking' | 'charity';
type InvitationTargetMode = 'public' | 'single' | 'bulk';

interface LinkedTrip {
  id: string;
  name?: string | null;
  destination?: string | null;
  status?: string | null;
  departure_date?: string | null;
}

interface LinkedCampaign {
  id: string;
  name?: string | null;
  status?: string | null;
}

interface Invitation {
  id: string;
  invitation_code: string;
  qr_code_data?: string | null;
  qr_code_url?: string | null;
  target?: InvitationTargetType | string | null;
  trip_id?: string | null;
  campaign_id?: string | null;
  trip?: LinkedTrip | null;
  campaign?: LinkedCampaign | null;
  max_uses?: number | null;
  current_uses?: number | null;
  used_count?: number | null;
  discount_percent?: number | null;
  valid_from?: string | null;
  expires_at?: string | null;
  is_active?: boolean | null;
  created_at?: string | null;
  target_user_count?: number;
  target_mode?: InvitationTargetMode;
}

interface TripOption {
  id: string;
  name: string;
  destination?: string | null;
  status?: string | null;
  departure_date?: string | null;
}

interface CampaignOption {
  id: string;
  name: string;
  status?: string | null;
}

function isTripActive(statusInput: unknown) {
  const status = String(statusInput || '').trim().toLowerCase();
  return !['cancelled', 'canceled', 'completed', 'inactive', 'archived', 'closed'].includes(status);
}

function formatDate(value?: string | null) {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'N/A';
  return parsed.toLocaleString();
}

function toNumberOrNull(value: string) {
  const text = String(value || '').trim();
  if (!text) return null;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : null;
}

function buildInvitationShareText(invitation: Invitation) {
  const targetType =
    String(invitation.target || '').toLowerCase() === 'charity' ? 'charity campaign' : 'trip booking';
  const title =
    targetType === 'charity campaign'
      ? invitation.campaign?.name || 'Charity Campaign'
      : invitation.trip?.name || 'Trip';
  return `Join via invitation (${invitation.invitation_code}) for ${title} (${targetType}).`;
}

export default function InvitationsPage() {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [trips, setTrips] = useState<TripOption[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [targetType, setTargetType] = useState<InvitationTargetType>('booking');
  const [targetMode, setTargetMode] = useState<InvitationTargetMode>('public');
  const [tripId, setTripId] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [invitationCode, setInvitationCode] = useState('');
  const [discountPercent, setDiscountPercent] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [singleTargetUserId, setSingleTargetUserId] = useState('');
  const [bulkTargetUserIds, setBulkTargetUserIds] = useState('');

  const activeTrips = useMemo(
    () =>
      trips.filter((trip) => {
        if (!isTripActive(trip.status)) return false;
        if (!trip.departure_date) return true;
        const departure = new Date(trip.departure_date);
        if (Number.isNaN(departure.getTime())) return true;
        return departure.getTime() >= Date.now();
      }),
    [trips]
  );

  const activeCampaigns = useMemo(
    () => campaigns.filter((campaign) => String(campaign.status || 'active').toLowerCase() === 'active'),
    [campaigns]
  );

  useEffect(() => {
    loadInitialData();
  }, []);

  async function loadInitialData() {
    setLoading(true);
    setError('');
    try {
      await Promise.all([loadInvitations(), loadOptions()]);
    } catch (loadError) {
      console.error('[admin-invitations] load error:', loadError);
      setError((loadError as Error)?.message || 'Failed to load invitation data');
    } finally {
      setLoading(false);
    }
  }

  async function loadInvitations() {
    const res = await fetch('/api/admin/invitations', { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || 'Failed to load invitations');
    }
    setInvitations(Array.isArray(data.invitations) ? data.invitations : []);
  }

  async function loadOptions() {
    const res = await fetch('/api/admin/invitations/options', { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || 'Failed to load invitation options');
    }
    setTrips(Array.isArray(data?.trips) ? data.trips : []);
    setCampaigns(Array.isArray(data?.campaigns) ? data.campaigns : []);
  }

  async function createInvitation() {
    setCreating(true);
    setError('');
    setNotice('');
    try {
      const payload: Record<string, unknown> = {
        invitationCode: invitationCode.trim() || undefined,
        targetType,
        targetMode,
        tripId: targetType === 'booking' ? tripId || null : null,
        campaignId: targetType === 'charity' ? campaignId || null : null,
        discountPercent: toNumberOrNull(discountPercent),
        maxUses: toNumberOrNull(maxUses),
        validFrom: validFrom || null,
        expiresAt: expiresAt || null,
      };

      if (targetMode === 'single') {
        payload.targetTelegramUserId = singleTargetUserId.trim();
      } else if (targetMode === 'bulk') {
        payload.targetTelegramUserIds = bulkTargetUserIds;
      }

      const res = await fetch('/api/admin/invitations/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Failed to create invitation');
      }

      setNotice(`Invitation created: ${data?.invitation?.invitation_code || 'success'}`);
      setInvitationCode('');
      setDiscountPercent('');
      setMaxUses('');
      setValidFrom('');
      setExpiresAt('');
      setSingleTargetUserId('');
      setBulkTargetUserIds('');
      await loadInvitations();
    } catch (createError) {
      console.error('[admin-invitations] create error:', createError);
      setError((createError as Error)?.message || 'Failed to create invitation');
    } finally {
      setCreating(false);
    }
  }

  async function deleteInvitation(invitation: Invitation) {
    const confirmed = window.confirm(
      `Deactivate invitation ${invitation.invitation_code}? This keeps history but blocks new usage.`
    );
    if (!confirmed) return;

    try {
      setDeletingId(invitation.id);
      setError('');
      setNotice('');
      const res = await fetch(`/api/admin/invitations?id=${invitation.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Failed to deactivate invitation');
      }
      setNotice(`Invitation deactivated: ${invitation.invitation_code}`);
      await loadInvitations();
    } catch (deleteError) {
      console.error('[admin-invitations] delete error:', deleteError);
      setError((deleteError as Error)?.message || 'Failed to deactivate invitation');
    } finally {
      setDeletingId(null);
    }
  }

  function copyText(value: string) {
    navigator.clipboard.writeText(value);
  }

  function downloadQRCode(qrData: string, code: string) {
    const link = document.createElement('a');
    link.href = qrData;
    link.download = `invitation-${code}.png`;
    link.click();
  }

  function resolveInvitationLink(invitation: Invitation) {
    const explicit = String(invitation.qr_code_url || '').trim();
    if (explicit) return explicit;
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/invite/${encodeURIComponent(invitation.invitation_code)}`;
  }

  function shareInvitation(invitation: Invitation, channel: 'telegram' | 'whatsapp' | 'x' | 'facebook') {
    const inviteUrl = resolveInvitationLink(invitation);
    if (!inviteUrl) return;
    const message = buildInvitationShareText(invitation);
    const encodedUrl = encodeURIComponent(inviteUrl);
    const encodedMessage = encodeURIComponent(message);

    const shareUrl =
      channel === 'telegram'
        ? `https://t.me/share/url?url=${encodedUrl}&text=${encodedMessage}`
        : channel === 'whatsapp'
          ? `https://wa.me/?text=${encodeURIComponent(`${message} ${inviteUrl}`)}`
          : channel === 'x'
            ? `https://x.com/intent/tweet?url=${encodedUrl}&text=${encodedMessage}`
            : `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`;

    window.open(shareUrl, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Invitation Links</h1>
          <p className="text-muted-foreground mt-1">
            Create invitation links for active trips or active charity campaigns, with optional user targeting.
          </p>
          {error ? <p className="text-sm text-red-500 mt-1">{error}</p> : null}
          {notice ? <p className="text-sm text-emerald-500 mt-1">{notice}</p> : null}
        </div>
        <Button onClick={loadInitialData} variant="outline" disabled={loading}>
          <RotateCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create Invitation</CardTitle>
          <CardDescription>
            Invitation can be linked to one active trip or one active charity campaign.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="targetType">Invitation Type</Label>
              <select
                id="targetType"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={targetType}
                onChange={(event) => setTargetType(event.target.value as InvitationTargetType)}
              >
                <option value="booking">Trip Booking</option>
                <option value="charity">Charity Campaign</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="targetMode">Target Scope</Label>
              <select
                id="targetMode"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={targetMode}
                onChange={(event) => setTargetMode(event.target.value as InvitationTargetMode)}
              >
                <option value="public">Public (no user restriction)</option>
                <option value="single">Single Telegram User</option>
                <option value="bulk">Bulk Telegram Users</option>
              </select>
            </div>
          </div>

          {targetType === 'booking' ? (
            <div className="space-y-2">
              <Label htmlFor="tripId">Active Trip</Label>
              <select
                id="tripId"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={tripId}
                onChange={(event) => setTripId(event.target.value)}
              >
                <option value="">Select active trip</option>
                {activeTrips.map((trip) => (
                  <option key={trip.id} value={trip.id}>
                    {trip.name} {trip.destination ? `- ${trip.destination}` : ''}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="campaignId">Active Charity Campaign</Label>
              <select
                id="campaignId"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={campaignId}
                onChange={(event) => setCampaignId(event.target.value)}
              >
                <option value="">Select active campaign</option>
                {activeCampaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {targetMode === 'single' ? (
            <div className="space-y-2">
              <Label htmlFor="singleTargetUserId">Telegram User ID</Label>
              <Input
                id="singleTargetUserId"
                value={singleTargetUserId}
                onChange={(event) => setSingleTargetUserId(event.target.value)}
                placeholder="e.g. 123456789"
              />
            </div>
          ) : null}

          {targetMode === 'bulk' ? (
            <div className="space-y-2">
              <Label htmlFor="bulkTargetUserIds">Bulk Telegram User IDs</Label>
              <Textarea
                id="bulkTargetUserIds"
                value={bulkTargetUserIds}
                onChange={(event) => setBulkTargetUserIds(event.target.value)}
                placeholder="One per line, or comma-separated"
                rows={4}
              />
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="invitationCode">Invitation Code (Optional)</Label>
              <Input
                id="invitationCode"
                value={invitationCode}
                onChange={(event) => setInvitationCode(event.target.value)}
                placeholder="Auto-generated if blank"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="discountPercent">Discount % (Optional)</Label>
              <Input
                id="discountPercent"
                type="number"
                min={0}
                max={99.99}
                step={0.01}
                value={discountPercent}
                onChange={(event) => setDiscountPercent(event.target.value)}
                placeholder="0 means no discount"
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="maxUses">Max Uses (Optional)</Label>
              <Input
                id="maxUses"
                type="number"
                min={1}
                step={1}
                value={maxUses}
                onChange={(event) => setMaxUses(event.target.value)}
                placeholder="Unlimited if blank"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="validFrom">Valid From (Optional)</Label>
              <Input
                id="validFrom"
                type="datetime-local"
                value={validFrom}
                onChange={(event) => setValidFrom(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="expiresAt">Expires At (Optional)</Label>
              <Input
                id="expiresAt"
                type="datetime-local"
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.target.value)}
              />
            </div>
          </div>

          <Button onClick={createInvitation} disabled={creating}>
            <Plus className="w-4 h-4 mr-2" />
            {creating ? 'Creating...' : 'Create Invitation'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invitations</CardTitle>
          <CardDescription>{invitations.length} invitation(s)</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : invitations.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No invitations created yet.</div>
          ) : (
            <div className="space-y-4">
              {invitations.map((invitation) => {
                const used = Number(invitation.current_uses ?? invitation.used_count ?? 0);
                const maxUses = invitation.max_uses;
                const targetType =
                  String(invitation.target || '').toLowerCase() === 'charity' ? 'charity' : 'booking';
                const targetMode = invitation.target_mode || 'public';
                return (
                  <div key={invitation.id} className="rounded-lg border p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <code className="bg-muted px-2 py-1 rounded text-sm font-mono">{invitation.invitation_code}</code>
                        <span
                          className={`text-xs px-2 py-1 rounded ${
                            invitation.is_active !== false
                              ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                              : 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200'
                          }`}
                        >
                          {invitation.is_active !== false ? 'active' : 'inactive'}
                        </span>
                        <span className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                          {targetType}
                        </span>
                        <span className="text-xs px-2 py-1 rounded bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
                          {targetMode}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="ghost" onClick={() => copyText(invitation.invitation_code)}>
                          <Copy className="w-4 h-4" />
                        </Button>
                        {invitation.qr_code_data ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              downloadQRCode(String(invitation.qr_code_data || ''), invitation.invitation_code)
                            }
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-600"
                          onClick={() => deleteInvitation(invitation)}
                          disabled={deletingId === invitation.id}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => shareInvitation(invitation, 'telegram')}>
                        <Share2 className="w-4 h-4 mr-1" />
                        Telegram
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => shareInvitation(invitation, 'whatsapp')}>
                        <Share2 className="w-4 h-4 mr-1" />
                        WhatsApp
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => shareInvitation(invitation, 'x')}>
                        <Share2 className="w-4 h-4 mr-1" />
                        X
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => shareInvitation(invitation, 'facebook')}>
                        <Share2 className="w-4 h-4 mr-1" />
                        Facebook
                      </Button>
                    </div>

                    <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
                      <div>
                        Uses: {used} / {maxUses && maxUses > 0 ? maxUses : 'Unlimited'}
                      </div>
                      <div>Discount: {Number(invitation.discount_percent || 0).toFixed(2)}%</div>
                      <div>Valid From: {formatDate(invitation.valid_from)}</div>
                      <div>Expires: {formatDate(invitation.expires_at)}</div>
                      <div>Target Users: {Number(invitation.target_user_count || 0)}</div>
                      <div>Created: {formatDate(invitation.created_at)}</div>
                    </div>

                    {targetType === 'booking' ? (
                      <div className="text-xs text-muted-foreground">
                        Trip:{' '}
                        {invitation.trip?.name
                          ? `${invitation.trip.name}${invitation.trip?.destination ? ` - ${invitation.trip.destination}` : ''}`
                          : invitation.trip_id || 'N/A'}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        Campaign: {invitation.campaign?.name || invitation.campaign_id || 'N/A'}
                      </div>
                    )}

                    {invitation.qr_code_url ? (
                      <div className="text-xs text-muted-foreground break-all">
                        Link: {String(invitation.qr_code_url)}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
