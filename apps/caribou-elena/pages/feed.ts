import type { H3Event } from 'h3'
import { sendRedirect } from 'h3'

export default async function feedRedirect(event: H3Event) {
  return sendRedirect(event, '/home', 301)
}
