// Vitest for the server's pure logic.
//
// Two things make this config more than a default.
//
// The resolver: server/ is NodeNext, so every relative import ends in '.js' while the
// file on disk is '.ts'. tsc understands that mapping and Vite's resolver does not, so
// it is done here rather than by weakening the server's module setting.
//
// The env: services/osu.ts imports env.ts, which validates at module load and exits the
// process when a variable is missing. Unit tests get fixed placeholder values here, so
// they never read server/.env and can never touch a real credential.

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    {
      name: 'nodenext-js-to-ts',
      enforce: 'pre',
      resolveId(source: string, importer: string | undefined) {
        if (!importer || !source.startsWith('.') || !source.endsWith('.js')) return null;
        const candidate = resolve(dirname(importer), `${source.slice(0, -3)}.ts`);
        return existsSync(candidate) ? candidate : null;
      },
    },
  ],
  test: {
    name: 'server',
    environment: 'node',
    include: ['server/src/**/*.test.ts'],
    env: {
      SESSION_SECRET: 'test-only-session-secret',
      OSU_CLIENT_ID: '0',
      OSU_CLIENT_SECRET: 'test-only',
      OSU_REDIRECT_URI: 'http://localhost:3001/api/auth/callback',
      DATABASE_URL: 'postgres://localhost:5432/none',
      NODE_ENV: 'test',
    },
  },
});
