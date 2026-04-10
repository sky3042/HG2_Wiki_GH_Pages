import { parsePageId } from 'notion-utils'

const URLs = [
  'カリスマ-サンダーランド-1bc3b07c81ff80f9a1bce3057aa85bc0',
  'charisma-thunderland-1bc3b07c81ff80f9a1bce3057aa85bc0',
  '1bc3b07c81ff80f9a1bce3057aa85bc0',
  '/カリスマ-サンダーランド-1bc3b07c81ff80f9a1bce3057aa85bc0'
]

URLs.forEach(url => {
  const decoded = decodeURIComponent(url)
  const id = parsePageId(decoded, { uuid: false })
  console.log(`URL: ${url}`)
  console.log(`Decoded: ${decoded}`)
  console.log(`Parsed ID: ${id}`)
  console.log('---')
})
