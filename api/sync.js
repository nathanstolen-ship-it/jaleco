// api/sync.js — sincronização do Jaleco via Upstash Redis (Vercel Marketplace)
// GET  /api/sync?c=<codigo>          → { estado: {...} | null }
// PUT  /api/sync?c=<codigo>  body: { estado: {...} }

const KV_URL =
  process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN =
  process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export default async function handler(req, res) {
  if (!KV_URL || !KV_TOKEN) {
    return res.status(500).json({ erro: 'Redis não configurado no Vercel' });
  }

  const codigo = String(req.query.c || '').trim().toLowerCase();
  if (!/^[a-z0-9-]{8,64}$/.test(codigo)) {
    return res.status(400).json({ erro: 'Código inválido' });
  }
  const chave = encodeURIComponent('jaleco:' + codigo);
  const auth = { Authorization: `Bearer ${KV_TOKEN}` };

  try {
    if (req.method === 'GET') {
      const r = await fetch(`${KV_URL}/get/${chave}`, { headers: auth });
      const j = await r.json();
      return res
        .status(200)
        .json({ estado: j.result ? JSON.parse(j.result) : null });
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      const estado = req.body && req.body.estado;
      if (!estado) return res.status(400).json({ erro: 'Sem estado no corpo' });
      const texto = JSON.stringify(estado);
      if (texto.length > 900000) {
        return res.status(413).json({ erro: 'Estado grande demais' });
      }
      const r = await fetch(`${KV_URL}/set/${chave}`, {
        method: 'POST',
        headers: auth,
        body: texto,
      });
      if (!r.ok) throw new Error('Falha ao gravar no Redis');
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, PUT, POST');
    return res.status(405).json({ erro: 'Método não permitido' });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
