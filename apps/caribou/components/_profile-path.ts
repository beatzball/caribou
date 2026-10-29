// Caribou's own profile page for an account. Every `/@acct@host` path is
// built here: the status card's author link, boost line and mentions, and the
// notifications list.
//
// `acct` is relative to the instance the data came from: a local account has
// no `@host` part, so add the host. With no host known, the bare handle is the
// best there is.
export function profilePath(acct: string, host: string): string {
  return `/@${acct.includes('@') || !host ? acct : `${acct}@${host}`}`
}
