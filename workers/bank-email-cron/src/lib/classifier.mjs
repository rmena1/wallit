import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from '../config/index.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

let txFilterPrompt;
let categoryChoicePrompt;

async function loadPrompts() {
  if (!txFilterPrompt) {
    const txPath = join(__dirname, '../../prompts/best-tx-filter.json');
    const catPath = join(__dirname, '../../prompts/best-category-choice.json');
    txFilterPrompt = JSON.parse(await readFile(txPath, 'utf8'));
    categoryChoicePrompt = JSON.parse(await readFile(catPath, 'utf8'));
  }
}

function truncateBody(body, maxChars = 8000) {
  if (body.length <= maxChars) return body;
  return body.slice(0, maxChars) + '...';
}

function enrichError(error, context) {
  const parts = [context];
  
  if (error.message) {
    parts.push(error.message);
  }
  
  if (error.cause) {
    const causeChain = [];
    let current = error.cause;
    while (current) {
      const causeInfo = [];
      if (current.code) causeInfo.push(`code: ${current.code}`);
      if (current.message) causeInfo.push(`message: ${current.message}`);
      if (causeInfo.length > 0) {
        causeChain.push(causeInfo.join(', '));
      }
      current = current.cause;
    }
    
    if (causeChain.length > 0) {
      parts.push(`cause: ${causeChain.join(' -> ')}`);
    }
  }
  
  const enriched = new Error(parts.join('; '), { cause: error.cause || error });
  
  if (error.response) {
    enriched.response = error.response;
  }
  
  return enriched;
}

const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'ABORT_ERR',
]);

const TRANSIENT_HTTP_STATUSES = new Set([429, 502, 503, 504]);

function isTransientError(error, response) {
  if (response && TRANSIENT_HTTP_STATUSES.has(response.status)) {
    return true;
  }
  
  if (error.cause?.code && TRANSIENT_NETWORK_CODES.has(error.cause.code)) {
    return true;
  }
  
  if (error.name === 'AbortError' || error.code === 'ABORT_ERR') {
    return true;
  }
  
  if (error.message?.includes('fetch failed')) {
    return true;
  }
  
  return false;
}

async function withRetry(fn, { maxRetries = 3, baseDelayMs = 500, context = 'Operation' } = {}) {
  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      const isTransient = isTransientError(error, error.response);
      
      if (!isTransient || attempt === maxRetries) {
        throw enrichError(error, `${context} failed after ${attempt + 1} attempt(s)`);
      }
      
      const delayMs = baseDelayMs * Math.pow(2, attempt);
      console.warn(
        `${context} attempt ${attempt + 1}/${maxRetries + 1} failed (transient), retrying in ${delayMs}ms:`,
        error.message
      );
      
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  throw enrichError(lastError, `${context} exhausted retries`);
}

async function callJev(prompt, state, timeoutMs) {
  return await withRetry(
    async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      
      try {
        let response;
        try {
          response = await fetch(`${config.typesafe.baseUrl}/v1/systemone`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${config.typesafe.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: prompt.model,
              questions: {
                [prompt.question_id]: {
                  type: prompt.type,
                  instructions: prompt.instructions,
                  criteria: prompt.criteria,
                },
              },
              state,
            }),
            signal: controller.signal,
          });
        } catch (error) {
          clearTimeout(timeout);
          throw enrichError(error, `TypeSafe POST ${config.typesafe.baseUrl}/v1/systemone failed`);
        }

        clearTimeout(timeout);

        if (!response.ok) {
          const text = await response.text();
          const error = new Error(`Jev API error: ${response.status} ${text}`);
          error.response = response;
          throw error;
        }

        const result = await response.json();
        const answer = result.answers?.[prompt.question_id];
        
        if (!answer) {
          throw new Error('Jev response missing answer');
        }

        return {
          choice: answer.choice,
          confidence: answer.confidence,
        };
      } catch (error) {
        clearTimeout(timeout);
        throw error;
      }
    },
    { maxRetries: 2, baseDelayMs: 500, context: 'Jev API call' }
  );
}

