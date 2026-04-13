const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const PIANI = {
  pro:      { priceId: process.env.STRIPE_PRICE_PRO,      nome: 'Pro' },
  business: { priceId: process.env.STRIPE_PRICE_BUSINESS, nome: 'Business' }
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { piano, businessId, userEmail, returnUrl } = req.body;

  if (!PIANI[piano]) return res.status(400).json({ error: 'Piano non valido' });
  if (!businessId)   return res.status(400).json({ error: 'businessId mancante' });

  try {
    // Recupera o crea il customer Stripe
    const { data: biz } = await sb.from('businesses').select('stripe_customer_id,nome').eq('id', businessId).single();

    let customerId = biz?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userEmail,
        name: biz?.nome || '',
        metadata: { businessId }
      });
      customerId = customer.id;
      await sb.from('businesses').update({ stripe_customer_id: customerId }).eq('id', businessId);
    }

    // Crea la checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: PIANI[piano].priceId, quantity: 1 }],
      success_url: `${returnUrl}?checkout=success&piano=${piano}`,
      cancel_url:  `${returnUrl}?checkout=cancel`,
      metadata: { businessId, piano },
      subscription_data: { metadata: { businessId, piano } },
      locale: 'it'
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    res.status(500).json({ error: err.message });
  }
};
