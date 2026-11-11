import { css } from 'lit'

// The status card's avatar and padding, shared with the Home slice's
// thread line (#275), so a change to one cannot break the other.

/** The avatar's size in the card's gutter. */
export const CARD_AVATAR = css`48px`
/** The card's padding around its content. */
export const CARD_PAD = css`var(--space-4)`
/** Where the thread line runs: the avatar's centre, from the card's edge. */
export const THREAD_LINE_X = css`calc(${CARD_PAD} + ${CARD_AVATAR} / 2 - 1px)`
/** How far a line reaches into the next row: to just above its avatar. */
export const THREAD_LINE_REACH = css`calc(-1 * ${CARD_PAD} + var(--space-1))`
