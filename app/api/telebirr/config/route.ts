import { NextResponse } from 'next/server';
import {
  getTelebirrConfigStatus,
  getTelebirrGatewayProxyURL,
  resolveTelebirrGatewayBaseURL,
} from '@/lib/telebirr';

export async function GET() {
  try {
    const status = getTelebirrConfigStatus();
    const gatewayProxyURL = getTelebirrGatewayProxyURL();
    return NextResponse.json({
      ok: true,
      telebirr: {
        ...status,
        gatewayProxyURL: gatewayProxyURL || null,
        requestBaseURL: resolveTelebirrGatewayBaseURL(status.baseURL),
      },
    });
  } catch (error) {
    console.error('[telebirr-config] Error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to read Telebirr config' }, { status: 500 });
  }
}
