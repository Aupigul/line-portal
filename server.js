const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const CHANNEL_ACCESS_TOKEN = process.env.LINE_TOKEN;

let groupAssignments = {};
let messages = {};
let agents = {
  "agent1": { name: "พนักงาน 1", password: "1234" },
  "agent2": { name: "พนักงาน 2", password: "1234" }
};

// LINE ส่งข้อความเข้ามาที่นี่
app.post('/webhook', (req, res) => {
  const events = req.body.events || [];
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

// Login
app.post('/login', (req, res) => {
  const { agentId, password } = req.body;
  if (agents[agentId] && agents[agentId].password === password) {
    res.json({ success: true, name: agents[agentId].name });
  } else {
    res.json({ success: false });
  }
});

// ดูกลุ่มที่ตัวเองรับผิดชอบ
app.get('/my-groups/:agentId', (req, res) => {
  const { agentId } = req.params;
  const myGroups = Object.entries(groupAssignments)
    .filter(([gId, aId]) => aId === agentId)
    .map(([gId, aId, name]) => ({
      groupId: gId,
      groupName: groupNames[gId] || gId,
      messages: messages[gId] || []
    }));
  res.json(myGroups);
});

// เก็บชื่อกลุ่ม
let groupNames = {};

// ตอบข้อความ
app.post('/send', async (req, res) => {
  const { groupId, text, agentId } = req.body;
  if (groupAssignments[groupId] !== agentId) {
    return res.json({ success: false, error: 'ไม่มีสิทธิ์' });
  }
  try {
    await axios.post('https://api.line.me/v2/bot/message/push', {
      to: groupId,
      messages: [{ type: 'text', text }]
    }, {
      headers: { Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}` }
    });
    if (!messages[groupId]) messages[groupId] = [];
    messages[groupId].push({ from: 'agent', agentId, text, time: new Date().toISOString() });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Admin: Assign กลุ่มให้พนักงาน
app.post('/assign', (req, res) => {
  const { groupId, agentId, groupName, adminKey } = req.body;
  if (adminKey !== process.env.ADMIN_KEY) {
    return res.json({ success: false, error: 'Admin key ผิด' });
  }
  groupAssignments[groupId] = agentId;
  if (groupName) groupNames[groupId] = groupName;
  res.json({ success: true });
});

// Admin: ดูกลุ่มทั้งหมด
app.get('/admin/groups', (req, res) => {
  const { adminKey } = req.query;
  if (adminKey !== process.env.ADMIN_KEY) {
    return res.json({ success: false, error: 'Admin key ผิด' });
  }
  const result = Object.entries(groupAssignments).map(([gId, aId]) => ({
    groupId: gId,
    groupName: groupNames[gId] || gId,
    agentId: aId,
    agentName: agents[aId] ? agents[aId].name : aId,
    messageCount: (messages[gId] || []).length
  }));
  res.json(result);
});

// Health check
app.get('/', (req, res) => {
  res.send('LINE Portal Server is running!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
