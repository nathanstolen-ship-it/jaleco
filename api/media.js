// api/media.js — imagens dos flashcards no Vercel Blob
// PUT    /api/media?c=<codigo>&k=<deckId/arquivo>   corpo: binário da imagem → { url }
// DELETE /api/media?c=<codigo>&prefix=<deckId/>     apaga as imagens de um baralho

import { put, del, list } from '@vercel/blob';

export const config = { api: { bodyParser: false } };

async function lerCorpo(req) {
  const partes = [];
  for await (const p of req) partes.push(p);
  return Buffer.concat(partes);
}

export default async function handler(req, res) {
  const codigo = String(req.query.c || '').trim().toLowerCase();
  if (!/^[a-z0-9-]{8,64}$/.test(codigo)) {
    return res.status(400).json({ erro: 'Código inválido' });
  }

  try {
    if (req.method === 'PUT' || req.method === 'POST') {
      const k = String(req.query.k || '').trim();
      if (!k || k.length > 300 || k.includes('..')) {
        return res.status(400).json({ erro: 'Chave inválida' });
      }
      const dados = await lerCorpo(req);
      if (!dados.length) return res.status(400).json({ erro: 'Corpo vazio' });
      if (dados.length > 4000000) {
        return res.status(413).json({ erro: 'Imagem grande demais (máx 4MB)' });
      }
      const blob = await put(`jaleco/${codigo}/${k}`, dados, {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: req.headers['content-type'] || 'application/octet-stream',
      });
      return res.status(200).json({ url: blob.url });
    }

    if (req.method === 'DELETE') {
      const prefix = String(req.query.prefix || '').trim();
      if (!prefix) return res.status(400).json({ erro: 'Sem prefixo' });
      const { blobs } = await list({ prefix: `jaleco/${codigo}/${prefix}` });
      if (blobs.length) await del(blobs.map((b) => b.url));
      return res.status(200).json({ ok: true, apagadas: blobs.length });
    }

    res.setHeader('Allow', 'PUT, POST, DELETE');
    return res.status(405).json({ erro: 'Método não permitido' });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
