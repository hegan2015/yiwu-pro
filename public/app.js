'use strict';

let token = localStorage.getItem('yw_token') || '';
let S = null;
let me = null;
let tab = 'new';
let cart = { customerId: '', currency: 'CNY', items: [] };
let newSearch = '';
let prodSearch = '';
let lowOnly = false;
let orderFilter = 'all';
let pendingPhoto = null;
let pendingImportRows = null;
let toastTimer = null;

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n, cur) => (cur === 'USD' ? '$' : '¥') + Number(n).toFixed(2);
const fmtDate = (t) => new Date(t).toLocaleDateString('zh-CN');
const fmtTime = (t) => new Date(t).toLocaleString('zh-CN', { hour12: false });
const STATUS = { quote: '报价', confirmed: '已确认', shipped: '已发货', cancelled: '已取消' };
const isBoss = () => me && me.role === 'boss';

async function api(path, method = 'GET', body) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (res.status === 401 && path !== '/api/login') {
    localStorage.removeItem('yw_token');
    token = '';
    showLogin();
    throw new Error('登录已失效，请重新登录');
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '操作失败');
  return data;
}

function showToast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = isErr ? 'err' : '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('已复制，去微信/WhatsApp 粘贴发送');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    showToast('已复制，去微信/WhatsApp 粘贴发送');
  }
}

function openModal(title, bodyHtml) {
  $('#modal-root').innerHTML =
    `<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal">
        <div class="modal-head"><h3>${esc(title)}</h3><button class="modal-close" onclick="closeModal()">×</button></div>
        <div>${bodyHtml}</div>
      </div>
    </div>`;
}
function closeModal() { $('#modal-root').innerHTML = ''; pendingPhoto = null; }

function showLogin() {
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
}

async function doLogin(ev) {
  ev.preventDefault();
  try {
    const r = await api('/api/login', 'POST', { username: $('#login-user').value, password: $('#login-pass').value });
    token = r.token;
    localStorage.setItem('yw_token', token);
    await refresh();
  } catch (e) { showToast(e.message, true); }
  return false;
}

async function doLogout() {
  try { await api('/api/logout', 'POST', {}); } catch {}
  localStorage.removeItem('yw_token');
  token = '';
  showLogin();
}

async function refresh() {
  S = await api('/api/state');
  me = S.me;
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  render();
}

function setTab(t) { tab = t; render(); window.scrollTo(0, 0); }

function render() {
  if (!S) return;
  $('#topbar-user').textContent = `${me.name}（${isBoss() ? '老板' : '店员'}）`;
  document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  const views = { new: renderNew, orders: renderOrders, recv: renderRecv, products: renderProducts, more: renderMore };
  $('#main').innerHTML = views[tab]();
}

/* ---------- 开单 ---------- */

function defaultPrice(p) { return cart.currency === 'USD' ? p.priceUsd : p.priceCny; }

function pickCustomer(id) {
  cart.customerId = id;
  const c = S.customers.find((x) => x.id === id);
  if (c) {
    cart.currency = c.type === 'foreign' ? 'USD' : 'CNY';
    cart.items.forEach((it) => {
      const p = S.products.find((x) => x.id === it.productId);
      if (p) it.price = defaultPrice(p);
    });
  }
  render();
}

function setCurrency(cur) {
  cart.currency = cur;
  cart.items.forEach((it) => {
    const p = S.products.find((x) => x.id === it.productId);
    if (p) it.price = defaultPrice(p);
  });
  render();
}

function addToCart(pid) {
  const p = S.products.find((x) => x.id === pid);
  if (!p) return;
  const exist = cart.items.find((x) => x.productId === pid);
  if (exist) exist.qty += 1;
  else cart.items.push({ productId: pid, qty: 1, price: defaultPrice(p) });
  render();
}

function cartStep(pid, d) {
  const it = cart.items.find((x) => x.productId === pid);
  if (!it) return;
  it.qty = Math.max(1, it.qty + d);
  render();
}
function cartQty(pid, v) {
  const it = cart.items.find((x) => x.productId === pid);
  if (!it) return;
  const n = parseInt(v, 10);
  it.qty = Number.isInteger(n) && n > 0 ? n : 1;
  render();
}
function cartPrice(pid, v) {
  const it = cart.items.find((x) => x.productId === pid);
  if (!it) return;
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) it.price = Math.round(n * 100) / 100;
  render();
}
function cartRemove(pid) {
  cart.items = cart.items.filter((x) => x.productId !== pid);
  render();
}

function newProdListHtml() {
  const kw = newSearch.trim().toLowerCase();
  const list = S.products.filter((p) => !kw || p.name.toLowerCase().includes(kw) || p.sku.toLowerCase().includes(kw));
  if (list.length === 0) return '<div class="empty">没有匹配的商品</div>';
  return list.map((p) => `
    <div class="prod-row">
      <div class="prod-thumb">${p.photo ? `<img src="${esc(p.photo)}" alt="">` : esc(p.name.slice(0, 1))}</div>
      <div class="grow">
        <div>${esc(p.name)}</div>
        <div class="muted small">${esc(p.sku)} · 库存 ${p.stock}${p.stock < 0 ? '（缺货）' : ''}</div>
      </div>
      <div class="money">${money(defaultPrice(p), cart.currency)}</div>
      <button class="btn btn-sm" onclick="addToCart('${p.id}')">＋</button>
    </div>`).join('');
}
function renderNewProdList() { $('#new-prod-list').innerHTML = newProdListHtml(); }

