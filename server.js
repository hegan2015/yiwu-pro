'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 8095);
const DATA_DIR = process.env.YW_DATA_DIR || path.join(__dirname, 'data');
const PHOTO_DIR = path.join(DATA_DIR, 'photos');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_TTL = 7 * 86400000;

const round2 = (n) => Math.round(n * 100) / 100;
const uid = () => crypto.randomUUID();
const now = () => Date.now();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}
function makeUser(username, name, role, password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { id: uid(), username, name, role, salt, hash: hashPassword(password, salt), createdAt: now() };
}
const publicUser = (u) => ({ id: u.id, username: u.username, name: u.name, role: u.role, createdAt: u.createdAt });

const DEFAULT_SETTINGS = {
  companyName: '义乌市示例商行',
  address: '浙江省义乌市国际商贸城一区 0001 商位',
  phone: '+86-579-85000000',
  tradeTerms: 'FOB Ningbo',
  bankName: 'Bank of China, Yiwu Branch',
  bankAccount: '0000 0000 0000 0000',
  bankSwift: 'BKCHCNBJ910',
  lowStockThreshold: 100,
};

function seed() {
  const t = now();
  const day = 86400000;
  const users = [
    makeUser('boss', '老板', 'boss', 'boss123'),
    makeUser('clerk', '店员小王', 'clerk', 'clerk123'),
  ];
  const carton = (pcs, l, w, h, gw, nw) => ({ pcsPerCarton: pcs, cartonL: l, cartonW: w, cartonH: h, grossWeightKg: gw, netWeightKg: nw });
  const products = [
    { id: uid(), sku: 'SD-001', name: '圣诞球 6cm 混色', unit: '盒', priceCny: 18, priceUsd: 2.6, stock: 800, hsCode: '9505.10', cartonSpec: carton(60, 50, 40, 35, 9, 8), photo: null, photoHash: null, createdAt: t },
    { id: uid(), sku: 'FJ-012', name: '合金发夹 珍珠款', unit: '打', priceCny: 9.5, priceUsd: 1.4, stock: 1500, hsCode: '9615.11', cartonSpec: carton(200, 45, 35, 30, 11, 10), photo: null, photoHash: null, createdAt: t },
    { id: uid(), sku: 'WZ-033', name: '纯棉中筒袜 男女通用', unit: '双', priceCny: 2.2, priceUsd: 0.32, stock: 6000, hsCode: '6115.95', cartonSpec: carton(600, 55, 40, 40, 16, 15), photo: null, photoHash: null, createdAt: t },
    { id: uid(), sku: 'DJ-108', name: 'LED 铜线串灯 10m', unit: '条', priceCny: 6.8, priceUsd: 0.98, stock: 2200, hsCode: '9405.42', cartonSpec: carton(200, 50, 40, 35, 10, 9), photo: null, photoHash: null, createdAt: t },
    { id: uid(), sku: 'YS-021', name: '金属钥匙扣 卡通', unit: '个', priceCny: 1.5, priceUsd: 0.22, stock: 9000, hsCode: '7326.90', cartonSpec: carton(1000, 45, 35, 30, 13, 12), photo: null, photoHash: null, createdAt: t },
    { id: uid(), sku: 'SN-056', name: '桌面收纳盒 三格', unit: '个', priceCny: 7.2, priceUsd: 1.05, stock: 950, hsCode: '3924.90', cartonSpec: carton(80, 55, 45, 40, 12, 11), photo: null, photoHash: null, createdAt: t },
    { id: uid(), sku: 'YU-009', name: '三折自动伞 纯色', unit: '把', priceCny: 13.5, priceUsd: 1.95, stock: 600, hsCode: '6601.91', cartonSpec: carton(60, 50, 35, 35, 14, 13), photo: null, photoHash: null, createdAt: t },
    { id: uid(), sku: 'MR-077', name: '毛绒挂件 12cm', unit: '个', priceCny: 4.6, priceUsd: 0.66, stock: 3200, hsCode: '9503.00', cartonSpec: carton(300, 55, 45, 45, 10, 9), photo: null, photoHash: null, createdAt: t },
  ];
  const customers = [
    { id: uid(), name: '王姐百货', type: 'wholesale', contact: '王姐', phone: '138xxxx0001', note: '篁园市场老客，月结', createdAt: t },
    { id: uid(), name: '李记商行', type: 'wholesale', contact: '老李', phone: '139xxxx0002', note: '现结为主', createdAt: t },
    { id: uid(), name: 'Ahmed Trading', type: 'foreign', contact: 'Ahmed', phone: '+971-50-xxxx003', note: '迪拜，WhatsApp 下单', createdAt: t },
    { id: uid(), name: 'Maria Importaciones', type: 'foreign', contact: 'Maria', phone: '+52-55-xxxx004', note: '墨西哥，货代走宁波港', createdAt: t },
  ];
  const stockLedger = products.map((p) => ({
    id: uid(), productId: p.id, type: 'in', delta: p.stock, before: 0, after: p.stock,
    reason: '期初库存', refOrderId: null, userName: '系统', at: t,
  }));
  const P = (i) => products[i];
  const C = (i) => customers[i];
  const item = (p, qty, currency) => ({
    productId: p.id, sku: p.sku, name: p.name, unit: p.unit, qty,
    price: currency === 'USD' ? p.priceUsd : p.priceCny,
  });
  const mkOrder = (no, customer, currency, items, status, ageDays, paid, payments) => {
    const total = round2(items.reduce((s, it) => s + it.qty * it.price, 0));
    const createdAt = t - ageDays * day;
    return {
      id: uid(), no, customerId: customer.id, customerName: customer.name,
      currency, items, total, status, paid: round2(paid),
      payments: payments || [], source: 'manual', externalNo: null, shipping: null,
      createdAt,
      confirmedAt: status === 'quote' ? null : createdAt,
      shippedAt: status === 'shipped' ? createdAt + 2 * day : null,
      updatedAt: createdAt,
    };
  };
  const orders = [
    mkOrder('YW-0001', C(2), 'USD',
      [item(P(0), 300, 'USD'), item(P(3), 500, 'USD'), item(P(7), 400, 'USD')],
      'shipped', 70, 0, []),
    mkOrder('YW-0002', C(0), 'CNY',
      [item(P(2), 1000, 'CNY'), item(P(1), 200, 'CNY'), item(P(5), 100, 'CNY')],
      'confirmed', 20, 2000,
      [{ id: uid(), amount: 2000, method: '微信', note: '定金', at: t - 18 * day }]),
    mkOrder('YW-0003', C(3), 'USD',
      [item(P(6), 400, 'USD'), item(P(4), 2000, 'USD')],
      'confirmed', 45, 500,
      [{ id: uid(), amount: 500, method: 'T/T', note: '30% deposit', at: t - 44 * day }]),
    mkOrder('YW-0004', C(1), 'CNY',
      [item(P(3), 300, 'CNY'), item(P(7), 500, 'CNY')],
      'quote', 1, 0, []),
  ];
  orders[0].shipping = { forwarder: '环球义达物流', destination: 'Jebel Ali, UAE', note: '' };
  return { seq: 4, users, settings: { ...DEFAULT_SETTINGS }, products, customers, orders, stockLedger };
}

