import type { NextConfig } from 'next';
const config: NextConfig = { output:'standalone', serverExternalPackages:['better-sqlite3','@prisma/adapter-better-sqlite3'] };
export default config;