function renderNew() {
  const sym = cart.currency === 'USD' ? '$' : '¥';
  const total = Math.round(cart.items.reduce((s, it) => s + it.qty * it.price, 0) * 100) / 100;
  const customerOpts = S.customers.map((c) =>
    `<option value="${c.id}" ${c.id === cart.customerId ? 'selected' : ''}>${esc(c.name)}（${c.type === 'foreign' ? '外贸' : '批发'}）</option>`).join('');
  const cartHtml = cart.items.length === 0 ? '<div class="empty">从上方商品列表点「＋」加入订单</div>' :
    cart.items.map((it) => {
      const p = S.products.find((x) => x.id === it.productId);
      if (!p) return '';
      return `
      <div class="cart-item">
        <div class="row-between">
          <div class="grow">${esc(p.name)} <span class="muted small">${esc(p.sku)}</span></div>
          <button class="btn btn-danger btn-sm" onclick="cartRemove('${p.id}')">移除</button>
        </div>
        <div class="row mt8">
          <div class="stepper">
            <button onclick="cartStep('${p.id}',-1)">−</button>
            <input type="number" value="${it.qty}" min="1" onchange="cartQty('${p.id}',this.value)">
            <button onclick="cartStep('${p.id}',1)">＋</button>
          </div>
          <span class="muted small">${esc(p.unit)} ×</span>
          <input class="price-input" type="number" step="0.01" value="${it.price}" onchange="cartPrice('${p.id}',this.value)">
          <span class="grow money" style="text-align:right">${sym}${(it.qty * it.price).toFixed(2)}</span>
        </div>
      </div>`;
    }).join('');
  return `
  <div class="card">
    <div class="field"><span>客户</span>
      <select onchange="pickCustomer(this.value)">
        <option value="">选择客户…</option>${customerOpts}
      </select>
    </div>
    <div class="row">
      <span class="muted">币种</span>
      <button class="chip ${cart.currency === 'CNY' ? 'active' : ''}" onclick="setCurrency('CNY')">¥ 人民币</button>
      <button class="chip ${cart.currency === 'USD' ? 'active' : ''}" onclick="setCurrency('USD')">$ 美元</button>
    </div>
  </div>
  <div class="card">
    <div class="row">
      <input class="grow" placeholder="搜索商品名称 / 货号" value="${esc(newSearch)}" oninput="newSearch=this.value;renderNewProdList()">
      <button class="btn btn-ghost" onclick="openRecognize()">📷 识货</button>
    </div>
    <div id="new-prod-list" class="mt8">${newProdListHtml()}</div>
  </div>
  <div class="card">
    <div class="section-title" style="margin-top:0">本单商品</div>
    ${cartHtml}
    <div class="cart-total"><span>合计</span><span class="money">${sym}${total.toFixed(2)}</span></div>
    <div class="modal-foot">
      <button class="btn btn-gray" onclick="saveOrder('quote')">存为报价单</button>
      <button class="btn" onclick="saveOrder('confirmed')">确认订单</button>
    </div>
    ${cart.items.some((it) => { const p = S.products.find((x) => x.id === it.productId); return p && it.qty > p.stock; }) ? '<div class="muted small mt8" style="color:var(--orange)">⚠ 有商品数量超过当前库存，确认后库存将记为负数（缺货）</div>' : ''}
  </div>`;
}

async function saveOrder(status) {
  if (!cart.customerId) return showToast('请先选择客户', true);
  if (cart.items.length === 0) return showToast('请先加入商品', true);
  try {
    const o = await api('/api/orders', 'POST', {
      customerId: cart.customerId, currency: cart.currency, status,
      items: cart.items.map((it) => ({ productId: it.productId, qty: it.qty, price: it.price })),
    });
    cart = { customerId: '', currency: 'CNY', items: [] };
    await refresh();
    setTab('orders');
    showToast(`${o.no} 已保存为${STATUS[status]}`);
  } catch (e) { showToast(e.message, true); }
}

/* ---------- 拍照识货 ---------- */

async function imageHash(file) {
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas');
  c.width = 9; c.height = 8;
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0, 9, 8);
  const d = ctx.getImageData(0, 0, 9, 8).data;
  let bits = '';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const i = (y * 9 + x) * 4, j = (y * 9 + x + 1) * 4;
      const g1 = d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114;
      const g2 = d[j] * .299 + d[j + 1] * .587 + d[j + 2] * .114;
      bits += g1 > g2 ? '1' : '0';
    }
  }
  let hex = '';
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

function openRecognize() { $('#recognize-input').click(); }

async function onRecognizeFile() {
  const input = $('#recognize-input');
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  try {
    const hash = await imageHash(file);
    const r = await api('/api/recognize', 'POST', { hash });
    if (!r.hasPhotos) {
      openModal('拍照识货', '<div class="empty">还没有商品上传过照片。<br>请先到「货品」页编辑商品并上传照片，之后即可拍照找货。</div>');
      return;
    }
    const rows = r.results.map((x) => {
      const p = x.product;
      const label = x.distance <= 6 ? '<span class="badge b-green">很可能同款</span>' : x.distance <= 10 ? '<span class="badge b-orange">相似</span>' : '<span class="badge b-gray">仅供参考</span>';
      return `
      <div class="rec-result">
        <div class="prod-thumb">${p.photo ? `<img src="${esc(p.photo)}" alt="">` : esc(p.name.slice(0, 1))}</div>
        <div class="grow">
          <div>${esc(p.name)}</div>
          <div class="muted small">${esc(p.sku)} · ${money(p.priceCny, 'CNY')} / ${money(p.priceUsd, 'USD')} ${label}</div>
        </div>
        <button class="btn btn-sm" onclick="addRecognized('${p.id}')">加入订单</button>
      </div>`;
    }).join('');
    openModal('拍照识货结果', rows || '<div class="empty">没有可比对的商品照片</div>');
  } catch (e) { showToast(e.message, true); }
}

function addRecognized(pid) {
  closeModal();
  addToCart(pid);
  setTab('new');
  showToast('已加入订单');
}

/* ---------- 订单 ---------- */

