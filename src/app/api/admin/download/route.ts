import { NextRequest, NextResponse } from 'next/server'
import { fetchWaiverPdf } from '@/lib/google-drive'
import { isAdminAuthorized } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const id = req.nextUrl.searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  }

  try {
    const file = await fetchWaiverPdf(id)
    if (!file) {
      return new NextResponse('Not found', { status: 404 })
    }
    return new NextResponse(file.bytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${file.name.replace(/[^\w.-]/g, '_')}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('Admin download error:', err)
    return new NextResponse('Error retrieving file', { status: 500 })
  }
}
