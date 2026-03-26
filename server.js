const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const CHANNEL_ACCESS_TOKEN = process.env.LINE_TOKEN;

// เก็บข้อมูลว่ากลุ่มไหน assign ให้พนักงานคนไหน
// และเก็บข้อความในแต่ละกลุ่ม
let groupAssignments = {}; // { groupId: agentId }
let messages = {};         // { groupId: [ {from, text, time}, ... ] }
let agents = {             // พนักงานในระบบ (เพิ่มเองได้ภายหลัง)
  "agent1": { name: "พนักงาน 1", password: "1234" },
  "agent2": { name: "พนักงาน 2", password: "1234" }
};

// LINE ส่งข้อความเข้ามาที่นี่
app.post('/webhook', (req, res) => {
  const events = req.body.events;
  events.forEach(event => {
    if (event.type === 'message' && event.message.type === 'text') {
      const groupId = event.source.groupId;
      const text = event.message.text;
      const senderId = event.source.userId;
      if (groupId) {
        if (!messages[groupId]) messages[groupId] = [];
        messages[groupId].push({
          from: 'customer',
          senderId,
          text,
          time: new Date().toISOString()
        });
      }
    }
  });
  res.sendStatus(200);
});

// Portal: Login
app.post('/login', (req, res) => {
  const { agentId, password } = req.body;
  if (agents[agentId] && agents[agentId].password === password) {
    res.json({ success: true, name: agents[agentId].name });
  } else {
    res.json({ success: false });
  }
});

// Portal: ดูกลุ่มที่ตัวเองรับผิดชอบ
app.get('/my-groups/:agentId', (req, res) => {
  const { agentId } = req.params;
  const myGroups = Object.entries(groupAssignments)
    .filter(([gId, aId]) => aId === agentId)
    .map(([gId]) => ({ groupId: gId, messages: messages[gId] || [] }));
  res.json(myGroups);
});

// Portal: ตอบข้อความ
app.post('/send', async (req, res) => {
  const { groupId, text, agentId } = req.body;
  if (groupAssignments[groupId] !== agentId) {
    return res.json({ success: false, error: 'ไม่มีสิทธิ์' });
  }
  await axios.post('https://api.line.me/v2/bot/message/push', {
    to: groupId,
    messages: [{ type: 'text', text }]
  }, {
    headers: { Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}` }
  });
  if (!messages[groupId]) messages[groupId] = [];
  messages[groupId].push({ from: 'agent', agentId, text, time: new Date().toISOString() });
  res.json({ success: true });
});

// Admin: Assign กลุ่มให้พนักงาน
app.post('/assign', (req, res) => {
  const { groupId, agentId, adminKey } = req.body;
  if (adminKey !== process.env.ADMIN_KEY) {
    return res.json({ success: false, error: 'Admin key ผิด' });
  }
  groupAssignments[groupId] = agentId;
  res.json({ success: true });
});

app.listen(3000, () => console.log('Server running'));
