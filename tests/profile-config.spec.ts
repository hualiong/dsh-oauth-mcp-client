import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { addConnectionConfig, removeConnectionConfig } from '../src/profile-config.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('permanent profile configuration', () => {
  it('preserves existing patches and appends an OAuth MCP row', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-oauth-mcp-'))
    roots.push(root)
    const path = join(root, 'cordis.patch.yml')
    writeFileSync(path, '# user configuration\n- insert:\n    - id: existing\n      name: existing-plugin\n')

    await addConnectionConfig(path, {
      serverName: 'example',
      url: 'https://mcp.example.com/mcp',
    })

    const source = readFileSync(path, 'utf8')
    expect(source).toContain('# user configuration')
    expect(parse(source)).toEqual([
      { insert: [{ id: 'existing', name: 'existing-plugin' }] },
      {
        insert: [{
          id: 'oauth-mcp-example',
          name: '@dsh-external/dsh-oauth-mcp-client',
          config: {
            serverName: 'example',
            url: 'https://mcp.example.com/mcp',
            failOnStartupError: false,
          },
        }],
      },
    ])
  })

  it('rejects a duplicate server name without changing the file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-oauth-mcp-'))
    roots.push(root)
    const path = join(root, 'cordis.patch.yml')
    const source = '- insert:\n    - id: custom\n      config:\n        serverName: example\n'
    writeFileSync(path, source)

    await expect(addConnectionConfig(path, {
      serverName: 'example',
      url: 'https://mcp.example.com/mcp',
    })).rejects.toThrow('already exists')
    expect(readFileSync(path, 'utf8')).toBe(source)
  })

  it('removes a user-inserted connection without rebuilding the remaining patch', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-oauth-mcp-'))
    roots.push(root)
    const path = join(root, 'cordis.patch.yml')
    writeFileSync(path, '- insert:\n    - id: oauth-mcp-example\n      name: plugin\n      config:\n        serverName: example\n# keep this comment\n- id: other\n  disabled: true\n')

    await removeConnectionConfig(path, { serverName: 'example', entryId: 'oauth-mcp-example' })

    const source = readFileSync(path, 'utf8')
    expect(source).toContain('# keep this comment')
    expect(parse(source)).toEqual([{ id: 'other', disabled: true }])
  })

  it('disables a bundle connection in the permanent profile patch', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-oauth-mcp-'))
    roots.push(root)
    const path = join(root, 'cordis.patch.yml')
    writeFileSync(path, '[]\n')

    await removeConnectionConfig(path, { serverName: 'springbrand', entryId: 'springbrand-mcp-oauth' })

    expect(parse(readFileSync(path, 'utf8'))).toEqual([{ id: 'springbrand-mcp-oauth', disabled: true }])
  })
})