function quoteText(o) {
  const s = S.settings;
  const sym = o.currency === 'USD' ? '$' : '¥';
  const d = fmtDate(o.createdAt);
  const lines = o.items.map((it, i) => `${i + 1}. ${it.name}（${it.sku}） ${it.qty}${it.unit} × ${sym}${it.price.toFixed(2)} = ${sym}${(it.qty * it.price).toFixed(2)}`);
  if (o.currency === 'USD') {
    return `QUOTATION — ${s.companyName}\nNo: ${o.no}   Date: ${d}\nTo: ${o.customerName}\n${lines.join('\n')}\nTOTAL: ${sym}${o.total.toFixed(2)}\nTerms: ${s.tradeTerms}\nTel: ${s.phone}`;
  }
  return `【报价单】${s.companyName}\n单号：${o.no}　日期：${d}\n客户：${o.customerName}\n${lines.join('\n')}\n合计：${sym}${o.total.toFixed(2)}\n联系电话：${s.phone}`;
}

function orderCard(o) {
  const due = Math.round((o.total - o.paid) * 100) / 100;
  const itemsBrief = o.items.slice(0, 2).map((it) => `${esc(it.name)} ×${it.qty}`).join('、') + (o.items.length > 2 ? ` 等 ${o.items.length} 项` : '');
  const acts = [];
  if (o.status === 'quote') {
    acts.push(`<button class="btn btn-sm" onclick="confirmOrder('${o.id}')">确认订单</button>`);
    acts.push(`<button class="btn btn-gray btn-sm" onclick="copyQuote('${o.id}')">复制报价单</button>`);
    acts.push(`<button class="btn btn-danger btn-sm" onclick="cancelOrder('${o.id}')">取消</button>`);
  } else if (o.status === 'confirmed') {
    acts.push(`<button class="btn btn-sm" onclick="openShip('${o.id}')">发货</button>`);
    if (due > 0) acts.push(`<button class="btn btn-ghost btn-sm" onclick="openPay('${o.id}')">收款</button>`);
    acts.push(`<button class="btn btn-gray btn-sm" onclick="copyQuote('${o.id}')">复制报价单</button>`);
    acts.push(`<button class="btn btn-danger btn-sm" onclick="cancelOrder('${o.id}')">取消</button>`);
  } else if (o.status === 'shipped') {
    if (due > 0) acts.push(`<button class="btn btn-ghost btn-sm" onclick="openPay('${o.id}')">收款</button>`);
    if (o.currency === 'USD') {
      acts.push(`<button class="btn btn-gray btn-sm" onclick="openDoc('invoice','${o.id}')">商业发票</button>`);
      acts.push(`<button class="btn btn-gray btn-sm" onclick="openDoc('packing','${o.id}')">装箱单</button>`);
    }
    acts.push(`<button class="btn btn-gray btn-sm" onclick="copyQuote('${o.id}')">复制报价单</button>`);
  }
  const pays = o.payments.length ? `
    <details class="payments"><summary>收款记录（${o.payments.length} 笔，已收 ${money(o.paid, o.currency)}）</summary>
      ${o.payments.map((p) => `<div class="pay-line"><span>${fmtTime(p.at)} · ${esc(p.method)}${p.note ? ' · ' + esc(p.note) : ''}</span><span class="money">${money(p.amount, o.currency)}</span></div>`).join('')}
    </details>` : '';
  const shipping = o.shipping && (o.shipping.forwarder || o.shipping.destination) ?
    `<div class="muted small mt8">🚚 ${esc(o.shipping.forwarder || '')}${o.shipping.destination ? ' → ' + esc(o.shipping.destination) : ''}</div>` : '';
  return `
  <div class="card">
    <div class="order-head">
      <span class="order-no">${esc(o.no)} ${o.source === '1688' ? '<span class="badge b-1688">1688</span>' : ''}</span>
      <span class="badge b-${o.status}">${STATUS[o.status]}</span>
    </div>
    <div class="row-between">
      <span>${esc(o.customerName)}</span>
      <span class="muted small">${fmtDate(o.createdAt)}</span>
    </div>
    <div class="order-items">${itemsBrief}</div>
    <div class="row-between">
      <span class="money">${money(o.total, o.currency)}</span>
      ${o.status === 'quote' || o.status === 'cancelled' ? '' :
        due > 0 ? `<span class="money money-red">未收 ${money(due, o.currency)}</span>` : '<span class="badge b-green">已结清</span>'}
    </div>
    ${shipping}${pays}
    <div class="order-actions">${acts.join('')}</div>
  </div>`;
}

function renderOrders() {
  const filters = [['all', '全部'], ['quote', '报价'], ['confirmed', '已确认'], ['shipped', '已发货'], ['cancelled', '已取消']];
  const list = S.orders.filter((o) => orderFilter === 'all' || o.status === orderFilter);
  return `
  <div class="chips">${filters.map(([k, label]) =>
    `<button class="chip ${orderFilter === k ? 'active' : ''}" onclick="orderFilter='${k}';render()">${label}</button>`).join('')}</div>
  ${list.length === 0 ? '<div class="empty">暂无订单</div>' : list.map(orderCard).join('')}`;
}

async function confirmOrder(id) {
  try { await api('/api/orders/' + id, 'PUT', { status: 'confirmed' }); await refresh(); showToast('已确认，库存已扣减，计入应收'); }
  catch (e) { showToast(e.message, true); }
}
async function cancelOrder(id) {
  if (!confirm('确定取消该订单？已确认订单取消后库存会自动回补。')) return;
  try { await api('/api/orders/' + id, 'PUT', { status: 'cancelled' }); await refresh(); showToast('订单已取消'); }
  catch (e) { showToast(e.message, true); }
}
function copyQuote(id) {
  const o = S.orders.find((x) => x.id === id);
  if (o) copyText(quoteText(o));
}
function openDoc(kind, id) { window.open(`/docs/${kind}/${id}?token=${encodeURIComponent(token)}`, '_blank'); }

