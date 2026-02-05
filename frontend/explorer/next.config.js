const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@jinn/shared-ui'],
  outputFileTracingRoot: path.resolve(__dirname, '..', '..'),
  turbopack: {
    root: path.resolve(__dirname, '..', '..'),
  },
};

module.exports = nextConfig;
