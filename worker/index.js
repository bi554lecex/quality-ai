// Cloudflare-compatible entry point used by Sites to serve the Vite build.
export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname.endsWith('/')) {
      url.pathname += 'index.html'
    }

    const assetResponse = await env.ASSETS.fetch(new Request(url, request))
    if (assetResponse.status !== 404 || request.method !== 'GET') {
      return assetResponse
    }

    const acceptsHtml = request.headers.get('accept')?.includes('text/html')
    if (!acceptsHtml) {
      return assetResponse
    }

    url.pathname = '/index.html'
    return env.ASSETS.fetch(new Request(url, request))
  },
}
