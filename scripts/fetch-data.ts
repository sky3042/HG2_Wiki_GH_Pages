import * as fs from 'node:fs';
import * as path from 'node:path';

import type { ExtendedRecordMap } from 'notion-types';
import * as dotenv from 'dotenv';
import { NotionAPI } from 'notion-client';
import { getAllPagesInSpace, getBlockTitle } from 'notion-utils';

// 環境変数をロード
dotenv.config();

const notion = new NotionAPI({
  authToken: process.env.NOTION_TOKEN,
  activeUser: process.env.NOTION_ACTIVE_USER,
});

// あなたの本番ルートページID
const ROOT_PAGE_ID = '1ac3b07c81ff80d184a1f564abe7fef3'; 

const DATA_DIR = path.join(process.cwd(), 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ▼▼▼ 二重ラップ修正用の共通関数 ▼▼▼
function fixDoubleNesting(obj: any) {
  if (!obj) return;
  for (const key in obj) {
    const item = obj[key];
    if (!item || !item.value) continue;

    // value.value が存在する場合、それを本来の value に引き上げる
    const innerValue = (item.value as any).value;
    if (innerValue) {
      // console.log(`   🔧 Fixing double nesting for key: ${key}`);
      item.value = innerValue;
    }
  }
}
// ▲▲▲ ここまで ▲▲▲

// ▼▼▼ データを軽量化するための関数 ▼▼▼
function pruneRecordMap(data: ExtendedRecordMap): any {
  const pruneBlock = (block: any) => {
    if (!block || !block.value) return block;
    const v = block.value;

    // ★ ギャラリービューの位置調整を反映させるための処理 ★
    // NotionのAPIから取得されるデータでは、ギャラリービュー上での画像位置調整は 'card_cover_position' に入るが、
    // レンダラー（react-notion-x）側が 'page_cover_position' のみを参照しているケースがあるため、同期させる。
    const format = v.format ? { ...v.format } : undefined;
    if (format && format.card_cover_position !== undefined) {
      format.page_cover_position = format.card_cover_position;
    }

    return {
      value: {
        id: v.id,
        type: v.type,
        properties: v.properties,
        format,
        content: v.content,
        parent_id: v.parent_id,
        parent_table: v.parent_table,
        collection_id: v.collection_id,
        view_ids: v.view_ids,
        created_time: v.created_time,
        last_edited_time: v.last_edited_time
      }
    };
  };

  const pruned: any = {
    block: {},
    collection: data.collection,
    collection_view: data.collection_view,
    collection_query: data.collection_query
  };

  if (data.block) {
    for (const id in data.block) {
      pruned.block[id] = pruneBlock(data.block[id]);
    }
  }

  return pruned;
}
// ▲▲▲ ここまで ▲▲▲

async function main() {
  const isForce = process.argv.includes('--force');
  console.log(`🚀 Notionデータの増分更新（タイムスタンプ比較）を開始します...${isForce ? ' (強制再取得モード: --force)' : ''}`);
  
  const updatedPages: string[] = [];
  const newPages: string[] = [];
  const skippedPages: string[] = [];

  const localFiles = new Set<string>();
  if (fs.existsSync(DATA_DIR)) {
    const files = fs.readdirSync(DATA_DIR);
    for (const file of files) {
      if (file.endsWith('.json')) {
        localFiles.add(file.replace('.json', ''));
      }
    }
  }

  await getAllPagesInSpace(
    ROOT_PAGE_ID,
    undefined,
    async (pageId: string) => {
      const cleanId = pageId.replaceAll('-', '');
      const filePath = path.join(DATA_DIR, `${cleanId}.json`);

      try {
        const recordMap = await notion.getPage(pageId);

        // ▼▼▼ 修正適用：block だけでなく collection 等も直す ▼▼▼
        fixDoubleNesting(recordMap.block);
        fixDoubleNesting(recordMap.collection);
        fixDoubleNesting(recordMap.collection_view);
        // ▲▲▲ 修正ここまで ▲▲▲

        // ▼▼▼ ギャラリー等のコレクションデータが欠落している場合に対応する処理 ▼▼▼
        if (!recordMap.collection_query || Object.keys(recordMap.collection_query).length === 0) {
          if (recordMap.collection_view) {
            for (const viewId of Object.keys(recordMap.collection_view)) {
              const view = recordMap.collection_view[viewId]?.value;
              let collectionId = (view as any)?.collection_id;
              if (!collectionId && (view as any)?.format?.collection_pointer?.id) {
                collectionId = (view as any).format.collection_pointer.id;
              }
              if (collectionId) {
                try {
                  const collectionData = await notion.getCollectionData(
                    collectionId,
                    viewId,
                    view
                  );
                  if (collectionData.recordMap?.block) {
                    fixDoubleNesting(collectionData.recordMap.block);
                    for (const blockId of Object.keys(collectionData.recordMap.block)) {
                      const newBlock = collectionData.recordMap.block[blockId];
                      if (newBlock?.value?.id && !recordMap.block[blockId]) {
                        recordMap.block[blockId] = newBlock;
                      }
                    }
                  }
                  if (!recordMap.collection_query) recordMap.collection_query = {} as any;
                  const queryData = recordMap.collection_query as any;
                  if (!queryData[collectionId]) queryData[collectionId] = {};
                  
                  queryData[collectionId][viewId] = {
                    collection_group_results: (collectionData.result as any)?.reducerResults?.collection_group_results || collectionData.result,
                    blockIds: collectionData.result?.blockIds || (collectionData.result as any)?.reducerResults?.collection_group_results?.blockIds || [],
                  } as any;
                } catch (err: any) {
                  console.warn(`Failed to fetch collection data manually for view ${viewId}:`, err.message);
                }
              }
            }
          }
        }
        // ▲▲▲ ここまで ▲▲▲
        
        const block = recordMap.block[pageId]?.value;
        const title = block 
          ? (getBlockTitle(block, recordMap) || 'Untitled') 
          : 'Unknown Page';

        // A. 新規ページ
        if (!localFiles.has(cleanId)) {
            console.log(`✨ New: "${title}"`);
            const prunedRecordMap = pruneRecordMap(recordMap);
            fs.writeFileSync(filePath, JSON.stringify(prunedRecordMap));
            newPages.push(title);
            await sleep(300);
            return recordMap;
        }

        // B. 既存ページ（タイムスタンプ比較）
        if (!isForce && fs.existsSync(filePath)) {
            const oldData = fs.readFileSync(filePath, 'utf8');
            const oldRecordMap = JSON.parse(oldData) as ExtendedRecordMap;
            const oldBlock = oldRecordMap.block[pageId]?.value;
            
            const oldTime = oldBlock?.last_edited_time || 0;
            const newTime = block?.last_edited_time || 0;

            if (oldTime === newTime) {
                skippedPages.push(title);
                return recordMap; 
            }
        }

        // C. 更新あり
        console.log(`🔄 Updated: "${title}"`);
        const prunedRecordMap = pruneRecordMap(recordMap);
        fs.writeFileSync(filePath, JSON.stringify(prunedRecordMap, null, 2));
        updatedPages.push(title);
        
        await sleep(300); 
        return recordMap;

      } catch (err: any) {
        console.error(`❌ Error fetching ${cleanId}:`, err.message);
        if (localFiles.has(cleanId)) {
            const data = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(data) as ExtendedRecordMap;
        }
        throw err;
      }
    },
    {
      concurrency: 1,
      traverseCollections: true,
    }
  );

  console.log('\n' + '='.repeat(40));
  console.log('🎉 処理完了');
  console.log(`新規: ${newPages.length} / 更新: ${updatedPages.length} / 変化なし: ${skippedPages.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});