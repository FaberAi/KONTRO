// api/firma.js — Gestione ricevute firma dipendenti
// GET  ?token=xxx       → restituisce i dati della ricevuta
// POST { token, firma } → salva la firma

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

    // 1. Carica acconto
    const { data: acc, error: accErr } = await sb
      .from('acconti_stipendio')
      .select('id, business_id, importo, data, tipo, note, firma_stato, firmato_at, firma_scade_at, dipendente_id')
      .eq('firma_token', token)
      .single();

    if (accErr || !acc) {
      console.error('Token non trovato:', token, accErr?.message);
      return res.status(404).json({ error: 'Ricevuta non trovata' });
    }

    // Controlla scadenza
    if (acc.firma_scade_at && new Date(acc.firma_scade_at) < new Date()) {
      return res.status(410).json({ error: 'Link scaduto', scaduto: true });
    }

    // 2. Carica dipendente separatamente
    const { data: dip } = await sb
      .from('dipendenti')
      .select('nome, cognome, ruolo')
      .eq('id', acc.dipendente_id)
      .single();

    // 3. Carica azienda separatamente
    const { data: biz } = await sb
      .from('businesses')
      .select('name, email')
      .eq('id', acc.business_id)
      .single();

    return res.status(200).json({
      ...acc,
      dipendenti: dip || {},
      businesses: biz || {}
    });
  }

  // ── POST — salva firma ───────────────────────────────────────────────
  if (req.method === 'POST') {
    const { firma } = req.body;
    if (!firma) return res.status(400).json({ error: 'Firma mancante' });

    const { data: existing, error: exErr } = await sb
      .from('acconti_stipendio')
      .select('firma_stato, firma_scade_at')
      .eq('firma_token', token)
      .single();

    if (exErr || !existing) return res.status(404).json({ error: 'Ricevuta non trovata' });
    if (existing.firma_stato === 'firmata') return res.status(409).json({ error: 'Già firmata' });
    if (existing.firma_scade_at && new Date(existing.firma_scade_at) < new Date()) {
      return res.status(410).json({ error: 'Link scaduto' });
    }

    const { error } = await sb
      .from('acconti_stipendio')
      .update({
        firma_data_url: firma,
        firma_stato:    'firmata',
        firmato_at:     new Date().toISOString()
      })
      .eq('firma_token', token);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  res.status(405).json({ error: 'Metodo non consentito' });
};
