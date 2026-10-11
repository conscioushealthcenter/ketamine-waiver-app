import { GoogleAuth } from 'google-auth-library'

/**
 * Google Drive is the only store for submitted waivers: one subfolder per
 * patient under GOOGLE_DRIVE_FOLDER_ID (a Shared Drive folder). Auth is a
 * service account that is a Content manager on that folder.
 * GOOGLE_SERVICE_ACCOUNT_JSON is the key file contents, raw or base64 JSON.
 */

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive'
const API = 'https://www.googleapis.com/drive/v3'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const SHARED = 'supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives'

let cachedAuth: GoogleAuth | null = null

function getAuth(): GoogleAuth {
  if (cachedAuth) return cachedAuth

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!raw) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_JSON env var')
  const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf-8')
  cachedAuth = new GoogleAuth({ credentials: JSON.parse(text), scopes: [DRIVE_SCOPE] })
  return cachedAuth
}

async function getAccessToken(): Promise<string> {
  const client = await getAuth().getClient()
  const { token } = await client.getAccessToken()
  if (!token) throw new Error('Failed to obtain Google Drive access token')
  return token
}

function getRootFolderId(): string {
  const id = process.env.GOOGLE_DRIVE_FOLDER_ID
  if (!id) throw new Error('Missing GOOGLE_DRIVE_FOLDER_ID env var')
  return id
}

/** Trims and collapses internal whitespace so "Jane   Doe " and "Jane Doe" are treated as the same name. */
function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

interface DriveItem {
  id: string
  name: string
  createdTime?: string
  parents?: string[]
  mimeType?: string
}

async function driveGet<T>(token: string, path: string, what: string): Promise<T> {
  const res = await fetch(`${API}/${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Google Drive ${what} failed: ${res.status} ${text}`)
  }
  return (await res.json()) as T
}

async function listChildren(token: string, parentId: string, onlyFolders: boolean): Promise<DriveItem[]> {
  const mime = onlyFolders ? `mimeType='${FOLDER_MIME}'` : `mimeType!='${FOLDER_MIME}'`
  const q = encodeURIComponent(`'${parentId}' in parents and ${mime} and trashed=false`)
  const fields = encodeURIComponent('nextPageToken, files(id,name,createdTime)')
  const items: DriveItem[] = []
  let pageToken: string | undefined

  do {
    const json = await driveGet<{ files: DriveItem[]; nextPageToken?: string }>(
      token,
      `files?q=${q}&fields=${fields}&pageSize=1000&${SHARED}` + (pageToken ? `&pageToken=${pageToken}` : ''),
      'listing'
    )
    items.push(...json.files)
    pageToken = json.nextPageToken
  } while (pageToken)

  return items
}

/**
 * Finds a subfolder by name (case/whitespace-insensitive) directly under
 * parentId, creating it if no match exists. Keeps one Drive folder per
 * patient even if their name is typed with different spacing/casing across
 * submissions. Names that differ more than that (e.g. a missing middle
 * initial) intentionally still create separate folders — merging those
 * requires a human to confirm it's really the same patient.
 */
async function findOrCreatePatientFolder(token: string, parentId: string, folderName: string): Promise<string> {
  const normalized = normalizeName(folderName)
  const existing = await listChildren(token, parentId, true)
  const match = existing.find(f => normalizeName(f.name).toLowerCase() === normalized.toLowerCase())
  if (match) return match.id

  const createRes = await fetch(`${API}/files?fields=id&supportsAllDrives=true`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: normalized, mimeType: FOLDER_MIME, parents: [parentId] }),
  })
  if (!createRes.ok) {
    const text = await createRes.text().catch(() => '')
    throw new Error(`Google Drive folder creation failed: ${createRes.status} ${text}`)
  }
  return ((await createRes.json()) as { id: string }).id
}

/**
 * Uploads a PDF (as raw bytes) into the patient's subfolder of the
 * configured Drive folder, creating the subfolder if needed. Throws on any
 * failure — there is no second copy, so callers must surface the error.
 */
export async function uploadPdfToDrive(pdfBytes: Uint8Array, filename: string, patientFolderName: string): Promise<string> {
  const token = await getAccessToken()
  const patientFolderId = await findOrCreatePatientFolder(token, getRootFolderId(), patientFolderName)

  const boundary = `waiver_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify({ name: filename, parents: [patientFolderId] })}\r\n` +
        `--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`,
      'utf-8'
    ),
    Buffer.from(pdfBytes),
    Buffer.from(`\r\n--${boundary}--`, 'utf-8'),
  ])

  const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id&supportsAllDrives=true`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Google Drive upload failed: ${res.status} ${text}`)
  }
  return ((await res.json()) as { id: string }).id
}

export interface WaiverFile {
  id: string
  name: string
  uploadedAt: string
}

/** All waivers grouped by patient folder name, newest first within each patient. */
export async function listWaivers(): Promise<Record<string, WaiverFile[]>> {
  const token = await getAccessToken()
  const folders = await listChildren(token, getRootFolderId(), true)
  const grouped: Record<string, WaiverFile[]> = {}

  for (let i = 0; i < folders.length; i += 8) {
    const batch = folders.slice(i, i + 8)
    const results = await Promise.all(batch.map(f => listChildren(token, f.id, false)))
    batch.forEach((folder, idx) => {
      const files = results[idx]
        .filter(f => f.name.toLowerCase().endsWith('.pdf'))
        .map(f => ({ id: f.id, name: f.name, uploadedAt: f.createdTime || '' }))
        .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
      if (files.length) grouped[normalizeName(folder.name)] = files
    })
  }

  return grouped
}

/**
 * Fetches one waiver PDF by Drive file id. Refuses any file that is not a
 * direct child of a patient folder under the configured root, so the admin
 * endpoint cannot be used to read arbitrary files the service account can see.
 */
export async function fetchWaiverPdf(fileId: string): Promise<{ bytes: ArrayBuffer; name: string } | null> {
  if (!/^[A-Za-z0-9_-]{10,}$/.test(fileId)) return null
  const token = await getAccessToken()

  const meta = await driveGet<DriveItem>(token, `files/${fileId}?fields=id,name,mimeType,parents&supportsAllDrives=true`, 'metadata')
  const parentId = meta.parents?.[0]
  if (!parentId || meta.mimeType === FOLDER_MIME) return null

  const parent = await driveGet<DriveItem>(token, `files/${parentId}?fields=id,parents&supportsAllDrives=true`, 'metadata')
  if (!parent.parents?.includes(getRootFolderId())) return null

  const res = await fetch(`${API}/files/${fileId}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Google Drive download failed: ${res.status}`)
  return { bytes: await res.arrayBuffer(), name: meta.name }
}
