import { describe, expect, it } from 'vitest'
import type {
  GroupedNotificationsPage, NotificationGroupData, Account, Notification,
  Status,
} from '@beatzball/caribou-mastodon-client'
import {
  appendOlderGroups, groupNotifications, groupsFromPage, prependNewerGroups, withoutSilencedAccounts,
  type NotificationGroup,
} from '../notification-groups.js'

function account(id: string): Account {
  return { id, acct: id, username: id, displayName: id } as unknown as Account
}

function notif(id: string, type: string, by: string, statusId?: string, extra: object = {}): Notification {
  return {
    id, type, createdAt: '2026-11-01T10:00:00.000Z', account: account(by),
    ...(statusId ? { status: { id: statusId } } : {}),
    ...extra,
  } as unknown as Notification
}

function summary(groups: NotificationGroup[]) {
  return groups.map((g) => `${g.type}:${g.count}:${g.accounts.map((a) => a.id).join(',')}:${g.newestId}-${g.oldestId}`)
}

describe('groupNotifications (an older server)', () => {
  it('groups favourites and boosts on the same post, and follows; mentions stay single', () => {
    const groups = groupNotifications([
      notif('9', 'favourite', 'bob', 's1'),
      notif('8', 'mention', 'carol', 's2'),
      notif('7', 'favourite', 'alice', 's1'),
      notif('6', 'reblog', 'dave', 's1'),
      notif('5', 'follow', 'erin'),
      notif('4', 'mention', 'carol', 's3'),
      notif('3', 'follow', 'frank'),
      notif('2', 'favourite', 'gina', 's9'),
    ])
    expect(summary(groups)).toEqual([
      'favourite:2:bob,alice:9-7',
      'mention:1:carol:8-8',
      'reblog:1:dave:6-6',
      'follow:2:erin,frank:5-3',
      'mention:1:carol:4-4',
      'favourite:1:gina:2-2',
    ])
  })

  it('uses the server group key when there is one', () => {
    const groups = groupNotifications([
      notif('9', 'favourite', 'bob', 's1', { groupKey: 'favourite-s1-100' }),
      notif('7', 'favourite', 'alice', 's1', { groupKey: 'favourite-s1-99' }),
    ])
    expect(summary(groups)).toEqual(['favourite:1:bob:9-9', 'favourite:1:alice:7-7'])
  })

  it('keeps a server key that says ungrouped', () => {
    const groups = groupNotifications([
      notif('3', 'follow', 'alice', undefined, { groupKey: 'ungrouped-3' }),
      notif('2', 'follow', 'bob', undefined, { groupKey: 'ungrouped-2' }),
    ])
    expect(groups.map((g) => g.key)).toEqual(['ungrouped-3', 'ungrouped-2'])
  })

  it('does not group across days', () => {
    const groups = groupNotifications([
      notif('9', 'follow', 'bob'),
      notif('7', 'follow', 'alice', undefined, { createdAt: '2026-10-30T10:00:00.000Z' }),
    ])
    expect(groups).toHaveLength(2)
  })

  it('a page added below or above merges into its group with no duplicates', () => {
    const first = [notif('9', 'favourite', 'bob', 's1'), notif('8', 'mention', 'carol', 's2')]
    const older = [notif('8', 'mention', 'carol', 's2'), notif('5', 'favourite', 'alice', 's1')]
    const newer = [notif('12', 'favourite', 'zoe', 's1')]
    expect(summary(groupNotifications([...newer, ...first, ...older]))).toEqual([
      'favourite:3:zoe,bob,alice:12-5',
      'mention:1:carol:8-8',
    ])
  })
})

function group(g: Partial<NotificationGroupData> & { groupKey: string; type: string }): NotificationGroupData {
  return {
    notificationsCount: 1, mostRecentNotificationId: '1', sampleAccountIds: [], ...g,
  }
}

function page(groups: NotificationGroupData[], ids: string[] = ['alice', 'bob', 'carol', 'dave']): GroupedNotificationsPage {
  return {
    accounts: ids.map(account),
    statuses: [{ id: 's1' } as Status],
    notificationGroups: groups,
  }
}