function openShip(id) {
  const o = S.orders.find((x) => x.id === id);
  openModal(`发货 ${o.no}`, `
  <form onsubmit="return submitShip(event,'${id}')">
    <div class="field"><span>货代 / 物流公司</span><input name="forwarder" placeholder="如：环球义达物流"></div>
    <div class="field"><span>目的地</span><input name="destination" placeholder="如：Jebel Ali, UAE"></div>
    <div class="field"><span>备注</span><input name="note" placeholder="选填"></div>
    <div class="modal-foot"><button class="btn" type="submit">确认发货</button></div>
  </form>`);
}
async function submitShip(ev, id) {
  ev.preventDefault();
  const f = ev.target.elements;
  try {
    await api('/api/orders/' + id, 'PUT', { status: 'shipped', shipping: { forwarder: f.forwarder.value, destination: f.destination.value, note: f.note.value } });
    closeModal(); await refresh(); showToast('已发货');
  } catch (e) { showToast(e.message, true); }
  return false;
}

function openPay(id) {
  const o = S.orders.find((x) => x.id === id);
  const due = Math.round((o.total - o.paid) * 100) / 100;
  openModal(`收款 ${o.no}`, `
  <div class="muted">未收余额：<b class="money">${money(due, o.currency)}</b></div>
  <form onsubmit="return submitPay(event,'${id}')" class="mt12">
    <div class="field"><span>金额（${o.currency === 'USD' ? '$' : '¥'}）</span><input name="amount" type="number" step="0.01" min="0.01" value="${due}" required></div>
    <div class="field"><span>收款方式</span>
      <select name="method"><option>微信</option><option>支付宝</option><option>现金</option><option>银行转账</option><option>T/T</option><option>1688</option><option>其他</option></select>
    </div>
    <div class="field"><span>备注</span><input name="note" placeholder="如：定金 / 尾款"></div>
    <div class="modal-foot"><button class="btn" type="submit">登记收款</button></div>
  </form>`);
}
async function submitPay(ev, id) {
  ev.preventDefault();
  const f = ev.target.elements;
  try {
    await api(`/api/orders/${id}/payments`, 'POST', { amount: Number(f.amount.value), method: f.method.value, note: f.note.value });
    closeModal(); await refresh(); showToast('收款已登记');
  } catch (e) { showToast(e.message, true); }
  return false;
}

/* ---------- 应收 ---------- */

function dunningText(entry) {
  const s = S.settings;
  const sym = entry.currency === 'USD' ? '$' : '¥';
  if (entry.currency === 'USD') {
    const lines = entry.orders.map((x) => `- ${x.no}: ${sym}${x.due.toFixed(2)} (${x.days} days overdue)`);
    return `Payment Reminder — ${s.companyName}\nDear ${entry.name},\nThe following invoices are still outstanding:\n${lines.join('\n')}\nTotal due: ${sym}${entry.total.toFixed(2)}\nPlease arrange payment at your earliest convenience. Thank you!`;
  }
  const lines = entry.orders.map((x) => `- ${x.no}：${sym}${x.due.toFixed(2)}（已拖欠 ${x.days} 天）`);
  return `【对账提醒】${s.companyName}\n${entry.name} 您好，以下货款尚未结清：\n${lines.join('\n')}\n合计：${sym}${entry.total.toFixed(2)}\n麻烦安排付款，谢谢！`;
}

function recvSummaryHtml() {
  return ['CNY', 'USD'].map((cur) => {
    const d = S.receivables.byCurrency[cur];
    const sym = cur === 'USD' ? '$' : '¥';
    return `
    <div class="card">
      <div class="row-between"><b>${cur === 'USD' ? '美元应收' : '人民币应收'}</b><span class="money money-red">${sym}${d.total.toFixed(2)}</span></div>
      <div class="bucket-row">
        <div class="bucket bk-ok">0-30 天<span class="num">${sym}${d.buckets.d0_30.toFixed(2)}</span></div>
        <div class="bucket bk-warn">31-60 天<span class="num">${sym}${d.buckets.d31_60.toFixed(2)}</span></div>
        <div class="bucket bk-danger">60 天以上<span class="num">${sym}${d.buckets.d60p.toFixed(2)}</span></div>
      </div>
    </div>`;
  }).join('');
}

function renderRecv() {
  const entries = S.receivables.customers;
  const cards = entries.map((e) => `
    <div class="card">
      <div class="row-between">
        <div><b>${esc(e.name)}</b> <span class="badge ${e.type === 'foreign' ? 'b-quote' : 'b-gray'}">${e.type === 'foreign' ? '外贸' : '批发'}</span></div>
        <span class="money money-red">${money(e.total, e.currency)}</span>
      </div>
      <div class="muted small mt8">${esc(e.contact)} ${esc(e.phone)}</div>
      ${e.orders.map((x) => `
        <div class="recv-order">
          <span>${esc(x.no)}</span>
          <span class="badge ${x.bucket === 'd60p' ? 'b-red' : x.bucket === 'd31_60' ? 'b-orange' : 'b-green'}">${x.days} 天</span>
          <span class="money">${money(x.due, e.currency)}</span>
          <button class="btn btn-ghost btn-sm" onclick="openPay('${x.id}')">收款</button>
        </div>`).join('')}
      <div class="order-actions">
        <button class="btn btn-gray btn-sm" onclick='copyText(dunningText(S.receivables.customers.find(x=>x.customerId==="${e.customerId}"&&x.currency==="${e.currency}")))'>复制催款单</button>
      </div>
    </div>`).join('');
  return recvSummaryHtml() + (entries.length === 0 ? '<div class="empty">没有未结清的应收，生意兴隆！</div>' : cards);
}

/* ---------- 货品 ---------- */

