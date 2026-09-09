// Vitest for the client's pure logic.
//
// Deliberately separate from the server config rather than a workspace: two configs and
// two scripts work on any vitest version, and the two halves need different resolution
// rules anyway — see vitest.server.config.ts.
//
// environment 'node' because nothing here renders a component. These suites cover the
// mappers and the phase rules, which are the parts that break silently.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'client',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
