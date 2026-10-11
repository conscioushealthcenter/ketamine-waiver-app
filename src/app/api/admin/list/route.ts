import { NextResponse } from 'next/server'
import { listWaivers } from '@/lib/google-drive'
import { isAdminAuthorized } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  if (!isAdminAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    return NextResponse.json({ patients: await listWaivers() })
  } catch (err) {
    console.error('Admin list error:', err)
    return NextResponse.json({ error: 'Could not load waivers' }, { status: 500 })
  }
}
