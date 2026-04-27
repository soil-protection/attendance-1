/**
 * EDUTRACK v2 — server.js
 * ─────────────────────────────────────────────────────────────
 * Node.js + Express + MongoDB backend
 * Starts with an EMPTY database — all data comes from your UI
 *
 * SETUP:
 *   1. npm install express mongoose cors dotenv
 *   2. Create .env (copy .env.example → .env, fill in MONGO_URI)
 *   3. node server.js
 *
 * .env contents:
 *   MONGO_URI=mongodb://localhost:27017/edutrack
 *   PORT=3000
 * ─────────────────────────────────────────────────────────────
 */

require('dotenv').config();
const express  = require('express');
const mongoose = require('mongoose');
const cors     = require('cors');
const path     = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── MIDDLEWARE ──────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));  // Serve index.html etc.

// ── MONGODB CONNECTION ──────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/edutrack';

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅  MongoDB connected →', MONGO_URI))
  .catch(err => console.error('❌  MongoDB connection failed:', err.message));

mongoose.connection.on('disconnected', () => console.warn('⚠️  MongoDB disconnected'));

// ── SCHEMAS ─────────────────────────────────────────────────

const studentSchema = new mongoose.Schema({
  studentId: { type: String, required: true, unique: true, trim: true, uppercase: true },
  name:      { type: String, required: true, trim: true },
  class:     { type: String, required: true, trim: true },
  roll:      { type: String, trim: true, default: '' },
  email:     { type: String, trim: true, lowercase: true, default: '' },
  phone:     { type: String, trim: true, default: '' },
  addedAt:   { type: Date,   default: Date.now }
}, { versionKey: false });

const attendanceSchema = new mongoose.Schema({
  studentId:   { type: String, required: true },   // internal _id or studentId ref
  studentName: { type: String, required: true },
  rollNo:      { type: String },
  date:        { type: String, required: true },    // "YYYY-MM-DD"
  subject:     { type: String, required: true, trim: true },
  class:       { type: String, required: true, trim: true },
  teacher:     { type: String, trim: true, default: '' },
  status:      { type: String, enum: ['Present', 'Absent', 'Late'], required: true },
  savedAt:     { type: Date,   default: Date.now }
}, { versionKey: false });

// One record per student per subject per day
attendanceSchema.index({ studentId: 1, date: 1, subject: 1 }, { unique: true });

const Student    = mongoose.model('Student',    studentSchema);
const Attendance = mongoose.model('Attendance', attendanceSchema);

// ── HEALTH CHECK ────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  const state = mongoose.connection.readyState;
  res.json({
    ok: state === 1,
    db: ['disconnected','connected','connecting','disconnecting'][state] || 'unknown'
  });
});

// ════════════════════════════════════════════════════════════
//  STUDENT ROUTES
// ════════════════════════════════════════════════════════════

