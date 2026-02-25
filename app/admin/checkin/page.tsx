'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getAdminSession } from '@/lib/admin-auth';
import { Camera, CameraOff, QrCode, Search, CheckCircle2 } from 'lucide-react';
import jsQR from 'jsqr';

interface CheckInCandidate {
  ticketId: string;
  ticketNumber: string;
  serialNumber: string;
  status: string;
  tripId: string;
  tripName: string;
  destination: string;
  departureDate: string;
  telegramUserId: string;
  customerName: string;
  phoneNumber: string;
  referenceNumber: string;
}

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function parseTicketIdFromRaw(raw: string) {
  const text = String(raw || '').trim();
  if (!text) {
    return { ticketId: '', serial: '', error: 'Empty QR payload' };
  }

  const uuidRegex = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;

  try {
    const parsedJson = JSON.parse(text);
    const jsonTicketId = String(
      parsedJson?.ticketId || parsedJson?.ticket_id || parsedJson?.id || ''
    ).trim();
    const serial = String(parsedJson?.serial || parsedJson?.serialNumber || '').trim();
    if (jsonTicketId) {
      return { ticketId: jsonTicketId, serial, error: '' };
    }
  } catch { }

  try {
    const url = new URL(text);
    const fromQuery = String(
      url.searchParams.get('ticketId') ||
      url.searchParams.get('ticket_id') ||
      url.searchParams.get('id') ||
      ''
    ).trim();
    const serial = String(url.searchParams.get('serial') || '').trim();
    if (fromQuery) {
      return { ticketId: fromQuery, serial, error: '' };
    }

    const segments = url.pathname.split('/').filter(Boolean);
    const verifyIdx = segments.findIndex((segment) => segment.toLowerCase() === 'verify-ticket');
    if (verifyIdx >= 0 && segments[verifyIdx + 1]) {
      return { ticketId: String(segments[verifyIdx + 1]).trim(), serial, error: '' };
    }

    const ticketIdx = segments.findIndex((segment) => segment.toLowerCase() === 'tickets');
    if (ticketIdx >= 0 && segments[ticketIdx + 1]) {
      return { ticketId: String(segments[ticketIdx + 1]).trim(), serial, error: '' };
    }

    const uuidInPath = url.pathname.match(uuidRegex)?.[0] || '';
    if (uuidInPath) {
      return { ticketId: uuidInPath, serial, error: '' };
    }
  } catch { }

  const uuid = text.match(uuidRegex)?.[0] || '';
  if (uuid) {
    return { ticketId: uuid, serial: '', error: '' };
  }

  if (/^[A-Za-z0-9_-]{8,}$/i.test(text)) {
    return { ticketId: text, serial: '', error: '' };
  }

  return { ticketId: '', serial: '', error: 'Could not extract ticket ID from QR payload' };
}

