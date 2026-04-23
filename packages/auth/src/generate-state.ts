export function generateState(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  // base64url without padding
  let b64 = ''
  // btoa is not available in Node node:test env, but Vitest with happy-dom/node
  // both provide `Buffer`. Use a portable conversion via string-of-bytes → btoa
  // when available, fallback to Buffer.
  if (typeof btoa === 'function') {
    let binary = ''
    for (const b of bytes) binary += String.fromCharCode(b)
    b64 = btoa(binary)
  } else {
    b64 = Buffer.from(bytes).toString('base64')
  }
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