function prodListHtml() {
  const kw = prodSearch.trim().toLowerCase();
  const th = S.settings.lowStockThreshold;
  const list = S.products.filter((p) =>
    (!kw || p.name.toLowerCase().includes(kw) || p.sku.toLowerCase().includes(kw)) &&
    (!lowOnly || p.stock <= th));
  if (list.length === 0) return '<div class="empty">没有匹配的商品</div>';
  return list.map((p) => {
    const stockBadge = p.stock < 0 ? '<span class="badge b-red">缺货</span>' : p.stock <= th ? '<span class="badge b-orange">偏低</span>' : '<span class="badge b-green">充足</span>';
    const specOk = p.cartonSpec && p.cartonSpec.pcsPerCarton > 0;
    return `
    <div class="card">
      <div class="prod-card-head">
        <div class="prod-thumb">${p.photo ? `<img src="${esc(p.photo)}" alt="">` : esc(p.name.slice(0, 1))}</div>
        <div class="grow">
          <div><b>${esc(p.name)}</b></div>
          <div class="muted small">${esc(p.sku)} · ${money(p.priceCny, 'CNY')} / ${money(p.priceUsd, 'USD')} · ${specOk ? '箱规✓' : '箱规未设'}</div>
          <div class="stock-line">库存 <b>${p.stock}</b> ${esc(p.unit)} ${stockBadge}</div>
        </div>
      </div>
      <div class="order-actions">
        <button class="btn btn-gray btn-sm" onclick="openProductModal('${p.id}')">编辑</button>
        ${isBoss() ? `<button class="btn btn-gray btn-sm" onclick="openStock('${p.id}','in')">入库</button>
        <button class="btn btn-gray btn-sm" onclick="openStock('${p.id}','adjust')">盘点</button>` : ''}
        <button class="btn btn-gray btn-sm" onclick="openLedger('${p.id}')">流水</button>
        ${isBoss() ? `<button class="btn btn-danger btn-sm" onclick="deleteProduct('${p.id}')">删除</button>` : ''}
      </div>
    </div>`;
  }).join('');
}
function renderProdList() { $('#prod-list').innerHTML = prodListHtml(); }

function renderProducts() {
  return `
  <div class="card">
    <div class="row">
      <input class="grow" placeholder="搜索商品名称 / 货号" value="${esc(prodSearch)}" oninput="prodSearch=this.value;renderProdList()">
      <button class="btn" onclick="openProductModal('')">＋ 新增</button>
    </div>
    <div class="mt8">
      <button class="chip ${lowOnly ? 'active' : ''}" onclick="lowOnly=!lowOnly;render()">只看缺货/偏低（≤${S.settings.lowStockThreshold}）</button>
    </div>
  </div>
  <div id="prod-list">${prodListHtml()}</div>`;
}

function specFieldsHtml(spec) {
  const v = (k) => spec && spec[k] ? spec[k] : '';
  return `
  <div class="field"><span>外贸箱规（装箱单自动计算用，选填）</span></div>
  <div class="spec-grid">
    <div class="field"><span>每箱装量</span><input name="pcsPerCarton" type="number" min="0" value="${v('pcsPerCarton')}"></div>
    <div class="field"><span>箱长 cm</span><input name="cartonL" type="number" step="0.1" min="0" value="${v('cartonL')}"></div>
    <div class="field"><span>箱宽 cm</span><input name="cartonW" type="number" step="0.1" min="0" value="${v('cartonW')}"></div>
    <div class="field"><span>箱高 cm</span><input name="cartonH" type="number" step="0.1" min="0" value="${v('cartonH')}"></div>
    <div class="field"><span>毛重 kg/箱</span><input name="grossWeightKg" type="number" step="0.1" min="0" value="${v('grossWeightKg')}"></div>
    <div class="field"><span>净重 kg/箱</span><input name="netWeightKg" type="number" step="0.1" min="0" value="${v('netWeightKg')}"></div>
  </div>`;
}

function openProductModal(id) {
  const p = id ? S.products.find((x) => x.id === id) : null;
  pendingPhoto = null;
  openModal(p ? '编辑商品' : '新增商品', `
  <form onsubmit="return saveProduct(event,'${id}')">
    <div class="field"><span>商品名称</span><input name="pname" value="${esc(p ? p.name : '')}" required maxlength="60"></div>
    <div class="field-row">
      <div class="field"><span>货号</span><input name="sku" value="${esc(p ? p.sku : '')}" required maxlength="30"></div>
      <div class="field"><span>单位</span><input name="unit" value="${esc(p ? p.unit : '个')}" required maxlength="8"></div>
    </div>
    <div class="field-row">
      <div class="field"><span>批发价 ¥</span><input name="priceCny" type="number" step="0.01" min="0.01" value="${p ? p.priceCny : ''}" required></div>
      <div class="field"><span>外贸价 $</span><input name="priceUsd" type="number" step="0.01" min="0.01" value="${p ? p.priceUsd : ''}" required></div>
    </div>
    ${p ? `<div class="muted small">当前库存 ${p.stock}（库存请用「入库 / 盘点」调整）</div>` :
      `<div class="field mt8"><span>期初库存</span><input name="stock" type="number" min="0" value="0"></div>`}
    <div class="field mt8"><span>HS 编码（选填）</span><input name="hsCode" value="${esc(p ? p.hsCode : '')}" maxlength="20"></div>
    ${specFieldsHtml(p ? p.cartonSpec : null)}
    <div class="field"><span>商品照片（用于拍照识货）</span>
      <div class="row">
        <img id="photo-preview" class="photo-preview ${p && p.photo ? '' : 'hidden'}" src="${p && p.photo ? esc(p.photo) : ''}" alt="">
        <input type="file" accept="image/*" onchange="onProductPhoto(this)">
      </div>
    </div>
    <div class="modal-foot"><button class="btn" type="submit">保存</button></div>
  </form>`);
}

async function onProductPhoto(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 3 * 1024 * 1024) return showToast('图片需在 3MB 以内', true);
  try {
    const dataURL = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    const hash = await imageHash(file);
    pendingPhoto = { dataURL, hash };
    const img = $('#photo-preview');
    img.src = dataURL;
    img.classList.remove('hidden');
  } catch (e) { showToast('图片读取失败：' + e.message, true); }
}

