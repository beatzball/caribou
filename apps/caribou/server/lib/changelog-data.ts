// The parsed changelog of this build. Server only: `pages/changelog.ts`
// reaches it through a dynamic import inside `pageData`, so the file's text
// stays out of the client bundle.
import { CHANGELOG_MD } from '../changelog.generated.js'
import { parseChangelog, type Release } from './changelog.js'

let releases: Release[] | undefined

export function changelogReleases(): Release[] {
  releases ??= parseChangelog(CHANGELOG_MD)
  return releases
}
