// api/webhook/stripe.js - Stripe Webhook API for Vercel
import Stripe from 'stripe';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

// Initialize Firebase Admin (only once)
if (!getApps().length) {
  const serviceAccount = {
    type: "service_account",
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
    auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
    universe_domain: "googleapis.com"
  };

  initializeApp({
    credential: cert(serviceAccount),
    databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com`
  });
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const db = getFirestore();

// Disable body parser for webhook
export const config = {
  api: {
    bodyParser: false,
  },
};

// Helper function to get raw body
const getRawBody = (req) => {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      resolve(Buffer.from(data));
    });
  });
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const rawBody = await getRawBody(req);
    const sig = req.headers['stripe-signature'];

    let event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object;
      const { userId, credits, packageId } = paymentIntent.metadata;

      try {
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();

        if (userDoc.exists) {
          const userData = userDoc.data();
          const newCredits = userData.credits + parseInt(credits);

          await userRef.update({
            credits: newCredits,
            totalSpent: (userData.totalSpent || 0) + (paymentIntent.amount / 100),
            lastPurchase: Timestamp.now(),
            updatedAt: Timestamp.now()
          });

          await db.collection('transactions').add({
            userId: userId,
            type: 'purchase',
            packageId: packageId,
            credits: parseInt(credits),
            amount: paymentIntent.amount / 100,
            paymentIntentId: paymentIntent.id,
            timestamp: Timestamp.now()
          });

          console.log(`✅ Credits added: ${credits} credits to user ${userId}`);
        }
      } catch (error) {
        console.error('Error processing payment:', error);
        return res.status(500).json({ error: 'Error processing payment' });
      }
    }

    return res.json({ received: true });

  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}
