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
        questions: [{
          id: prompt.question_id,
          type: prompt.type,
          instructions: prompt.instructions,
          criteria: prompt.criteria,
        }],
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
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        text: {
          format: {
            type: 'json_schema',
            json_schema: {
              name: 'decision',
              strict: true,
              schema: {
                type: 'object',
                properties: {
                  choice: { type: 'string' },
                  confidence: { type: 'number' },
                },
                required: ['choice', 'confidence'],
                additionalProperties: false,
              },
            },
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
    const content = result.choices?.[0]?.message?.content;
    
    if (!content) {
      throw new Error('Luna response missing content');
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
