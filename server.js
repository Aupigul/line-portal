const express = require('express');
const axios = require('axios');
const { Pool } = require('pg');
const app = express();
app.use(express.json());
app.use(express.static('public'));

const CHANNEL_ACCESS_TOKEN = process.env.LINE_TOKEN;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS group_assignments (
      group_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      group_name TEXT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      group_id TEXT NOT NULL,
      from_type TEXT NOT NULL,
      sender_id TEXT,
      agent_id TEXT,
      agent_name TEXT,
      text TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log('Database initialized');
}

initDB().catch(console.error);

const agents = {
  "oo":   { name: "อุ๊",    password: "oo1234",   lineUserId: "U7662b0ed329611845d54422bac731972" },
  "pong": { name: "พงษ์",  password: "pong1234", lineUserId: null },
  "kai":  { name: "ไก่",   password: "kai1234",  lineUserId: null },
  "benz": { name: "เบ็นซ์", password: "benz1234", lineUserId: null }
};

// ส่งแจ้งเตือนหาพนักงานผ่าน LINE
async function notifyAgent(agentId, groupName, text) {
  const agent = agents[agentId];
  if (!agent || !agent.lineUserId) return;
  try {
    await axios.post('https://api.line.me/v2/bot/message/push', {
      to: agent.lineUserId,
      messages: [{
        type: 'text',
        text: `🔔 มีข้อความใหม่!\nกลุ่ม: ${groupName}\nข้อความ: ${text}`
      }]
    }, {
      headers: { Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}` }
    });
  } catch (err) {
    console.error('Notify error:', err.message);
  }
}

// LINE Webhook
app.post('/webhook', async (req, res) => {
  const events = req.body.events || [];
  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      const groupId = event.source.groupId;
      const text = event.message.text;
      const senderId = event.source.userId;

      if (groupId) {
        // เก็บข้อความ
        await pool.query(
          `INSERT INTO messages (group_id, from_type, sender_id, text) VALUES ($1, 'customer', $2, $3)`,
          [groupId, senderId, text]
        );

        // หาว่ากลุ่มนี้ assign ให้ใคร แล้วแจ้งเตือน
        const result = await pool.query(
          `SELECT agent_id, group_name FROM group_assignments WHERE group_id = $1`,
          [groupId]
        );
        if (result.rows.length > 0) {
          const { agent_id, group_name } = result.rows[0];
          await notifyAgent(agent_id, group_name, text);
        }
      }
    }
  }
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
app.get('/my-groups/:agentId', async (req, res) => {
  const { agentId } = req.params;
  const result = await pool.query(
    `SELECT group_id, group_name FROM group_assignments WHERE agent_id = $1`,
    [agentId]
  );
  const groups = await Promise.all(result.rows.map(async row => {
    const msgs = await pool.query(
      `SELECT from_type, sender_id, agent_id, agent_name, text, created_at FROM messages WHERE group_id = $1 ORDER BY created_at ASC`,
      [row.group_id]
    );
    return {
      groupId: row.group_id,
      groupName: row.group_name || row.group_id,
      messages: msgs.rows.map(m => ({
        from: m.from_type,
        senderId: m.sender_id,
        agentId: m.agent_id,
        agentName: m.agent_name,
        text: m.text,
        time: m.created_at
      }))
    };
  }));
  res.json(groups);
});

// ตอบข้อความ
app.post('/send', async (req, res) => {
  const { groupId, text, agentId } = req.body;
  const check = await pool.query(
    `SELECT agent_id FROM group_assignments WHERE group_id = $1`,
    [groupId]
  );
  if (!check.rows.length || check.rows[0].agent_id !== agentId) {
    return res.json({ success: false, error: 'ไม่มีสิทธิ์ตอบกลุ่มนี้' });
  }
  try {
    await axios.post('https://api.line.me/v2/bot/message/push', {
      to: groupId,
      messages: [{ type: 'text', text }]
    }, {
      headers: { Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}` }
    });
    await pool.query(
      `INSERT INTO messages (group_id, from_type, agent_id, agent_name, text) VALUES ($1, 'agent', $2, $3, $4)`,
      [groupId, agentId, agents[agentId]?.name || agentId, text]
    );
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Admin: Assign กลุ่มให้พนักงาน
app.post('/assign', async (req, res) => {
  const { groupId, agentId, groupName, adminKey } = req.body;
  if (adminKey !== process.env.ADMIN_KEY) {
    return res.json({ success: false, error: 'Admin key ผิด' });
  }
  if (!agents[agentId]) {
    return res.json({ success: false, error: 'ไม่พบพนักงานนี้' });
  }
  await pool.query(
    `INSERT INTO group_assignments (group_id, agent_id, group_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (group_id) DO UPDATE SET agent_id = $2, group_name = $3`,
    [groupId, agentId, groupName || groupId]
  );
  res.json({ success: true, message: `Assign กลุ่ม "${groupName}" ให้ ${agents[agentId].name} แล้ว` });
});

// Admin: ดูกลุ่มทั้งหมด
app.get('/admin/groups', async (req, res) => {
  const { adminKey } = req.query;
  if (adminKey !== process.env.ADMIN_KEY) {
    return res.json({ success: false, error: 'Admin key ผิด' });
  }
  const result = await pool.query(`SELECT * FROM group_assignments`);
  const groups = await Promise.all(result.rows.map(async row => {
    const count = await pool.query(`SELECT COUNT(*) FROM messages WHERE group_id = $1`, [row.group_id]);
    return {
      groupId: row.group_id,
      groupName: row.group_name,
      agentId: row.agent_id,
      agentName: agents[row.agent_id]?.name || row.agent_id,
      messageCount: parseInt(count.rows[0].count)
    };
  }));
  res.json(groups);
});

app.get('/', (req, res) => res.send('LINE Portal Server is running!'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
