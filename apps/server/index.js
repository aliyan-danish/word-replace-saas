const express = require('express');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/auth.routes');
const jobsRoutes = require('./routes/jobs.routes');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Auth routes (register/login) are grouped under /auth per the RESTful-by-resource convention.
app.use('/auth', authRoutes);

// Job routes (file upload, and later scan/replace/download) grouped under /api/jobs.
app.use('/api/jobs', jobsRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));