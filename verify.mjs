'use strict';
// 全功能 API 验证：node verify.mjs [baseUrl]
const BASE = process.argv[2] || 'http://localhost:8096';
let passed = 0, failed = 0;
const ok = (name, cond, extra) => {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${extra ? ' — ' + JSON.stringify(extra).slice(0, 200) : ''}`); }
};

async function req(method, path, body, token) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function main() {
  console.log('== 鉴权 ==');
  const badLogin = await req('POST', '/api/login', { username: 'boss', password: 'wrong' });
  ok('错误密码拒绝 401', badLogin.status === 401);
  const boss = (await req('POST', '/api/login', { username: 'boss', password: 'boss123' })).data;
  const clerk = (await req('POST', '/api/login', { username: 'clerk', password: 'clerk123' })).data;
  ok('老板/店员登录成功', !!boss.token && !!clerk.token);
  const noAuth = await req('GET', '/api/state');
  ok('未登录访问 state 拒绝 401', noAuth.status === 401);
  const bt = boss.token, ct = clerk.token;

  console.log('== 状态与应收口径 ==');
  const st = (await req('GET', '/api/state', undefined, bt)).data;
  ok('老板可见员工列表', Array.isArray(st.users) && st.users.length === 2);
  ok('响应不含密码哈希', !JSON.stringify(st.users).includes('hash'));
  const stClerk = (await req('GET', '/api/state', undefined, ct)).data;
  ok('店员不可见员工列表', stClerk.users === undefined);
  const r = st.receivables;
  ok('USD 应收合计 2254', r.byCurrency.USD.total === 2254, r.byCurrency.USD);
  ok('CNY 应收合计 2820', r.byCurrency.CNY.total === 2820, r.byCurrency.CNY);
  ok('60 天以上高危 1534', r.byCurrency.USD.buckets.d60p === 1534, r.byCurrency.USD.buckets);
  ok('31-60 天 720', r.byCurrency.USD.buckets.d31_60 === 720);
  ok('0-30 天 2820', r.byCurrency.CNY.buckets.d0_30 === 2820);
  ok('报价单不计应收', !r.customers.some((c) => c.name === '李记商行'));

  console.log('== 商品与库存 ==');
  const np = await req('POST', '/api/products', { name: '测试灯笼', sku: 'TEST-001', unit: '个', priceCny: 5, priceUsd: 0.72, stock: 50 }, bt);
  ok('新建商品', np.status === 200 && np.data.stock === 50);
  const pid = np.data.id;
  const dup = await req('POST', '/api/products', { name: 'x', sku: 'TEST-001', unit: '个', priceCny: 1, priceUsd: 0.2, stock: 0 }, bt);
  ok('重复货号拒绝', dup.status === 400);
  const editStock = await req('PUT', '/api/products/' + pid, { stock: 999 }, bt);
  ok('直接改库存被拒（须走入库/盘点）', editStock.status === 400);
  const stockIn = await req('POST', `/api/products/${pid}/stock`, { type: 'in', qty: 30, note: '补货' }, bt);
  ok('入库 +30 → 80', stockIn.data.product.stock === 80);
  const adjust = await req('POST', `/api/products/${pid}/stock`, { type: 'adjust', qty: 75, note: '盘点' }, bt);
  ok('盘点 75 → 差异 -5', adjust.data.product.stock === 75);
  const ledger = (await req('GET', `/api/products/${pid}/ledger`, undefined, bt)).data;
  ok('流水含入库/盘点记录', ledger.some((x) => x.type === 'in') && ledger.some((x) => x.type === 'adjust' && x.delta === -5));
  const clerkStock = await req('POST', `/api/products/${pid}/stock`, { type: 'in', qty: 1 }, ct);
  ok('店员动库存被拒 403', clerkStock.status === 403);
  const clerkDel = await req('DELETE', '/api/products/' + pid, undefined, ct);
  ok('店员删商品被拒 403', clerkDel.status === 403);

  console.log('== 订单流转与收款 ==');
  const cust = st.customers.find((c) => c.name === '王姐百货');
  const oq = await req('POST', '/api/orders', { customerId: cust.id, currency: 'CNY', status: 'quote', items: [{ productId: pid, qty: 10 }] }, ct);
  ok('店员可开报价单', oq.status === 200 && oq.data.status === 'quote');
  const oid = oq.data.id;
  ok('报价单金额=数量×批发价', oq.data.total === 50);
  const stockAfterQuote = (await req('GET', '/api/state', undefined, bt)).data.products.find((p) => p.id === pid).stock;
  ok('报价不扣库存', stockAfterQuote === 75);
  const earlyPay = await req('POST', `/api/orders/${oid}/payments`, { amount: 10 }, bt);
  ok('报价单收款被拒 409', earlyPay.status === 409);
  const conf = await req('PUT', '/api/orders/' + oid, { status: 'confirmed' }, bt);
  ok('确认订单', conf.data.status === 'confirmed');
  const stockAfterConf = (await req('GET', '/api/state', undefined, bt)).data.products.find((p) => p.id === pid).stock;
  ok('确认扣库存 75→65', stockAfterConf === 65);
  const overPay = await req('POST', `/api/orders/${oid}/payments`, { amount: 999 }, bt);
  ok('超收被拒', overPay.status === 400);
  const partPay = await req('POST', `/api/orders/${oid}/payments`, { amount: 20, method: '微信', note: '定金' }, bt);
  ok('部分收款 20', partPay.data.order.paid === 20);
  const recvNow = (await req('GET', '/api/receivables', undefined, bt)).data;
  ok('应收即时更新（CNY 2850）', recvNow.byCurrency.CNY.total === 2850, recvNow.byCurrency.CNY);
  const ship = await req('PUT', '/api/orders/' + oid, { status: 'shipped', shipping: { forwarder: '测试货代', destination: 'Moscow' } }, bt);
  ok('发货并记录货代', ship.data.status === 'shipped' && ship.data.shipping.destination === 'Moscow');
  const badTrans = await req('PUT', '/api/orders/' + oid, { status: 'cancelled' }, bt);
  ok('已发货不可取消 409', badTrans.status === 409);
  const oq2 = (await req('POST', '/api/orders', { customerId: cust.id, items: [{ productId: pid, qty: 5 }], status: 'confirmed' }, bt)).data;
  await req('PUT', '/api/orders/' + oq2.id, { status: 'cancelled' }, bt);
  const stockAfterCancel = (await req('GET', '/api/state', undefined, bt)).data.products.find((p) => p.id === pid).stock;
  ok('取消已确认订单回补库存 60→65', stockAfterCancel === 65);
  const negPrice = await req('POST', '/api/orders', { customerId: cust.id, items: [{ productId: pid, qty: 1, price: -5 }] }, bt);
  ok('负改价被拒', negPrice.status === 400);

  console.log('== 客户保护 ==');
  const delCust = await req('DELETE', '/api/customers/' + cust.id, undefined, bt);
  ok('有订单客户禁删 409', delCust.status === 409);
  const tmpCust = (await req('POST', '/api/customers', { name: '临时客户', type: 'wholesale' }, bt)).data;
  const delTmp = await req('DELETE', '/api/customers/' + tmpCust.id, undefined, bt);
  ok('无订单客户可删', delTmp.status === 200);

  console.log('== 照片与识货 ==');
  const photo = await req('POST', `/api/products/${pid}/photo`, { image: PNG_1PX, hash: '0123456789abcdef' }, bt);
  ok('照片上传成功', photo.status === 200 && !!photo.data.photo);
  const photoGet = await fetch(BASE + photo.data.photo);
  ok('照片可访问', photoGet.status === 200 && photoGet.headers.get('content-type') === 'image/png');
  const badPhoto = await req('POST', `/api/products/${pid}/photo`, { image: 'data:image/png;base64,aGVsbG8=' }, bt);
  ok('伪造图片被拒', badPhoto.status === 400);
  const rec = await req('POST', '/api/recognize', { hash: '0123456789abcdef' }, bt);
  ok('完全相同指纹 distance=0', rec.data.results[0].distance === 0 && rec.data.results[0].match === true);
  const recFar = await req('POST', '/api/recognize', { hash: 'ffffffffffffffff' }, bt);
  ok('远指纹不判为同款', recFar.data.results[0].match === false);
  const recBad = await req('POST', '/api/recognize', { hash: 'zzz' }, bt);
  ok('非法指纹拒绝', recBad.status === 400);

  console.log('== 1688 导入 ==');
  const rows = [
    { externalNo: '1688T001', buyerName: '导入客户甲', productName: '导入商品A', sku: 'IMP-A', qty: 100, price: 3.5, status: '等待卖家发货', receiver: '张三', phone: '13800000000' },
    { externalNo: '1688T001', buyerName: '导入客户甲', productName: '导入商品B', sku: '', qty: 50, price: 2, status: '等待卖家发货' },
    { externalNo: '1688T002', buyerName: '导入客户乙', productName: '导入商品A', sku: 'IMP-A', qty: 10, price: 3.5, status: '等待买家付款' },
  ];
  const imp = await req('POST', '/api/import/1688', { rows }, bt);
  ok('导入 2 单', imp.data.imported === 2, imp.data);
  ok('自动建客户 2 / 商品 2', imp.data.customersCreated === 2 && imp.data.productsCreated === 2);
  const impState = (await req('GET', '/api/state', undefined, bt)).data;
  const impO1 = impState.orders.find((o) => o.externalNo === '1688T001');
  ok('同单多行合并为一单', impO1.items.length === 2 && impO1.total === 450);
  ok('已付款订单自动记收款', impO1.paid === 450 && impO1.payments[0].method === '1688');
  const impO2 = impState.orders.find((o) => o.externalNo === '1688T002');
  ok('未付款订单转为报价', impO2.status === 'quote');
  ok('复用已建商品（IMP-A 只建一次）', impState.products.filter((p) => p.sku === 'IMP-A').length === 1);
  const imp2 = await req('POST', '/api/import/1688', { rows }, bt);
  ok('重复导入全部跳过', imp2.data.imported === 0 && imp2.data.skipped === 3, imp2.data);
  const sample = await fetch(BASE + '/api/import/sample', { headers: { Authorization: 'Bearer ' + bt } });
  ok('样例 CSV 可下载', sample.status === 200 && (await sample.text()).includes('订单编号'));

  console.log('== 外贸单证 ==');
  const usdOrder = impState.orders.find((o) => o.no === 'YW-0001');
  const inv = await fetch(`${BASE}/docs/invoice/${usdOrder.id}?token=${bt}`);
  const invHtml = await inv.text();
  ok('发票生成', inv.status === 200 && invHtml.includes('COMMERCIAL INVOICE') && invHtml.includes('1534.00'));
  const pack = await fetch(`${BASE}/docs/packing/${usdOrder.id}?token=${bt}`);
  const packHtml = await pack.text();
  ok('装箱单生成含箱数/体积', pack.status === 200 && packHtml.includes('PACKING LIST') && packHtml.includes('CBM'));
  const packNoAuth = await fetch(`${BASE}/docs/packing/${usdOrder.id}`);
  ok('单证无 token 拒绝 401', packNoAuth.status === 401);
  const noSpecOrder = impState.orders.find((o) => o.externalNo === '1688T001');
  const packMissing = await (await fetch(`${BASE}/docs/packing/${noSpecOrder.id}?token=${bt}`)).text();
  ok('缺箱规给出警告', packMissing.includes('未设置箱规'));

  console.log('== 员工与设置 ==');
  const nu = await req('POST', '/api/users', { username: 'clerk2', name: '小李', role: 'clerk', password: 'abc12345' }, bt);
  ok('老板建员工', nu.status === 200);
  const login2 = await req('POST', '/api/login', { username: 'clerk2', password: 'abc12345' });
  ok('新员工可登录', login2.status === 200);
  const clerkCreateUser = await req('POST', '/api/users', { username: 'hacker', name: 'x', role: 'boss', password: 'abc12345' }, ct);
  ok('店员建员工被拒 403', clerkCreateUser.status === 403);
  const reset = await req('PUT', '/api/users/' + nu.data.id, { password: 'newpass123' }, bt);
  ok('重置密码', reset.status === 200);
  const oldLogin = await req('POST', '/api/login', { username: 'clerk2', password: 'abc12345' });
  ok('旧密码失效', oldLogin.status === 401);
  const newLogin = await req('POST', '/api/login', { username: 'clerk2', password: 'newpass123' });
  ok('新密码生效', newLogin.status === 200);
  const delSelf = await req('DELETE', '/api/users/' + boss.user.id, undefined, bt);
  ok('不能删除自己', delSelf.status === 400);
  const delU = await req('DELETE', '/api/users/' + nu.data.id, undefined, bt);
  ok('删除员工', delU.status === 200);
  const setClerk = await req('PUT', '/api/settings', { companyName: 'hack' }, ct);
  ok('店员改设置被拒 403', setClerk.status === 403);
  const setBoss = await req('PUT', '/api/settings', { companyName: '义乌市测试商行', lowStockThreshold: 50 }, bt);
  ok('老板改设置', setBoss.data.companyName === '义乌市测试商行' && setBoss.data.lowStockThreshold === 50);

  console.log('== 定价页 ==');
  const plans = await req('GET', '/api/plans');
  ok('公开定价接口 3 套餐', plans.status === 200 && plans.data.length === 3);
  const pricingPage = await fetch(BASE + '/pricing.html');
  ok('定价页可访问', pricingPage.status === 200);

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('验证脚本异常:', e); process.exit(1); });