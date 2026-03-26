const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());
app.use(express.static('public'));

const CHANNEL_ACCESS_TOKEN = process.env.LINE_TOKEN;

let groupAssignments = {};
let messages = {};
let groupNames = {};

let agents = {
  "oo": { name: "อุ๊", password: "oo1234" },
  "pong": { name: "พงษ์", password: "pong1234" },
  "kai": { name: "ไก่", password: "kai1234" },
  "benz": { name: "เบ็นซ์", password: "benz1234" }
};

// LINE Webhook
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
    res.json({ success: false, error: 'Username หรือ Password ไม่ถูกต้อง' });
  }
});

// ดูกลุ่มของตัวเอง
app.get('/my-groups/:agentId', (req, res) => {
  const { agentId } = req.params;
  const myGroups = Object.entries(groupAssignments)
    .filter(([gId, aId]) => aId === agentId)
    .map(([gId]) => ({
      groupId: gId,
      groupName: groupNames[gId] || gId,
      messages: messages[gId] || []
    }));
  res.json(myGroups);
});

// ตอบข้อความ
app.post('/send', async (req, res) => {
  const { groupId, text, agentId } = req.body;
  if (groupAssignments[groupId] !== agentId) {
    return res.json({ success: false, error: 'ไม่มีสิทธิ์ตอบกลุ่มนี้' });
  }
  try {
    await axios.post('https://api.line.me/v2/bot/message/push', {
      to: groupId,
      messages: [{ type: 'text', text }]
    }, {
      headers: { Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}` }
    });
    messages[groupId].push({ from: 'agent', agentId, agentName: agents[agentId].name, text, time: new Date().toISOString() });
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
  if (!agents[agentId]) {
    return res.json({ success: false, error: 'ไม่พบพนักงานนี้' });
  }
  groupAssignments[groupId] = agentId;
  if (groupName) groupNames[groupId] = groupName;
  res.json({ success: true, message: `Assign กลุ่ม "${groupName}" ให้ ${agents[agentId].name} แล้ว` });
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

app.get('/health', (req, res) => res.send('LINE Portal Server is running!'));
app.get('/', (req, res) => res.send('LINE Portal Server is running!'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
