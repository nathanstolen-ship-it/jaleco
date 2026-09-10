// api/sync.js — sincronização do Jaleco via Upstash Redis (Vercel Marketplace)
// GET  /api/sync?c=<codigo>                 → { estado: {...} | null, rev }
// GET  /api/sync?c=<codigo>&so=rev          → { rev }   (consulta barata: a nuvem mudou?)
// PUT  /api/sync?c=<codigo>  body: { estado, base }
//      grava só se a versão da nuvem ainda for `base` (senão 409 + rev atual, e o
//      aparelho mescla de novo antes de tentar outra vez). Sem `base` = app antigo,
//      grava por cima como antes.

const KV_URL =
  process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN =
  process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

// Teto do estado sincronizado (texto dos cards, sem imagens). Precisa caber no
// localStorage do Safari (~5 MB em UTF-16) e no corpo de função da Vercel (4,5 MB).
const LIMITE = 2000000;

// Compara-e-grava atômico: ninguém grava entre a checagem da versão e o SET.
const CAS = `
local atual = redis.call('GET', KEYS[2]) or ''
if ARGV[1] ~= '*' and atual ~= ARGV[1] then return {0, atual} end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('SET', KEYS[2], ARGV[3])
return {1, ARGV[3]}`;

async function redis(comando) {
  const r = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    body: JSON.stringify(comando),
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || 'Falha no Redis');
  return j.result;
}

export default async function handler(req, res) {
  if (!KV_URL || !KV_TOKEN) {
    return res.status(500).json({ erro: 'Redis não configurado no Vercel' });
  }

  const codigo = String(req.query.c || '').trim().toLowerCase();
  if (!/^[a-z0-9-]{8,64}$/.test(codigo)) {
    return res.status(400).json({ erro: 'Código inválido' });
  }
  const chave = 'jaleco:' + codigo;
  const chaveRev = chave + ':rev';
  res.setHeader('Cache-Control', 'no-store');

  try {
    if (req.method === 'GET') {
      if (req.query.so === 'rev') {
        return res.status(200).json({ rev: (await redis(['GET', chaveRev])) || '' });
      }
      const [estado, rev] = await redis(['MGET', chave, chaveRev]);
      return res
        .status(200)
        .json({ estado: estado ? JSON.parse(estado) : null, rev: rev || '' });
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      const estado = req.body && req.body.estado;
      if (!estado) return res.status(400).json({ erro: 'Sem estado no corpo' });
      const texto = JSON.stringify(estado);
      if (texto.length > LIMITE) {
        return res.status(413).json({ erro: 'Estado grande demais', limite: LIMITE });
      }
      const base = typeof req.body.base === 'string' ? req.body.base : '*';
      const novaRev = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const [ok, rev] = await redis(['EVAL', CAS, '2', chave, chaveRev, base, texto, novaRev]);
      if (!ok) return res.status(409).json({ erro: 'A nuvem mudou', rev });
      return res.status(200).json({ ok: true, rev, tamanho: texto.length, limite: LIMITE });
    }

    res.setHeader('Allow', 'GET, PUT, POST');
    return res.status(405).json({ erro: 'Método não permitido' });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
