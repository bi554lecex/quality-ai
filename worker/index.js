// Cloudflare-compatible entry point used by Sites to serve the Vite build.
export default {
  fetch(request, env) {
    return env.ASSETS.fetch(request)
  },
}
