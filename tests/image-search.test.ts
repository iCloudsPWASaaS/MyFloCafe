/**
 * Integration Test: Google Images lookup via SerpAPI (product image search)
 *
 * Covers the backend half of the "Search online" product image feature:
 *   - Degrades to an empty list when SERPAPI_KEY is not configured (offline-first).
 *   - Errors do not propagate — a failed upstream call returns an empty list.
 *   - Results are normalized and SerpAPI responses without a full image are dropped.
 *   - The route requires owner/manager auth and a non-empty query.
 *
 * SerpAPI is stubbed via global fetch so the suite never makes a network call.
 *
 * Usage: node tests/run-electron-node-test.cjs tests/image-search.test.ts
 */

const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-image-search-'));
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' } };
  return originalLoad.apply(this, arguments as any);
};

process.env.JWT_SECRET = 'test-secret-image-search';
delete process.env.SERPAPI_KEY;

const {
  initTestDb, createApp, startServer,
  seedOwnerUser, api, assertEqual, closeDatabase,
} = require('./helpers/test-setup');

const { productRoutes, searchSerpApiImages } = require('../main/routes/products');

async function main() {
  console.log('Integration Test: SerpAPI product image search');
  console.log('='.repeat(60));

  const db = initTestDb();
  const { authHeader } = seedOwnerUser(db);
  const app = createApp({ '/api/products': productRoutes });
  const { baseUrl, server } = await startServer(app);

  try {
    console.log('\n─── Scenario A: unconfigured key returns empty list ───');
    {
      const rows = await searchSerpApiImages('Cola original');
      assertEqual(rows.length, 0, 'A1: no SERPAPI_KEY → empty results');
    }

    console.log('\n─── Scenario B: route requires authentication ───');
    {
      const res = await api(baseUrl, '/api/products/image-search?q=cola', {});
      assertEqual(res.status, 401, 'B1: anonymous request rejected');
    }

    console.log('\n─── Scenario C: empty query rejected ───');
    {
      const res = await api(baseUrl, '/api/products/image-search?q=%20', { headers: authHeader });
      assertEqual(res.status, 400, 'C1: blank query → 400');
    }

    console.log('\n─── Scenario D: stubbed SerpAPI maps + filters results ───');
    process.env.SERPAPI_KEY = 'test-serpapi-key';
    const realFetch = globalThis.fetch as any;
    let calls = 0;
    globalThis.fetch = async (input: any, init?: any) => {
      const url = String(input);
      if (!url.startsWith('https://serpapi.com/search.json?engine=google_images&q=')) {
        return realFetch(input, init);
      }
      calls++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          images_results: [
            { title: 'Cola Can', thumbnail: 'https://thumb/1.jpg', original: 'https://full/1.jpg', original_width: 1200, original_height: 800, link: 'https://example.com/cola' },
            { title: 'Broken Result', thumbnail: null, original: null },
          ],
        }),
      } as any;
    };
    try {
      const rows = await searchSerpApiImages('Cola original');
      assertEqual(calls, 1, 'D1: one upstream call');
      assertEqual(rows.length, 1, 'D2: drops results without a full image');
      assertEqual(rows[0].source, 'serpapi', 'D3: source tag present');
      assertEqual(rows[0].title, 'Cola Can', 'D4: title mapped');
      assertEqual(rows[0].full, 'https://full/1.jpg', 'D5: full URL mapped');
      assertEqual(rows[0].width, 1200, 'D6: width mapped');
      assertEqual(rows[0].height, 800, 'D7: height mapped');
      assertEqual(rows[0].context_url, 'https://example.com/cola', 'D8: context link mapped');

      calls = 0;
      const res = await api(baseUrl, '/api/products/image-search?q=cola', { headers: authHeader });
      assertEqual(res.status, 200, 'D9: route returns 200');
      assertEqual(res.data.results.length, 1, 'D10: route returns normalized results');
      assertEqual(res.data.results[0].full, 'https://full/1.jpg', 'D11: route result carries full image');
    } finally {
      globalThis.fetch = realFetch;
    }

    console.log('\n─── Scenario E: upstream failure returns empty list ───');
    {
      const failingFetch = async () => {
        throw new Error('network down');
      };
      globalThis.fetch = failingFetch as any;
      try {
        const rows = await searchSerpApiImages('Cola original');
        assertEqual(rows.length, 0, 'E1: upstream error → empty results');
      } finally {
        globalThis.fetch = realFetch;
      }
    }

    console.log('\n✅ All image-search integration checks passed.');
  } finally {
    delete process.env.SERPAPI_KEY;
    server.close();
    closeDatabase();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});