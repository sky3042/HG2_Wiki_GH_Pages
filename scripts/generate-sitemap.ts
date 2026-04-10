import * as fs from 'node:fs';
import * as path from 'node:path';

import { getSiteMap } from '../lib/get-site-map';

async function main() {
  console.log('🗺️ Generating sitemap cache...');
  
  const cachePath = path.join(process.cwd(), 'canonical-map.json');
  
  // ★重要：古いキャッシュがあれば削除して、強制的に再生成させる
  if (fs.existsSync(cachePath)) {
    console.log('   (Deleting old cache to force regeneration)');
    fs.unlinkSync(cachePath);
  }

  // サイトマップを作成（この時点で古いファイルが無いので、必ずロジックが走る）
  const siteMap = await getSiteMap();
  
  // 新しい結果を保存
  fs.writeFileSync(cachePath, JSON.stringify(siteMap.canonicalPageMap, null, 2));
  
  console.log(`✅ Saved ${Object.keys(siteMap.canonicalPageMap).length} routes to canonical-map.json`);
}

main();