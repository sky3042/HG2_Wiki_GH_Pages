import * as fs from 'node:fs';
import * as path from 'node:path';
import { getSiteMap } from '../lib/get-site-map';
import * as config from '../lib/config';

async function main() {
  console.log('🗺️ Generating sitemap.xml and robots.txt...');
  
  const siteMap = await getSiteMap();
  const host = config.host;

  // 1. Generate sitemap.xml
  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${host}</loc>
  </url>
  ${Object.keys(siteMap.canonicalPageMap)
    .map((pagePath) => `
  <url>
    <loc>${host}/${pagePath}</loc>
  </url>`.trim())
    .join('\n')}
</urlset>`;

  fs.writeFileSync(path.join(process.cwd(), 'public', 'sitemap.xml'), sitemapXml);
  console.log('✅ Generated public/sitemap.xml');

  // 2. Generate robots.txt
  const robotsTxt = `User-agent: *
Allow: /
Disallow: /api/get-tweet-ast/*
Disallow: /api/search-notion

Sitemap: ${host}/sitemap.xml
`;

  fs.writeFileSync(path.join(process.cwd(), 'public', 'robots.txt'), robotsTxt);
  console.log('✅ Generated public/robots.txt');

  // 3. Update canonical-map.json cache
  fs.writeFileSync(path.join(process.cwd(), 'canonical-map.json'), JSON.stringify(siteMap.canonicalPageMap, null, 2));
  console.log('✅ Updated canonical-map.json');
}

main().catch(console.error);