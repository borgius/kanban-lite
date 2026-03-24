import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// Minimal Next.js config. Run on port 3001 (see package.json scripts)
// to avoid clashing with kanban-lite standalone server on port 3000.
const __dirname = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
	outputFileTracingRoot: __dirname,
};

export default nextConfig;
