import { test, describe, mock } from 'node:test';
import assert from 'node:assert';

describe('Classifier Jev/TypeSafe API', () => {
  test('Jev request sends questions as dict keyed by question_id, not array', async () => {
    const originalFetch = globalThis.fetch;
    let capturedRequestBody = null;

    try {
      globalThis.fetch = mock.fn(async (url, options) => {
        if (url.includes('/v1/systemone')) {
          capturedRequestBody = JSON.parse(options.body);
          return {
            ok: true,
            json: async () => ({
              answers: {
                tx_filter: {
                  choice: 'transaction',
                  confidence: 0.95,
                },
              },
            }),
          };
        }
        throw new Error(`Unexpected fetch to ${url}`);
      });

      const { isTransaction } = await import('../src/lib/classifier.mjs');
      
      await isTransaction({
        subject: 'Test transaction',
        from: 'test@example.com',
        textBody: 'Test body',
      });

      assert.ok(capturedRequestBody, 'Jev API should have been called');
      assert.ok(capturedRequestBody.questions, 'Request should include questions field');
      assert.strictEqual(
        Array.isArray(capturedRequestBody.questions),
        false,
        'questions should NOT be an array'
      );
      assert.strictEqual(
        typeof capturedRequestBody.questions,
        'object',
        'questions should be an object/dict'
      );
      assert.ok(
        capturedRequestBody.questions.tx_filter,
        'questions should be keyed by question_id (tx_filter)'
      );
      assert.strictEqual(
        capturedRequestBody.questions.tx_filter.type,
        'choice',
        'question should include type field'
      );
      assert.ok(
        capturedRequestBody.questions.tx_filter.instructions,
        'question should include instructions field'
      );
      assert.ok(
        capturedRequestBody.questions.tx_filter.criteria,
        'question should include criteria field'
      );
      assert.strictEqual(
        capturedRequestBody.questions.tx_filter.id,
        undefined,
        'question should NOT include id field (it is the key)'
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('Jev category request sends questions as dict keyed by category', async () => {
    const originalFetch = globalThis.fetch;
    let capturedRequestBody = null;

    try {
      globalThis.fetch = mock.fn(async (url, options) => {
        if (url.includes('/v1/systemone')) {
          capturedRequestBody = JSON.parse(options.body);
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
      
      await chooseCategory(
        {
          subject: 'Test email',
          from: 'test@example.com',
          textBody: 'Compra en supermercado',
        },
        'Supermercado Test'
      );

      assert.ok(capturedRequestBody, 'Jev API should have been called');
      assert.ok(capturedRequestBody.questions, 'Request should include questions field');
      assert.strictEqual(
        Array.isArray(capturedRequestBody.questions),
        false,
        'questions should NOT be an array'
      );
      assert.ok(
        capturedRequestBody.questions.category,
        'questions should be keyed by question_id (category)'
      );
      assert.strictEqual(
        capturedRequestBody.questions.category.type,
        'choice',
        'question should include type field'
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('Classifier Luna API', () => {
  test('Luna request includes text.format.name and type json_schema', async () => {
    const originalFetch = globalThis.fetch;
    let capturedRequestBody = null;

    try {
      globalThis.fetch = mock.fn(async (url, options) => {
        if (url === 'https://api.openai.com/v1/responses') {
          capturedRequestBody = JSON.parse(options.body);
          return {
            ok: true,
            json: async () => ({
              output: [
                {
                  role: 'assistant',
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify({ choice: 'transaction', confidence: 0.95 }),
                    },
                  ],
                },
              ],
            }),
          };
        }
        throw new Error(`Unexpected fetch to ${url}`);
      });

      const { isTransaction } = await import('../src/lib/classifier.mjs');
      
      await isTransaction({
        subject: 'Test transaction',
        from: 'test@example.com',
        textBody: 'Test body',
      });

      assert.ok(capturedRequestBody, 'Luna API should have been called');
      assert.ok(capturedRequestBody.text, 'Request should include text field');
      assert.ok(capturedRequestBody.text.format, 'text should include format field');
      assert.strictEqual(
        capturedRequestBody.text.format.type,
        'json_schema',
        'text.format.type should be json_schema'
      );
      assert.ok(
        capturedRequestBody.text.format.name,
        'text.format should include name field'
      );
      assert.strictEqual(
        typeof capturedRequestBody.text.format.name,
        'string',
        'text.format.name should be a string'
      );
      assert.ok(
        capturedRequestBody.text.format.name.length > 0,
        'text.format.name should not be empty'
      );
      assert.ok(
        capturedRequestBody.text.format.schema,
        'text.format should include schema field'
      );
      assert.strictEqual(
        capturedRequestBody.text.format.strict,
        true,
        'text.format.strict should be true'
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('Luna response parsing handles output array format', async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = mock.fn(async (url, options) => {
        if (url === 'https://api.openai.com/v1/responses') {
          return {
            ok: true,
            json: async () => ({
              output: [
                {
                  role: 'assistant',
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify({ choice: '__skip__', confidence: 0.85 }),
                    },
                  ],
                },
              ],
            }),
          };
        }
        throw new Error(`Unexpected fetch to ${url}`);
      });

      const { chooseCategory } = await import('../src/lib/classifier.mjs');
      
      const result = await chooseCategory(
        {
          subject: 'Test email',
          from: 'test@example.com',
          textBody: 'Test body',
        },
        'Test Merchant'
      );

      assert.strictEqual(result, null, 'Should return null for __skip__ choice');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('Luna handles API errors correctly', async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = mock.fn(async (url, options) => {
        if (url === 'https://api.openai.com/v1/responses') {
          return {
            ok: false,
            status: 400,
            text: async () => "Missing required parameter: 'text.format.name'",
          };
        }
        throw new Error(`Unexpected fetch to ${url}`);
      });

      const { isTransaction } = await import('../src/lib/classifier.mjs');
      
      await assert.rejects(
        async () => {
          await isTransaction({
            subject: 'Test',
            from: 'test@example.com',
            textBody: 'Test',
          });
        },
        {
          message: /Luna API error: 400/,
        },
        'Should throw error for 400 response'
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
