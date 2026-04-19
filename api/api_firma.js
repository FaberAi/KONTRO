// api/firma.js — Gestione ricevute firma dipendenti
// GET  ?token=xxx       → restituisce i dati della ricevuta
// POST { token, firma } → salva la firma e chiude la ricevuta

const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = req.method === 'GET'
    ? req.query.token
    : req.body?.token;

  if (!token) return res.status(400).json({ error: 'Token mancante' });

  // ── GET — carica dati ricevuta ───────────────────────────────────────
  if (req.method === 'GET') {
    const { data, error } = await sb
      .from('acconti_stipendio')
      .select(`
        id, importo, data, tipo, note, firma_stato, firmato_at, firma_scade_at,
        dipendenti(nome, cognome, ruolo),
        businesses:business_id(name, vat_number, email)
      `)
      .eq('firma_token', token)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Ricevuta non trovata' });

    // Controlla scadenza
    if (data.firma_scade_at && new Date(data.firma_scade_at) < new Date()) {
      return res.status(410).json({ error: 'Link scaduto', scaduto: true });
    }

    return res.status(200).json(data);
  }

  // ── POST — salva firma ───────────────────────────────────────────────
  if (req.method === 'POST') {
    const { firma } = req.body;
    if (!firma) return res.status(400).json({ error: 'Firma mancante' });

    // Controlla che non sia già firmata
    const { data: existing } = await sb
      .from('acconti_stipendio')
      .select('firma_stato, firma_scade_at')
      .eq('firma_token', token)
      .single();

    if (!existing) return res.status(404).json({ error: 'Ricevuta non trovata' });
    if (existing.firma_stato === 'firmata') return res.status(409).json({ error: 'Già firmata' });
    if (existing.firma_scade_at && new Date(existing.firma_scade_at) < new Date()) {
      return res.status(410).json({ error: 'Link scaduto' });
    }

    const { error } = await sb
      .from('acconti_stipendio')
      .update({
        firma_data_url: firma,
        firma_stato: 'firmata',
        firmato_at: new Date().toISOString()
      })
      .eq('firma_token', token);

    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({ success: true, message: 'Firma salvata' });
  }

  res.status(405).json({ error: 'Metodo non consentito' });
};
