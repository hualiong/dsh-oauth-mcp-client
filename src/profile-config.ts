/** Permanent DSH profile patch updates initiated by the local Web settings page. */

import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { isMap, isSeq, parseDocument, type Document, type ParsedNode } from 'yaml'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function writeDocument(patchPath: string, document: Document.Parsed<ParsedNode>): Promise<void> {
  const temporaryPath = `${patchPath}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, document.toString(), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await rename(temporaryPath, patchPath)
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

/** Append one OAuth MCP connection to a profile's permanent patch layer. */
export async function addConnectionConfig(
  patchPath: string,
  input: { serverName: string; url: string },
): Promise<void> {
  const source = await readFile(patchPath, 'utf8')
  const document = parseDocument(source)
  if (document.errors.length > 0) throw new Error(`profile patch is invalid YAML: ${document.errors[0]?.message ?? 'unknown error'}`)
  if (!isSeq(document.contents)) throw new Error('profile patch must contain a top-level YAML array')

  const patchEntries = document.toJS() as unknown
  if (!Array.isArray(patchEntries)) throw new Error('profile patch must contain a top-level YAML array')
  const id = `oauth-mcp-${input.serverName}`
  for (const entry of patchEntries) {
    if (!isRecord(entry) || !Array.isArray(entry.insert)) continue
    for (const row of entry.insert) {
      if (!isRecord(row)) continue
      const rowConfig = isRecord(row.config) ? row.config : undefined
      if (row.id === id || rowConfig?.serverName === input.serverName) {
        throw new Error(`MCP connection "${input.serverName}" already exists in the profile patch`)
      }
    }
  }

  document.add({
    insert: [{
      id,
      name: '@dsh-external/dsh-oauth-mcp-client',
      config: {
        serverName: input.serverName,
        url: input.url,
        failOnStartupError: false,
      },
    }],
  })

  await writeDocument(patchPath, document)
}

/** Remove an inserted connection or permanently disable its bundle entry. */
export async function removeConnectionConfig(
  patchPath: string,
  input: { serverName: string; entryId: string },
): Promise<void> {
  const source = await readFile(patchPath, 'utf8')
  const document = parseDocument(source)
  if (document.errors.length > 0) throw new Error(`profile patch is invalid YAML: ${document.errors[0]?.message ?? 'unknown error'}`)
  if (!isSeq(document.contents)) throw new Error('profile patch must contain a top-level YAML array')

  for (let patchIndex = 0; patchIndex < document.contents.items.length; patchIndex++) {
    const patch = document.contents.items[patchIndex]
    if (!isMap(patch)) continue
    const insert = patch.get('insert', true)
    if (!isSeq(insert)) continue
    const rowIndex = insert.items.findIndex((row) => {
      if (!isMap(row)) return false
      if (row.get('id') === input.entryId) return true
      const config = row.get('config', true)
      return isMap(config) && config.get('serverName') === input.serverName
    })
    if (rowIndex < 0) continue
    insert.items.splice(rowIndex, 1)
    if (insert.items.length === 0) document.contents.items.splice(patchIndex, 1)
    await writeDocument(patchPath, document)
    return
  }

  document.add({ id: input.entryId, disabled: true })
  await writeDocument(patchPath, document)
}