export default function AdminCheckInPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanRafRef = useRef<number | null>(null);
  const scanCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scanContextRef = useRef<CanvasRenderingContext2D | null>(null);
  const scannerBusyRef = useRef(false);
  const lastScanAtRef = useRef(0);

  const [scannerEnabled, setScannerEnabled] = useState(false);
  const [scannerSupported, setScannerSupported] = useState(false);
  const [scannerEngine, setScannerEngine] = useState<'barcode-detector' | 'jsqr' | ''>('');
  const [loadingCamera, setLoadingCamera] = useState(false);
  const [rawPayload, setRawPayload] = useState('');
  const [manualPayload, setManualPayload] = useState('');
  const [parsedTicketId, setParsedTicketId] = useState('');
  const [parsedSerial, setParsedSerial] = useState('');
  const [tripDate, setTripDate] = useState(todayYmd());
  const [lookupLoading, setLookupLoading] = useState(false);
  const [checkInLoading, setCheckInLoading] = useState(false);
  const [candidate, setCandidate] = useState<CheckInCandidate | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const stopScanner = useCallback(() => {
    if (scanRafRef.current) {
      window.cancelAnimationFrame(scanRafRef.current);
      scanRafRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    scannerBusyRef.current = false;
    lastScanAtRef.current = 0;
    setScannerEngine('');
    setScannerEnabled(false);
    setLoadingCamera(false);
  }, []);

  const decodeWithJsQr = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return '';

    if (!scanCanvasRef.current) {
      scanCanvasRef.current = document.createElement('canvas');
    }

    const canvas = scanCanvasRef.current;
    const maxWidth = 960;
    const sourceWidth = Math.max(video.videoWidth || 0, 1);
    const sourceHeight = Math.max(video.videoHeight || 0, 1);
    const ratio = Math.min(1, maxWidth / sourceWidth);
    const targetWidth = Math.max(Math.floor(sourceWidth * ratio), 1);
    const targetHeight = Math.max(Math.floor(sourceHeight * ratio), 1);
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    if (!scanContextRef.current) {
      scanContextRef.current = canvas.getContext('2d', { willReadFrequently: true });
    }

    const context = scanContextRef.current;
    if (!context) return '';

    context.drawImage(video, 0, 0, targetWidth, targetHeight);
    const frame = context.getImageData(0, 0, targetWidth, targetHeight);
    const detected = jsQR(frame.data, frame.width, frame.height, {
      inversionAttempts: 'attemptBoth',
    });
    return String(detected?.data || '').trim();
  }, []);

  const lookupTicket = useCallback(async (ticketId: string) => {
    if (!ticketId) return;
    try {
      setLookupLoading(true);
      setError('');
      setSuccess('');
      const response = await fetch(`/api/admin/tickets/checkin?ticketId=${encodeURIComponent(ticketId)}`, {
        cache: 'no-store',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || 'Failed to load ticket');
      }
      const first = (data?.results || [])[0] as CheckInCandidate | undefined;
      if (!first) {
        throw new Error('Ticket not found');
      }
      setCandidate(first);
    } catch (err) {
      setCandidate(null);
      setError((err as Error)?.message || 'Failed to load ticket');
    } finally {
      setLookupLoading(false);
    }
  }, []);

  const handleDecodedPayload = useCallback(
    async (raw: string) => {
      const parsed = parseTicketIdFromRaw(raw);
      setRawPayload(raw);
      setParsedTicketId(parsed.ticketId);
      setParsedSerial(parsed.serial);
      setError('');
      setSuccess('');

      if (!parsed.ticketId) {
        setCandidate(null);
        setError(parsed.error || 'Ticket not found in QR payload');
        return;
      }

      await lookupTicket(parsed.ticketId);
    },
    [lookupTicket]
  );

  const startScanner = useCallback(async () => {
    if (!navigator?.mediaDevices?.getUserMedia) {
      setScannerSupported(false);
      setError('Camera QR scanner is not supported in this browser. Use paste/manual input.');
      return;
    }

    const BarcodeDetectorCtor = (globalThis as any).BarcodeDetector;

    try {
      setLoadingCamera(true);
      setError('');
      setSuccess('');
      setScannerSupported(true);
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      }
      streamRef.current = stream;

      if (!videoRef.current) {
        throw new Error('Video element not available');
      }
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setScannerEnabled(true);
      setLoadingCamera(false);

      const supportsBarcodeDetector = Boolean(BarcodeDetectorCtor);
      const detector = supportsBarcodeDetector
        ? new BarcodeDetectorCtor({ formats: ['qr_code'] })
        : null;
      setScannerEngine(supportsBarcodeDetector ? 'barcode-detector' : 'jsqr');

      const tick = async () => {
        if (!videoRef.current || !streamRef.current) return;
        if (scannerBusyRef.current) {
          scanRafRef.current = window.requestAnimationFrame(tick);
          return;
        }
        const now = Date.now();
        if (now - lastScanAtRef.current < 180) {
          scanRafRef.current = window.requestAnimationFrame(tick);
          return;
        }
        lastScanAtRef.current = now;

        try {
          scannerBusyRef.current = true;
          let value = '';
          if (detector) {
            const barcodes = await detector.detect(videoRef.current);
            const first = Array.isArray(barcodes) ? barcodes[0] : null;
            value = String(first?.rawValue || '').trim();
          } else {
            value = decodeWithJsQr();
          }

          if (value) {
            await handleDecodedPayload(value);
            stopScanner();
            scannerBusyRef.current = false;
            return;
          }
        } catch { }
        scannerBusyRef.current = false;
        scanRafRef.current = window.requestAnimationFrame(tick);
      };

      scanRafRef.current = window.requestAnimationFrame(tick);
    } catch (err) {
      setError((err as Error)?.message || 'Failed to start camera scanner');
      setLoadingCamera(false);
      stopScanner();
    }
  }, [decodeWithJsQr, handleDecodedPayload, stopScanner]);

  useEffect(() => {
    setScannerSupported(Boolean(navigator?.mediaDevices?.getUserMedia));
    return () => {
      stopScanner();
    };
  }, [stopScanner]);

  const handleManualResolve = useCallback(async () => {
    await handleDecodedPayload(manualPayload);
  }, [handleDecodedPayload, manualPayload]);

  const handleCheckIn = useCallback(async () => {
    if (!candidate?.ticketId) return;
    try {
      const session = getAdminSession();
      if (!session) {
        setError('Admin session not found. Please login again.');
        return;
      }

      setCheckInLoading(true);
      setError('');
      setSuccess('');
      const response = await fetch('/api/admin/tickets/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketId: candidate.ticketId,
          tripDate: tripDate || undefined,
          adminId: session.admin.id,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || 'Failed to check in ticket');
      }

      setCandidate((prev) => (prev ? { ...prev, status: 'used' } : prev));
      setSuccess('Customer checked in successfully.');
    } catch (err) {
      setError((err as Error)?.message || 'Failed to check in ticket');
    } finally {
      setCheckInLoading(false);
    }
  }, [candidate?.ticketId, tripDate]);

  const normalizedStatus = String(candidate?.status || '').toLowerCase();
  const canCheckIn = normalizedStatus === 'confirmed';
  const isUsed = normalizedStatus === 'used';

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold text-white">QR Check-In</h1>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="bg-slate-800 border-slate-700 p-5 xl:col-span-2">
          <h2 className="text-lg font-semibold text-white mb-3">Camera Scanner</h2>
          <p className="text-sm text-slate-400 mb-4">
            Scan the ticket QR code, preview ticket details, then check in on trip day.
          </p>

          <div className="rounded-xl border border-slate-700 bg-slate-900 p-3">
            <video ref={videoRef} className="w-full rounded-lg bg-black min-h-[240px]" muted playsInline />
          </div>

          <div className="flex flex-wrap gap-3 mt-4">
            {!scannerEnabled ? (
              <Button
                onClick={startScanner}
                disabled={loadingCamera}
                className="bg-primary hover:bg-primary/90 text-white flex items-center gap-2"
              >
                <Camera size={16} />
                {loadingCamera ? 'Starting Camera...' : 'Start Scanner'}
              </Button>
            ) : (
              <Button
                onClick={stopScanner}
                className="bg-slate-700 hover:bg-slate-600 text-white flex items-center gap-2"
              >
                <CameraOff size={16} />
                Stop Scanner
              </Button>
            )}

            {!scannerSupported ? (
              <span className="text-xs text-amber-300">
                Browser camera scan unsupported. Use paste/manual input below.
              </span>
            ) : scannerEngine ? (
              <span className="text-xs text-slate-400">
                Engine: {scannerEngine === 'barcode-detector' ? 'BarcodeDetector' : 'jsQR fallback'}
              </span>
            ) : null}
          </div>
        </Card>

        <Card className="bg-slate-800 border-slate-700 p-5">
          <h2 className="text-lg font-semibold text-white mb-3">Manual Resolve</h2>
          <p className="text-sm text-slate-400 mb-3">
            Paste QR payload, ticket URL, or ticket ID.
          </p>

          <textarea
            value={manualPayload}
            onChange={(e) => setManualPayload(e.target.value)}
            placeholder="Paste QR text or ticket URL..."
            rows={5}
            className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded text-sm placeholder:text-slate-400 focus:outline-none focus:border-primary"
          />
          <Button
            onClick={handleManualResolve}
            disabled={lookupLoading || !manualPayload.trim()}
            className="mt-3 w-full bg-primary hover:bg-primary/90 text-white flex items-center justify-center gap-2"
          >
            <Search size={16} />
            {lookupLoading ? 'Resolving...' : 'Resolve Ticket'}
          </Button>
        </Card>
      </div>

      <Card className="bg-slate-800 border-slate-700 p-5 mt-6">
        <h2 className="text-lg font-semibold text-white mb-3">Check-In Details</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <div className="p-3 rounded bg-slate-900 border border-slate-700">
            <p className="text-xs text-slate-400 mb-1">Ticket ID</p>
            <p className="text-sm text-slate-200 break-all">{parsedTicketId || '-'}</p>
          </div>
          <div className="p-3 rounded bg-slate-900 border border-slate-700">
            <p className="text-xs text-slate-400 mb-1">Serial (from QR)</p>
            <p className="text-sm text-slate-200 break-all">{parsedSerial || '-'}</p>
          </div>
          <div className="p-3 rounded bg-slate-900 border border-slate-700">
            <p className="text-xs text-slate-400 mb-1">Trip Date for Check-In</p>
            <input
              type="date"
              value={tripDate}
              onChange={(e) => setTripDate(e.target.value)}
              className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        {rawPayload ? (
          <div className="mb-4 p-3 rounded bg-slate-900 border border-slate-700">
            <p className="text-xs text-slate-400 mb-1">Last Raw Payload</p>
            <p className="text-xs text-slate-300 break-all">{rawPayload}</p>
          </div>
        ) : null}

        {error ? <p className="text-sm text-red-400 mb-3">{error}</p> : null}
        {success ? (
          <p className="text-sm text-emerald-400 mb-3 flex items-center gap-2">
            <CheckCircle2 size={15} />
            {success}
          </p>
        ) : null}

        {candidate ? (
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-slate-400">Customer</p>
                <p className="text-white">{candidate.customerName || '-'}</p>
              </div>
              <div>
                <p className="text-slate-400">Phone</p>
                <p className="text-white">{candidate.phoneNumber || '-'}</p>
              </div>
              <div>
                <p className="text-slate-400">Trip</p>
                <p className="text-white">{candidate.tripName}</p>
                <p className="text-xs text-slate-400">
                  {candidate.destination} |{' '}
                  {candidate.departureDate ? new Date(candidate.departureDate).toLocaleString() : '-'}
                </p>
              </div>
              <div>
                <p className="text-slate-400">Ticket</p>
                <p className="text-white font-mono text-xs">{candidate.ticketNumber || candidate.serialNumber}</p>
                <p className="text-xs text-slate-400">{candidate.referenceNumber || '-'}</p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span
                className={`px-2 py-1 rounded text-xs font-medium ${isUsed ? 'bg-emerald-900/30 text-emerald-400' : 'bg-blue-900/30 text-blue-300'
                  }`}
              >
                {isUsed ? 'used' : candidate.status}
              </span>
              <Button
                onClick={handleCheckIn}
                disabled={checkInLoading || !canCheckIn}
                className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-2"
              >
                <QrCode size={16} />
                {checkInLoading ? 'Checking In...' : isUsed ? 'Already Checked In' : 'Check In Ticket'}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-400">Scan or resolve a ticket to view details.</p>
        )}
      </Card>
    </div>
  );
}
