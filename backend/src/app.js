const express = require('express');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/authRoutes');
const batchRoutes = require('./routes/batchRoutes');
const certificateRoutes = require('./routes/certificateRoutes');
const publicRoutes = require('./routes/publicRoutes');
const jobRoutes = require('./routes/jobRoutes');

const app = express();

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/batches', batchRoutes);
app.use('/api/certificates', certificateRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/jobs', jobRoutes);

// Public verification portal shortcut
app.get('/verify', (req, res) => {
  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect('/api/public/portal' + query);
});

// Health check
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'CertiFlow API'
  });
});

// Hello route
app.get('/api/hello', (req, res) => {
  res.status(200).json({ message: 'Hello from CertiFlow API' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Unhandled Error]', err);
  res.status(500).json({
    error: 'INTERNAL_SERVER_ERROR',
    message: err.message || 'An unexpected error occurred.'
  });
});

module.exports = app;