function load() {
  if (!fs.existsSync(STORE_FILE)) {
    const s = seed();
    persist(s);
    return s;
  }
  const s = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  if (!Array.isArray(s.users) || s.users.length === 0) {
    s.users = [makeUser('boss', '老板', 'boss', 'boss123'), makeUser('clerk', '店员小王', 'clerk', 'clerk123')];
  }
  s.settings = { ...DEFAULT_SETTINGS, ...(s.settings || {}) };
  s.stockLedger = s.stockLedger || [];
  for (const p of s.products) {
    if (p.photo === undefined) p.photo = null;
    if (p.photoHash === undefined) p.photoHash = null;
    if (p.cartonSpec === undefined) p.cartonSpec = null;
    if (p.hsCode === undefined) p.hsCode = '';
  }
  for (const o of s.orders) {
    if (o.source === undefined) o.source = 'manual';
    if (o.externalNo === undefined) o.externalNo = null;
    if (o.shipping === undefined) o.shipping = null;
  }
  return s;
}

function persist(s) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = STORE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, STORE_FILE);
}

let state = load();
const sessions = new Map();

function createSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { userId, expires: now() + SESSION_TTL });
  return token;
}
function sessionUser(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (s.expires < now()) { sessions.delete(token); return null; }
  return state.users.find((u) => u.id === s.userId) || null;
}

class HttpError extends Error {
  constructor(code, msg) { super(msg); this.code = code; }
}
const bad = (msg) => new HttpError(400, msg);
const notFound = (msg) => new HttpError(404, msg);
const forbidden = (msg) => new HttpError(403, msg);
const conflict = (msg) => new HttpError(409, msg);

const isPosInt = (n) => Number.isInteger(n) && n > 0 && n <= 10000000;
const isMoney = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1e9;
const isHexHash = (s) => typeof s === 'string' && /^[0-9a-f]{16}$/.test(s);

function findProduct(id) {
  const p = state.products.find((x) => x.id === id);
  if (!p) throw notFound('商品不存在');
  return p;
}
function findCustomer(id) {
  const c = state.customers.find((x) => x.id === id);
  if (!c) throw notFound('客户不存在');
  return c;
}
function findOrder(id) {
  const o = state.orders.find((x) => x.id === id);
  if (!o) throw notFound('订单不存在');
  return o;
}
function requireBoss(user) {
  if (user.role !== 'boss') throw forbidden('此操作仅限老板');
}

function computeReceivables(s) {
  const t = now();
  const byCurrency = {
    CNY: { total: 0, buckets: { d0_30: 0, d31_60: 0, d60p: 0 } },
    USD: { total: 0, buckets: { d0_30: 0, d31_60: 0, d60p: 0 } },
  };
  const map = new Map();
  for (const o of s.orders) {
    if (o.status !== 'confirmed' && o.status !== 'shipped') continue;
    const due = round2(o.total - o.paid);
    if (due <= 0) continue;
    const days = Math.floor((t - (o.confirmedAt || o.createdAt)) / 86400000);
    const bucket = days > 60 ? 'd60p' : days > 30 ? 'd31_60' : 'd0_30';
    const cur = byCurrency[o.currency] || byCurrency.CNY;
    cur.buckets[bucket] = round2(cur.buckets[bucket] + due);
    cur.total = round2(cur.total + due);
    const key = o.customerId + ':' + o.currency;
    if (!map.has(key)) {
      const c = s.customers.find((x) => x.id === o.customerId);
      map.set(key, {
        customerId: o.customerId, name: o.customerName,
        type: c ? c.type : 'wholesale', contact: c ? c.contact : '', phone: c ? c.phone : '',
        currency: o.currency, total: 0, orders: [],
      });
    }
    const entry = map.get(key);
    entry.total = round2(entry.total + due);
    entry.orders.push({ id: o.id, no: o.no, due, days, bucket });
  }
  const customers = [...map.values()].sort((a, b) => b.total - a.total);
  return { byCurrency, customers };
}