describe('server groups', () => {
  it('reads a page: accounts, post, count and range', () => {
    const groups = groupsFromPage(page([
      group({ groupKey: 'favourite-s1', type: 'favourite', notificationsCount: 14, statusId: 's1',
        mostRecentNotificationId: '20', pageMinId: '7', pageMaxId: '20', sampleAccountIds: ['alice', 'bob'] }),
      group({ groupKey: 'ungrouped-5', type: 'mention', statusId: 'gone', mostRecentNotificationId: '5', sampleAccountIds: ['carol'] }),
    ]))
    expect(summary(groups)).toEqual(['favourite:14:alice,bob:20-7', 'mention:1:carol:5-5'])
    expect(groups[0]!.status?.id).toBe('s1')
    expect(groups[1]!.status).toBeNull()
  })

  it('an older page joins the group it continues, keeps the newer total, and adds new ones below', () => {
    // notifications_count counts every notification of the group up to the
    // top of the page, so the older page's 14 is part of the first page's 14.
    const list = groupsFromPage(page([
      group({ groupKey: 'favourite-s1', type: 'favourite', notificationsCount: 14, pageMinId: '10', pageMaxId: '20', sampleAccountIds: ['alice'] }),
    ]))
    const older = groupsFromPage(page([
      group({ groupKey: 'favourite-s1', type: 'favourite', notificationsCount: 14, pageMinId: '4', pageMaxId: '8', sampleAccountIds: ['bob', 'alice'] }),
      group({ groupKey: 'ungrouped-3', type: 'mention', mostRecentNotificationId: '3', sampleAccountIds: ['carol'] }),
    ]))
    expect(summary(appendOlderGroups(list, older))).toEqual([
      'favourite:14:alice,bob:20-4',
      'mention:1:carol:3-3',
    ])
  })

  it('a newer page joins its group with the server\'s new total and moves it to the top', () => {
    const list = groupsFromPage(page([
      group({ groupKey: 'ungrouped-30', type: 'mention', mostRecentNotificationId: '30', sampleAccountIds: ['carol'] }),
      group({ groupKey: 'favourite-s1', type: 'favourite', notificationsCount: 14, pageMinId: '10', pageMaxId: '20', sampleAccountIds: ['alice'] }),
    ]))
    const newer = groupsFromPage(page([
      group({ groupKey: 'favourite-s1', type: 'favourite', notificationsCount: 15, pageMinId: '40', pageMaxId: '40', sampleAccountIds: ['dave', 'alice'] }),
    ]))
    expect(summary(prependNewerGroups(list, newer))).toEqual([
      'favourite:15:dave,alice:40-10',
      'mention:1:carol:30-30',
    ])
  })

  it('a part that came in twice is not counted twice', () => {
    const list = groupsFromPage(page([
      group({ groupKey: 'follow-1', type: 'follow', notificationsCount: 2, pageMinId: '10', pageMaxId: '20', sampleAccountIds: ['alice', 'bob'] }),
    ]))
    expect(summary(prependNewerGroups(list, list))).toEqual(['follow:2:alice,bob:20-10'])
    expect(summary(appendOlderGroups(list, list))).toEqual(['follow:2:alice,bob:20-10'])
  })
})

describe('withoutSilencedAccounts', () => {
  const list = groupNotifications([
    notif('9', 'favourite', 'bob', 's1'),
    notif('8', 'favourite', 'alice', 's1'),
    notif('7', 'mention', 'bob', 's2'),
    notif('6', 'follow', 'bob'),
    notif('5', 'poll', 'carol', 's3'),
  ])

  it('takes a muted account out of a group, and drops a group of only muted accounts', () => {
    expect(summary(withoutSilencedAccounts(list, new Set(['bob'])))).toEqual([
      'favourite:1:alice:9-8',
      'poll:1:carol:5-5',
    ])
  })

  it('keeps everything when nobody is muted', () => {
    expect(withoutSilencedAccounts(list, new Set())).toEqual(list)
  })

  it('a sample that is all muted or blocked keeps the row for the people outside it', () => {
    const groups = groupsFromPage(page([
      group({ groupKey: 'follow-1', type: 'follow', notificationsCount: 14, sampleAccountIds: ['alice', 'bob'] }),
    ]))
    expect(groups[0]!.complete).toBe(false)
    const left = withoutSilencedAccounts(groups, new Set(['alice', 'bob']))
    expect(summary(left)).toEqual(['follow:12::1-1'])
  })

  it('a full list that is all muted or blocked drops the row', () => {
    const groups = groupsFromPage(page([
      group({ groupKey: 'follow-1', type: 'follow', notificationsCount: 2, sampleAccountIds: ['alice', 'bob'] }),
    ]))
    expect(groups[0]!.complete).toBe(true)
    expect(withoutSilencedAccounts(groups, new Set(['alice', 'bob']))).toEqual([])
  })

  it('lowers a server count by the accounts it takes out', () => {
    const groups = groupsFromPage(page([
      group({ groupKey: 'reblog-s1', type: 'reblog', notificationsCount: 14, statusId: 's1', sampleAccountIds: ['alice', 'bob'] }),
    ]))
    expect(summary(withoutSilencedAccounts(groups, new Set(['bob'])))).toEqual(['reblog:13:alice:1-1'])
  })
})
