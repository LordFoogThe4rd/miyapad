import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'jsdom',
		include: ['src/**/*.{test,spec}.{ts,tsx}', 'server/**/*.test.ts'],
		exclude: ['**/node_modules/**'],
		setupFiles: ['vitest.setup.ts'],
		benchmark: {
			include: ['src/**/*.bench.{ts,tsx}'],
		},
		coverage: {
			provider: 'v8',
			include: ['src/**/*.{ts,tsx}', 'server/**/*.ts'],
			exclude: ['**/*.{test,bench}.{ts,tsx}', '**/*.d.ts', '**/node_modules/**', 'src/version.ts'],
			reporter: ['text-summary', 'html'],
		},
	},
});
