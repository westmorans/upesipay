const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Queue Management System
let queue = [];
let isProcessing = false;
let logs = [];

function addLog(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const logEntry = { id: Date.now() + Math.random(), timestamp, message, type };
  logs.unshift(logEntry);
  if (logs.length > 100) logs.pop(); // Keep last 100 logs
}

// Queue Processor with 6-second delay loop
async function processQueue() {
  if (isProcessing || queue.length === 0) return;

  isProcessing = true;

  while (queue.length > 0) {
    const task = queue.shift();
    const { phone, amount, reference, description } = task;

    addLog(`⏳ Processing STK push for ${phone} (Amount: ${amount})...`, 'info');

    try {
      const authHeader = process.env.UPESI_BASIC_AUTH_TOKEN.startsWith('Basic ')
        ? process.env.UPESI_BASIC_AUTH_TOKEN
        : `Basic ${process.env.UPESI_BASIC_AUTH_TOKEN}`;

      const response = await fetch('https://upesipay.com/api/v2/disbursement-wallet/topup/', {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          phone_number: phone,  // Fixed: using 'phone_number' as requested by UpesiPay API
          amount: Number(amount),
          reference: reference || `REF-${Date.now()}`,
          description: description || 'Wallet Top-up'
        })
      });

      const data = await response.json().catch(() => ({ message: 'Invalid JSON response from UpesiPay' }));

      if (response.ok) {
        addLog(`✅ STK Push sent successfully to ${phone}: ${JSON.stringify(data)}`, 'success');
      } else {
        addLog(`❌ Failed for ${phone} [Status ${response.status}]: ${JSON.stringify(data)}`, 'error');
      }
    } catch (err) {
      addLog(`💥 Request Error for ${phone}: ${err.message}`, 'error');
    }

    if (queue.length > 0) {
      addLog(`⏸ Waiting 6 seconds before processing next request (${queue.length} remaining in queue)...`, 'info');
      await new Promise(resolve => setTimeout(resolve, 6000));
    }
  }

  addLog(`🎉 All queue tasks completed!`, 'success');
  isProcessing = false;
}

// API Endpoints
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/queue', (req, res) => {
  const { numbers, amount, reference, description } = req.body;

  if (!numbers || !Array.isArray(numbers) || numbers.length === 0) {
    return res.status(400).json({ error: 'Please provide an array of phone numbers.' });
  }

  if (!amount || isNaN(amount)) {
    return res.status(400).json({ error: 'Please provide a valid amount.' });
  }

  const tasks = numbers.map(num => ({
    phone: num.trim(),
    amount: amount,
    reference: reference,
    description: description
  }));

  queue.push(...tasks);
  addLog(`📥 Added ${tasks.length} task(s) to queue. Total in queue: ${queue.length}`, 'info');

  // Trigger background loop execution
  processQueue();

  res.json({ message: `Successfully queued ${tasks.length} requests.`, queueLength: queue.length });
});

app.get('/api/status', (req, res) => {
  res.json({
    isProcessing,
    queueLength: queue.length,
    logs
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
