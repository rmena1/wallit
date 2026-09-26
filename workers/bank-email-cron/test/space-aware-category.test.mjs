import { test, describe, mock } from 'node:test';
import assert from 'node:assert';

describe('Space-aware category selection', () => {
  test('Personal account receives Personal category', async () => {
    const originalFetch = globalThis.fetch;
    
    try {
      globalThis.fetch = mock.fn(async (url, options) => {
        if (url.includes('/v1/systemone')) {
          return {
            ok: true,
            json: async () => ({
              answers: {
                category: {
                  choice: 'l1exaaayy8ilffwd7mrfb',
                  confidence: 0.90,
                },
              },
            }),
          };
        }
        throw new Error(`Unexpected fetch to ${url}`);
      });

      const { chooseCategory } = await import('../src/lib/classifier.mjs');
      
      const personalAccountId = 'iutwwtj7xqn3iyii5h4c6';
      
      const categoryId = await chooseCategory(
        {
          subject: 'Compra en supermercado',
          from: 'test@example.com',
          textBody: 'Compra en Líder',
        },
        'Líder',
        personalAccountId
      );

      assert.strictEqual(categoryId, 'l1exaaayy8ilffwd7mrfb', 'Should return Personal category for Personal account');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('Casa account receives Casa category', async () => {
    const originalFetch = globalThis.fetch;
    
    try {
      globalThis.fetch = mock.fn(async (url, options) => {
        if (url.includes('/v1/systemone')) {
          return {
            ok: true,
            json: async () => ({
              answers: {
                category: {
                  choice: '9m35h226dm0g1yjgq6u4h',
                  confidence: 0.90,
                },
              },
            }),
          };
        }
        throw new Error(`Unexpected fetch to ${url}`);
      });

      const { chooseCategory } = await import('../src/lib/classifier.mjs');
      
      const casaAccountId = 'nxk4kf3fka5r8a3ozqtks';
      
      const categoryId = await chooseCategory(
        {
          subject: 'Compra en supermercado',
          from: 'test@example.com',
          textBody: 'Compra en Jumbo',
        },
        'Jumbo',
        casaAccountId
      );

      assert.strictEqual(categoryId, '9m35h226dm0g1yjgq6u4h', 'Should return Casa category for Casa account');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('Cross-space category mismatch returns null', async () => {
    const originalFetch = globalThis.fetch;
    
    try {
      globalThis.fetch = mock.fn(async (url, options) => {
        if (url.includes('/v1/systemone')) {
          return {
            ok: true,
            json: async () => ({
              answers: {
                category: {
                  choice: 'l1exaaayy8ilffwd7mrfb',
                  confidence: 0.90,
                },
              },
            }),
          };
        }
        throw new Error(`Unexpected fetch to ${url}`);
      });

      const { chooseCategory } = await import('../src/lib/classifier.mjs');
      
      const casaAccountId = 'nxk4kf3fka5r8a3ozqtks';
      
      const categoryId = await chooseCategory(
        {
          subject: 'Compra en supermercado',
          from: 'test@example.com',
          textBody: 'Compra en Líder',
        },
        'Líder',
        casaAccountId
      );

      assert.strictEqual(categoryId, null, 'Should return null when category space does not match account space');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('Null category is allowed regardless of space', async () => {
    const originalFetch = globalThis.fetch;
    
    try {
      globalThis.fetch = mock.fn(async (url, options) => {
        if (url.includes('/v1/systemone')) {
          return {
            ok: true,
            json: async () => ({
              answers: {
                category: {
                  choice: '__skip__',
                  confidence: 0.95,
                },
              },
            }),
          };
        }
        throw new Error(`Unexpected fetch to ${url}`);
      });

      const { chooseCategory } = await import('../src/lib/classifier.mjs');
      
      const casaAccountId = 'nxk4kf3fka5r8a3ozqtks';
      
      const categoryId = await chooseCategory(
        {
          subject: 'Unknown merchant',
          from: 'test@example.com',
          textBody: 'ONEPAY payment',
        },
        'ONEPAY',
        casaAccountId
      );

      assert.strictEqual(categoryId, null, 'Should return null for __skip__ choice');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('Casa account uses Casa prompt with correct criteria', async () => {
    const originalFetch = globalThis.fetch;
    let capturedRequest = null;
    
    try {
      globalThis.fetch = mock.fn(async (url, options) => {
        if (url.includes('/v1/systemone')) {
          capturedRequest = JSON.parse(options.body);
          return {
            ok: true,
            json: async () => ({
              answers: {
                category: {
                  choice: '9m35h226dm0g1yjgq6u4h',
                  confidence: 0.90,
                },
              },
            }),
          };
        }
        throw new Error(`Unexpected fetch to ${url}`);
      });

      const { chooseCategory } = await import('../src/lib/classifier.mjs');
      
      const casaAccountId = 'nxk4kf3fka5r8a3ozqtks';
      
      await chooseCategory(
        {
          subject: 'Test',
          from: 'test@example.com',
          textBody: 'Test',
        },
        'Test',
        casaAccountId
      );

      assert.ok(capturedRequest, 'Should have captured request');
      assert.ok(capturedRequest.questions.category.criteria, 'Should have criteria');
      assert.ok(
        capturedRequest.questions.category.criteria['9m35h226dm0g1yjgq6u4h'],
        'Casa prompt should include Casa Supermercado category'
      );
      assert.strictEqual(
        capturedRequest.questions.category.criteria['l1exaaayy8ilffwd7mrfb'],
        undefined,
        'Casa prompt should NOT include Personal Supermercado category'
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('Personal account uses Personal prompt with correct criteria', async () => {
    const originalFetch = globalThis.fetch;
    let capturedRequest = null;
    
    try {
      globalThis.fetch = mock.fn(async (url, options) => {
        if (url.includes('/v1/systemone')) {
          capturedRequest = JSON.parse(options.body);
          return {
            ok: true,
            json: async () => ({
              answers: {
                category: {
                  choice: 'l1exaaayy8ilffwd7mrfb',
                  confidence: 0.90,
                },
              },
            }),
          };
        }
        throw new Error(`Unexpected fetch to ${url}`);
      });

      const { chooseCategory } = await import('../src/lib/classifier.mjs');
      
      const personalAccountId = 'iutwwtj7xqn3iyii5h4c6';
      
      await chooseCategory(
        {
          subject: 'Test',
          from: 'test@example.com',
          textBody: 'Test',
        },
        'Test',
        personalAccountId
      );

      assert.ok(capturedRequest, 'Should have captured request');
      assert.ok(capturedRequest.questions.category.criteria, 'Should have criteria');
      assert.ok(
        capturedRequest.questions.category.criteria['l1exaaayy8ilffwd7mrfb'],
        'Personal prompt should include Personal Supermercado category'
      );
      assert.strictEqual(
        capturedRequest.questions.category.criteria['9m35h226dm0g1yjgq6u4h'],
        undefined,
        'Personal prompt should NOT include Casa Supermercado category'
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('Low confidence returns null regardless of space match', async () => {
    const originalFetch = globalThis.fetch;
    
    try {
      globalThis.fetch = mock.fn(async (url, options) => {
        if (url.includes('/v1/systemone')) {
          return {
            ok: true,
            json: async () => ({
              answers: {
                category: {
                  choice: 'l1exaaayy8ilffwd7mrfb',
                  confidence: 0.50,
                },
              },
            }),
          };
        }
        throw new Error(`Unexpected fetch to ${url}`);
      });

      const { chooseCategory } = await import('../src/lib/classifier.mjs');
      
      const personalAccountId = 'iutwwtj7xqn3iyii5h4c6';
      
      const categoryId = await chooseCategory(
        {
          subject: 'Test',
          from: 'test@example.com',
          textBody: 'Test',
        },
        'Test',
        personalAccountId
      );

      assert.strictEqual(categoryId, null, 'Should return null for low confidence');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('Space mappings', () => {
  test('getAccountSpace returns correct space for Personal account', async () => {
    const { getAccountSpace } = await import('../src/data/space-mappings.mjs');
    
    const space = getAccountSpace('iutwwtj7xqn3iyii5h4c6');
    assert.strictEqual(space, 'personal_a12e6f85fccd3cd8f7b385577c952ba0');
  });

  test('getAccountSpace returns correct space for Casa account', async () => {
    const { getAccountSpace } = await import('../src/data/space-mappings.mjs');
    
    const space = getAccountSpace('nxk4kf3fka5r8a3ozqtks');
    assert.strictEqual(space, 'ms2yt6sp7kwmn11qrupu3');
  });

  test('getCategorySpace returns correct space for Personal category', async () => {
    const { getCategorySpace } = await import('../src/data/space-mappings.mjs');
    
    const space = getCategorySpace('l1exaaayy8ilffwd7mrfb');
    assert.strictEqual(space, 'personal_a12e6f85fccd3cd8f7b385577c952ba0');
  });

  test('getCategorySpace returns correct space for Casa category', async () => {
    const { getCategorySpace } = await import('../src/data/space-mappings.mjs');
    
    const space = getCategorySpace('9m35h226dm0g1yjgq6u4h');
    assert.strictEqual(space, 'ms2yt6sp7kwmn11qrupu3');
  });

  test('isCategoryInAccountSpace returns true for matching spaces', async () => {
    const { isCategoryInAccountSpace } = await import('../src/data/space-mappings.mjs');
    
    const matches = isCategoryInAccountSpace('l1exaaayy8ilffwd7mrfb', 'iutwwtj7xqn3iyii5h4c6');
    assert.strictEqual(matches, true);
  });

  test('isCategoryInAccountSpace returns false for mismatched spaces', async () => {
    const { isCategoryInAccountSpace } = await import('../src/data/space-mappings.mjs');
    
    const matches = isCategoryInAccountSpace('l1exaaayy8ilffwd7mrfb', 'nxk4kf3fka5r8a3ozqtks');
    assert.strictEqual(matches, false);
  });

  test('isCategoryInAccountSpace returns true for null category', async () => {
    const { isCategoryInAccountSpace } = await import('../src/data/space-mappings.mjs');
    
    const matches = isCategoryInAccountSpace(null, 'nxk4kf3fka5r8a3ozqtks');
    assert.strictEqual(matches, true);
  });

  test('getAccountSpace returns null for unknown account', async () => {
    const { getAccountSpace } = await import('../src/data/space-mappings.mjs');
    
    const space = getAccountSpace('unknown_account_id');
    assert.strictEqual(space, null);
  });

  test('getCategorySpace returns null for unknown category', async () => {
    const { getCategorySpace } = await import('../src/data/space-mappings.mjs');
    
    const space = getCategorySpace('unknown_category_id');
    assert.strictEqual(space, null);
  });
});

describe('Import payload with defensive validation', () => {
  test('buildImportPayload preserves valid category', async () => {
    const { buildImportPayload } = await import('../src/lib/import-client.mjs');
    
    const parsed = {
      accountId: 'iutwwtj7xqn3iyii5h4c6',
      name: 'Test Transaction',
      originalName: 'Test Original',
      date: '2026-09-25',
      type: 'expense',
      currency: 'CLP',
      amount: 5000,
      provider: 'bci',
    };
    
    const payload = buildImportPayload(parsed, 'l1exaaayy8ilffwd7mrfb', 'test-email-id');
    
    assert.strictEqual(payload.categoryId, 'l1exaaayy8ilffwd7mrfb');
  });

  test('buildImportPayload allows null category', async () => {
    const { buildImportPayload } = await import('../src/lib/import-client.mjs');
    
    const parsed = {
      accountId: 'nxk4kf3fka5r8a3ozqtks',
      name: 'Test Transaction',
      originalName: 'Test Original',
      date: '2026-09-25',
      type: 'expense',
      currency: 'CLP',
      amount: 5000,
      provider: 'tenpo',
    };
    
    const payload = buildImportPayload(parsed, null, 'test-email-id');
    
    assert.strictEqual(payload.categoryId, null);
  });
});