function adjustStock(product, delta, type, reason, user, refOrderId) {
  const before = product.stock;
  product.stock = before + delta;
  state.stockLedger.push({
    id: uid(), productId: product.id, type, delta, before, after: product.stock,
    reason, refOrderId: refOrderId || null, userName: user ? user.name : '系统', at: now(),
  });
}
function deductOrderStock(order, user) {
  for (const it of order.items) {
    const p = state.products.find((x) => x.id === it.productId);
    if (p) adjustStock(p, -it.qty, 'out', `订单 ${order.no} 确认`, user, order.id);
  }
}
function restoreOrderStock(order, user) {
  for (const it of order.items) {
    const p = state.products.find((x) => x.id === it.productId);
    if (p) adjustStock(p, it.qty, 'in', `订单 ${order.no} 取消回补`, user, order.id);
  }
}

function validateCartonSpec(b) {
  if (b === null || b === undefined) return null;
  const spec = {};
  for (const k of ['pcsPerCarton', 'cartonL', 'cartonW', 'cartonH', 'grossWeightKg', 'netWeightKg']) {
    const v = b[k];
    if (v === undefined || v === null || v === '' || v === 0) { spec[k] = 0; continue; }
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1e6) throw bad('箱规参数不合法');
    spec[k] = k === 'pcsPerCarton' ? Math.round(v) : round2(v);
  }
  return spec;
}

function validateProductBody(b, partial) {
  const out = {};
  if (!partial || b.name !== undefined) {
    if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 60) throw bad('商品名称必填（60 字以内）');
    out.name = b.name.trim();
  }
  if (!partial || b.sku !== undefined) {
    if (typeof b.sku !== 'string' || !b.sku.trim() || b.sku.length > 30) throw bad('货号必填（30 字以内）');
    out.sku = b.sku.trim();
  }
  if (!partial || b.unit !== undefined) {
    if (typeof b.unit !== 'string' || !b.unit.trim() || b.unit.length > 8) throw bad('单位必填');
    out.unit = b.unit.trim();
  }
  for (const k of ['priceCny', 'priceUsd']) {
    if (!partial || b[k] !== undefined) {
      if (!isMoney(b[k]) || b[k] <= 0) throw bad(k === 'priceCny' ? '批发价必须大于 0' : '外贸价必须大于 0');
      out[k] = round2(b[k]);
    }
  }
  if (!partial || b.stock !== undefined) {
    if (!Number.isInteger(b.stock) || b.stock < 0) throw bad('库存必须是非负整数');
    out.stock = b.stock;
  }
  if (b.hsCode !== undefined) {
    if (typeof b.hsCode !== 'string' || b.hsCode.length > 20) throw bad('HS 编码格式不正确');
    out.hsCode = b.hsCode.trim();
  }
  if (b.cartonSpec !== undefined) out.cartonSpec = validateCartonSpec(b.cartonSpec);
  return out;
}

function validateCustomerBody(b, partial) {
  const out = {};
  if (!partial || b.name !== undefined) {
    if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 60) throw bad('客户名称必填');
    out.name = b.name.trim();
  }
  if (!partial || b.type !== undefined) {
    if (b.type !== 'wholesale' && b.type !== 'foreign') throw bad('客户类型必须是批发或外贸');
    out.type = b.type;
  }
  for (const k of ['contact', 'phone', 'note']) {
    if (b[k] !== undefined) {
      if (typeof b[k] !== 'string' || b[k].length > 120) throw bad('联系信息格式不正确');
      out[k] = b[k].trim();
    }
  }
  return out;
}

const TRANSITIONS = {
  quote: ['confirmed', 'cancelled'],
  confirmed: ['shipped', 'cancelled'],
  shipped: [],
  cancelled: [],
};

function buildOrder(customer, currency, items, status, user, extra) {
  const total = round2(items.reduce((s, it) => s + it.qty * it.price, 0));
  state.seq += 1;
  const t = now();
  const o = {
    id: uid(), no: 'YW-' + String(state.seq).padStart(4, '0'),
    customerId: customer.id, customerName: customer.name,
    currency, items, total, status, paid: 0, payments: [],
    source: 'manual', externalNo: null, shipping: null,
    createdAt: t, confirmedAt: status === 'confirmed' ? t : null,
    shippedAt: null, updatedAt: t,
    ...(extra || {}),
  };
  state.orders.push(o);
  if (status === 'confirmed') deductOrderStock(o, user);
  return o;
}

function parseOrderItems(b, currency) {
  if (!Array.isArray(b.items) || b.items.length === 0) throw bad('订单至少需要一件商品');
  if (b.items.length > 100) throw bad('单笔订单最多 100 种商品');
  return b.items.map((it) => {
    const p = findProduct(it.productId);
    if (!isPosInt(it.qty)) throw bad(`「${p.name}」数量必须是正整数`);
    let price = currency === 'USD' ? p.priceUsd : p.priceCny;
    if (it.price !== undefined) {
      if (!isMoney(it.price) || it.price <= 0) throw bad(`「${p.name}」改价必须大于 0`);
      price = round2(it.price);
    }
    return { productId: p.id, sku: p.sku, name: p.name, unit: p.unit, qty: it.qty, price };
  });
}

const routes = [];
function route(method, pattern, handler, opts) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:[^/]+/g, (m) => {
    keys.push(m.slice(1));
    return '([^/]+)';
  }) + '$');
  routes.push({ method, re, keys, handler, opts: opts || {} });
}

