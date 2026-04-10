import { type ExtendedRecordMap } from 'notion-types'
import { parsePageId } from 'notion-utils'

import type { PageProps } from './types'
import * as acl from './acl'
import { environment, pageUrlAdditions, pageUrlOverrides, site } from './config'
import { db } from './db'
import { getSiteMap } from './get-site-map' // 追加
import { getPage } from './notion'

export async function resolveNotionPage(
  domain: string,
  rawPageId?: string
): Promise<PageProps> {
  let pageId: string | undefined
  let recordMap: ExtendedRecordMap

  if (rawPageId && rawPageId !== 'index') {
    // 1. URLにNotion IDが含まれているかチェック (Title-ID パターンなど)
    pageId = parsePageId(rawPageId, { uuid: false })

    // 2. 固定のオーバーライド設定をチェック
    if (!pageId) {
      const override =
        pageUrlOverrides[rawPageId] || pageUrlAdditions[rawPageId]

      if (override) {
        pageId = parsePageId(override, { uuid: false })
      }
    }

    // 3. サイトマップ（別名マップ）から検索
    if (!pageId) {
      const siteMap = await getSiteMap()
      pageId = siteMap?.canonicalPageMap?.[rawPageId]
    }

    if (pageId) {
      console.log(`[resolveNotionPage] resolving "${rawPageId}" -> "${pageId}"`)
      recordMap = await getPage(pageId)
    } else {
      console.error(`[resolveNotionPage] pageId not found for "${rawPageId}"`)
      return {
        error: {
          message: `Not found "${rawPageId}"`,
          statusCode: 404
        }
      }
    }
  } else {
    pageId = site.rootNotionPageId
    recordMap = await getPage(pageId)
  }

  // ★サイトマップを取得してPropsに含める
  const siteMap = await getSiteMap()

  const props: PageProps = {
    site,
    recordMap,
    pageId,
    canonicalPageMap: siteMap?.canonicalPageMap
  }
  return { ...props, ...(await acl.pageAcl(props)) }
}