import { NextRequest, NextResponse } from 'next/server'
import { authorizeImportRequest } from '@/lib/import-auth'
import { importEmailTransaction, type EmailImportInput } from '@/lib/domain/email-import-service'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  if (!authorizeImportRequest(request.headers.get('authorization'))) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (!Number.isFinite(contentLength) || contentLength > 32_768) {
    return NextResponse.json({ success: false, error: 'Request too large' }, { status: 413 })
  }

  let input: EmailImportInput
  try {
    const rawBody = await request.text()
    if (Buffer.byteLength(rawBody, 'utf8') > 32_768) {
      return NextResponse.json({ success: false, error: 'Request too large' }, { status: 413 })
    }
    input = JSON.parse(rawBody) as EmailImportInput
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 })
  }
  const result = await importEmailTransaction(input)
  return NextResponse.json(result, {
    status: result.success ? 200 : 400,
    headers: { 'Cache-Control': 'no-store' },
  })
}
