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

async function callJev(prompt, state, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(`${config.typesafe.baseUrl}/v1/systemone`, {
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

    clearTimeout(timeout);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Jev API error: ${response.status} ${text}`);
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
}

async function callLuna(prompt, state, timeoutMs) {
  if (!config.openai.apiKey) {
    throw new Error('Luna fallback unavailable: OPENAI_API_KEY not configured');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const systemPrompt = `${prompt.instructions}\n\nCriteria:\n${JSON.stringify(prompt.criteria, null, 2)}`;
    const userPrompt = `Based on this email data, choose ONE option from the criteria:\n\n${JSON.stringify(state, null, 2)}`;
    
    const response = await fetch('https://api.openai.com/v1/responses', {
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

    clearTimeout(timeout);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Luna API error: ${response.status} ${text}`);
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
}

async function classifyWithFallback(prompt, state, jevTimeoutMs, lunaTimeoutMs) {
  try {
    return await callJev(prompt, state, jevTimeoutMs);
  } catch (error) {
    console.warn('Jev classification failed, falling back to Luna:', error.message);
    return await callLuna(prompt, state, lunaTimeoutMs);
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
