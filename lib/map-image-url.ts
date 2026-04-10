import { type Block,type ExtendedRecordMap } from 'notion-types'
import { defaultMapImageUrl } from 'notion-utils'

import { defaultPageCover, defaultPageIcon } from './config'

export const mapImageUrl = (url: string | undefined, block: Block, recordMap?: ExtendedRecordMap) => {
  if (url === defaultPageCover || url === defaultPageIcon) {
    return url
  }

  if (recordMap?.signed_urls?.[block.id] && (url === block.format?.page_cover || url === block.format?.page_icon)) {
    return recordMap.signed_urls[block.id]
  }

  const mappedUrl = defaultMapImageUrl(url, block)
  if (mappedUrl && (mappedUrl.includes('table=undefined') || !mappedUrl.includes('table='))) {
    try {
      const u = new URL(mappedUrl)
      if (u.hostname === 'www.notion.so' && u.pathname.startsWith('/image')) {
        u.searchParams.set('table', 'block')
        return u.toString()
      }
    } catch {
      // ignore
    }
  }

  return mappedUrl
}
