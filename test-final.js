import { getStaticProps } from './pages/_pageId.tsx.bak'

async function runTest() {
  const context = {
    params: {
      pageId: '%E3%82%AB%E3%83%AA%E3%82%B9%E3%83%9E-%E3%82%B5%E3%83%B3%E3%83%80%E3%83%BC%E3%83%A9%E3%83%B3%E3%83%89-1bc3b07c81ff80f9a1bce3057aa85bc0'
    }
  }

  console.log('--- Testing getStaticProps ---')
  try {
    const result = await getStaticProps(context)
    console.log('Result:', JSON.stringify(result, null, 2))
    
    if (result.redirect) {
      console.log('SUCCESS: Redirect returned')
      if (result.redirect.destination.includes('charisma-thunderland')) {
        console.log('SUCCESS: Correct destination')
      } else {
        console.error('FAILURE: Incorrect destination')
      }
    } else {
      console.error('FAILURE: No redirect returned')
    }
  } catch (err) {
    console.error('CRASH in getStaticProps:', err)
  }
}

runTest().catch(console.error)
