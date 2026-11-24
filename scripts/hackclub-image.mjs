// Generate pixel-car sheets through Hack Club AI.
//
//   node scripts/hackclub-image.mjs --model google/gemini-nano-banana-2.1 \
//     --prompt-file art/prompts/rally.txt --out art/sheets/car.png --aspect 16:9
//
//   node scripts/hackclub-image.mjs --model anthropic/claude-fable-5.2 \
//     --prompt-file art/prompts/rally-svg.txt --out art/sheets/car.svg --text
//
// Key: HACKCLUB_API_KEY or ~/.config/hackclub-ai.key.
// Hack Club has a $3/day cap; a 402 means the day's spend is used up.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, v, i, all) => {
    if (v.startsWith('--')) a.push([v.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return a;
  }, []),
);
const key = process.env.HACKCLUB_API_KEY
  || fs.readFileSync(path.join(os.homedir(), '.config', 'hackclub-ai.key'), 'utf8').trim();
const prompt = args['prompt-file'] ? fs.readFileSync(args['prompt-file'], 'utf8') : args.prompt;
if (!prompt) throw new Error('--prompt or --prompt-file is required');
const model = args.model || 'google/gemini-nano-banana-2.1';
const out = args.out || 'art/sheets/generated.png';

const content = [{ type: 'text', text: prompt }];
if (args.ref) {
  const b64 = fs.readFileSync(args.ref).toString('base64');
  const mime = args.ref.endsWith('.jpg') || args.ref.endsWith('.jpeg') ? 'image/jpeg' : 'image/png';
  content.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } });
}

const body = {
  model,
  messages: [{ role: 'user', content }],
  max_tokens: Number(args['max-tokens'] || 32000),
};
if (!args.text) {
  body.modalities = ['image', 'text'];
  body.image_config = { aspect_ratio: args.aspect || '16:9' };
}
if (args.effort) body.reasoning_effort = args.effort;

const r = await fetch('https://ai.hackclub.com/proxy/v1/chat/completions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const text = await r.text();
if (!r.ok) {
  console.error(`Hack Club AI ${r.status}: ${text.slice(0, 1200)}`);
  process.exit(1);
}
const j = JSON.parse(text);
const msg = j.choices?.[0]?.message ?? {};

fs.mkdirSync(path.dirname(out), { recursive: true });
if (args.text) {
  const svg = String(msg.content ?? '').replace(/^```(?:svg|xml)?\s*/i, '').replace(/```\s*$/, '').trim();
  fs.writeFileSync(out, svg);
  console.log('wrote', out, `${svg.length} bytes`);
} else {
  const url = msg.images?.[0]?.image_url?.url;
  if (!url) { console.error('no image in response:', text.slice(0, 800)); process.exit(1); }
  const b64 = url.includes(',') ? url.split(',')[1] : url;
  fs.writeFileSync(out, Buffer.from(b64, 'base64'));
  console.log('wrote', out);
}
