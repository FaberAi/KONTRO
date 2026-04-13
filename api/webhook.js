const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(Buffer.from(data)));
    req.on('error', reject);
  });
}

async function logEvento(businessId, evento, piano, stripeEventId) {
  await sb.from('abbonamenti_log').insert({
    business_id: businessId, evento, piano, stripe_event_id: stripeEventId
  });
}

const handler = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).json({ error: 'Webhook error: ' + err.message });
  }

  const obj = event.data.object;

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const businessId = obj.metadata?.businessId;
        const piano      = obj.metadata?.piano;
        if (!businessId || !piano) break;
        await sb.from('businesses').update({
          piano,
          stripe_subscription_id: obj.subscription,
          piano_scadenza: null
        }).eq('id', businessId);
        await logEvento(businessId, 'attivato', piano, event.id);
        break;
      }

      case 'invoice.payment_succeeded': {
        const sub = await stripe.subscriptions.retrieve(obj.subscription);
        const businessId = sub.metadata?.businessId;
        const piano      = sub.metadata?.piano;
        if (!businessId) break;
        await sb.from('businesses').update({
          piano,
          piano_scadenza: new Date(sub.current_period_end * 1000).toISOString()
        }).eq('id', businessId);
        await logEvento(businessId, 'rinnovato', piano, event.id);
        break;
      }

      case 'customer.subscription.deleted':
      case 'invoice.payment_failed': {
        const subId = obj.id || obj.subscription;
        if (!subId) break;
        const sub = await stripe.subscriptions.retrieve(subId);
        const businessId = sub.metadata?.businessId;
        if (!businessId) break;
        await sb.from('businesses').update({
          piano: 'free',
          stripe_subscription_id: null,
          piano_scadenza: null
        }).eq('id', businessId);
        await logEvento(businessId, 'cancellato', 'free', event.id);
        break;
      }
    }
  } catch (err) {
    console.error('Webhook handler error:', err);
  }

  res.json({ received: true });
};

handler.config = { api: { bodyParser: false } };
module.exports = handler;
