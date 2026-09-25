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
        if (url.includes('api.openai.com')) {
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
        if (url.includes('api.openai.com')) {
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
        if (url.includes('typesafe.ai')) {
          throw new Error('Jev unavailable');
        }
        if (url.includes('api.openai.com')) {
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
        (error) => {
          const fullMessage = error.message + ' ' + (error.cause?.message || '');
          assert.ok(fullMessage.includes('400'), 'Should include 400 status code');
          return true;
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
        if (url.includes('api.openai.com')) {
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
        if (url.includes('api.openai.com')) {
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
        if (url.includes('api.openai.com')) {
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
        if (url.includes('api.openai.com')) {
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
        if (url.includes('typesafe.ai')) {
          throw new Error('Jev unavailable');
        }
        if (url.includes('api.openai.com')) {
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
        (error) => {
          let fullMessage = error.message;
          let currentError = error;
          while (currentError.cause) {
            fullMessage += ' ' + (currentError.cause.message || '');
            currentError = currentError.cause;
          }
          assert.ok(fullMessage.includes('missing content'), 'Should mention missing content');
          return true;
        },
        'Should provide diagnostic info in error message'
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('Classifier Error Handling', () => {
  test('fetch error with cause includes error code in message', async () => {
    const originalFetch = globalThis.fetch;
    
    try {
      globalThis.fetch = mock.fn(async (url, options) => {
        if (url.includes('typesafe.ai')) {
          throw new Error('Jev unavailable');
        }
        if (url.includes('api.openai.com')) {
          const error = new Error('fetch failed');
          error.cause = {
            code: 'ETIMEDOUT',
            message: 'Connection timeout',
          };
          throw error;
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
        (error) => {
          assert.ok(error.message.includes('ETIMEDOUT'), 'Error message should include cause code');
          assert.ok(error.message.includes('Connection timeout'), 'Error message should include cause message');
          return true;
        },
        'Should enrich error with cause details'
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('nested error causes are included in message', async () => {
    const originalFetch = globalThis.fetch;
    
    try {
      globalThis.fetch = mock.fn(async (url, options) => {
        if (url.includes('typesafe.ai')) {
          throw new Error('Jev unavailable');
        }
        if (url.includes('api.openai.com')) {
          const rootCause = {
            code: 'ECONNRESET',
            message: 'Socket hang up',
          };
          const error = new Error('fetch failed');
          error.cause = {
            code: 'UND_ERR_SOCKET',
            message: 'Socket error',
            cause: rootCause,
          };
          throw error;
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
        (error) => {
          assert.ok(error.message.includes('UND_ERR_SOCKET'), 'Should include first cause code');
          assert.ok(error.message.includes('ECONNRESET'), 'Should include nested cause code');
          return true;
        },
        'Should include full cause chain'
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('Classifier Retry Logic', () => {
  test('transient network error triggers retry and eventually succeeds', async () => {
    const originalFetch = globalThis.fetch;
    let attemptCount = 0;
    
    try {
      globalThis.fetch = mock.fn(async (url, options) => {
        if (url.includes('typesafe.ai')) {
          throw new Error('Jev unavailable');
        }
        
        attemptCount++;
        
        if (url.includes('api.openai.com')) {
          if (attemptCount < 2) {
            const error = new Error('fetch failed');
            error.cause = {
              code: 'ETIMEDOUT',
              message: 'Connection timeout',
            };
            throw error;
          }
          
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
      
      const result = await isTransaction({
        subject: 'Test transaction',
        from: 'test@example.com',
        textBody: 'Test body',
      });

      assert.strictEqual(result, true, 'Should succeed after retry');
      assert.ok(attemptCount >= 2, 'Should have attempted at least twice');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('AbortError is treated as transient and triggers retry', async () => {
    const originalFetch = globalThis.fetch;
    let attemptCount = 0;
    
    try {
      globalThis.fetch = mock.fn(async (url, options) => {
        if (url.includes('typesafe.ai')) {
          throw new Error('Jev unavailable');
        }
        
        attemptCount++;
        
        if (url.includes('api.openai.com')) {
          if (attemptCount < 2) {
            const error = new Error('The operation was aborted');
            error.name = 'AbortError';
            error.code = 'ABORT_ERR';
            throw error;
          }
          
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
      
      const result = await isTransaction({
        subject: 'Test transaction',
        from: 'test@example.com',
        textBody: 'Test body',
      });

      assert.strictEqual(result, true, 'Should succeed after retry');
      assert.ok(attemptCount >= 2, 'Should have retried after AbortError');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('fetch failed TypeError with cause enriches error message', async () => {
    const originalFetch = globalThis.fetch;
    
    try {
      globalThis.fetch = mock.fn(async (url, options) => {
        if (url.includes('typesafe.ai')) {
          throw new Error('Jev unavailable');
        }
        
        if (url.includes('api.openai.com')) {
          const error = new TypeError('fetch failed');
          error.cause = {
            code: 'ECONNRESET',
            message: 'socket hang up',
          };
          throw error;
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
        (error) => {
          assert.ok(error.message.includes('ECONNRESET'), 'Should include cause code in message');
          assert.ok(error.message.includes('socket hang up'), 'Should include cause message');
          return true;
        },
        'Should enrich TypeError fetch failed with cause details'
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('HTTP 429 triggers retry', async () => {
    const originalFetch = globalThis.fetch;
    let attemptCount = 0;
    
    try {
      globalThis.fetch = mock.fn(async (url, options) => {
        if (url.includes('typesafe.ai')) {
          throw new Error('Jev unavailable');
        }
        
        attemptCount++;
        
        if (url.includes('api.openai.com')) {
          if (attemptCount < 2) {
            return {
              ok: false,
              status: 429,
              text: async () => 'Rate limit exceeded',
            };
          }
          
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
      
      const result = await isTransaction({
        subject: 'Test transaction',
        from: 'test@example.com',
        textBody: 'Test body',
      });

      assert.strictEqual(result, true, 'Should succeed after retry');
      assert.ok(attemptCount >= 2, 'Should have retried after 429');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('HTTP 502, 503, 504 trigger retries', async () => {
    const originalFetch = globalThis.fetch;
    
    for (const status of [502, 503, 504]) {
      let attemptCount = 0;
      
      globalThis.fetch = mock.fn(async (url, options) => {
        if (url.includes('typesafe.ai')) {
          throw new Error('Jev unavailable');
        }
        
        attemptCount++;
        
        if (url.includes('api.openai.com')) {
          if (attemptCount < 2) {
            return {
              ok: false,
              status,
              text: async () => 'Server error',
            };
          }
          
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
      
      const result = await isTransaction({
        subject: 'Test transaction',
        from: 'test@example.com',
        textBody: 'Test body',
      });

      assert.strictEqual(result, true, `Should succeed after ${status} retry`);
      assert.ok(attemptCount >= 2, `Should have retried after ${status}`);
      
      attemptCount = 0;
    }
    
    globalThis.fetch = originalFetch;
  });

  test('non-transient errors do not trigger retries', async () => {
    const originalFetch = globalThis.fetch;
    let attemptCount = 0;
    
    try {
      globalThis.fetch = mock.fn(async (url, options) => {
        if (url.includes('typesafe.ai')) {
          throw new Error('Jev unavailable');
        }
        
        if (url.includes('api.openai.com')) {
          attemptCount++;
          return {
            ok: false,
            status: 400,
            text: async () => 'Bad request',
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
        (error) => {
          let fullMessage = error.message;
          let currentError = error;
          while (currentError.cause) {
            fullMessage += ' ' + (currentError.cause.message || '');
            currentError = currentError.cause;
          }
          assert.ok(fullMessage.includes('400'), 'Should include 400 status');
          return true;
        },
        'Should fail immediately for 400'
      );

      assert.strictEqual(attemptCount, 1, 'Should not retry for 400 errors');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('max retries exhausted throws enriched error', async () => {
    const originalFetch = globalThis.fetch;
    let lunaAttemptCount = 0;
    
    try {
      globalThis.fetch = mock.fn(async (url, options) => {
        if (url.includes('typesafe.ai')) {
          throw new Error('Jev unavailable');
        }
        
        if (url.includes('api.openai.com')) {
          lunaAttemptCount++;
          const error = new Error('fetch failed');
          error.cause = {
            code: 'ECONNRESET',
            message: 'Connection reset',
          };
          throw error;
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
        (error) => {
          assert.ok(error.message.includes('ECONNRESET'), 'Should include cause code');
          assert.ok(error.message.includes('attempt'), 'Should mention attempts');
          return true;
        },
        'Should throw enriched error after max retries'
      );

      assert.strictEqual(lunaAttemptCount, 3, 'Should attempt 3 times (initial + 2 retries)');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
