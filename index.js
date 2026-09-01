require('dotenv/config');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('./generated/prisma/client.ts');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET;
const SALT_ROUNDS = 10;

function makeToken(user) {
  return jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header.' });
  }
  const token = header.slice('Bearer '.length);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

app.get('/', (req, res) => {
  res.send('Bananas API is running');
});

// ---------- Signup ----------
app.post('/signup', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || typeof username !== 'string' || username.trim().length < 3) {
      return res.status(400).json({ error: 'Username needs at least 3 characters.' });
    }
    if (!password || typeof password !== 'string' || password.length < 4) {
      return res.status(400).json({ error: 'Password needs at least 4 characters.' });
    }

    const cleanUsername = username.trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { username: cleanUsername } });
    if (existing) {
      return res.status(409).json({ error: 'That username is taken.' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await prisma.user.create({
      data: {
        username: cleanUsername,
        passwordHash,
        gameState: { create: { score: 0, unlockedSkins: ['classic'] } },
      },
      include: { gameState: true },
    });

    const token = makeToken(user);
    res.status(201).json({
      token,
      username: user.username,
      score: user.gameState.score,
      unlockedSkins: user.gameState.unlockedSkins,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong creating your account.' });
  }
});

// ---------- Login ----------
app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const cleanUsername = username.trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { username: cleanUsername },
      include: { gameState: true },
    });
    if (!user) {
      return res.status(404).json({ error: 'No account with that username.' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Wrong password.' });
    }

    const token = makeToken(user);
    res.json({
      token,
      username: user.username,
      score: user.gameState.score,
      unlockedSkins: user.gameState.unlockedSkins,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong logging in.' });
  }
});

// ---------- Get game state ----------
app.get('/me/state', requireAuth, async (req, res) => {
  try {
    const gameState = await prisma.gameState.findUnique({ where: { userId: req.userId } });
    if (!gameState) return res.status(404).json({ error: 'No game state found.' });
    res.json({ score: gameState.score, unlockedSkins: gameState.unlockedSkins });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong loading your progress.' });
  }
});

// ---------- Save game state ----------
app.post('/me/state', requireAuth, async (req, res) => {
  try {
    const { score, unlockedSkins } = req.body;
    if (typeof score !== 'number' || !Array.isArray(unlockedSkins)) {
      return res.status(400).json({ error: 'score must be a number and unlockedSkins must be an array.' });
    }
    const updated = await prisma.gameState.update({
      where: { userId: req.userId },
      data: { score, unlockedSkins },
    });
    res.json({ score: updated.score, unlockedSkins: updated.unlockedSkins });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong saving your progress.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});