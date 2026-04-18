// api/save-subscription.js
// =============================================================
// KONTRO - Salva una push subscription nel database
// Il frontend chiama questa funzione quando l'utente accetta
// le notifiche push e genera una subscription.
// =============================================================

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { subscription, userId, businessId, userAgent } = req.body;

  // Validazione input
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Subscription mancante o malformata' });
  }
  if (!userId) {
    return res.status(400).json({ error: 'userId obbligatorio' });
  }

  // Estrai i campi crittografici dalla subscription
  const endpoint = subscription.endpoint;
  const p256dh = subscription.keys && subscription.keys.p256dh;
  const auth = subscription.keys && subscription.keys.auth;

  if (!p256dh || !auth) {
    return res.status(400).json({ error: 'Chiavi crittografiche mancanti' });
  }

  // Connetti a Supabase con service key (bypass RLS perché il server è trusted)
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Configurazione server mancante' });
  }

  const sb = createClient(supabaseUrl, serviceKey);

  try {
    // UPSERT: se esiste già una subscription con lo stesso endpoint, aggiornala.
    // Questo gestisce il caso in cui l'utente riattivi le notifiche sullo stesso device.
    const { data, error } = await sb
      .from('push_subscriptions')
      .upsert({
        user_id: userId,
        business_id: businessId || null,
        endpoint: endpoint,
        p256dh: p256dh,
        auth: auth,
        user_agent: userAgent || null,
        last_used_at: new Date().toISOString()
      }, {
        onConflict: 'endpoint'
      })
      .select()
      .single();

    if (error) {
      console.error('[save-subscription] Supabase error:', error);
      return res.status(500).json({ error: error.message });
    }

    console.log('[save-subscription] Subscription salvata per user:', userId);
    return res.status(200).json({
      success: true,
      subscriptionId: data.id
    });

  } catch (err) {
    console.error('[save-subscription] Error:', err);
    return res.status(500).json({ error: err.message });
  }
};
