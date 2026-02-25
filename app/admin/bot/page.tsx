'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Send, Megaphone, RefreshCw } from 'lucide-react';

type BotStatus = {
  ok: boolean;
  botTokenConfigured: boolean;
  botApiReachable: boolean;
  botUsername: string | null;
  telegramUsers: number;
  activeUsers: number;
  activeTrips: number;
  pendingApprovals: number;
  telebirrConfigured: boolean;
  telebirrMode: 'live' | 'demo';
  telebirrMissing: string[];
};

const INITIAL_STATUS: BotStatus = {
  ok: false,
  botTokenConfigured: false,
  botApiReachable: false,
  botUsername: null,
  telegramUsers: 0,
  activeUsers: 0,
  activeTrips: 0,
  pendingApprovals: 0,
  telebirrConfigured: false,
  telebirrMode: 'live',
  telebirrMissing: [],
};

export default function BotControlPage() {
  const [status, setStatus] = useState<BotStatus>(INITIAL_STATUS);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [statusError, setStatusError] = useState('');

  const [singleUserId, setSingleUserId] = useState('');
  const [singleTitle, setSingleTitle] = useState('');
  const [singleMessage, setSingleMessage] = useState('');
  const [sendingSingle, setSendingSingle] = useState(false);

  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [sendingBroadcast, setSendingBroadcast] = useState(false);

  const [resultMessage, setResultMessage] = useState('');
  const [resultType, setResultType] = useState<'success' | 'error' | ''>('');
  const [telebirrDebugLoading, setTelebirrDebugLoading] = useState(false);
  const [telebirrDebug, setTelebirrDebug] = useState<any>(null);
  const [telebirrDebugError, setTelebirrDebugError] = useState('');

  useEffect(() => {
    loadStatus();
  }, []);

  const getErrorMessage = (error: unknown, fallback: string) => {
    if (error instanceof Error && error.message) return error.message;
    return fallback;
  };

  const setResult = (type: 'success' | 'error', message: string) => {
    setResultType(type);
    setResultMessage(message);
  };

  const clearResult = () => {
    setResultType('');
    setResultMessage('');
  };

  const loadStatus = async () => {
    try {
      setLoadingStatus(true);
      setStatusError('');

      const response = await fetch('/api/admin/bot/status', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Failed to load bot status');
      }

      const data = await response.json();
      setStatus(data);
    } catch (error) {
      console.error('[bot-ui] Status error:', error);
      setStatusError('Failed to load bot status.');
    } finally {
      setLoadingStatus(false);
    }
  };

  const sendSingleMessage = async () => {
    if (!singleUserId.trim() || !singleMessage.trim()) {
      setResult('error', 'Telegram user ID and message are required.');
      return;
    }

    try {
      clearResult();
      setSendingSingle(true);

      const response = await fetch('/api/admin/bot/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'single',
          telegramUserId: singleUserId.trim(),
          title: singleTitle,
          message: singleMessage,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to send message');
      }

      setResult('success', `Message sent to user ${singleUserId.trim()}.`);
      setSingleMessage('');
      await loadStatus();
    } catch (error) {
      setResult('error', getErrorMessage(error, 'Failed to send message.'));
    } finally {
      setSendingSingle(false);
    }
  };

  const sendBroadcast = async () => {
    if (!broadcastMessage.trim()) {
      setResult('error', 'Broadcast message is required.');
      return;
    }

    try {
      clearResult();
      setSendingBroadcast(true);

      const response = await fetch('/api/admin/bot/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'broadcast',
          title: broadcastTitle,
          message: broadcastMessage,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to send broadcast');
      }

      setResult(
        'success',
        `Broadcast completed. Sent: ${data.sent || 0}, Failed: ${data.failed || 0}.`
      );
      setBroadcastMessage('');
      await loadStatus();
    } catch (error) {
      setResult('error', getErrorMessage(error, 'Failed to send broadcast.'));
    } finally {
      setSendingBroadcast(false);
    }
  };

  const runTelebirrDebug = async () => {
    try {
      setTelebirrDebugLoading(true);
      setTelebirrDebugError('');
      const response = await fetch('/api/admin/telebirr/debug', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || 'Failed to run Telebirr debug');
      }
      setTelebirrDebug(data);
    } catch (error) {
      console.error('[bot-ui] Telebirr debug error:', error);
      setTelebirrDebugError(getErrorMessage(error, 'Failed to run Telebirr debug.'));
    } finally {
      setTelebirrDebugLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Bot Control Center</h1>
          <p className="text-slate-400 mt-1">GUI controls for Telegram bot operations</p>
        </div>
        <Button
          onClick={loadStatus}
          disabled={loadingStatus}
          variant="outline"
          className="bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-600"
        >
          {loadingStatus ? (
            <span className="flex items-center gap-2">
              <Loader2 size={16} className="animate-spin" />
              Refreshing
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <RefreshCw size={16} />
              Refresh Status
            </span>
          )}
        </Button>
      </div>

      {statusError && (
        <Card className="bg-red-900/20 border-red-800 p-4">
          <p className="text-red-300 text-sm">{statusError}</p>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card className="bg-slate-800 border-slate-700 p-4">
          <p className="text-slate-400 text-sm">Bot Token</p>
          <p className={`font-semibold ${status.botTokenConfigured ? 'text-green-400' : 'text-red-400'}`}>
            {status.botTokenConfigured ? 'Configured' : 'Missing'}
          </p>
        </Card>
        <Card className="bg-slate-800 border-slate-700 p-4">
          <p className="text-slate-400 text-sm">Telegram API</p>
          <p className={`font-semibold ${status.botApiReachable ? 'text-green-400' : 'text-red-400'}`}>
            {status.botApiReachable ? 'Reachable' : 'Unavailable'}
          </p>
        </Card>
        <Card className="bg-slate-800 border-slate-700 p-4">
          <p className="text-slate-400 text-sm">Active Users</p>
          <p className="text-white font-semibold">{status.activeUsers}</p>
        </Card>
        <Card className="bg-slate-800 border-slate-700 p-4">
          <p className="text-slate-400 text-sm">Total Users</p>
          <p className="text-white font-semibold">{status.telegramUsers}</p>
        </Card>
        <Card className="bg-slate-800 border-slate-700 p-4">
          <p className="text-slate-400 text-sm">Telebirr</p>
          <p className={`font-semibold ${status.telebirrConfigured ? 'text-green-400' : 'text-red-400'}`}>
            {status.telebirrConfigured ? `Configured (${status.telebirrMode})` : 'Not configured'}
          </p>
        </Card>
      </div>

      <Card className="bg-slate-800 border-slate-700 p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Direct Message</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm text-slate-300 mb-2">Telegram User ID</label>
            <input
              value={singleUserId}
              onChange={(e) => setSingleUserId(e.target.value)}
              placeholder="123456789"
              className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded placeholder:text-slate-400 focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-2">Title (optional)</label>
            <input
              value={singleTitle}
              onChange={(e) => setSingleTitle(e.target.value)}
              placeholder="Ticket Update"
              className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded placeholder:text-slate-400 focus:outline-none focus:border-primary"
            />
          </div>
        </div>
        <div className="mb-4">
          <label className="block text-sm text-slate-300 mb-2">Message</label>
          <textarea
            value={singleMessage}
            onChange={(e) => setSingleMessage(e.target.value)}
            rows={4}
            placeholder="Write the message to send..."
            className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded placeholder:text-slate-400 focus:outline-none focus:border-primary"
          />
        </div>
        <Button
          onClick={sendSingleMessage}
          disabled={sendingSingle}
          className="bg-primary hover:bg-primary/90 text-white flex items-center gap-2"
        >
          {sendingSingle ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          Send Message
        </Button>
      </Card>

      <Card className="bg-slate-800 border-slate-700 p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Broadcast to Active Users</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm text-slate-300 mb-2">Title (optional)</label>
            <input
              value={broadcastTitle}
              onChange={(e) => setBroadcastTitle(e.target.value)}
              placeholder="Service Announcement"
              className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded placeholder:text-slate-400 focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-2">Recipients</label>
            <input
              value={`${status.activeUsers} active users`}
              readOnly
              className="w-full p-2 bg-slate-700 border border-slate-600 text-slate-300 rounded"
            />
          </div>
        </div>
        <div className="mb-4">
          <label className="block text-sm text-slate-300 mb-2">Broadcast Message</label>
          <textarea
            value={broadcastMessage}
            onChange={(e) => setBroadcastMessage(e.target.value)}
            rows={4}
            placeholder="Write announcement message..."
            className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded placeholder:text-slate-400 focus:outline-none focus:border-primary"
          />
        </div>
        <Button
          onClick={sendBroadcast}
          disabled={sendingBroadcast}
          className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-2"
        >
          {sendingBroadcast ? <Loader2 size={16} className="animate-spin" /> : <Megaphone size={16} />}
          Send Broadcast
        </Button>
      </Card>

      <Card className="bg-slate-800 border-slate-700 p-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Telebirr Debug</h2>
            <p className="text-sm text-slate-400">
              Runs live connectivity probes for token and pre-order endpoints.
            </p>
          </div>
          <Button
            onClick={runTelebirrDebug}
            disabled={telebirrDebugLoading}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            {telebirrDebugLoading ? (
              <span className="flex items-center gap-2">
                <Loader2 size={16} className="animate-spin" />
                Running
              </span>
            ) : (
              'Run Debug'
            )}
          </Button>
        </div>

        {telebirrDebugError ? <p className="text-sm text-red-300 mb-3">{telebirrDebugError}</p> : null}

        {telebirrDebug ? (
          <pre className="rounded-lg bg-slate-900 border border-slate-700 p-3 text-xs text-slate-200 overflow-auto whitespace-pre-wrap">
            {JSON.stringify(telebirrDebug, null, 2)}
          </pre>
        ) : (
          <p className="text-sm text-slate-400">No debug run yet.</p>
        )}
      </Card>

      {resultMessage && (
        <Card
          className={`p-4 ${resultType === 'success'
              ? 'bg-green-900/20 border-green-800'
              : 'bg-red-900/20 border-red-800'
            }`}
        >
          <p className={resultType === 'success' ? 'text-green-300' : 'text-red-300'}>{resultMessage}</p>
        </Card>
      )}
    </div>
  );
}
