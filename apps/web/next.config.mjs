import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });   // one shared .env at the repo root

/** @type {import('next').NextConfig} */
export default {
  transpilePackages: ['@anomaly/core'],
  serverExternalPackages: ['mongodb'],
  // The shared core package uses NodeNext-style "./file.js" imports that point at .ts sources.
  webpack(config) {
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    return config;
  },
};
