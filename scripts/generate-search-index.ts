import * as fs from 'node:fs'
import * as path from 'node:path'
import { getBlockTitle } from 'notion-utils'

const DATA_DIR = path.join(process.cwd(), 'data')
const OUT_FILE = path.join(process.cwd(), 'public', 'search-index.json')

async function main() {
  console.log('🔍 Generating search index...')
  
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json') && f !== 'spreadsheet.json')
  const index = []

  for (const file of files) {
    const filePath = path.join(DATA_DIR, file)
    try {
      const recordMap = JSON.parse(fs.readFileSync(filePath, 'utf8')) as any
      const pageIds = Object.keys(recordMap.block || {})
      const pageId = pageIds[0]
      const block = recordMap.block[pageId!]?.value

      if (block && block.type === 'page') {
        const title = getBlockTitle(block, recordMap)
        const slug = block.format?.slug

        if (title) {
          index.push({
            id: pageId,
            title,
            slug: slug || pageId.replaceAll('-', '')
          })
        }
      }
    } catch (err) {
      console.warn(`Failed to parse ${file}:`, err.message)
    }
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(index, null, 2))
  console.log(`✅ Search index generated with ${index.length} pages.`)
}

main().catch(console.error)