const PLANS = [
  {
    id: 'basic', name: '开单版', priceMonthly: 29, priceYearly: 290,
    tagline: '先把单开起来、把账记清楚',
    features: ['手机开单报价（¥/$ 双币种）', '报价单一键复制发微信/WhatsApp', '客户管理', '应收对账 + 账龄催款', '1 个账号'],
  },
  {
    id: 'stock', name: '进销存版', priceMonthly: 59, priceYearly: 590,
    tagline: '开单之外，库存和多人协作也管起来',
    features: ['含开单版全部功能', '商品档案 + 照片', '精确库存：出入库流水 / 盘点', '缺货预警', '拍照识货（以图搜图）', '1688 订单导入', '3 个账号（老板/店员权限）'],
  },
  {
    id: 'trade', name: '外贸全能版', priceMonthly: 99, priceYearly: 990,
    tagline: '内贸外贸一本账，单证不求人',
    features: ['含进销存版全部功能', '外贸单证：商业发票 / 装箱单', '箱规自动算体积毛净重', '公司抬头 / 银行信息自定义', '10 个账号', '优先客服支持'],
  },
];

route('GET', '/api/plans', () => PLANS, { public: true });

route('GET', '/api/health', () => ({ ok: true, service: 'yiwu-pro', time: now() }), { public: true });

route('POST', '/api/login', (b) => {
  const username = typeof b.username === 'string' ? b.username.trim() : '';
  const password = typeof b.password === 'string' ? b.password : '';
  const u = state.users.find((x) => x.username === username);
  if (!u || hashPassword(password, u.salt) !== u.hash) throw new HttpError(401, '用户名或密码错误');
  const token = createSession(u.id);
  return { token, user: publicUser(u) };
}, { public: true });

route('POST', '/api/logout', (b, params, user, token) => {
  sessions.delete(token);
  return { ok: true };
});

route('GET', '/api/state', (b, params, user) => ({
  me: publicUser(user),
  products: state.products,
  customers: state.customers,
  orders: [...state.orders].sort((a, b) => b.createdAt - a.createdAt),
  receivables: computeReceivables(state),
  settings: state.settings,
  users: user.role === 'boss' ? state.users.map(publicUser) : undefined,
}));

route('GET', '/api/receivables', () => computeReceivables(state));

route('POST', '/api/products', (b) => {
  const v = validateProductBody(b, false);
  if (state.products.some((p) => p.sku === v.sku)) throw bad('货号已存在');
  const p = { id: uid(), photo: null, photoHash: null, hsCode: '', cartonSpec: null, ...v, createdAt: now() };
  state.products.push(p);
  persist(state);
  return p;
});

route('PUT', '/api/products/:id', (b, params) => {
  const p = findProduct(params.id);
  const v = validateProductBody(b, true);
  if (v.sku && state.products.some((x) => x.sku === v.sku && x.id !== p.id)) throw bad('货号已存在');
  if (v.stock !== undefined && v.stock !== p.stock) {
    throw bad('库存不能直接修改，请使用入库或盘点');
  }
  delete v.stock;
  Object.assign(p, v);
  persist(state);
  return p;
});

route('DELETE', '/api/products/:id', (b, params, user) => {
  requireBoss(user);
  findProduct(params.id);
  state.products = state.products.filter((x) => x.id !== params.id);
  persist(state);
  return { ok: true };
});

route('POST', '/api/products/:id/stock', (b, params, user) => {
  requireBoss(user);
  const p = findProduct(params.id);
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, 120) : '';
  if (b.type === 'in') {
    if (!isPosInt(b.qty)) throw bad('入库数量必须是正整数');
    adjustStock(p, b.qty, 'in', note || '采购入库', user);
  } else if (b.type === 'adjust') {
    if (!Number.isInteger(b.qty) || b.qty < 0) throw bad('盘点数量必须是非负整数');
    const delta = b.qty - p.stock;
    if (delta === 0) return { product: p, unchanged: true };
    adjustStock(p, delta, 'adjust', note || '盘点调整', user);
  } else throw bad('类型必须是 in（入库）或 adjust（盘点）');
  persist(state);
  return { product: p };
});

route('GET', '/api/products/:id/ledger', (b, params) => {
  findProduct(params.id);
  return state.stockLedger.filter((x) => x.productId === params.id).sort((a, b) => b.at - a.at).slice(0, 200);
});

route('POST', '/api/products/:id/photo', (b, params) => {
  const p = findProduct(params.id);
  if (typeof b.image !== 'string') throw bad('缺少图片数据');
  const m = b.image.match(/^data:image\/(jpeg|png|webp);base64,(.+)$/);
  if (!m) throw bad('仅支持 JPG / PNG / WebP 图片');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length === 0 || buf.length > 3 * 1024 * 1024) throw bad('图片大小需在 3MB 以内');
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50;
  const isWebp = buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
  if (!isJpeg && !isPng && !isWebp) throw bad('图片内容与格式不符');
  const ext = isJpeg ? 'jpg' : isPng ? 'png' : 'webp';
  fs.mkdirSync(PHOTO_DIR, { recursive: true });
  const fname = `${p.id}.${ext}`;
  fs.writeFileSync(path.join(PHOTO_DIR, fname), buf);
  for (const old of fs.readdirSync(PHOTO_DIR)) {
    if (old.startsWith(p.id + '.') && old !== fname) fs.unlinkSync(path.join(PHOTO_DIR, old));
  }
  p.photo = '/photos/' + fname;
  if (b.hash !== undefined) {
    if (!isHexHash(b.hash)) throw bad('图片指纹格式不正确');
    p.photoHash = b.hash;
  }
  persist(state);
  return p;
});

