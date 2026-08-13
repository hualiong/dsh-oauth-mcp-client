import { defineConfig } from 'tsdown'

const id = '@dsh-external/dsh-oauth-mcp-client'

export default defineConfig({
  entry: { client: 'src/client.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  clean: false,
  sourcemap: true,
  dts: false,
  deps: {
    neverBundle: ['react', 'react/jsx-runtime', '@deepseek-ai/cordis'],
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
