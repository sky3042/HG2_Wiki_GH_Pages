import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import bundleAnalyzer from '@next/bundle-analyzer'

const withBundleAnalyzer = bundleAnalyzer({
  // eslint-disable-next-line no-process-env
  enabled: process.env.ANALYZE === 'true'
})

export default withBundleAnalyzer({
  staticPageGenerationTimeout: 300,
  output: 'export',

  async redirects() {
    const redirects = []
    try {
      const dirname = path.dirname(fileURLToPath(import.meta.url))
      const oldMapPath = path.resolve(dirname, 'canonical-map_old.json')
      const newMapPath = path.resolve(dirname, 'canonical-map.json')

      // Helper: escape special chars for `source` (backslash-escape for path-to-regexp)
      const escapeSource = (str) => encodeURI(str).replaceAll(/[:*+?{}()]/g, '\\$&')
      // Helper: escape special chars for `destination` (percent-encode; backslash doesn't work in dest)
      const escapeDest = (str) => encodeURI(str)
        .replaceAll('(', '%28').replaceAll(')', '%29')
        .replaceAll('{', '%7B').replaceAll('}', '%7D')
        .replaceAll(':', '%3A').replaceAll('*', '%2A')
        .replaceAll('+', '%2B').replaceAll('?', '%3F')

      if (fs.existsSync(newMapPath)) {
        const newMap = JSON.parse(fs.readFileSync(newMapPath, 'utf8'))

        // Part 1: ID-only and Title-ID redirects (e.g. /1b63..., /something-1b63... -> /slug)
        for (const [slug, pageId] of Object.entries(newMap)) {
          const cleanId = pageId.replaceAll('-', '')

          if (slug !== cleanId) {
            const escapedDest = escapeDest(slug)

            // 1a. Redirect ID-only to Slug (e.g. /1b63... -> /laniatte...)
            redirects.push({
              source: `/${cleanId}`,
              destination: `/${escapedDest}`,
              permanent: true
            })

            // 1b. Redirect Title-ID to Slug (e.g. /some-title-1b63... -> /laniatte...)
            redirects.push({
              source: `/:title(.*)-${cleanId}`,
              destination: `/${escapedDest}`,
              permanent: true
            })
          }
        }

        // Part 2: Old-slug to new-slug redirects (e.g. /カリスマ・サンダーランド -> /charisma-thunderland)
        if (fs.existsSync(oldMapPath)) {
          const oldMap = JSON.parse(fs.readFileSync(oldMapPath, 'utf8'))
          const oldIdToSlug = Object.fromEntries(Object.entries(oldMap).map(([slug, id]) => [id.replaceAll('-', ''), slug]))
          const newIdToSlug = Object.fromEntries(Object.entries(newMap).map(([slug, id]) => [id.replaceAll('-', ''), slug]))

          for (const [id, oldSlug] of Object.entries(oldIdToSlug)) {
            const newSlug = newIdToSlug[id]
            if (newSlug && oldSlug !== newSlug) {
              redirects.push({
                source: `/${escapeSource(oldSlug)}`,
                destination: `/${escapeDest(newSlug)}`,
                permanent: true
              })
            }
          }
        }

        console.log(`Generated ${redirects.length} redirects (ID + Title-ID + old-slug).`)
      }
    } catch (err) {
      console.warn('Could not generate redirects from canonical maps:', err)
    }
    return redirects
  },

  turbopack: {},

  outputFileTracingExcludes: {
    '*': ['data/**/*']
  },
  outputFileTracingIncludes: {
    '/**': ['canonical-map.json', 'canonical-map_old.json']
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'www.notion.so' },
      { protocol: 'https', hostname: 'notion.so' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'abs.twimg.com' },
      { protocol: 'https', hostname: 'pbs.twimg.com' },
      { protocol: 'https', hostname: 's3.us-west-2.amazonaws.com' }
    ],
    formats: ['image/avif', 'image/webp'],
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    unoptimized: true
  },

  webpack: (config) => {
    // Workaround for ensuring that `react` and `react-dom` resolve correctly
    // when using a locally-linked version of `react-notion-x`.
    // @see https://github.com/vercel/next.js/issues/50391
    const dirname = path.dirname(fileURLToPath(import.meta.url))
    config.resolve.alias.react = path.resolve(dirname, 'node_modules/react')
    config.resolve.alias['react-dom'] = path.resolve(
      dirname,
      'node_modules/react-dom'
    )
    return config
  },

  // See https://react-tweet.vercel.app/next#troubleshooting
  transpilePackages: ['react-tweet']
})
