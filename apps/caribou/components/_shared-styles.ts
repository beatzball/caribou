import { css } from 'lit'

// The document stylesheet sets `* { box-sizing: border-box }`, but a document
// rule does not cross a shadow boundary. Every component that renders its own
// markup composes this so its box model matches the page's.
export const boxReset = css`
  *, *::before, *::after { box-sizing: border-box; }
`
