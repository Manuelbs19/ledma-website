// api/user.js - User Management API for Vercel
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
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

const auth = getAuth();
const db = getFirestore();

// Premium account detection
const isPremiumAccount = (email) => {
  const premiumEmails = (process.env.PREMIUM_EMAILS || 'manueladriangarcialedesma@gmail.com').split(',');
  return premiumEmails.includes(email);
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
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Authenticate user
    const user = await authenticateUser(req);

    if (req.method === 'GET') {
      // Get user data
      const userDoc = await db.collection('users').doc(user.uid).get();
      
      if (!userDoc.exists) {
        // Create new user
        const newUser = {
          uid: user.uid,
          email: user.email,
          name: user.name || user.email.split('@')[0],
          credits: isPremiumAccount(user.email) ? 999999 : 0,
          accountType: isPremiumAccount(user.email) ? 'developer' : 'free',
          dailyDownloadsUsed: 0,
          lastDailyReset: Timestamp.now(),
          createdAt: Timestamp.now(),
          totalSpent: 0,
          totalDownloads: 0
        };
        
        await db.collection('users').doc(user.uid).set(newUser);
        return res.json(newUser);
      } else {
        let userData = userDoc.data();
        
        // Reset daily downloads if needed
        const lastReset = userData.lastDailyReset?.toDate() || new Date(0);
        const now = new Date();
        const isNewDay = now.toDateString() !== lastReset.toDateString();
        
        if (isNewDay) {
          userData.dailyDownloadsUsed = 0;
          userData.lastDailyReset = Timestamp.now();
          await db.collection('users').doc(user.uid).update({
            dailyDownloadsUsed: 0,
            lastDailyReset: Timestamp.now()
          });
        }
        
        return res.json(userData);
      }
    } else if (req.method === 'POST') {
      // Update user credits
      const { amount, operation = 'subtract' } = req.body;
      const userRef = db.collection('users').doc(user.uid);
      const userDoc = await userRef.get();
      
      if (!userDoc.exists) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      const userData = userDoc.data();
      let newCredits = userData.credits;
      
      if (operation === 'add') {
        newCredits += amount;
      } else if (operation === 'subtract') {
        newCredits = Math.max(0, newCredits - amount);
      }
      
      await userRef.update({ 
        credits: newCredits,
        updatedAt: Timestamp.now()
      });
      
      return res.json({ credits: newCredits, success: true });
    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('User API error:', error);
    return res.status(401).json({ error: 'Authentication failed' });
  }
}
