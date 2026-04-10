import * as fs from 'node:fs';
import { NotionAPI } from 'notion-client';
import * as dotenv from 'dotenv';
dotenv.config();

const notion = new NotionAPI({
  authToken: process.env.NOTION_TOKEN,
  activeUser: process.env.NOTION_ACTIVE_USER,
});

function fixDoubleNesting(obj: any) {
  if (!obj) return;
  for (const key in obj) {
    const item = obj[key];
    if (!item || !item.value) continue;
    const innerValue = (item.value as any).value;
    if (innerValue) {
      item.value = innerValue;
    }
  }
}

async function main() {
  const recordMap = await notion.getPage('1ac3b07c81ff80d184a1f564abe7fef3');
  
  fixDoubleNesting(recordMap.block);
  fixDoubleNesting(recordMap.collection);
  fixDoubleNesting(recordMap.collection_view);

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
            console.log(`Fetching collection data for ${collectionId} / ${viewId}`);
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
            console.log(`Saved blockIds:`, queryData[collectionId][viewId].blockIds);
          } catch (err: any) {
            console.error(`Failed to fetch collection data manually for view ${viewId}:`, err.message);
          }
        }
      }
    }
  }

  console.log('Final collection_query keys:', Object.keys(recordMap.collection_query || {}));
}

main().catch(console.error);
