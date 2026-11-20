import { NextResponse } from 'next/server';
import { isSameOrigin, type HandlerResult } from '@/lib/http';

export function toResponse(r: HandlerResult) {
  return NextResponse.json(r.body, { status: r.status, headers: r.headers });
}

export function csrfOk(request: Request): boolean {
  return isSameOrigin(request.url, request.headers.get('origin'), process.env.NEXT_PUBLIC_SITE_URL);
}

export async function readJson(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { return null; }
}