route('POST', '/api/recognize', (b) => {
  if (!isHexHash(b.hash)) throw bad('图片指纹格式不正确');
  const target = BigInt('0x' + b.hash);
  const ranked = state.products
    .filter((p) => p.photoHash)
    .map((p) => {
      let x = target ^ BigInt('0x' + p.photoHash);
      let dist = 0;
      while (x) { dist += Number(x & 1n); x >>= 1n; }
      return { product: p, distance: dist, match: dist <= 10 };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 8);
  return { results: ranked, hasPhotos: state.products.some((p) => p.photoHash) };
});

route('POST', '/api/customers', (b) => {
  const v = validateCustomerBody(b, false);
  const c = { id: uid(), contact: '', phone: '', note: '', ...v, createdAt: now() };
  state.customers.push(c);
  persist(state);
  return c;
});

route('PUT', '/api/customers/:id', (b, params) => {
  const c = findCustomer(params.id);
  Object.assign(c, validateCustomerBody(b, true));
  for (const o of state.orders) if (o.customerId === c.id) o.customerName = c.name;
  persist(state);
  return c;
});

route('DELETE', '/api/customers/:id', (b, params, user) => {
  requireBoss(user);
  findCustomer(params.id);
  if (state.orders.some((o) => o.customerId === params.id)) throw conflict('该客户已有订单，不能删除');
  state.customers = state.customers.filter((x) => x.id !== params.id);
  persist(state);
  return { ok: true };
});

route('POST', '/api/orders', (b, params, user) => {
  const c = findCustomer(b.customerId);
  const currency = b.currency || (c.type === 'foreign' ? 'USD' : 'CNY');
  if (currency !== 'CNY' && currency !== 'USD') throw bad('币种必须是 CNY 或 USD');
  const items = parseOrderItems(b, currency);
  const status = b.status === 'confirmed' ? 'confirmed' : 'quote';
  const o = buildOrder(c, currency, items, status, user);
  persist(state);
  return o;
});

route('PUT', '/api/orders/:id', (b, params, user) => {
  const o = findOrder(params.id);
  const next = b.status;
  if (!TRANSITIONS[o.status].includes(next)) throw conflict(`订单当前状态为「${o.status}」，不能变更为「${next}」`);
  const t = now();
  if (next === 'confirmed') { o.confirmedAt = t; deductOrderStock(o, user); }
  if (next === 'cancelled' && o.status === 'confirmed') restoreOrderStock(o, user);
  if (next === 'shipped') {
    o.shippedAt = t;
    if (b.shipping && typeof b.shipping === 'object') {
      const sh = {};
      for (const k of ['forwarder', 'destination', 'note']) {
        if (typeof b.shipping[k] === 'string' && b.shipping[k].length <= 120) sh[k] = b.shipping[k].trim();
      }
      o.shipping = { forwarder: '', destination: '', note: '', ...sh };
    }
  }
  o.status = next;
  o.updatedAt = t;
  persist(state);
  return o;
});

route('POST', '/api/orders/:id/payments', (b, params) => {
  const o = findOrder(params.id);
  if (o.status !== 'confirmed' && o.status !== 'shipped') throw conflict('报价单未确认，不能登记收款');
  const due = round2(o.total - o.paid);
  if (!isMoney(b.amount) || b.amount <= 0) throw bad('收款金额必须大于 0');
  const amount = round2(b.amount);
  if (amount > due) throw bad(`收款金额不能超过未收余额 ${due}`);
  const method = typeof b.method === 'string' && b.method.trim() ? b.method.trim().slice(0, 20) : '其他';
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, 120) : '';
  const pay = { id: uid(), amount, method, note, at: now() };
  o.payments.push(pay);
  o.paid = round2(o.paid + amount);
  o.updatedAt = now();
  persist(state);
  return { order: o, payment: pay };
});

const SAMPLE_CSV = '\uFEFF订单编号,买家会员名,货品名称,货号,数量,单价,货品总价,订单状态,收货人,联系电话\n' +
  '1688000123456789,wangjie88,LED 铜线串灯 10m,DJ-108,500,6.80,3400.00,等待卖家发货,王姐,138xxxx0001\n' +
  '1688000123456789,wangjie88,毛绒挂件 12cm,MR-077,300,4.60,1380.00,等待卖家发货,王姐,138xxxx0001\n' +
  '1688000987654321,lijishop,三折自动伞 纯色,YU-009,200,13.50,2700.00,交易成功,老李,139xxxx0002\n';

route('GET', '/api/import/sample', () => SAMPLE_CSV, { raw: 'text/csv; charset=utf-8' });

