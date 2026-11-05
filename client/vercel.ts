const renderApiOrigin = process.env.RENDER_API_ORIGIN

if (!renderApiOrigin) {
  throw new Error('Set RENDER_API_ORIGIN to the HTTPS origin of the Render API')
}

const apiOrigin = new URL(renderApiOrigin)
if (
  apiOrigin.protocol !== 'https:' ||
  apiOrigin.username ||
  apiOrigin.password ||
  apiOrigin.pathname !== '/' ||
  apiOrigin.search ||
  apiOrigin.hash
) {
  throw new Error('RENDER_API_ORIGIN must be an HTTPS origin without a path')
}

if ((process.env.API_PROXY_SECRET?.length ?? 0) < 32) {
  throw new Error('API_PROXY_SECRET must contain at least 32 characters')
}

// Vercel evaluates this file on the platform; no secrets enter the Vite bundle.
export const config = {
  framework: 'vite',
  installCommand: 'corepack pnpm install --frozen-lockfile --no-prod',
  buildCommand: 'pnpm run build',
  outputDirectory: 'dist',
  routes: [
    {
      src: '/api(?:/(.*))?',
      dest: `${apiOrigin.origin}/api/$1`,
      headers: {
        'Cache-Control': 'private, no-store',
        'CDN-Cache-Control': 'no-store',
        'Vercel-CDN-Cache-Control': 'no-store',
        'x-vercel-enable-rewrite-caching': '0',
      },
      transforms: [
        {
          type: 'request.headers',
          op: 'set',
          target: { key: 'x-api-proxy-secret' },
          args: '$API_PROXY_SECRET',
          env: ['API_PROXY_SECRET'],
        },
      ],
    },
    { handle: 'filesystem' },
    { src: '/(.*)', dest: '/index.html' },
  ],
}
