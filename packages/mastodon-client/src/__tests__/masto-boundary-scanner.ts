import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

const SKIP_DIRS = new Set(['node_modules', 'dist', '.output', '.nitro', '.litro', 'coverage'])

/**
 * Every TypeScript source under `dir`, hand-written `.d.ts` files included.
 * Skips dependencies, build output and dot directories.
 */
export function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) sourceFiles(join(dir, entry.name), out)
    } else if (/\.(c|m)?tsx?$/.test(entry.name)) {
      out.push(join(dir, entry.name))
    }
  }
  return out
}

// Finds every place a source file reaches masto: by module specifier, not by
// text, so aliases, line breaks and subpaths cannot hide it. A string or a
// comment that only mentions the name is not a use.

const MASTO_NAMESPACES = new Set(['v1', 'v2', 'rest'])

function isMastoModule(spec: string): boolean {
  return spec === 'masto' || spec.startsWith('masto/')
}

function scriptKind(fileName: string): ts.ScriptKind {
  if (/\.(c|m)?tsx$/.test(fileName)) return ts.ScriptKind.TSX
  return ts.ScriptKind.TS
}

/** One line per use: `<line>: <what>`. Empty when the file uses no masto. */
export function findMastoUses(fileName: string, text: string): string[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKind(fileName))
  const uses: string[] = []
  const report = (node: ts.Node, what: string) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
    uses.push(`${line + 1}: ${what}`)
  }
  const checkSpec = (node: ts.Node, spec: ts.Node | undefined, kind: string) => {
    if (spec && ts.isStringLiteralLike(spec) && isMastoModule(spec.text)) report(node, `${kind} '${spec.text}'`)
  }

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      checkSpec(node, node.moduleSpecifier, ts.isImportDeclaration(node) ? 'import' : 'export')
    } else if (ts.isImportEqualsDeclaration(node)) {
      const ref = node.moduleReference
      if (ts.isExternalModuleReference(ref)) checkSpec(node, ref.expression, 'import = require')
    } else if (ts.isImportTypeNode(node)) {
      const arg = node.argument
      if (ts.isLiteralTypeNode(arg)) checkSpec(node, arg.literal, 'import type')
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (callee.kind === ts.SyntaxKind.ImportKeyword) checkSpec(node, node.arguments[0], 'dynamic import')
      else if (ts.isIdentifier(callee) && callee.text === 'require') checkSpec(node, node.arguments[0], 'require')
    } else if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) {
      checkSpec(node, node.name, 'declare module')
    } else if (ts.isQualifiedName(node)) {
      if (ts.isIdentifier(node.left) && node.left.text === 'mastodon' && MASTO_NAMESPACES.has(node.right.text)) {
        report(node, `mastodon.${node.right.text}`)
      }
    } else if (ts.isPropertyAccessExpression(node)) {
      const e = node.expression
      if (ts.isIdentifier(e) && e.text === 'mastodon' && MASTO_NAMESPACES.has(node.name.text)) {
        report(node, `mastodon.${node.name.text}`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return uses
}
