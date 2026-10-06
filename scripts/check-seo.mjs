import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import { log } from 'node:console'
import { URL } from 'node:url'
import { JSDOM } from 'jsdom'

const root = new URL('../', import.meta.url)
const read = path => readFile(new URL(path, root), 'utf8')
const { homepage } = JSON.parse(await read('package.json'))
const site = new URL(homepage)
assert.equal(site.protocol, 'https:', 'The package homepage must use HTTPS.')
assert.equal(site.href, `${site.origin}/`, 'The package homepage must be the root URL.')

const dom = new JSDOM(await read('dist/index.html'))
try {
  const document = dom.window.document
  const canonical = document.querySelectorAll('head link[rel="canonical"]')
  assert.equal(canonical.length, 1, 'The built HTML must have exactly one canonical URL.')
  assert.equal(canonical[0].getAttribute('href'), homepage, 'The canonical must match the package homepage.')
  assert.equal(document.querySelector('meta[property="og:url"]')?.content, homepage, 'og:url must match the canonical.')
  assert.equal(document.documentElement.lang, 'en')
  assert.ok(document.title.includes('Meloark'), 'The document title must identify Meloark.')
  assert.ok(document.querySelector('meta[name="description"]')?.content.trim(), 'A description is required.')
  for (const meta of document.querySelectorAll('meta[name]')) {
    if (/^(robots|googlebot|bingbot)$/i.test(meta.name)) {
      assert.doesNotMatch(meta.content, /\b(noindex|nofollow|none)\b/i, 'The public app must permit indexing and following.')
    }
  }
  const schema = [...document.querySelectorAll('script[type="application/ld+json"]')].map(script => JSON.parse(script.textContent))
  const websites = schema.filter(item => item['@type'] === 'WebSite')
  assert.equal(websites.length, 1, 'Exactly one WebSite structured-data object is required.')
  assert.equal(websites[0]['@context'], 'https://schema.org')
  assert.equal(websites[0].name, 'Meloark')
  assert.equal(websites[0].url, homepage, 'Structured data must use the canonical URL.')

  for (const element of document.querySelectorAll('script[src], link[href]:not([rel="canonical"])')) {
    const path = element.getAttribute('src') ?? element.getAttribute('href')
    assert.ok(path.startsWith('/') && !path.startsWith('//'), `App resources must remain local: ${path}`)
    await access(new URL(`dist${path}`, root))
  }
  const robots = await read('dist/robots.txt')
  assert.match(robots, /^User-agent:\s*\*\s*$/m)
  assert.match(robots, /^Allow:\s*\/\s*$/m)
  assert.doesNotMatch(robots, /^Disallow:\s*\S+/im, 'The public app and its resources must remain crawlable.')
  assert.deepEqual([...robots.matchAll(/^Sitemap:\s*(\S+)\s*$/gm)].map(match => match[1]), [`${homepage}sitemap.xml`])

  const sitemap = new dom.window.DOMParser().parseFromString(await read('dist/sitemap.xml'), 'application/xml')
  assert.equal(sitemap.querySelector('parsererror'), null, 'The sitemap must be valid XML.')
  assert.equal(sitemap.documentElement.localName, 'urlset')
  assert.equal(sitemap.documentElement.namespaceURI, 'http://www.sitemaps.org/schemas/sitemap/0.9')
  assert.equal(sitemap.querySelectorAll('url').length, 1, 'Only the public homepage belongs in the sitemap.')
  assert.deepEqual([...sitemap.querySelectorAll('loc')].map(element => element.textContent.trim()), [homepage])
  assert.doesNotMatch(await read('dist/_headers'), /^\s*X-Robots-Tag:.*\b(noindex|nofollow|none)\b/im, 'Headers must not block indexing.')
  for (const file of ['robots.txt', 'sitemap.xml', '_headers']) {
    assert.equal(await read(`dist/${file}`), await read(`public/${file}`), `${file} must be copied unchanged into dist.`)
  }
  log('SEO checks passed: canonical, site metadata, crawler files, indexing permissions and local assets.')
} finally {
  dom.window.close()
}
