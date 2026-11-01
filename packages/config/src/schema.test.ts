/**
 * docs/schema/v1.json is the JSON Schema for flowcanvas.config.json, generated
 * from the zod ConfigSchema (input shape: what a hand-written file may contain,
 * so fields with defaults are optional). This test keeps the two in sync.
 *
 *   UPDATE_SCHEMA=1 pnpm --filter @flowcanvas/config test   # regenerate
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ConfigSchema, SCHEMA_URL, parseConfig } from './index';

const file = new URL('../../../docs/schema/v1.json', import.meta.url);

function configJsonSchema(): Record<string, unknown> {
  const s = zodToJsonSchema(ConfigSchema, { target: 'jsonSchema7', $refStrategy: 'relative', pipeStrategy: 'input', effectStrategy: 'input', removeAdditionalStrategy: 'strict' }) as Record<string, unknown>;
  // Only the outer `$schema` dialect, id and title are added; everything else comes from zod.
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: SCHEMA_URL,
    title: 'flowcanvas.config.json',
    description: 'Flow Canvas project file (v1): screens, states, flows, transitions, mocks, tokens, sections, images, notes and comments. Generated from ConfigSchema in @flowcanvas/config.',
    ...Object.fromEntries(Object.entries(s).filter(([k]) => k !== '$schema')),
  };
}

describe('docs/schema/v1.json', () => {
  const generated = JSON.stringify(configJsonSchema(), null, 2) + '\n';

  it('matches the zod ConfigSchema (regenerate with UPDATE_SCHEMA=1)', () => {
    if (process.env.UPDATE_SCHEMA === '1' || !existsSync(file)) writeFileSync(file, generated);
    expect(readFileSync(file, 'utf8')).toBe(generated);
  });

  it('describes the demo config: every top-level key is known, required keys match', () => {
    const schema = JSON.parse(generated) as { properties: Record<string, unknown>; required: string[] };
    const demo = JSON.parse(readFileSync(new URL('../../../apps/demo/flowcanvas.config.json', import.meta.url), 'utf8')) as Record<string, unknown>;
    expect(parseConfig(demo).ok).toBe(true);
    for (const k of Object.keys(demo)) expect(schema.properties, k).toHaveProperty(k);
    expect(schema.required.sort()).toEqual(['project', 'version']);
  });
});
