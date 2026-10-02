// Server-render a Lit template to a string, the way Litro's Lit adapter does.
// Tests that use this must run in the node environment — put
// `// @vitest-environment node` on the first line of the test file — because
// `lit` resolves to its server build only under the `node` export condition.
import { render } from '@lit-labs/ssr'
import { collectResult } from '@lit-labs/ssr/lib/render-result.js'
import type { TemplateResult } from 'lit'

export function ssr(template: TemplateResult): Promise<string> {
  return collectResult(render(template))
}
