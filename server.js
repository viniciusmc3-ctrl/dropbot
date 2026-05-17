const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const SHOPIFY_CLIENT_ID = 'd9493f349640a117d78d9b6dbd632242';
const SHOPIFY_CLIENT_SECRET = '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';

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Callback OAuth - mostra o token na tela
app.get('/auth/callback', async (req, res) => {
  const { shop, code } = req.query;
  if (!shop || !code) return res.status(400).send('Parâmetros inválidos');
  try {
    const response = await axios.post(`https://${shop}/admin/oauth/access_token`, {
      client_id: SHOPIFY_CLIENT_ID,
      client_secret: SHOPIFY_CLIENT_SECRET,
      code,
    });
    const accessToken = response.data.access_token;
    res.send(`<html><body style="font-family:monospace;padding:40px;background:#0d1117;color:#e6edf3">
      <h2>✅ Token gerado com sucesso!</h2>
      <p>Copie o token abaixo e cole no campo <strong>Access Token</strong> nas Configurações do DropBot:</p>
      <input style="width:100%;padding:12px;font-size:14px;background:#161b22;color:#58a6ff;border:1px solid #30363d;border-radius:8px" value="${accessToken}" onclick="this.select()"/>
      <br><br><a href="/" style="color:#00c853">← Voltar ao DropBot</a>
    </body></html>`);
  } catch (err) {
    res.status(500).send('Erro: ' + err.message);
  }
});

app.get('/api/shopify/orders', async (req, res) => {
  const { shop, token, limit = 50 } = req.query;
  if (!shop || !token) return res.status(400).json({ error: 'shop e token são obrigatórios' });
  try {
    const params = new URLSearchParams({ status: 'any', financial_status: 'paid', limit });
    const r = await axios.get(`https://${shop}/admin/api/2024-01/orders.json?${params}`, {
      headers: { 'X-Shopify-Access-Token': token }
    });
    res.json(r.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.errors || err.message });
  }
});

app.get('/api/shopify/test', async (req, res) => {
  const { shop, token } = req.query;
  if (!shop || !token) return res.status(400).json({ error: 'shop e token são obrigatórios' });
  try {
    const r = await axios.get(`https://${shop}/admin/api/2024-01/shop.json`, {
      headers: { 'X-Shopify-Access-Token': token }
    });
    res.json({ ok: true, shop: r.data.shop?.name });
  } catch (err) {
    res.status(err.response?.status || 500).json({ ok: false, error: err.response?.data?.errors || err.message });
  }
});

app.get('/api/whatsapp/test', async (req, res) => {
  const { instanceId, instanceToken, clientToken } = req.query;
  try {
    const r = await axios.get(`https://api.z-api.io/instances/${instanceId}/token/${instanceToken}/status`, {
      headers: { 'Client-Token': clientToken || '' }
    });
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

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`✅ DropBot rodando na porta ${PORT}`));