async function callLuna(prompt, state, timeoutMs) {
  if (!config.openai.apiKey) {
    throw new Error('Luna fallback unavailable: OPENAI_API_KEY not configured');
  }

  return await withRetry(
    async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      
      try {
        const systemPrompt = `${prompt.instructions}\n\nCriteria:\n${JSON.stringify(prompt.criteria, null, 2)}`;
        const userPrompt = `Based on this email data, choose ONE option from the criteria:\n\n${JSON.stringify(state, null, 2)}`;
        
        const url = `${config.openai.baseUrl}/v1/responses`;
        
        let response;
        try {
          response = await fetch(url, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${config.openai.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: config.openai.model,
              reasoning: {
                effort: config.openai.reasoningEffort,
              },
              input: `${systemPrompt}\n\n${userPrompt}`,
              text: {
                format: {
                  type: 'json_schema',
                  name: 'transaction_classification',
                  schema: {
                    type: 'object',
                    properties: {
                      choice: { type: 'string' },
                      confidence: { type: 'number' },
                    },
                    required: ['choice', 'confidence'],
                    additionalProperties: false,
                  },
                  strict: true,
                },
              },
            }),
            signal: controller.signal,
          });
        } catch (error) {
          clearTimeout(timeout);
          throw enrichError(error, `OpenAI POST ${url} failed`);
        }

        clearTimeout(timeout);

        if (!response.ok) {
          const text = await response.text();
          const error = new Error(`Luna API error: ${response.status} ${text}`);
          error.response = response;
          throw error;
        }

        const result = await response.json();
        
        let content;
        
        // Prefer top-level output_text string
        if (typeof result.output_text === 'string') {
          content = result.output_text;
        }
        // Walk output array for message items and content parts
        else if (result.output && Array.isArray(result.output)) {
          for (const item of result.output) {
            // Handle items with type: "message"
            if (item.type === 'message' && item.content) {
              if (Array.isArray(item.content)) {
                // Find output_text or text content parts
                const textPart = item.content.find(c => 
                  c.type === 'output_text' || c.type === 'text'
                );
                if (textPart) {
                  content = textPart.output_text || textPart.text;
                  break;
                }
              } else if (typeof item.content === 'string') {
                content = item.content;
                break;
              }
            }
            // Handle assistant role items
            else if (item.role === 'assistant' && item.content) {
              if (Array.isArray(item.content)) {
                // Find output_text or text content parts
                const textPart = item.content.find(c => 
                  c.type === 'output_text' || c.type === 'text'
                );
                if (textPart) {
                  content = textPart.output_text || textPart.text;
                  break;
                }
              }
            }
          }
        }
        // Fallback to older response shapes
        else if (result.output?.text) {
          content = result.output.text;
        } else if (typeof result.output === 'string') {
          content = result.output;
        } else if (result.choices?.[0]?.message?.content) {
          content = result.choices[0].message.content;
        }
        
        if (!content) {
          // Generate diagnostic info without exposing sensitive data
          const diagnostic = {
            resultKeys: Object.keys(result).sort(),
            outputType: Array.isArray(result.output) ? 'array' : typeof result.output,
          };
          
          if (Array.isArray(result.output)) {
            diagnostic.outputItemTypes = result.output.map(item => ({
              type: item.type,
              role: item.role,
              hasContent: !!item.content,
              contentType: Array.isArray(item.content) ? 'array' : typeof item.content,
            }));
            
            // Include content part types for each item
            diagnostic.contentPartTypes = result.output
              .filter(item => Array.isArray(item.content))
              .map(item => item.content.map(c => c.type));
          }
          
          throw new Error(`Luna response missing content: ${JSON.stringify(diagnostic).slice(0, 500)}`);
        }

        return JSON.parse(content);
      } catch (error) {
        clearTimeout(timeout);
        throw error;
      }
    },
    { maxRetries: 2, baseDelayMs: 500, context: 'Luna API call' }
  );
}

async function classifyWithFallback(prompt, state, jevTimeoutMs, lunaTimeoutMs) {
  try {
    return await callJev(prompt, state, jevTimeoutMs);
  } catch (error) {
    console.warn('Jev classification failed, falling back to Luna:', error.message);
    try {
      return await callLuna(prompt, state, lunaTimeoutMs);
    } catch (lunaError) {
      console.error('Luna API call failed:', {
        message: lunaError.message,
        errorName: lunaError.name,
        errorCode: lunaError.code,
        causeCode: lunaError.cause?.code,
        causeMessage: lunaError.cause?.message,
        url: `${config.openai.baseUrl}/v1/responses`,
        method: 'POST',
        timeout: lunaTimeoutMs,
      });
      throw lunaError;
    }
  }
}

export async function isTransaction(email) {
  await loadPrompts();
  
  const state = {
    subject: email.subject,
    from: email.from,
    body_excerpt: truncateBody(email.textBody),
  };

  const result = await classifyWithFallback(
    txFilterPrompt,
    state,
    config.typesafe.timeoutMs,
    config.openai.timeoutMs
  );

  return result.choice === 'transaction';
}

export async function chooseCategory(email, merchant) {
  await loadPrompts();
  
  const state = {
    subject: email.subject,
    from: email.from,
    merchant: merchant || '',
    body_excerpt: truncateBody(email.textBody),
  };

  const result = await classifyWithFallback(
    categoryChoicePrompt,
    state,
    config.typesafe.timeoutMs,
    config.openai.timeoutMs
  );

  const validCategoryIds = Object.keys(categoryChoicePrompt.criteria).filter(k => k !== '__skip__');
  
  if (result.choice === '__skip__' || !validCategoryIds.includes(result.choice)) {
    return null;
  }

  if (result.confidence < config.category.minConfidence) {
    console.log(`Category confidence ${result.confidence} below threshold ${config.category.minConfidence}, skipping`);
    return null;
  }

  return result.choice;
}
