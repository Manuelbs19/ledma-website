// api/create-payment-intent.js - Stripe Payment Intent API for Vercel
import Stripe from 'stripe';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

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
const auth = getAuth();

// Credit packages
const CREDIT_PACKAGES = {
  'starter': { credits: 100, price: 500, name: 'Starter Pack' },
  'popular': { credits: 300, price: 1200, name: 'Popular Pack' },
  'premium': { credits: 600, price: 2000, name: 'Premium Pack' },
  'ultimate': { credits: 1200, price: 3500, name: 'Ultimate Pack' }
};

// Authentication middleware
const authenticateUser = async (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('No token provided');
  }

  const idToken = authHeader.split('Bearer ')[1];
  const decodedToken = await auth.verifyIdToken(idToken);
  return decodedToken;
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await authenticateUser(req);
    const { packageId } = req.body;

    const selected = CREDIT_PACKAGES[packageId];
    if (!selected) {
      return res.status(400).json({ error: 'Invalid package' });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: selected.price,
      currency: 'usd',
      metadata: {
        userId: user.uid,
        packageId,
        credits: selected.credits.toString(),
        userEmail: user.email
      }
    });

    return res.json({
      clientSecret: paymentIntent.client_secret,
      package: selected
    });

  } catch (error) {
    console.error('Payment intent error:', error);
    return res.status(500).json({ error: 'Failed to create payment intent' });
  }
}
