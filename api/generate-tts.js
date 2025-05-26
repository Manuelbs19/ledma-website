// api/generate-tts.js - Text-to-Speech API for Vercel
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

// Voice mapping for Google TTS
const VOICE_MAPPING = {
  'es-ES-Standard-A': { languageCode: 'es-ES', name: 'es-ES-Standard-A', ssmlGender: 'FEMALE' },
  'es-ES-Wavenet-B': { languageCode: 'es-ES', name: 'es-ES-Wavenet-B', ssmlGender: 'MALE' },
  'es-ES-Wavenet-C': { languageCode: 'es-ES', name: 'es-ES-Wavenet-C', ssmlGender: 'FEMALE' },
  'es-MX-Wavenet-A': { languageCode: 'es-MX', name: 'es-MX-Wavenet-A', ssmlGender: 'FEMALE' },
  'es-MX-Wavenet-B': { languageCode: 'es-MX', name: 'es-MX-Wavenet-B', ssmlGender: 'MALE' },
  'en-US-Standard-A': { languageCode: 'en-US', name: 'en-US-Standard-A', ssmlGender: 'FEMALE' },
  'en-US-Wavenet-A': { languageCode: 'en-US', name: 'en-US-Wavenet-A', ssmlGender: 'MALE' },
  'en-US-Wavenet-B': { languageCode: 'en-US', name: 'en-US-Wavenet-B', ssmlGender: 'FEMALE' },
  'en-US-Neural2-A': { languageCode: 'en-US', name: 'en-US-Neural2-A', ssmlGender: 'MALE' },
  'en-US-Neural2-C': { languageCode: 'en-US', name: 'en-US-Neural2-C', ssmlGender: 'FEMALE' }
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
    const { text, voice = 'es-ES-Wavenet-C', speed = 1.0, downloadType = 'daily' } = req.body;

    if (!text || text.length > 5000) {
      return res.status(400).json({ error: 'Invalid text length' });
    }

    const userDoc = await db.collection('users').doc(user.uid).get();
    const userData = userDoc.data();

    const isPremium = isPremiumAccount(user.email) || userData.accountType === 'developer';

    if (downloadType === 'daily') {
      if (userData.dailyDownloadsUsed >= 1 && !isPremium) {
        return res.status(403).json({ error: 'Daily limit reached' });
      }
    } else if (downloadType === 'premium') {
      const creditsNeeded = 15;
      if (userData.credits < creditsNeeded && !isPremium) {
        return res.status(403).json({ error: 'Insufficient credits' });
      }
    }

    const voiceConfig = VOICE_MAPPING[voice] || VOICE_MAPPING['es-ES-Wavenet-C'];

    const ttsRequest = {
      input: { text: text },
      voice: voiceConfig,
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: speed,
        pitch: 0,
        volumeGainDb: 0
      }
    };

    const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${process.env.GOOGLE_TTS_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(ttsRequest)
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Google TTS Error:', errorData);
      return res.status(500).json({ error: 'TTS generation failed' });
    }

    const ttsData = await response.json();
    const audioBuffer = Buffer.from(ttsData.audioContent, 'base64');

    const updates = {
      totalDownloads: (userData.totalDownloads || 0) + 1,
      updatedAt: Timestamp.now()
    };

    if (downloadType === 'daily' && !isPremium) {
      updates.dailyDownloadsUsed = userData.dailyDownloadsUsed + 1;
    } else if (downloadType === 'premium' && !isPremium) {
      updates.credits = userData.credits - 15;
    }

    await db.collection('users').doc(user.uid).update(updates);

    await db.collection('usage_logs').add({
      userId: user.uid,
      type: 'tts_generation',
      downloadType: downloadType,
      textLength: text.length,
      voice: voice,
      creditsUsed: downloadType === 'premium' && !isPremium ? 15 : 0,
      timestamp: Timestamp.now()
    });

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.length);
    res.setHeader('Content-Disposition', 'attachment; filename="ledma-audio.mp3"');

    return res.send(audioBuffer);

  } catch (error) {
    console.error('TTS Generation error:', error);
    return res.status(500).json({ error: 'Failed to generate audio' });
  }
}
