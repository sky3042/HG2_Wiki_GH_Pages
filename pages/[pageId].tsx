import { type GetStaticProps } from 'next'
import { URLSearchParams } from 'url'
import { parsePageId } from 'notion-utils'

import { NotionPage } from '@/components/NotionPage'
import { domain, isDev, rootNotionPageId, site } from '@/lib/config'
import { getSiteMap } from '@/lib/get-site-map'
import { mapPageUrl } from '@/lib/map-page-url'
import { resolveNotionPage } from '@/lib/resolve-notion-page'
import { type PageProps, type Params } from '@/lib/types'

export const getStaticProps: GetStaticProps<PageProps, Params> = async (
  context
) => {
  const rawPageId = context.params?.pageId as string
  console.log(`[getStaticProps] starting for ${rawPageId}`)

  try {
    // URLデコード（日本語パスなど）を行って比較に備える
    const decodedPageId = decodeURIComponent(rawPageId)

    // ── Step 0: 初期リダイレクトチェック (IDが含まれている場合) ──
    // resolveNotionPage を呼ぶ前に、IDのみで正規URLを特定できればリダイレクト
    // これにより、dataディレクトリが参照できない環境でもIDベースの転送が動作します
    const extractedId = parsePageId(decodedPageId, { uuid: false })
    if (extractedId) {
      const siteMap = await getSiteMap()
      const canonicalPageMap = siteMap?.canonicalPageMap ?? {}

      // IDから正規のパスを逆引き
      const canonicalPath = Object.keys(canonicalPageMap).find(
        (url) => {
          const idInMap = canonicalPageMap[url]
          return idInMap && (idInMap === extractedId || parsePageId(idInMap, { uuid: false }) === extractedId)
        }
      )

      /* 
      if (canonicalPath && canonicalPath !== decodedPageId) {
        console.log(
          `[getStaticProps] early redirect: /${decodedPageId} -> /${canonicalPath}`
        )
        return {
          redirect: {
            destination: `/${encodeURIComponent(canonicalPath)}`,
            permanent: true
          }
        }
      }
      */
    }

    // ── Step 1: ページ解決 ──
    const props = await resolveNotionPage(domain, decodedPageId || '')

    // ── Step 2: 正規URLへのリダイレクト判定 ──
    // resolveNotionPage が成功し、recordMap が取得できた場合
    if (!props.error && props.pageId && props.recordMap) {
      const canonicalUrl = mapPageUrl(
        site,
        props.recordMap,
        new URLSearchParams(),
        props.canonicalPageMap
      )(props.pageId)

      // /slug 形式から先頭の / を除去
      let canonicalPath = canonicalUrl.startsWith('/')
        ? canonicalUrl.slice(1)
        : canonicalUrl
      
      // クエリパラメータが含まれている場合（?lite=trueなど）はパスのみ抽出
      canonicalPath = canonicalPath.split('?')[0]!
      // 念のためデコードして比較
      const decodedCanonicalPath = decodeURIComponent(canonicalPath)

      /* 
      if (decodedCanonicalPath !== decodedPageId) {
        console.log(
          `[getStaticProps] redirecting: /${decodedPageId} -> /${decodedCanonicalPath}`
        )
        return {
          redirect: {
            destination: `/${canonicalPath}`, // パスはエンコードされたまま使用
            permanent: true
          }
        }
      }
      */
    }

    return { props }
  } catch (err: any) {
    console.error(`[getStaticProps] error for ${rawPageId}:`, err.message)
    throw err
  }
}


export async function getStaticPaths() {
  if (isDev) {
    return {
      paths: [],
      fallback: false
    }
  }

  const siteMap = await getSiteMap()

  const staticPaths = {
    paths: Object.keys(siteMap.canonicalPageMap)
      .filter((pageId) => siteMap.canonicalPageMap[pageId] !== rootNotionPageId)
      .map((pageId) => ({
        params: {
          pageId
        }
      })),
    fallback: false
  }

  return staticPaths
}

export default function NotionDomainDynamicPage(props: PageProps) {
  return <NotionPage {...props} />
}
