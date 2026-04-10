import { resolveNotionPage } from './lib/resolve-notion-page.js'

const domain = 'houkai-gakuen-wiki.com'
const rawPageId = '%E3%82%AB%E3%83%AA%E3%82%B9%E3%83%9E-%E3%82%B5%E3%83%B3%E3%83%80%E3%83%BC%E3%83%A9%E3%83%B3%E3%83%89-1bc3b07c81ff80f9a1bce3057aa85bc0'

async function test() {
  const decoded = decodeURIComponent(rawPageId)
  console.log('Testing decoded:', decoded)
  
  try {
    const result = await resolveNotionPage(domain, decoded)
    console.log('Result PageID:', result.pageId)
    if (result.error) {
      console.error('Error:', result.error)
    } else {
      console.log('SUCCESS: Page resolved')
    }
  } catch (err) {
    console.error('CRASH:', err)
  }
}

test()