route('POST', '/api/import/1688', (b, params, user) => {
  if (!Array.isArray(b.rows) || b.rows.length === 0) throw bad('没有可导入的数据行');
  if (b.rows.length > 500) throw bad('单次最多导入 500 行');
  const groups = new Map();
  for (const r of b.rows) {
    const externalNo = typeof r.externalNo === 'string' ? r.externalNo.trim() : '';
    const buyerName = typeof r.buyerName === 'string' ? r.buyerName.trim() : '';
    const productName = typeof r.productName === 'string' ? r.productName.trim() : '';
    if (!externalNo || externalNo.length > 40) throw bad('订单编号必填（40 字以内）');
    if (!buyerName || buyerName.length > 60) throw bad(`订单 ${externalNo} 缺少买家名称`);
    if (!productName || productName.length > 60) throw bad(`订单 ${externalNo} 缺少货品名称`);
    if (!isPosInt(Number(r.qty))) throw bad(`订单 ${externalNo}「${productName}」数量必须是正整数`);
    const price = Number(r.price);
    if (!isMoney(price) || price <= 0) throw bad(`订单 ${externalNo}「${productName}」单价必须大于 0`);
    if (state.orders.some((o) => o.externalNo === externalNo)) continue;
    if (!groups.has(externalNo)) groups.set(externalNo, { buyerName, receiver: r.receiver || '', phone: r.phone || '', status: r.status || '', rows: [] });
    groups.get(externalNo).rows.push({ productName, sku: typeof r.sku === 'string' ? r.sku.trim() : '', qty: Number(r.qty), price: round2(price) });
  }
  const summary = { imported: 0, skipped: b.rows.length ? undefined : 0, customersCreated: 0, productsCreated: 0, orders: [] };
  let skippedRows = 0;
  for (const r of b.rows) {
    const no = typeof r.externalNo === 'string' ? r.externalNo.trim() : '';
    if (state.orders.some((o) => o.externalNo === no)) skippedRows++;
  }
  summary.skipped = skippedRows;
  for (const [externalNo, g] of groups) {
    let customer = state.customers.find((c) => c.name === g.buyerName);
    if (!customer) {
      customer = {
        id: uid(), name: g.buyerName, type: 'wholesale',
        contact: String(g.receiver || '').slice(0, 120), phone: String(g.phone || '').slice(0, 120),
        note: '1688 导入', createdAt: now(),
      };
      state.customers.push(customer);
      summary.customersCreated++;
    }
    const itemMap = new Map();
    for (const r of g.rows) {
      let p = r.sku ? state.products.find((x) => x.sku === r.sku) : null;
      if (!p) p = state.products.find((x) => x.name === r.productName);
      if (!p) {
        p = {
          id: uid(), sku: r.sku || 'IMP-' + String(state.products.length + 1).padStart(3, '0'),
          name: r.productName, unit: '件', priceCny: r.price, priceUsd: round2(r.price / 7),
          stock: 0, hsCode: '', cartonSpec: null, photo: null, photoHash: null, createdAt: now(),
        };
        if (state.products.some((x) => x.sku === p.sku)) p.sku = p.sku + '-' + state.seq;
        state.products.push(p);
        summary.productsCreated++;
      }
      if (itemMap.has(p.id)) itemMap.get(p.id).qty += r.qty;
      else itemMap.set(p.id, { productId: p.id, sku: p.sku, name: p.name, unit: p.unit, qty: r.qty, price: r.price });
    }
    const items = [...itemMap.values()];
    const isQuote = /等待买家付款|未付款/.test(g.status);
    const o = buildOrder(customer, 'CNY', items, isQuote ? 'quote' : 'confirmed', user, { source: '1688', externalNo });
    if (!isQuote) {
      o.paid = o.total;
      o.payments.push({ id: uid(), amount: o.total, method: '1688', note: '平台已付款', at: now() });
    }
    summary.imported++;
    summary.orders.push({ no: o.no, externalNo, total: o.total, status: o.status });
  }
  persist(state);
  return summary;
});

route('GET', '/api/users', (b, params, user) => {
  requireBoss(user);
  return state.users.map(publicUser);
});

route('POST', '/api/users', (b, params, user) => {
  requireBoss(user);
  const username = typeof b.username === 'string' ? b.username.trim() : '';
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) throw bad('用户名需 3-20 位字母/数字/下划线');
  if (state.users.some((u) => u.username === username)) throw bad('用户名已存在');
  if (typeof b.password !== 'string' || b.password.length < 6 || b.password.length > 64) throw bad('密码至少 6 位');
  const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 30) : username;
  const role = b.role === 'boss' ? 'boss' : 'clerk';
  const u = makeUser(username, name, role, b.password);
  state.users.push(u);
  persist(state);
  return publicUser(u);
});

route('PUT', '/api/users/:id', (b, params, user) => {
  requireBoss(user);
  const u = state.users.find((x) => x.id === params.id);
  if (!u) throw notFound('用户不存在');
  if (b.name !== undefined) {
    if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 30) throw bad('姓名不合法');
    u.name = b.name.trim();
  }
  if (b.role !== undefined) {
    if (b.role !== 'boss' && b.role !== 'clerk') throw bad('角色不合法');
    if (u.id === user.id && b.role !== 'boss') throw bad('不能降级自己的角色');
    u.role = b.role;
  }
  if (b.password !== undefined) {
    if (typeof b.password !== 'string' || b.password.length < 6 || b.password.length > 64) throw bad('密码至少 6 位');
    u.salt = crypto.randomBytes(16).toString('hex');
    u.hash = hashPassword(b.password, u.salt);
    for (const [tk, s] of sessions) if (s.userId === u.id && u.id !== user.id) sessions.delete(tk);
  }
  persist(state);
  return publicUser(u);
});

route('DELETE', '/api/users/:id', (b, params, user) => {
  requireBoss(user);
  if (params.id === user.id) throw bad('不能删除自己');
  const u = state.users.find((x) => x.id === params.id);
  if (!u) throw notFound('用户不存在');
  state.users = state.users.filter((x) => x.id !== params.id);
  for (const [tk, s] of sessions) if (s.userId === params.id) sessions.delete(tk);
  persist(state);
  return { ok: true };
});

route('PUT', '/api/settings', (b, params, user) => {
  requireBoss(user);
  const out = {};
  for (const k of ['companyName', 'address', 'phone', 'tradeTerms', 'bankName', 'bankAccount', 'bankSwift']) {
    if (b[k] !== undefined) {
      if (typeof b[k] !== 'string' || b[k].length > 120) throw bad('设置项格式不正确');
      out[k] = b[k].trim();
    }
  }
  if (b.lowStockThreshold !== undefined) {
    if (!Number.isInteger(b.lowStockThreshold) || b.lowStockThreshold < 0) throw bad('缺货预警阈值必须是非负整数');
    out.lowStockThreshold = b.lowStockThreshold;
  }
  Object.assign(state.settings, out);
  persist(state);
  return state.settings;
});

