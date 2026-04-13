const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { businessId, returnUrl } = req.body;
  if (!businessId) return res.status(400).json({ error: 'businessId mancante' });

  try {
    const { data: biz } = await sb.from('businesses')
      .select('stripe_customer_id').eq('id', businessId).single();

    if (!biz?.stripe_customer_id)
      return res.status(400).json({ error: 'Nessun abbonamento attivo' });

    const session = await stripe.billingPortal.sessions.create({
      customer: biz.stripe_customer_id,
      return_url: returnUrl
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Portal error:', err);
    res.status(500).json({ error: err.message });
  }
};