async function saveProduct(ev, id) {
  ev.preventDefault();
  const f = ev.target.elements;
  const spec = {};
  let hasSpec = false;
  for (const k of ['pcsPerCarton', 'cartonL', 'cartonW', 'cartonH', 'grossWeightKg', 'netWeightKg']) {
    spec[k] = Number(f[k].value || 0);
    if (spec[k] > 0) hasSpec = true;
  }
  const body = {
    name: f.pname.value, sku: f.sku.value, unit: f.unit.value,
    priceCny: Number(f.priceCny.value), priceUsd: Number(f.priceUsd.value),
    hsCode: f.hsCode.value, cartonSpec: hasSpec ? spec : null,
  };
  if (!id) body.stock = Number(f.stock.value || 0);
  try {
    const p = id ? await api('/api/products/' + id, 'PUT', body) : await api('/api/products', 'POST', body);
    if (pendingPhoto) {
      await api(`/api/products/${p.id}/photo`, 'POST', { image: pendingPhoto.dataURL, hash: pendingPhoto.hash });
      pendingPhoto = null;
    }
    closeModal(); await refresh(); showToast(id ? '商品已更新' : '商品已创建');
  } catch (e) { showToast(e.message, true); }
  return false;
}

function openStock(id, type) {
  const p = S.products.find((x) => x.id === id);
  const isIn = type === 'in';
  openModal(isIn ? `入库 ${p.name}` : `盘点 ${p.name}`, `
  <div class="muted">当前账面库存：<b>${p.stock}</b> ${esc(p.unit)}</div>
  <form onsubmit="return submitStock(event,'${id}','${type}')" class="mt12">
    <div class="field"><span>${isIn ? '入库数量' : '实盘数量（盘点后库存将等于该数）'}</span>
      <input name="qty" type="number" min="${isIn ? 1 : 0}" value="${isIn ? '' : p.stock}" required></div>
    <div class="field"><span>备注</span><input name="note" placeholder="${isIn ? '如：工厂补货' : '如：月度盘点'}"></div>
    <div class="modal-foot"><button class="btn" type="submit">${isIn ? '确认入库' : '确认盘点'}</button></div>
  </form>`);
}
async function submitStock(ev, id, type) {
  ev.preventDefault();
  const f = ev.target.elements;
  try {
    const r = await api(`/api/products/${id}/stock`, 'POST', { type, qty: Number(f.qty.value), note: f.note.value });
    closeModal(); await refresh();
    showToast(r.unchanged ? '账实一致，无需调整' : type === 'in' ? '入库成功' : '盘点完成，差异已调整');
  } catch (e) { showToast(e.message, true); }
  return false;
}

async function openLedger(id) {
  const p = S.products.find((x) => x.id === id);
  try {
    const rows = await api(`/api/products/${id}/ledger`);
    const labels = { in: '入库', out: '出库', adjust: '盘点' };
    const html = rows.length === 0 ? '<div class="empty">暂无流水</div>' : rows.map((r) => `
      <div class="list-row">
        <div class="grow">
          <div><span class="badge ${r.type === 'out' ? 'b-orange' : r.type === 'adjust' ? 'b-quote' : 'b-green'}">${labels[r.type]}</span>
            <b style="color:${r.delta >= 0 ? 'var(--green)' : 'var(--red)'}">${r.delta >= 0 ? '+' : ''}${r.delta}</b>
            <span class="muted small">${r.before} → ${r.after}</span></div>
          <div class="muted small mt8">${esc(r.reason)} · ${esc(r.userName)} · ${fmtTime(r.at)}</div>
        </div>
      </div>`).join('');
    openModal(`库存流水 ${p.name}`, html);
  } catch (e) { showToast(e.message, true); }
}

async function deleteProduct(id) {
  const p = S.products.find((x) => x.id === id);
  if (!confirm(`确定删除商品「${p.name}」？历史订单不受影响。`)) return;
  try { await api('/api/products/' + id, 'DELETE'); await refresh(); showToast('商品已删除'); }
  catch (e) { showToast(e.message, true); }
}

/* ---------- 更多 ---------- */

function customerDue(cid) {
  return S.receivables.customers.filter((x) => x.customerId === cid)
    .map((x) => money(x.total, x.currency)).join(' + ') || '无欠款';
}

