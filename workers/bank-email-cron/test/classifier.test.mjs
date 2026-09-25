import { test, describe, mock } from 'node:test';
import assert from 'node:assert';

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

  test('Luna parses top-level output_text string', async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = mock.fn(async (url, options) => {
        if (url === 'https://api.openai.com/v1/responses') {
          return {
            ok: true,
            json: async () => ({
              output_text: JSON.stringify({ choice: 'transaction', confidence: 0.92 }),
            }),
          };
        }
        throw new Error(`Unexpected fetch to ${url}`);
      });

      const { isTransaction } = await import('../src/lib/classifier.mjs');
      
      const result = await isTransaction({
        subject: 'Payment confirmation',
        from: 'noreply@bank.com',
        textBody: 'Your payment of $50 was successful',
      });

      assert.strictEqual(result, true, 'Should parse output_text string correctly');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('Luna parses output array with type: "output_text" content parts', async () => {
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
                      type: 'output_text',
                      output_text: JSON.stringify({ choice: 'transaction', confidence: 0.88 }),
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
      
      const result = await isTransaction({
        subject: 'Receipt from Store',
        from: 'receipts@store.com',
        textBody: 'Thank you for your purchase',
      });

      assert.strictEqual(result, true, 'Should parse output_text content parts');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('Luna parses output array with type: "message" items', async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = mock.fn(async (url, options) => {
        if (url === 'https://api.openai.com/v1/responses') {
          return {
            ok: true,
            json: async () => ({
              output: [
                {
                  type: 'message',
                  content: [
                    {
                      type: 'output_text',
                      output_text: JSON.stringify({ choice: '__skip__', confidence: 0.75 }),
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
          subject: 'Newsletter',
          from: 'news@example.com',
          textBody: 'Monthly updates',
        },
        'Example Merchant'
      );

      assert.strictEqual(result, null, 'Should parse message type items with output_text');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('Luna still supports legacy type: "text" format', async () => {
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
                      text: JSON.stringify({ choice: 'transaction', confidence: 0.96 }),
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
      
      const result = await isTransaction({
        subject: 'Transaction alert',
        from: 'alerts@bank.com',
        textBody: 'A charge of $100 was made',
      });

      assert.strictEqual(result, true, 'Should still support legacy text type');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('Luna provides diagnostic info when content is missing', async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = mock.fn(async (url, options) => {
        if (url === 'https://api.openai.com/v1/responses') {
          return {
            ok: true,
            json: async () => ({
              output: [
                {
                  type: 'unknown_type',
                  data: 'something unexpected',
                },
              ],
              some_other_field: 'value',
            }),
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
            textBody: 'Test body',
          });
        },
        {
          message: /Luna response missing content.*resultKeys.*outputType.*outputItemTypes/,
        },
        'Should provide diagnostic info in error message'
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
