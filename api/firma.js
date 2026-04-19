// api/firma.js
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = req.method === 'GET' ? req.query.token : req.body?.token;
  if (!token) return res.status(400).json({ error: 'Token mancante' });

  if (req.method === 'GET') {
    const { data: acc, error } = await sb
      .from('acconti_stipendio')
      .select('id, business_id, dipendente_id, importo, data, tipo, tipo_erogazione, mese_riferimento, note, firma_stato, firmato_at, firma_scade_at')
      .eq('firma_token', token)
      .single();

    if (error || !acc) return res.status(404).json({ error: 'Ricevuta non trovata' });
    if (acc.firma_scade_at && new Date(acc.firma_scade_at) < new Date())
      return res.status(410).json({ error: 'Link scaduto', scaduto: true });

    const { data: dip } = await sb.from('dipendenti')
      .select('nome, cognome').eq('id', acc.dipendente_id).single();
    const { data: biz } = await sb.from('businesses')
      .select('name').eq('id', acc.business_id).single();

    return res.status(200).json({ ...acc, dipendenti: dip || {}, businesses: biz || {} });
  }

  if (req.method === 'POST') {
    const { firma } = req.body;
    if (!firma) return res.status(400).json({ error: 'Firma mancante' });

    const { data: ex } = await sb.from('acconti_stipendio')
      .select('firma_stato, firma_scade_at').eq('firma_token', token).single();

    if (!ex) return res.status(404).json({ error: 'Non trovata' });
    if (ex.firma_stato === 'firmata') return res.status(409).json({ error: 'Già firmata' });
    if (ex.firma_scade_at && new Date(ex.firma_scade_at) < new Date())
      return res.status(410).json({ error: 'Link scaduto' });

    const { error } = await sb.from('acconti_stipendio')
      .update({ firma_data_url: firma, firma_stato: 'firmata', firmato_at: new Date().toISOString() })
      .eq('firma_token', token);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  res.status(405).json({ error: 'Metodo non consentito' });
};