function renderMore() {
  const customerRows = S.customers.map((c) => `
    <div class="list-row">
      <div class="grow">
        <div><b>${esc(c.name)}</b> <span class="badge ${c.type === 'foreign' ? 'b-quote' : 'b-gray'}">${c.type === 'foreign' ? '外贸' : '批发'}</span></div>
        <div class="muted small mt8">${esc(c.contact)} ${esc(c.phone)} · 欠款：${customerDue(c.id)}</div>
        ${c.note ? `<div class="muted small">${esc(c.note)}</div>` : ''}
      </div>
      <button class="btn btn-gray btn-sm" onclick="openCustomerModal('${c.id}')">编辑</button>
      ${isBoss() ? `<button class="btn btn-danger btn-sm" onclick="deleteCustomer('${c.id}')">删除</button>` : ''}
    </div>`).join('');

  const userRows = isBoss() ? (S.users || []).map((u) => `
    <div class="list-row">
      <div class="grow">
        <div><b>${esc(u.name)}</b> <span class="muted small">@${esc(u.username)}</span>
          <span class="badge ${u.role === 'boss' ? 'b-confirmed' : 'b-gray'}">${u.role === 'boss' ? '老板' : '店员'}</span></div>
      </div>
      <button class="btn btn-gray btn-sm" onclick="resetPassword('${u.id}')">重置密码</button>
      ${u.id !== me.id ? `
        <button class="btn btn-gray btn-sm" onclick="toggleRole('${u.id}','${u.role === 'boss' ? 'clerk' : 'boss'}')">${u.role === 'boss' ? '降为店员' : '升为老板'}</button>
        <button class="btn btn-danger btn-sm" onclick="deleteUser('${u.id}')">删除</button>` : ''}
    </div>`).join('') : '';

  const st = S.settings;
  const settingsForm = isBoss() ? `
  <div class="section-title">公司设置（单证抬头）</div>
  <div class="card">
    <form onsubmit="return saveSettings(event)">
      <div class="field"><span>公司名称</span><input name="companyName" value="${esc(st.companyName)}"></div>
      <div class="field"><span>地址</span><input name="address" value="${esc(st.address)}"></div>
      <div class="field-row">
        <div class="field"><span>电话</span><input name="phone" value="${esc(st.phone)}"></div>
        <div class="field"><span>贸易条款</span><input name="tradeTerms" value="${esc(st.tradeTerms)}"></div>
      </div>
      <div class="field"><span>开户银行</span><input name="bankName" value="${esc(st.bankName)}"></div>
      <div class="field-row">
        <div class="field"><span>银行账号</span><input name="bankAccount" value="${esc(st.bankAccount)}"></div>
        <div class="field"><span>SWIFT</span><input name="bankSwift" value="${esc(st.bankSwift)}"></div>
      </div>
      <div class="field"><span>缺货预警阈值（库存 ≤ 该值提示）</span><input name="lowStockThreshold" type="number" min="0" value="${st.lowStockThreshold}"></div>
      <button class="btn" type="submit">保存设置</button>
    </form>
  </div>` : '';

  return `
  <div class="section-title">客户管理 <button class="btn btn-sm" onclick="openCustomerModal('')">＋ 新增客户</button></div>
  <div class="card">${customerRows || '<div class="empty">暂无客户</div>'}</div>

  <div class="section-title">1688 订单导入</div>
  <div class="card">
    <div class="muted small">支持 1688 卖家后台导出的订单 CSV（自动识别 GBK/UTF-8 编码），按订单号去重，自动创建客户/商品/订单。</div>
    <div class="row mt12">
      <input type="file" accept=".csv,.txt" onchange="onImportFile(this)" class="grow">
      <button class="btn btn-gray btn-sm" onclick="downloadSample()">下载样例</button>
    </div>
    <div class="field mt12"><span>或直接粘贴 CSV 内容</span><textarea id="import-text" placeholder="订单编号,买家会员名,货品名称,货号,数量,单价,…"></textarea></div>
    <button class="btn btn-ghost btn-sm" onclick="parseImportText()">解析粘贴内容</button>
  </div>

  ${isBoss() ? `<div class="section-title">员工管理 <button class="btn btn-sm" onclick="openUserModal()">＋ 新增员工</button></div>
  <div class="card">${userRows}</div>` : ''}

  ${settingsForm}

  <div class="section-title">其他</div>
  <div class="card">
    <div class="row">
      <a class="btn btn-gray btn-sm" href="/pricing.html" style="text-decoration:none">功能套餐与定价</a>
      <button class="btn btn-danger btn-sm" onclick="doLogout()">退出登录</button>
    </div>
  </div>`;
}

function openCustomerModal(id) {
  const c = id ? S.customers.find((x) => x.id === id) : null;
  openModal(c ? '编辑客户' : '新增客户', `
  <form onsubmit="return saveCustomer(event,'${id}')">
    <div class="field"><span>客户名称</span><input name="cname" value="${esc(c ? c.name : '')}" required maxlength="60"></div>
    <div class="field"><span>类型</span>
      <select name="type">
        <option value="wholesale" ${c && c.type === 'wholesale' ? 'selected' : ''}>批发（人民币）</option>
        <option value="foreign" ${c && c.type === 'foreign' ? 'selected' : ''}>外贸（美元）</option>
      </select>
    </div>
    <div class="field-row">
      <div class="field"><span>联系人</span><input name="contact" value="${esc(c ? c.contact : '')}"></div>
      <div class="field"><span>电话 / WhatsApp</span><input name="phone" value="${esc(c ? c.phone : '')}"></div>
    </div>
    <div class="field"><span>备注</span><input name="note" value="${esc(c ? c.note : '')}"></div>
    <div class="modal-foot"><button class="btn" type="submit">保存</button></div>
  </form>`);
}
async function saveCustomer(ev, id) {
  ev.preventDefault();
  const f = ev.target.elements;
  const body = { name: f.cname.value, type: f.type.value, contact: f.contact.value, phone: f.phone.value, note: f.note.value };
  try {
    if (id) await api('/api/customers/' + id, 'PUT', body);
    else await api('/api/customers', 'POST', body);
    closeModal(); await refresh(); showToast('客户已保存');
  } catch (e) { showToast(e.message, true); }
  return false;
}
async function deleteCustomer(id) {
  const c = S.customers.find((x) => x.id === id);
  if (!confirm(`确定删除客户「${c.name}」？`)) return;
  try { await api('/api/customers/' + id, 'DELETE'); await refresh(); showToast('客户已删除'); }
  catch (e) { showToast(e.message, true); }
}

/* ---------- 1688 导入 ---------- */

function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (ch !== '\r') cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function mapImportRows(rows) {
  if (rows.length < 2) throw new Error('CSV 至少需要表头 + 一行数据');
  const header = rows[0];
  const find = (...keys) => header.findIndex((h) => keys.some((k) => h.includes(k)));
  const iNo = find('订单编号', '订单号');
  const iBuyer = find('买家');
  const iName = find('货品名称', '商品名称');
  const iSku = find('货号');
  const iQty = find('数量');
  const iPrice = find('单价');
  const iStatus = find('订单状态', '状态');
  const iRecv = find('收货人');
  const iPhone = find('电话', '手机');
  if (iNo < 0 || iName < 0 || iQty < 0 || iPrice < 0) throw new Error('缺少必需列：订单编号 / 货品名称 / 数量 / 单价');
  return rows.slice(1).map((r) => ({
    externalNo: (r[iNo] || '').trim(),
    buyerName: ((iBuyer >= 0 ? r[iBuyer] : '') || (iRecv >= 0 ? r[iRecv] : '') || '').trim(),
    productName: (r[iName] || '').trim(),
    sku: iSku >= 0 ? (r[iSku] || '').trim() : '',
    qty: Number(r[iQty]),
    price: Number(r[iPrice]),
    status: iStatus >= 0 ? (r[iStatus] || '').trim() : '',
    receiver: iRecv >= 0 ? (r[iRecv] || '').trim() : '',
    phone: iPhone >= 0 ? (r[iPhone] || '').trim() : '',
  }));
}