function docAuth(url) {
  const user = sessionUser(url.searchParams.get('token'));
  if (!user) throw new HttpError(401, '登录已失效，请重新登录后打开单证');
  return user;
}

function docPage(title, bodyHtml) {
  return `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
body{font-family:"Helvetica Neue",Arial,"PingFang SC","Microsoft YaHei",sans-serif;color:#111;margin:0;background:#f5f5f5}
.sheet{max-width:800px;margin:16px auto;background:#fff;padding:40px;box-shadow:0 1px 4px rgba(0,0,0,.15)}
h1{text-align:center;font-size:22px;letter-spacing:2px;margin:0 0 4px}
h2{text-align:center;font-size:14px;color:#555;font-weight:normal;margin:0 0 24px}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{border:1px solid #333;padding:6px 8px;text-align:left}
th{background:#eee}
.meta{display:flex;justify-content:space-between;font-size:13px;margin-bottom:16px;gap:20px}
.meta div{flex:1}
.right{text-align:right}.center{text-align:center}
.total-row td{font-weight:bold}
.warn{background:#fff3cd;border:1px solid #e0c060;padding:8px 12px;font-size:13px;margin-bottom:16px}
.foot{margin-top:28px;font-size:13px;display:flex;justify-content:space-between}
.toolbar{text-align:center;margin:16px}
.toolbar button{padding:10px 28px;font-size:15px;background:#d97706;color:#fff;border:none;border-radius:6px;cursor:pointer}
@media print{.toolbar{display:none}body{background:#fff}.sheet{box-shadow:none;margin:0;padding:20px}}
</style></head><body>
<div class="toolbar"><button onclick="window.print()">打印 / 另存为 PDF</button></div>
<div class="sheet">${bodyHtml}</div></body></html>`;
}

function orderDocData(id) {
  const o = findOrder(id);
  const c = state.customers.find((x) => x.id === o.customerId) || { name: o.customerName, contact: '', phone: '' };
  const s = state.settings;
  const fmtDate = (t) => t ? new Date(t).toISOString().slice(0, 10) : '';
  return { o, c, s, fmtDate };
}

route('GET', '/docs/invoice/:id', (b, params, user, token, url) => {
  docAuth(url);
  const { o, c, s, fmtDate } = orderDocData(params.id);
  const sym = o.currency === 'USD' ? 'USD' : 'CNY';
  const rows = o.items.map((it, i) => `<tr><td>${i + 1}</td><td>${esc(it.name)}<br><small>SKU: ${esc(it.sku)}${it.hsCode ? '' : ''}</small></td><td class="center">${it.qty}</td><td class="center">${esc(it.unit)}</td><td class="right">${it.price.toFixed(2)}</td><td class="right">${(it.qty * it.price).toFixed(2)}</td></tr>`).join('');
  const html = `
<h1>COMMERCIAL INVOICE</h1><h2>商 业 发 票</h2>
<div class="meta">
<div><b>Seller 卖方:</b><br>${esc(s.companyName)}<br>${esc(s.address)}<br>Tel: ${esc(s.phone)}</div>
<div><b>Invoice No. 发票号:</b> ${esc(o.no)}<br><b>Date 日期:</b> ${fmtDate(o.confirmedAt || o.createdAt)}<br><b>Trade Terms 贸易条款:</b> ${esc(s.tradeTerms)}</div>
</div>
<div class="meta"><div><b>Buyer 买方:</b><br>${esc(c.name)}<br>Attn: ${esc(c.contact)} &nbsp; Tel: ${esc(c.phone)}</div>
<div>${o.shipping && o.shipping.destination ? `<b>Destination 目的地:</b> ${esc(o.shipping.destination)}` : ''}</div></div>
<table><thead><tr><th>No.</th><th>Description of Goods 货品描述</th><th>Qty 数量</th><th>Unit 单位</th><th>Unit Price (${sym}) 单价</th><th>Amount (${sym}) 金额</th></tr></thead>
<tbody>${rows}
<tr class="total-row"><td colspan="5" class="right">TOTAL 合计</td><td class="right">${sym} ${o.total.toFixed(2)}</td></tr></tbody></table>
<div class="meta" style="margin-top:20px"><div><b>Bank Information 收款银行:</b><br>Beneficiary: ${esc(s.companyName)}<br>Bank: ${esc(s.bankName)}<br>A/C No.: ${esc(s.bankAccount)}<br>SWIFT: ${esc(s.bankSwift)}</div>
<div><b>Amount Paid 已收:</b> ${sym} ${o.paid.toFixed(2)}<br><b>Balance Due 未收:</b> ${sym} ${round2(o.total - o.paid).toFixed(2)}</div></div>
<div class="foot"><div>Remarks 备注: ${esc(o.shipping ? o.shipping.note : '')}</div><div>Signature 签字: ______________</div></div>`;
  return docPage(`Invoice ${o.no}`, html);
}, { raw: 'text/html; charset=utf-8', queryAuth: true });

