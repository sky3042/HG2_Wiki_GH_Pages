import { getSiteMap } from './lib/get-site-map.js'
import { parsePageId } from 'notion-utils'

async function debug() {
  console.log('--- getSiteMap Debug ---')
  const siteMap = await getSiteMap()
  const map = siteMap.canonicalPageMap
  console.log('Total entries in map:', Object.keys(map).length)
  
  const targetId = '1bc3b07c81ff80f9a1bce3057aa85bc0'
  const targetSlug = 'charisma-thunderland'
  
  console.log(`Checking for slug [${targetSlug}]:`, map[targetSlug])
  
  console.log('Searching for ID:', targetId)
  const matches = Object.keys(map).filter(slug => {
    const id = map[slug]
    return id === targetId || parsePageId(id, { uuid: false }) === targetId
  })
  
  console.log('Matches found:', matches)
  
  if (matches.length > 0) {
    console.log('SUCCESS: ID found in map')
  } else {
    console.error('FAILURE: ID not found in map')
  }
}

debug().catch(console.error)