// GET all students
app.get('/api/students', async (req, res) => {
  try {
    const students = await Student.find().sort({ addedAt: -1 });
    res.json(students);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST add new student
app.post('/api/students', async (req, res) => {
  try {
    const { name, studentId, class: cls, roll, email, phone } = req.body;

    if (!name || !studentId || !cls)
      return res.status(400).json({ error: 'name, studentId and class are required' });

    // Check duplicate studentId
    const exists = await Student.findOne({ studentId: studentId.toUpperCase() });
    if (exists)
      return res.status(409).json({ error: `Student ID "${studentId}" already exists` });

    const student = await Student.create({ name, studentId, class: cls, roll, email, phone });
    res.status(201).json(student);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single student
app.get('/api/students/:id', async (req, res) => {
  try {
    const student = await Student.findById(req.params.id);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    res.json(student);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update student
app.put('/api/students/:id', async (req, res) => {
  try {
    const student = await Student.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true, runValidators: true }
    );
    if (!student) return res.status(404).json({ error: 'Student not found' });
    res.json(student);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE student (also removes their attendance)
app.delete('/api/students/:id', async (req, res) => {
  try {
    const student = await Student.findByIdAndDelete(req.params.id);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    // Remove all attendance records for this student
    const deleted = await Attendance.deleteMany({ studentId: req.params.id });
    res.json({ message: 'Student deleted', attendanceRecordsRemoved: deleted.deletedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
//  ATTENDANCE ROUTES
// ════════════════════════════════════════════════════════════

// GET all attendance records (with optional filters)
app.get('/api/attendance', async (req, res) => {
  try {
    const { studentId, subject, class: cls, from, to, date } = req.query;
    const filter = {};

    if (studentId) filter.studentId = studentId;
    if (subject)   filter.subject   = new RegExp(subject, 'i');
    if (cls)       filter.class     = new RegExp(cls, 'i');
    if (date)      filter.date      = date;
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = from;
      if (to)   filter.date.$lte = to;
    }

    const records = await Attendance.find(filter).sort({ date: -1, savedAt: -1 });
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST save attendance for a whole class (batch upsert)
app.post('/api/attendance', async (req, res) => {
  try {
    const { records } = req.body;
    if (!records || !Array.isArray(records) || !records.length)
      return res.status(400).json({ error: 'records array is required' });

    const results = [];
    for (const r of records) {
      const { studentId, studentName, rollNo, date, subject, class: cls, teacher, status } = r;

      if (!studentId || !date || !subject || !cls || !status) {
        results.push({ studentId, ok: false, error: 'Missing required fields' });
        continue;
      }

      try {
        // Upsert: update existing or insert new
        const doc = await Attendance.findOneAndUpdate(
          { studentId, date, subject },
          { studentId, studentName, rollNo, date, subject, class: cls, teacher, status, savedAt: new Date() },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        results.push({ studentId, ok: true, id: doc._id });
      } catch (e) {
        results.push({ studentId, ok: false, error: e.message });
      }
    }

    const saved   = results.filter(r => r.ok).length;
    const failed  = results.length - saved;
    res.json({ message: `${saved} records saved, ${failed} failed`, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET attendance for a specific student
app.get('/api/attendance/student/:studentId', async (req, res) => {
  try {
    const records = await Attendance.find({ studentId: req.params.studentId }).sort({ date: -1 });

    const total   = records.length;
    const present = records.filter(r => r.status === 'Present').length;
    const absent  = records.filter(r => r.status === 'Absent').length;
    const late    = records.filter(r => r.status === 'Late').length;
    const pct     = total > 0 ? ((present / total) * 100).toFixed(1) : '0.0';

    // Subject breakdown
    const subjects = {};
    records.forEach(r => {
      if (!subjects[r.subject]) subjects[r.subject] = { present: 0, total: 0 };
      subjects[r.subject].total++;
      if (r.status === 'Present') subjects[r.subject].present++;
    });

    res.json({ records, stats: { total, present, absent, late, percentage: pct }, subjects });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE single attendance record
app.delete('/api/attendance/:id', async (req, res) => {
  try {
    const record = await Attendance.findByIdAndDelete(req.params.id);
    if (!record) return res.status(404).json({ error: 'Record not found' });
    res.json({ message: 'Record deleted', id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
//  STATS ROUTE (Dashboard summary)
// ════════════════════════════════════════════════════════════

app.get('/api/stats', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const [totalStudents, todayRecords, allRecords] = await Promise.all([
      Student.countDocuments(),
      Attendance.find({ date: today }),
      Attendance.find()
    ]);

    const presentToday = todayRecords.filter(r => r.status === 'Present').length;
    const absentToday  = todayRecords.filter(r => r.status === 'Absent').length;
    const totalPresent = allRecords.filter(r => r.status === 'Present').length;
    const avgPct = allRecords.length > 0
      ? ((totalPresent / allRecords.length) * 100).toFixed(1)
      : null;

    res.json({
      totalStudents,
      presentToday,
      absentToday,
      totalRecords: allRecords.length,
      averageAttendance: avgPct
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── FALLBACK: serve index.html for all non-API routes ───────
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'index.html'));
  } else {
    res.status(404).json({ error: 'API route not found' });
  }
});

// ── START SERVER ────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════╗
║   EduTrack v2 — Attendance System   ║
╠══════════════════════════════════════╣
║  Server  →  http://localhost:${PORT}   ║
║  API     →  http://localhost:${PORT}/api║
║  DB      →  ${MONGO_URI.slice(0,28)}... ║
╚══════════════════════════════════════╝
  `);
});
