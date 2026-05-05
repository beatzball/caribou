import { http, HttpResponse } from 'msw'
import { makeStatus, sampleAccount } from './status.js'

let nextStatuses = [makeStatus('s1'), makeStatus('s2')]

export function setNextStatuses(statuses: ReturnType<typeof makeStatus>[]) {
  nextStatuses = statuses
}

export const handlers = [
  http.get('https://fosstodon.org/api/v1/timelines/home', () =>
    HttpResponse.json(nextStatuses),
  ),
  http.get('https://fosstodon.org/api/v1/accounts/verify_credentials', () =>
    HttpResponse.json(sampleAccount),
  ),
  http.get('https://fosstodon.org/api/v1/statuses/:id', ({ params }) => {
    if (params.id === '110') return HttpResponse.json(makeStatus('110'))
    return HttpResponse.json({ error: 'Record not found' }, { status: 404 })
  }),
]