function handleImportText(text) {
  try {
    const rows = mapImportRows(parseCSV(text));
    if (rows.length === 0) throw new Error('没有数据行');
    pendingImportRows = rows;
    const orderCount = new Set(rows.map((r) => r.externalNo)).size;
    const preview = rows.slice(0, 8).map((r) =>
      `<tr><td>${esc(r.externalNo)}</td><td>${esc(r.buyerName)}</td><td>${esc(r.productName)}</td><td>${r.qty}</td><td>${Number(r.price).toFixed(2)}</td></tr>`).join('');
    openModal('导入预览', `
      <div class="muted">共 <b>${rows.length}</b> 行货品，合并为 <b>${orderCount}</b> 笔订单。已存在的订单号会自动跳过。</div>
      <div style="overflow-x:auto" class="mt12">
        <table class="preview-table"><thead><tr><th>订单编号</th><th>买家</th><th>货品</th><th>数量</th><th>单价</th></tr></thead><tbody>${preview}</tbody></table>
      </div>
      ${rows.length > 8 ? `<div class="muted small mt8">… 其余 ${rows.length - 8} 行省略</div>` : ''}
      <div class="modal-foot"><button class="btn" onclick="doImport()">确认导入</button></div>`);
  } catch (e) { showToast(e.message, true); }
}

async function onImportFile(input) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  const buf = await file.arrayBuffer();
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { text = new TextDecoder('gbk').decode(buf); }
  handleImportText(text);
}

function parseImportText() {
  const text = $('#import-text').value;
  if (!text.trim()) return showToast('请先粘贴 CSV 内容', true);
  handleImportText(text);
}

async function doImport() {
  if (!pendingImportRows) return;
  try {
    const r = await api('/api/import/1688', 'POST', { rows: pendingImportRows });
    pendingImportRows = null;
    closeModal(); await refresh();
    showToast(`导入 ${r.imported} 单，跳过重复 ${r.skipped} 行，新建客户 ${r.customersCreated}、商品 ${r.productsCreated}`);
    setTab('orders');
  } catch (e) { showToast(e.message, true); }
}

async function downloadSample() {
  try {
    const res = await fetch('/api/import/sample', { headers: { Authorization: 'Bearer ' + token } });
    const text = await res.text();
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '1688订单导入样例.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) { showToast(e.message, true); }
}

/* ---------- 员工 / 设置 ---------- */

function openUserModal() {
  openModal('新增员工', `
  <form onsubmit="return saveUser(event)">
    <div class="field"><span>用户名（登录用，3-20 位字母/数字/下划线）</span><input name="username" required pattern="[A-Za-z0-9_]{3,20}"></div>
    <div class="field"><span>姓名</span><input name="uname" required maxlength="30"></div>
    <div class="field"><span>角色</span><select name="role"><option value="clerk">店员（不能删数据/动库存/管员工）</option><option value="boss">老板（全部权限）</option></select></div>
    <div class="field"><span>初始密码（至少 6 位）</span><input name="password" type="password" minlength="6" required></div>
    <div class="modal-foot"><button class="btn" type="submit">创建</button></div>
  </form>`);
}
async function saveUser(ev) {
  ev.preventDefault();
  const f = ev.target.elements;
  try {
    await api('/api/users', 'POST', { username: f.username.value, name: f.uname.value, role: f.role.value, password: f.password.value });
    closeModal(); await refresh(); showToast('员工已创建');
  } catch (e) { showToast(e.message, true); }
  return false;
}
function resetPassword(id) {
  const u = S.users.find((x) => x.id === id);
  openModal(`重置密码 ${u.name}`, `
  <form onsubmit="return submitReset(event,'${id}')">
    <div class="field"><span>新密码（至少 6 位）</span><input name="password" type="password" minlength="6" required></div>
    <div class="modal-foot"><button class="btn" type="submit">重置</button></div>
  </form>`);
}
async function submitReset(ev, id) {
  ev.preventDefault();
  try {
    await api('/api/users/' + id, 'PUT', { password: ev.target.elements.password.value });
    closeModal(); await refresh(); showToast('密码已重置');
  } catch (e) { showToast(e.message, true); }
  return false;
}
async function toggleRole(id, role) {
  try { await api('/api/users/' + id, 'PUT', { role }); await refresh(); showToast('角色已更新'); }
  catch (e) { showToast(e.message, true); }
}
async function deleteUser(id) {
  const u = S.users.find((x) => x.id === id);
  if (!confirm(`确定删除员工「${u.name}」？`)) return;
  try { await api('/api/users/' + id, 'DELETE'); await refresh(); showToast('员工已删除'); }
  catch (e) { showToast(e.message, true); }
}

async function saveSettings(ev) {
  ev.preventDefault();
  const f = ev.target.elements;
  const body = {};
  for (const k of ['companyName', 'address', 'phone', 'tradeTerms', 'bankName', 'bankAccount', 'bankSwift']) body[k] = f[k].value;
  body.lowStockThreshold = Number(f.lowStockThreshold.value);
  try { await api('/api/settings', 'PUT', body); await refresh(); showToast('设置已保存'); }
  catch (e) { showToast(e.message, true); }
  return false;
}

/* ---------- init ---------- */

document.getElementById('login-form').onsubmit = doLogin;
document.getElementById('recognize-input').onchange = onRecognizeFile;
if (token) refresh().catch(() => showLogin());
else showLogin();