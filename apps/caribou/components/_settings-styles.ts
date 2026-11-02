import { css } from 'lit'

// Shared by the settings sections: a group of radio buttons, one per row.
export const choiceStyles = css`
  :host { display: block; }
  fieldset { border: 0; margin: 0; padding: 0; }
  legend { padding: 0; margin-bottom: var(--space-2); color: var(--fg-0); font-weight: 500; }
  label {
    display: flex; align-items: center; gap: var(--space-2);
    min-height: 44px; padding: 0 var(--space-2); border-radius: var(--radius-md);
    cursor: pointer;
  }
  label:hover { background: var(--bg-1); }
  input { margin: 0; accent-color: var(--accent); width: 18px; height: 18px; }
  .hint { color: var(--fg-muted); font-size: 0.875em; }
  .status { margin: var(--space-2) 0 0; min-height: 1.25em; color: var(--danger); font-size: 0.875em; }
`
