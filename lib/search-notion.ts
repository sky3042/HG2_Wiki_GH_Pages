import ExpiryMap from 'expiry-map'
import pMemoize from 'p-memoize'

import type * as types from './types'
import { api } from './config'

export const searchNotion = pMemoize(searchNotionImpl, {
  cacheKey: (args) => args[0]?.query,
  cache: new ExpiryMap(10_000)
})

async function searchNotionImpl(
  params: types.SearchParams
): Promise<types.SearchResults> {
  try {
    // GitHub Pagesなどの静的環境向けに、予め生成されたインデックスを使用して検索します
    const res = await fetch('/search-index.json')
    const index = (await res.json()) as any[]
    
    const query = params.query.toLowerCase()
    const results = index
      .filter((page) => page.title.toLowerCase().includes(query))
      .slice(0, 10) // 上位10件に制限
      .map((page) => ({
        id: page.id,
        text: page.title,
        score: 1, // ダミースコア 
        isNavigable: true,
        highlight: {
          text: page.title,
          pathText: page.title
        }
      }))

    return {
      results,
      total: results.length,
      recordMap: {
        block: Object.fromEntries(
          results.map((r) => [
            r.id,
            {
              value: {
                id: r.id,
                type: 'page',
                properties: { title: [[r.text]] }
              }
            }
          ])
        ),
        collection: {},
        collection_view: {},
        collection_query: {},
        signed_urls: {}
      } as any
    }
  } catch (err) {
    console.error('Static search error:', err)
    return {
      results: [],
      total: 0,
      recordMap: {
        block: {},
        collection: {},
        collection_view: {},
        collection_query: {},
        signed_urls: {}
      } as any
    }
  }
}
