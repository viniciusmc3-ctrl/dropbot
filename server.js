const express = require('express');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/shopify/orders', async (req, res) => {
  const { shop, token, limit = 50, since_id } = req.query;
  if (!shop || !token) return res.status(400).json({ error: 'shop e token são obrigatórios' });
  try {
    const params = new URLSearchParams({ status: 'any', financial_status: 'paid', limit, ...(since_id && { since_id }) });
    const response = await axios.get(`https://${shop}/admin/api/2024-01/orders.json?${params}`, { headers: { 'X-Shopify-Access-Token': token } });
    res.json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.errors || err.message });
  }
});

app.get('/api/shopify/test', async (req, res) => {
  const { shop, token } = req.query;
  if (!shop || !token) return res.status(400).json({ error: 'shop e token são obrigatórios' });
  try {
    const response = await axios.get(`https://${shop}/admin/api/2024-01/shop.json`, { headers: { 'X-Shopify-Access-Token': token } });
    res.json({ ok: true, shop: response.data.shop?.name });
  } catch (err) {
    res.status(err.response?.status || 500).json({ ok: false, error: err.response?.data?.errors || err.message });
  }
});

app.get('/api/whatsapp/test', async (req, res) => {
  const { instanceId, instanceToken, clientToken } = req.query;
  try {
    const r = await axios.get(`https://api.z-api.io/instances/${instanceId}/token/${instanceToken}/status`, { headers: { 'Client-Token': clientToken || '' } });
    res.json({ ok: true, state: r.data?.connected ? 'connected' : r.data?.status });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.response?.data || err.message });
  }
});

app.post('/api/whatsapp/send', async (req, res) => {
  const { instanceId, instanceToken, clientToken, number, message, imageUrl } = req.body;
  if (!instanceId || !instanceToken || !number || !message) return res.status(400).json({ error: 'Campos obrigatórios faltando' });
  const headers = { 'Content-Type': 'application/json', 'Client-Token': clientToken || '' };
  const base = `https://api.z-api.io/instances/${instanceId}/token/${instanceToken}`;
  try {
    const response = imageUrl
      ? await axios.post(`${base}/send-image`, { phone: number, image: imageUrl, caption: message }, { headers })
      : await axios.post(`${base}/send-text`, { phone: number, message }, { headers });
    res.json({ ok: true, data: response.data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.response?.data || err.message });
  }
});

app.post('/api/whatsapp/send-batch', async (req, res) => {
  const { instanceId, instanceToken, clientToken, number, orders } = req.body;
  if (!orders || !Array.isArray(orders)) return res.status(400).json({ error: 'orders deve ser um array' });
  const headers = { 'Content-Type': 'application/json', 'Client-Token': clientToken || '' };
  const base = `https://api.z-api.io/instances/${instanceId}/token/${instanceToken}`;
  const results = [];
  for (const order of orders) {
    try {
      order.imageUrl
        ? await axios.post(`${base}/send-image`, { phone: number, image: order.imageUrl, caption: order.message }, { headers })
        : await axios.post(`${base}/send-text`, { phone: number, message: order.message }, { headers });
      results.push({ orderNum: order.orderNum, ok: true });
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      results.push({ orderNum: order.orderNum, ok: false, error: err.response?.data || err.message });
    }
  }
  res.json({ results });
});

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`✅ DropBot rodando na porta ${PORT}`));
