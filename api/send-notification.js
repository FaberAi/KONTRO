// api/send-notification.js
// =============================================================
// KONTRO - Invia notifiche push agli utenti abbonati
// 
// Come chiamare questo endpoint (da frontend o da altre API):
//   POST /api/send-notification
//   Body: {
//     userIds: ['uuid1', 'uuid2'],  // A quali utenti mandare (uno o piu')
//     notification: {
//       title: 'Chiusura serale inviata',
//       body: 'Mario ha chiuso la cassa: € 1.234,50',
//       url: '/app',               // dove andare al click (opzionale)
//       icon: '/icons/icon-192.png',
//       tag: 'chiusura-serale',    // per sostituire notifiche vecchie
//       requireInteraction: false  // resta finche' cliccata? (default no)
//     }
//   }
// 
// SICUREZZA: questo endpoint dovrebbe essere chiamato solo da:
//   - altre funzioni server (es. dopo chiusura serale)
//   - utenti autenticati che notificano se stessi (es. test)
// 
// Per ora lo lasciamo aperto per il primo test.
// In futuro aggiungeremo un controllo su x-api-key o auth.uid()
// =============================================================

const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');

// Setup VAPID
webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userIds, notification } = req.body;

  // Validazione input
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return res.status(400).json({ error: 'userIds deve essere un array non vuoto' });
  }
  if (!notification || !notification.title) {
    return res.status(400).json({ error: 'notification.title obbligatorio' });
  }

  // Connetti a Supabase
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Configurazione server mancante' });
  }

  const sb = createClient(supabaseUrl, serviceKey);

  try {
    // Recupera tutte le subscription degli utenti destinatari
    const { data: subscriptions, error } = await sb
      .from('push_subscriptions')
      .select('*')
      .in('user_id', userIds);

    if (error) {
      console.error('[send-notification] DB error:', error);
      return res.status(500).json({ error: error.message });
    }

    if (!subscriptions || subscriptions.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'Nessuna subscription trovata per gli utenti specificati',
        sent: 0
      });
    }

    console.log(`[send-notification] Invio a ${subscriptions.length} device(s)`);

    // Costruisci il payload della notifica
    const payload = JSON.stringify({
      title: notification.title,
      body: notification.body || '',
      icon: notification.icon || '/icons/icon-192.png',
      badge: notification.badge || '/icons/icon-192.png',
      image: notification.image,
      tag: notification.tag || 'kontro-' + Date.now(),
      url: notification.url || '/app',
      requireInteraction: notification.requireInteraction || false,
      actions: notification.actions || [],
      vibrate: notification.vibrate || [100, 50, 100],
      data: notification.data || {}
    });

    // Invia a tutte le subscription in parallelo
    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        const pushSubscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth
          }
        };

        try {
          await webpush.sendNotification(pushSubscription, payload);
          
          // Aggiorna last_used_at
          await sb
            .from('push_subscriptions')
            .update({ last_used_at: new Date().toISOString() })
            .eq('id', sub.id);
          
          return { success: true, subscriptionId: sub.id };

        } catch (err) {
          console.error(`[send-notification] Errore per sub ${sub.id}:`, err.statusCode, err.body);

          // Se la subscription e' invalida (410 Gone o 404 Not Found), cancellala dal DB
          // Queste sono subscription di device che hanno disinstallato l'app o revocato il permesso
          if (err.statusCode === 410 || err.statusCode === 404) {
            await sb
              .from('push_subscriptions')
              .delete()
              .eq('id', sub.id);
            return { success: false, subscriptionId: sub.id, reason: 'subscription expired, removed' };
          }

          return { success: false, subscriptionId: sub.id, error: err.message };
        }
      })
    );

    // Conta successi e fallimenti
    const sent = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const failed = results.length - sent;

    return res.status(200).json({
      success: true,
      total: subscriptions.length,
      sent: sent,
      failed: failed,
      details: results.map(r => r.value || { error: r.reason && r.reason.message })
    });

  } catch (err) {
    console.error('[send-notification] Fatal error:', err);
    return res.status(500).json({ error: err.message });
  }
};
