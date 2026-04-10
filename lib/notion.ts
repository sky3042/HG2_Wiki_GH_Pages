import * as fs from 'node:fs'
import * as path from 'node:path'

import {
  type ExtendedRecordMap,
  type SearchParams,
  type SearchResults
} from 'notion-types'
import { mergeRecordMaps } from 'notion-utils'
import pMap from 'p-map'
import pMemoize from 'p-memoize'

import {
  isPreviewImageSupportEnabled,
  navigationLinks,
  navigationStyle
} from './config'
import { getTweetsMap } from './get-tweets'
import { notion } from './notion-api'
import { getPreviewImageMap } from './preview-images'

console.log('[lib/notion.ts] loading...')

// ▼▼▼ 二重ラップ修正用の共通関数 ▼▼▼
function fixDoubleNesting(obj: any) {
  if (!obj) return;
  for (const key in obj) {
    const item = obj[key];
    if (!item || !item.value) continue;

    // value.value が存在する場合、それを本来の value に引き上げる
    const innerValue = (item.value as any).value;
    if (innerValue) {
      item.value = innerValue;
    }
  }
}
// ▲▲▲ ここまで ▲▲▲

async function fetchPageData(pageId: string): Promise<ExtendedRecordMap> {
  if (!pageId) {
    console.warn('[notion] fetchPageData received undefined/null pageId');
    return null as any;
  }
  const cleanId = pageId.replaceAll('-', '')
  const cachePath = path.join(process.cwd(), 'data', `${cleanId}.json`)

  let recordMap: ExtendedRecordMap | null = null;

  if (fs.existsSync(cachePath)) {
    try {
      const fileContent = fs.readFileSync(cachePath, 'utf8')
      recordMap = JSON.parse(fileContent) as ExtendedRecordMap
    } catch (err) {
      console.warn(`[notion] error reading local cache for ${cleanId}, falling back to API.`, err)
    }
  }

  if (!recordMap) {
    console.warn(`[notion] cache miss: fetching from API for ${pageId}`)
    recordMap = await notion.getPage(pageId)
  }

  if (recordMap) {
    // APIから直接取得したデータや古いキャッシュデータにもダブルネスト修正を適用
    fixDoubleNesting(recordMap.block)
    fixDoubleNesting(recordMap.collection)
    fixDoubleNesting(recordMap.collection_view)

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
  }

  return recordMap
}

const getNavigationLinkPages = pMemoize(
  async (): Promise<ExtendedRecordMap[]> => {
    const navigationLinkPageIds = (navigationLinks || [])
      .map((link) => link?.pageId)
      .filter(Boolean)

    if (navigationStyle !== 'default' && navigationLinkPageIds.length) {
      return pMap(
        navigationLinkPageIds,
        async (navigationLinkPageId) =>
          fetchPageData(navigationLinkPageId as string),
        {
          concurrency: 4
        }
      )
    }

    return []
  }
)



function fixGalleryViews(recordMap: ExtendedRecordMap, pageId?: string) {
  if (!recordMap.collection_view || !recordMap.block) {
    return
  }

  for (const viewId of Object.keys(recordMap.collection_view)) {
    const view = recordMap.collection_view[viewId]?.value
    if (view?.type === 'gallery') {
      const format = view?.format as any
      if (format?.gallery_cover?.type === 'page_content_first') {
        console.log(`[notion] fixing gallery view ${viewId} (page: ${pageId})`)
        format.gallery_cover.type = 'page_cover'

        const collectionViewBlock = recordMap.block[view.parent_id]?.value
        const collectionId = (collectionViewBlock as any)?.collection_id
        if (!collectionId) continue

        // Get item IDs from collection_query if available (most reliable)
        let pageIds = []
        if (recordMap.collection_query && recordMap.collection_query[collectionId]) {
          const collectionViews = recordMap.collection_query[collectionId]
          if (collectionViews[viewId]) {
            const collectionData = collectionViews[viewId]
            const ids = [
              ...((collectionData as any)?.collection_group_results?.blockIds || []),
              ...((collectionData as any)?.blockIds || [])
            ]
            pageIds = Array.from(new Set(ids))
          }
        }

        // Fallback to parent_id matching
        if (pageIds.length === 0) {
          pageIds = Object.keys(recordMap.block).filter(
            (id) => recordMap.block[id]?.value?.parent_id === collectionId
          )
        }

        for (const id of pageIds) {
          const block = recordMap.block[id]?.value
          if (block?.type === 'page' && (!block.format?.page_cover || block.format.page_cover.startsWith('attachment:'))) {
            const contentIds = block.content || []
            for (const contentId of contentIds) {
              const contentBlock = recordMap.block[contentId]?.value
              if (contentBlock?.type === 'image') {
                const source =
                  contentBlock.format?.display_source ||
                  contentBlock.properties?.source?.[0]?.[0]

                if (source) {
                  if (!block.format) {
                    block.format = {}
                  }

                  block.format.page_cover = source

                  // Signed URL handle
                  const signedUrl = recordMap.signed_urls?.[contentId]
                  if (signedUrl) {
                    if (!recordMap.signed_urls) {
                      recordMap.signed_urls = {}
                    }
                    recordMap.signed_urls[id] = signedUrl
                  }
                  break
                }
              }
            }
          }
        }
      }
    }
  }
}

export async function getPage(pageId: string): Promise<ExtendedRecordMap> {
  if (!pageId) {
    console.warn('[notion] getPage called with undefined pageId');
    return null as any;
  }
  console.log(`[getPage] starting for ${pageId}`)
  let recordMap = await fetchPageData(pageId)
  if (!recordMap) {
    console.error(`[getPage] failed to fetch recordMap for ${pageId}`);
    return null as any;
  }

  if (navigationStyle !== 'default') {
    const navigationLinkRecordMaps = await getNavigationLinkPages()

    if (navigationLinkRecordMaps?.length) {
      recordMap = navigationLinkRecordMaps
        .filter(Boolean)
        .reduce(
          (map, navigationLinkRecordMap) =>
            mergeRecordMaps(map, navigationLinkRecordMap),
          recordMap
        )
    }
  }

  if (isPreviewImageSupportEnabled) {
    const previewImageMap = await getPreviewImageMap(recordMap)
      ; (recordMap as any).preview_images = previewImageMap
  }

  await getTweetsMap(recordMap)

  fixGalleryViews(recordMap, pageId)

  return recordMap
}

export async function search(params: SearchParams): Promise<SearchResults> {
  return notion.search(params)
}