/** Permanent DSH profile patch updates initiated by the local Web settings page. */

import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { parseDocument, isSeq } from 'yaml'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

  const temporaryPath = `${patchPath}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, document.toString(), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await rename(temporaryPath, patchPath)
  } finally {
    await rm(temporaryPath, { force: true })
  }
}
