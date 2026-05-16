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

// Serve frontend estático
app.use(express.static(path.join(__dirname, 'public')));

// ─── SHOPIFY ──────────────────────────────────────────────
// Buscar pedidos pagos
app.get('/api/shopify/orders', async (req, res) => {
  const { shop, token, limit = 50, since_id } = req.query;

  if (!shop || !token) {
    return res.status(400).json({ error: 'shop e token são obrigatórios' });
  }

  try {
    const params = new URLSearchParams({
      status: 'any',
      financial_status: 'paid',
      limit,
      ...(since_id && { since_id }),
    });

    const response = await axios.get(
      `https://${shop}/admin/api/2024-01/orders.json?${params}`,
      {
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json',
        },
      }
    );

    res.json(response.data);
  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data?.errors || err.message;
    res.status(status).json({ error: message });
  }
});

// Testar conexão Shopify
app.get('/api/shopify/test', async (req, res) => {
  const { shop, token } = req.query;

  if (!shop || !token) {
    return res.status(400).json({ error: 'shop e token são obrigatórios' });
  }

  try {
    const response = await axios.get(
      `https://${shop}/admin/api/2024-01/shop.json`,
      { headers: { 'X-Shopify-Access-Token': token } }
    );
    res.json({ ok: true, shop: response.data.shop?.name });
  } catch (err) {
    res.status(err.response?.status || 500).json({
      ok: false,
      error: err.response?.data?.errors || err.message,
    });
  }
});

// ─── EVOLUTION API (WhatsApp) ─────────────────────────────
// Testar conexão
app.get('/api/whatsapp/test', async (req, res) => {
  const { url, apikey, instance } = req.query;
  try {
    const r = await axios.get(`${url}/instance/connectionState/${instance}`, {
      headers: { apikey },
    });
    res.json({ ok: true, state: r.data?.instance?.state });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Enviar mensagem com imagem
app.post('/api/whatsapp/send', async (req, res) => {
  const { waUrl, apikey, instance, number, message, imageUrl } = req.body;

  if (!waUrl || !apikey || !instance || !number || !message) {
    return res.status(400).json({ error: 'Campos obrigatórios faltando' });
  }

  try {
    let response;

    if (imageUrl) {
      // Envia imagem + caption (texto da mensagem)
      response = await axios.post(
        `${waUrl}/message/sendMedia/${instance}`,
        {
          number,
          mediatype: 'image',
          media: imageUrl,
          caption: message,
          fileName: 'produto.jpg',
        },
        { headers: { apikey, 'Content-Type': 'application/json' } }
      );
    } else {
      // Envia só texto
      response = await axios.post(
        `${waUrl}/message/sendText/${instance}`,
        { number, text: message },
        { headers: { apikey, 'Content-Type': 'application/json' } }
      );
    }

    res.json({ ok: true, data: response.data });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.response?.data || err.message,
    });
  }
});

// Enviar lote de pedidos
app.post('/api/whatsapp/send-batch', async (req, res) => {
  const { waUrl, apikey, instance, number, orders } = req.body;

  if (!orders || !Array.isArray(orders)) {
    return res.status(400).json({ error: 'orders deve ser um array' });
  }

  const results = [];

  for (const order of orders) {
    try {
      let response;

      if (order.imageUrl) {
        response = await axios.post(
          `${waUrl}/message/sendMedia/${instance}`,
          {
            number,
            mediatype: 'image',
            media: order.imageUrl,
            caption: order.message,
            fileName: `pedido-${order.orderNum}.jpg`,
          },
          { headers: { apikey, 'Content-Type': 'application/json' } }
        );
      } else {
        response = await axios.post(
          `${waUrl}/message/sendText/${instance}`,
          { number, text: order.message },
          { headers: { apikey, 'Content-Type': 'application/json' } }
        );
      }

      results.push({ orderNum: order.orderNum, ok: true });

      // Delay entre mensagens para não ser bloqueado
      await new Promise((r) => setTimeout(r, 1500));
    } catch (err) {
      results.push({
        orderNum: order.orderNum,
        ok: false,
        error: err.response?.data || err.message,
      });
    }
  }

  res.json({ results });
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// Fallback → frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ DropBot rodando na porta ${PORT}`);
});