route('GET', '/docs/packing/:id', (b, params, user, token, url) => {
  docAuth(url);
  const { o, c, s, fmtDate } = orderDocData(params.id);
  let totalCartons = 0, totalCbm = 0, totalGw = 0, totalNw = 0, missing = false;
  const rows = o.items.map((it, i) => {
    const p = state.products.find((x) => x.id === it.productId);
    const spec = p && p.cartonSpec;
    if (!spec || !spec.pcsPerCarton) { missing = true; return `<tr><td>${i + 1}</td><td>${esc(it.name)}</td><td class="center">${it.qty} ${esc(it.unit)}</td><td class="center">—</td><td class="center">—</td><td class="center">—</td><td class="right">—</td><td class="right">—</td><td class="right">—</td></tr>`; }
    const cartons = Math.ceil(it.qty / spec.pcsPerCarton);
    const cbm = round2(spec.cartonL * spec.cartonW * spec.cartonH / 1e6 * cartons);
    const gw = round2(spec.grossWeightKg * cartons);
    const nw = round2(spec.netWeightKg * cartons);
    totalCartons += cartons; totalCbm = round2(totalCbm + cbm); totalGw = round2(totalGw + gw); totalNw = round2(totalNw + nw);
    return `<tr><td>${i + 1}</td><td>${esc(it.name)}</td><td class="center">${it.qty} ${esc(it.unit)}</td><td class="center">${cartons}</td><td class="center">${spec.pcsPerCarton}</td><td class="center">${spec.cartonL}×${spec.cartonW}×${spec.cartonH}</td><td class="right">${cbm.toFixed(3)}</td><td class="right">${gw.toFixed(1)}</td><td class="right">${nw.toFixed(1)}</td></tr>`;
  }).join('');
  const html = `
<h1>PACKING LIST</h1><h2>装 箱 单</h2>
${missing ? '<div class="warn">⚠ 部分商品未设置箱规（每箱装量/尺寸/重量），对应行无法计算，请先在「货品」中补全箱规。Some items lack carton specifications.</div>' : ''}
<div class="meta">
<div><b>Seller 卖方:</b><br>${esc(s.companyName)}<br>${esc(s.address)}</div>
<div><b>P/L No. 编号:</b> ${esc(o.no)}<br><b>Date 日期:</b> ${fmtDate(o.shippedAt || o.confirmedAt || o.createdAt)}<br><b>Destination 目的地:</b> ${esc(o.shipping ? o.shipping.destination : '')}</div>
</div>
<div class="meta"><div><b>Buyer 买方:</b> ${esc(c.name)}</div><div><b>Forwarder 货代:</b> ${esc(o.shipping ? o.shipping.forwarder : '')}</div></div>
<table><thead><tr><th>No.</th><th>Description 货品</th><th>Qty 数量</th><th>Cartons 箱数</th><th>Pcs/Ctn 每箱</th><th>Meas. (cm) 箱规</th><th>CBM 体积</th><th>G.W.(kg) 毛重</th><th>N.W.(kg) 净重</th></tr></thead>
<tbody>${rows}
<tr class="total-row"><td colspan="3" class="right">TOTAL 合计</td><td class="center">${totalCartons}</td><td colspan="2"></td><td class="right">${totalCbm.toFixed(3)}</td><td class="right">${totalGw.toFixed(1)}</td><td class="right">${totalNw.toFixed(1)}</td></tr></tbody></table>
<div class="foot"><div>Shipping Marks 唛头: ${esc(c.name)} / ${esc(o.no)}${o.shipping && o.shipping.destination ? ' / ' + esc(o.shipping.destination) : ''}</div><div>Signature 签字: ______________</div></div>`;
  return docPage(`Packing List ${o.no}`, html);
}, { raw: 'text/html; charset=utf-8', queryAuth: true });

function sendJSON(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 8 * 1024 * 1024) { reject(bad('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(bad('请求体不是合法 JSON')); }
    });
    req.on('error', reject);
  });
}

const STATIC_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const PHOTO_TYPES = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  try {
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html' || pathname === '/app.js' || pathname === '/style.css' || pathname === '/pricing.html')) {
      const fname = pathname === '/' ? 'index.html' : pathname.slice(1);
      const file = path.join(PUBLIC_DIR, fname);
      if (!fs.existsSync(file)) throw notFound('页面不存在');
      res.writeHead(200, { 'Content-Type': STATIC_TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(fs.readFileSync(file));
      return;
    }
    if (req.method === 'GET' && pathname.startsWith('/photos/')) {
      const name = pathname.slice('/photos/'.length);
      if (!/^[A-Za-z0-9._-]+$/.test(name)) throw bad('文件名不合法');
      const file = path.join(PHOTO_DIR, name);
      if (!file.startsWith(PHOTO_DIR + path.sep) || !fs.existsSync(file)) throw notFound('图片不存在');
      res.writeHead(200, { 'Content-Type': PHOTO_TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(fs.readFileSync(file));
      return;
    }
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : url.searchParams.get('token');
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = pathname.match(r.re);
      if (!m) continue;
      let user = null;
      if (!r.opts.public) {
        user = sessionUser(token);
        if (!user) throw new HttpError(401, '未登录或登录已失效');
      }
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      const body = (req.method === 'POST' || req.method === 'PUT') ? await readBody(req) : {};
      const result = r.handler(body, params, user, token, url);
      if (r.opts.raw) {
        res.writeHead(200, { 'Content-Type': r.opts.raw });
        res.end(result);
      } else sendJSON(res, 200, result);
      return;
    }
    sendJSON(res, 404, { error: '接口不存在' });
  } catch (e) {
    if (e instanceof HttpError) sendJSON(res, e.code, { error: e.message });
    else {
      console.error(e);
      sendJSON(res, 500, { error: '服务器内部错误' });
    }
  }
});

server.listen(PORT, () => {
  console.log(`[yiwu-pro] 义乌小老板开单对账系统已启动: http://localhost:${PORT}`);
  console.log(`[yiwu-pro] 演示账号: boss / boss123（老板）, clerk / clerk123（店员）`);
  console.log(`[yiwu-pro] 数据文件: ${STORE_FILE}`);
});