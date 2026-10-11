import { timingSafeEqual } from 'crypto'

/**
 * Admin credentials come only from ADMIN_USERNAME / ADMIN_PASSWORD. If either
 * is unset the admin endpoints are disabled (fail closed) — there are no
 * built-in default credentials.
 */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function isAdminAuthorized(req: Request): boolean {
  const expectedUser = process.env.ADMIN_USERNAME
  const expectedPass = process.env.ADMIN_PASSWORD
  if (!expectedUser || !expectedPass) return false

  const username = req.headers.get('x-admin-username') ?? ''
  const password = req.headers.get('x-admin-password') ?? ''
  // Evaluate both so the response time does not reveal which one was wrong.
  const userOk = safeEqual(username, expectedUser)
  const passOk = safeEqual(password, expectedPass)
  return userOk && passOk
}
