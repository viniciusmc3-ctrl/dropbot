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

// OAuth callback
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

// Shopify - buscar pedidos pagos com imagens
app.get('/api/shopify/orders', async (req, res) => {
  const { shop, token, limit = 50 } = req.query;
  if (!shop || !token) return res.status(400).json({ error: 'shop e token são obrigatórios' });
  try {
    const params = new URLSearchParams({ status: 'any', financial_status: 'paid', limit });
    const r = await axios.get(`https://${shop}/admin/api/2024-01/orders.json?${params}`, {
      headers: { 'X-Shopify-Access-Token': token }
    });

    const orders = r.data.orders || [];

    // Coleta todos os product_ids únicos
    const productIds = [...new Set(
      orders.flatMap(o => (o.line_items || []).map(i => i.product_id).filter(Boolean))
    )];

    // Busca imagens de todos os produtos de uma vez
    const imageMap = {};
    await Promise.all(productIds.map(async (productId) => {
      try {
        const productRes = await axios.get(
          `https://${shop}/admin/api/2024-01/products/${productId}.json`,
          { headers: { 'X-Shopify-Access-Token': token } }
        );
        const images = productRes.data.product?.images || [];
        if (images.length > 0) {
          imageMap[productId] = images[0].src.split('?')[0];
        }
      } catch(e) {}
    }));

    // Atribui imagem a cada item
    orders.forEach(order => {
      (order.line_items || []).forEach(item => {
        if (item.product_id && imageMap[item.product_id]) {
          item._imageJpg = imageMap[item.product_id];
        }
      });
    });

    res.json({ orders });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.errors || err.message });
  }
});

// Shopify - testar conexão
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

// WhatsApp - testar
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

// WhatsApp - enviar mensagem
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

// Webhook WhatsApp - processa rastreio do fornecedor
app.post('/webhook/whatsapp', async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body;
    console.log('Webhook recebido:', JSON.stringify(body));

    const text = body?.text?.message
  || body?.image?.caption
  || body?.caption
  || body?.video?.caption
  || body?.document?.caption
  || body?.message?.conversation
  || body?.message
  || body?.body
  || '';

console.log('Texto extraído:', text);

    if (!text) { console.log('Webhook: sem texto'); return; }

    // Detecta padrão: #10034 LZ416569524CN
    const orderMatch   = text.match(/#(\d+)/);
    const trackingMatch = text.match(/([A-Z]{2}\d{8,12}[A-Z]{2})/);

    if (!orderMatch || !trackingMatch) {
      console.log('Webhook: padrão não encontrado no texto:', text);
      return;
    }

    const orderNumber = orderMatch[1];
    const trackingCode = trackingMatch[1];
    console.log(`📦 Rastreio recebido: Pedido #${orderNumber} → ${trackingCode}`);

    const shopUrl   = process.env.SHOP_URL;
    const shopToken = process.env.SHOP_TOKEN;
    if (!shopUrl || !shopToken) { console.log('SHOP_URL ou SHOP_TOKEN não configurados'); return; }

    // Busca o pedido na Shopify pelo número
    const orderRes = await axios.get(
      `https://${shopUrl}/admin/api/2024-01/orders.json?name=${encodeURIComponent('#'+orderNumber)}&status=any`,
      { headers: { 'X-Shopify-Access-Token': shopToken } }
    );
    const order = orderRes.data.orders?.[0];
    if (!order) { console.log(`❌ Pedido #${orderNumber} não encontrado`); return; }

    // Busca os fulfillment orders do pedido
    const foRes = await axios.get(
      `https://${shopUrl}/admin/api/2024-01/orders/${order.id}/fulfillment_orders.json`,
      { headers: { 'X-Shopify-Access-Token': shopToken } }
    );
    const fulfillmentOrders = foRes.data.fulfillment_orders || [];
    const openFO = fulfillmentOrders.filter(fo => fo.status === 'open');
    if (!openFO.length) { console.log(`⚠️ Pedido #${orderNumber} já processado`); return; }

    // Cria fulfillment com rastreio e notifica cliente
    await axios.post(
      `https://${shopUrl}/admin/api/2024-01/fulfillments.json`,
      {
        fulfillment: {
          message: 'Seu pedido foi enviado!',
          notify_customer: true,
          tracking_info: {
            number: trackingCode,
            company: 'Correios China',
            url: `https://t.17track.net/en#nums=${trackingCode}`
          },
          line_items_by_fulfillment_order: openFO.map(fo => ({
            fulfillment_order_id: fo.id
          }))
        }
      },
      { headers: { 'X-Shopify-Access-Token': shopToken, 'Content-Type': 'application/json' } }
    );

    console.log(`✅ Pedido #${orderNumber} processado! Rastreio: ${trackingCode}`);
  } catch(e) {
    console.log('❌ Erro webhook:', e.response?.data || e.message);
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use(express.static(path.join(__dirname, 'public')));
app.listen(PORT, () => console.log(`✅ DropBot rodando na porta ${PORT}`));
