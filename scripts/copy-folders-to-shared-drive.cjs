// One-time migration: server-side copy of the per-patient waiver folders into a
// Shared Drive folder. Nothing is downloaded; Drive copies file-to-file.
//
// The service account must be able to READ the source folder and WRITE (Content
// manager) to the target. Re-runnable: files already present (same name + size in
// the matching patient folder) are skipped. Dry run unless --apply is passed.
//
// Folder/file names are patient names, so this script logs counts and ids only.
//
// Usage:
//   SA_KEY_FILE=/path/key.json SOURCE_FOLDER_ID=... TARGET_FOLDER_ID=... \
//     node scripts/copy-folders-to-shared-drive.cjs [--apply]

const fs = require('node:fs')
const { GoogleAuth } = require('google-auth-library')

const { SA_KEY_FILE, SOURCE_FOLDER_ID, TARGET_FOLDER_ID } = process.env
const apply = process.argv.includes('--apply')
if (!SA_KEY_FILE || !SOURCE_FOLDER_ID || !TARGET_FOLDER_ID) {
  console.error('Set SA_KEY_FILE, SOURCE_FOLDER_ID and TARGET_FOLDER_ID.')
  process.exit(1)
}

const auth = new GoogleAuth({
  credentials: JSON.parse(fs.readFileSync(SA_KEY_FILE, 'utf-8')),
  scopes: ['https://www.googleapis.com/auth/drive'],
})
const FOLDER = 'application/vnd.google-apps.folder'
const norm = (n) => n.trim().replace(/\s+/g, ' ').toLowerCase()

async function api(path, init = {}) {
  const client = await auth.getClient()
  const { token } = await client.getAccessToken()
  const res = await fetch(`https://www.googleapis.com/drive/v3/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  if (!res.ok) throw new Error(`Drive ${res.status} on ${path.split('?')[0]}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

async function children(parentId) {
  const out = []
  let pageToken
  do {
    const q = encodeURIComponent(`'${parentId}' in parents and trashed=false`)
    const fields = encodeURIComponent('nextPageToken, files(id,name,mimeType,size)')
    const r = await api(
      `files?q=${q}&fields=${fields}&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives` +
        (pageToken ? `&pageToken=${pageToken}` : '')
    )
    out.push(...r.files)
    pageToken = r.nextPageToken
  } while (pageToken)
  return out
}

const stats = { foldersSeen: 0, foldersCreated: 0, filesSeen: 0, filesCopied: 0, filesSkipped: 0, failed: 0 }

async function copyTree(srcId, dstId) {
  const src = await children(srcId)
  const dst = dstId ? await children(dstId) : []

  for (const item of src) {
    if (item.mimeType === FOLDER) {
      stats.foldersSeen++
      let match = dst.find((d) => d.mimeType === FOLDER && norm(d.name) === norm(item.name))
      let matchId = match && match.id
      if (!matchId && apply) {
        const created = await api('files?fields=id&supportsAllDrives=true', {
          method: 'POST',
          body: JSON.stringify({ name: item.name.trim().replace(/\s+/g, ' '), mimeType: FOLDER, parents: [dstId] }),
        })
        matchId = created.id
        stats.foldersCreated++
      } else if (!matchId) {
        stats.foldersCreated++ // would create
      }
      await copyTree(item.id, matchId)
    } else {
      stats.filesSeen++
      const dup = dst.find((d) => d.name === item.name && d.size === item.size)
      if (dup) {
        stats.filesSkipped++
        continue
      }
      if (!apply) {
        stats.filesCopied++ // would copy
        continue
      }
      try {
        await api(`files/${item.id}/copy?fields=id&supportsAllDrives=true`, {
          method: 'POST',
          body: JSON.stringify({ name: item.name, parents: [dstId] }),
        })
        stats.filesCopied++
      } catch (err) {
        stats.failed++
        console.error('  copy failed for file id', item.id, '-', err.message)
      }
    }
  }
}

;(async () => {
  console.log(apply ? 'APPLY mode' : 'DRY RUN (pass --apply to copy)')
  await copyTree(SOURCE_FOLDER_ID, TARGET_FOLDER_ID)
  console.log(JSON.stringify(stats, null, 2))
  if (!apply) console.log('Counts above are what WOULD happen (foldersCreated/filesCopied).')
})().catch((e) => {
  console.error('Failed:', e.message)
  process.exit(1)
})
