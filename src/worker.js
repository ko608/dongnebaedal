// 동네배달 서버 (Cloudflare Workers)
// 필요한 설정: wrangler.jsonc 의 KV(DB), 대시보드 비밀 변수 ADMIN_PW

const EXAMPLES = [
  ["둔산 할매닭발", "야식", "국물닭발 19,000원"],
  ["BBQ 둔산점", "치킨", "황금올리브 21,000원"],
  ["청년다방 둔산점", "분식", "차돌떡볶이 13,000원"],
  ["맘스터치 둔산점", "한식", "싸이버거 5,400원"],
  ["봉구비어 둔산점", "한식", "봉구통닭 18,000원"],
  ["역전우동 둔산점", "한식", "김치우동 8,000원"],
  ["피자알볼로 둔산점", "피자", "단호박피자 L 25,900원"],
  ["컴포즈커피 둔산점", "카페", "아메리카노 1,500원"],
  ["홍콩반점 둔산점", "중식", "짜장면 7,000원"],
  ["스시로 둔산점", "일식", "초밥 10p 12,000원"],
  ["이삭토스트 둔산점", "분식", "햄치즈토스트 3,500원"],
  ["투썸플레이스 둔산점", "카페", "아이스박스 6,300원"],
  ["교촌치킨 둔산1호점", "치킨", "허니콤보 23,000원"],
].map(([name, cat, menu], i) => ({
  id: "ex" + i, name, cat, menu,
  link: "https://www.coupangeats.com", phone: "", addr: "둔산동", intro: "",
  // 고정된 예시 위치 (새로고침해도 그대로)
  lat: 36.3504 + Math.sin(i * 2.4) * 0.006, lng: 127.3845 + Math.cos(i * 2.4) * 0.007,
  example: true, ad: false, createdAt: 0,
}));

const CATS = ["치킨", "한식", "분식", "카페", "중식", "일식", "피자", "야식", "디저트", "반찬", "편의점", "약국", "꽃집", "미용실", "세탁소", "생활", "기타"];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

const clip = (v, n) => String(v ?? "").trim().slice(0, n);
// 유튜브 주소에서 영상 ID만 뽑아 저장 (watch?v=, youtu.be/, shorts/ 모두 지원)
const ytId = (v) => { const m = String(v || "").match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([A-Za-z0-9_-]{11})/); return m ? m[1] : (/^[A-Za-z0-9_-]{11}$/.test(String(v || "").trim()) ? String(v).trim() : ""); };
const okLink = (v) => /^https:\/\/[^\s"'<>]+$/i.test(v);
const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);

async function getList(env, key) {
  const v = await env.DB.get(key, "json");
  if (v) return v;
  if (key === "stores") { await env.DB.put("stores", JSON.stringify(EXAMPLES)); return EXAMPLES.slice(); }
  return [];
}
const putList = (env, key, list) => env.DB.put(key, JSON.stringify(list));

function cleanStore(b, base = {}) {
  const s = { ...base };
  if (b.name !== undefined) s.name = clip(b.name, 40);
  if (b.cat !== undefined) s.cat = CATS.includes(b.cat) ? b.cat : "기타";
  if (b.menu !== undefined) s.menu = clip(b.menu, 80);
  if (b.link !== undefined) s.link = clip(b.link, 400);
  if (b.phone !== undefined) s.phone = clip(b.phone, 20).replace(/[^0-9+\-\s]/g, "");
  if (b.showTel !== undefined) s.showTel = !!b.showTel;
  if (b.yt !== undefined) { s.yt = ytId(b.yt); s.ytShort = /shorts\//.test(String(b.yt)) || (!!b.ytShort && !/watch|youtu\.be/.test(String(b.yt))); }
  if (b.addr !== undefined) s.addr = clip(b.addr, 80);
  if (b.intro !== undefined) s.intro = clip(b.intro, 120);
  if (b.lat !== undefined) s.lat = num(b.lat);
  if (b.lng !== undefined) s.lng = num(b.lng);
  if (b.ad !== undefined) s.ad = !!b.ad;
  if (b.example !== undefined) s.example = !!b.example;
  if (b.items !== undefined) s.items = cleanItems(b.items);
  if (b.photos !== undefined) s.photos = (Array.isArray(b.photos) ? b.photos : []).filter((k) => /^[a-z0-9]{8,40}$/.test(String(k))).slice(0, MAX_PHOTOS);
  if (b.plan !== undefined) s.plan = b.plan === "qr" ? "qr" : "free";
  // 메뉴 항목이 있으면 한 줄 대표 메뉴는 자동으로 만들어요 (대표 ⭐ 먼저)
  if (s.items && s.items.length && (b.items !== undefined || !s.menu)) s.menu = menuLine(s.items);
  return s;
}
// ── 메뉴 항목 {n: 이름, p: 가격, b: 대표} ──
const MAX_ITEMS = 30, MAX_PHOTOS = 4;
function cleanItems(v) {
  return (Array.isArray(v) ? v : []).map((x) => ({ n: clip(x && x.n, 30), p: clip(x && x.p, 20), b: !!(x && x.b) })).filter((x) => x.n).slice(0, MAX_ITEMS);
}
const priceText = (p) => { const d = String(p || "").replace(/[^0-9]/g, ""); return d && /^[0-9,\s원]+$/.test(String(p).trim()) ? Number(d).toLocaleString("ko-KR") + "원" : String(p || ""); };
function menuLine(items) {
  const top = items.filter((x) => x.b).concat(items.filter((x) => !x.b)).slice(0, 2);
  return clip(top.map((x) => x.n + (x.p ? " " + priceText(x.p) : "")).join(" / "), 80);
}
// 손님에게 보여 줄 때는 전화번호·소개 외 필요한 것만
const telOf = (s) => (s.showTel && s.phone ? s.phone.replace(/[^0-9+]/g, "") : "");
// 주문 링크나 손님 공개 전화 중 하나는 있어야 해요
const hasAction = (s) => okLink(s.link || "") || !!telOf(s);
const publicStore = (s) => ({ id: s.id, name: s.name, cat: s.cat, menu: s.menu, items: s.items || [], photos: s.plan === "qr" ? (s.photos || []) : [], plan: s.plan === "qr" ? "qr" : "free", link: okLink(s.link || "") ? s.link : "", tel: telOf(s), yt: s.yt || "", ytShort: !!s.ytShort, addr: s.addr, intro: s.intro, lat: s.lat, lng: s.lng, ad: !!s.ad, example: !!s.example });

// 관리 비밀번호는 원문 대신 암호화된 값만 저장해요 (PBKDF2)
const PW_SALT = "8f9bd4dae2fe70f40bc50854186f3255";
const PW_HASH = "e39923ee52eca0c63e43eff24bd5489b7bcd69da62e83b0a44cba0d813f5542c";
const hex2buf = (h) => new Uint8Array(h.match(/../g).map((b) => parseInt(b, 16)));
async function pwMatches(pw) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: hex2buf(PW_SALT), iterations: 100000 }, key, 256);
  const got = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return got === PW_HASH;
}

// ── 주소 → 위치 찾기 ──
// 카카오 키(KAKAO_KEY, Secret)가 있으면 카카오로, 없으면 OpenStreetMap으로 찾아요.
async function kakaoFind(q, key) {
  const h = { Authorization: "KakaoAK " + key };
  for (const kind of ["address", "keyword"]) {
    const r = await fetch(`https://dapi.kakao.com/v2/local/search/${kind}.json?size=1&query=` + encodeURIComponent(q), { headers: h });
    if (!r.ok) continue;
    const d = await r.json();
    const doc = d.documents && d.documents[0];
    if (doc) return { lat: parseFloat(doc.y), lng: parseFloat(doc.x), label: doc.address_name || doc.place_name || q };
  }
  return null;
}
async function osmFind(q) {
  const url = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=kr&accept-language=ko&viewbox=127.2,36.5,127.6,36.2&q=" + encodeURIComponent(q);
  const r = await fetch(url, { headers: { "User-Agent": "dongnebaedal/1.0 (ko608@naver.com)" } });
  if (!r.ok) return null;
  const d = await r.json();
  return d[0] ? { lat: parseFloat(d[0].lat), lng: parseFloat(d[0].lon), label: d[0].display_name } : null;
}
async function geocode(addr, env) {
  let q = clip(addr, 80).replace(/\s+/g, " ");
  if (!q) return null;
  if (!/대전|서울|부산|대구|인천|광주|울산|세종|경기|강원|충북|충남|충청|전북|전남|전라|경북|경남|경상|제주/.test(q)) q = "대전 " + q;
  const words = q.split(" ");
  // 전체 주소로 못 찾으면 뒤에서 한 단어씩 줄여서 대략 위치라도 찾아요.
  for (let n = words.length; n >= 2; n--) {
    const part = words.slice(0, n).join(" ");
    let hit = null;
    try { hit = env.KAKAO_KEY ? await kakaoFind(part, env.KAKAO_KEY) : null; } catch (e) {}
    if (!hit) { try { hit = await osmFind(part); } catch (e) {} }
    if (hit && isFinite(hit.lat) && isFinite(hit.lng)) return { ...hit, exact: n === words.length, source: env.KAKAO_KEY ? "kakao" : "osm" };
  }
  return null;
}

async function isAdmin(request, env) {
  const pw = (request.headers.get("x-admin-pw") || "").trim();
  if (!pw || pw.length > 100) return false;
  if (env.ADMIN_PW && pw === env.ADMIN_PW) return true;
  return await pwMatches(pw);
}

// ════════ 🛵 퀵 연결 (충전금 차감 방식) ════════
// KV: quick:cfg {on,name,fee,key} · quick:bal 잔액 · quick:reqs 요청 목록 · quick:ledger 입출금 내역
const QDEF = { on: false, name: "제휴 퀵", fee: 500, key: "" };
const qCfg = async (env) => ({ ...QDEF, ...((await env.DB.get("quick:cfg", "json")) || {}) });
const qBal = async (env) => parseInt((await env.DB.get("quick:bal")) || "0", 10) || 0;
const qList = async (env, k) => (await env.DB.get(k, "json")) || [];
const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");
async function qLedger(env, entry) {
  const bal = (await qBal(env)) + entry.amount;
  await env.DB.put("quick:bal", String(bal));
  const led = await qList(env, "quick:ledger");
  led.unshift({ ...entry, balance: bal, t: Date.now() });
  await env.DB.put("quick:ledger", JSON.stringify(led.slice(0, 1000)));
  return bal;
}
// 업체 화면에는 접수 전까지 손님 전화번호를 가려요 (접수=수수료 차감 후 공개)
const partnerView = (r) => (r.status === "new" ? { ...r, phone: r.phone.replace(/\d(?=\d{4})/g, "*").replace(/\d{4}$/, "****") } : r);

async function handleQuick(request, env, path, body, method) {
  // 손님: 퀵 사용 여부
  if (path === "quick/info") { const c = await qCfg(env); return json({ on: !!c.on, name: c.name }); }

  // 손님: 퀵 요청 보내기
  if (path === "quick/request" && method === "POST") {
    const c = await qCfg(env);
    if (!c.on) return json({ error: "지금은 퀵 연결을 쉬고 있어요." }, 400);
    if (!body.agree) return json({ error: "연락처 제공에 동의해 주세요." }, 400);
    const r = { id: "q" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), createdAt: Date.now(), status: "new",
      from: clip(body.from, 80), to: clip(body.to, 80), phone: clip(body.phone, 20).replace(/[^0-9\-]/g, ""), item: clip(body.item, 60), memo: clip(body.memo, 120),
      storeId: clip(body.storeId, 40), storeName: clip(body.storeName, 40) };
    if (!r.from || !r.to || r.phone.replace(/\D/g, "").length < 9) return json({ error: "출발지, 도착지, 연락처를 확인해 주세요." }, 400);
    const reqs = await qList(env, "quick:reqs");
    if (reqs.filter((x) => x.status === "new").length >= 50) return json({ error: "요청이 밀려 있어요. 잠시 후 다시 시도해 주세요." }, 429);
    reqs.unshift(r);
    await env.DB.put("quick:reqs", JSON.stringify(reqs.slice(0, 500)));
    return json({ ok: true });
  }

  // 퀵 업체 화면
  if (path.startsWith("partner/")) {
    const c = await qCfg(env);
    const key = (request.headers.get("x-partner-key") || "").trim().toUpperCase();
    if (!c.key || key !== c.key) return json({ error: "접속 코드가 맞지 않아요." }, 401);
    const act = path.slice(8);
    if (act === "list") {
      const reqs = await qList(env, "quick:reqs");
      return json({ name: c.name, fee: c.fee, balance: await qBal(env), reqs: reqs.filter((r) => Date.now() - r.createdAt < 3 * 864e5).slice(0, 80).map(partnerView) });
    }
    if (method !== "POST") return json({ error: "잘못된 요청이에요." }, 405);
    const reqs = await qList(env, "quick:reqs");
    const r = reqs.find((x) => x.id === clip(body.id, 40));
    if (!r) return json({ error: "요청을 찾지 못했어요." }, 404);
    if (act === "accept") {
      if (r.status !== "new") return json({ error: "이미 처리된 요청이에요." }, 400);
      const bal = await qBal(env);
      if (bal < c.fee) return json({ error: `충전금이 부족해요. (잔액 ${bal.toLocaleString()}원 · 건당 ${c.fee.toLocaleString()}원)` }, 402);
      r.status = "accepted"; r.acceptedAt = Date.now(); r.fee = c.fee;
      await env.DB.put("quick:reqs", JSON.stringify(reqs));
      await qLedger(env, { type: "fee", amount: -c.fee, reqId: r.id, memo: `접수 수수료 (${r.from} → ${r.to})` });
      return json({ ok: true, req: r });
    }
    if (act === "done") { if (r.status !== "accepted") return json({ error: "접수한 요청만 완료할 수 있어요." }, 400); r.status = "done"; r.doneAt = Date.now(); }
    else if (act === "skip") { if (r.status !== "new") return json({ error: "접수 전 요청만 넘길 수 있어요." }, 400); r.status = "skipped"; }
    else return json({ error: "없는 기능이에요." }, 404);
    await env.DB.put("quick:reqs", JSON.stringify(reqs));
    return json({ ok: true });
  }

  // 관리자
  if (path.startsWith("admin/quick")) {
    if (!(await isAdmin(request, env))) return json({ error: "비밀번호가 맞지 않아요." }, 401);
    const act = path.slice(12);
    if (act === "") {
      const [cfg, balance, reqs, ledger] = await Promise.all([qCfg(env), qBal(env), qList(env, "quick:reqs"), qList(env, "quick:ledger")]);
      return json({ cfg, balance, reqs: reqs.slice(0, 100), ledger: ledger.slice(0, 100) });
    }
    if (method !== "POST") return json({ error: "잘못된 요청이에요." }, 405);
    if (act === "config") {
      const c = await qCfg(env);
      if (body.on !== undefined) c.on = !!body.on;
      if (body.name !== undefined) c.name = clip(body.name, 30) || "제휴 퀵";
      if (body.fee !== undefined) { const f = parseInt(body.fee, 10); if (!(f >= 0 && f <= 100000)) return json({ error: "수수료 금액을 확인해 주세요." }, 400); c.fee = f; }
      if (body.newKey || !c.key) c.key = newKey();
      await env.DB.put("quick:cfg", JSON.stringify(c));
      return json({ ok: true, cfg: c });
    }
    if (act === "charge") {
      const amt = parseInt(body.amount, 10);
      if (!amt || Math.abs(amt) > 10000000) return json({ error: "금액을 확인해 주세요." }, 400);
      const bal = await qLedger(env, { type: amt > 0 ? "charge" : "adjust", amount: amt, memo: clip(body.memo, 60) || (amt > 0 ? "충전" : "차감 조정") });
      return json({ ok: true, balance: bal });
    }
    if (act === "refund") {
      const reqs = await qList(env, "quick:reqs");
      const r = reqs.find((x) => x.id === clip(body.id, 40));
      if (!r || !r.fee || r.refunded) return json({ error: "환불할 수 있는 요청이 아니에요." }, 400);
      r.refunded = true; r.status = "refunded";
      await env.DB.put("quick:reqs", JSON.stringify(reqs));
      const bal = await qLedger(env, { type: "refund", amount: r.fee, reqId: r.id, memo: "수수료 환불" });
      return json({ ok: true, balance: bal });
    }
    return json({ error: "없는 기능이에요." }, 404);
  }
  return null;
}

async function handleApi(request, env, path) {
  if (!env.DB) return json({ error: "서버 설정이 아직 안 됐어요. (KV 바인딩 DB 필요)" }, 500);
  const method = request.method;
  let body = {};
  if (method === "POST") { try { body = await request.json(); } catch { return json({ error: "잘못된 요청이에요." }, 400); } }
  if (path.startsWith("quick/") || path.startsWith("partner/") || path.startsWith("admin/quick")) {
    const q = await handleQuick(request, env, path, body, method);
    if (q) return q;
  }

  // ── 손님용 ──
  if (path === "stores" && method === "GET") {
    const stores = await getList(env, "stores");
    return json({ stores: stores.map(publicStore) });
  }

  // 가게 전용 페이지(/s/가게번호)용 · QR로 들어오면 qr=1 → QR 방문 수 세기
  if (path === "store" && method === "GET") {
    const u = new URL(request.url), id = clip(u.searchParams.get("id"), 40);
    const s = (await getList(env, "stores")).find((x) => x.id === id);
    if (!s) return json({ error: "가게를 찾지 못했어요. 지도에서 내려갔을 수 있어요." }, 404);
    if (u.searchParams.get("qr") === "1") {
      const k = "qr:" + id, n = parseInt((await env.DB.get(k)) || "0", 10) + 1;
      await env.DB.put(k, String(n));
    }
    return json({ store: publicStore(s) });
  }

  if (path === "apply" && method === "POST") {
    if (!body.agree) return json({ error: "개인정보 수집·이용에 동의해 주세요." }, 400);
    const s = cleanStore({ ...body, plan: undefined, photos: undefined });
    if (!s.name || !s.menu || !s.phone || !s.addr) return json({ error: "필수 항목을 모두 입력해 주세요." }, 400);
    if (s.link && !okLink(s.link)) return json({ error: "주문 링크는 https:// 로 시작하는 주소를 넣어 주세요." }, 400);
    if (!hasAction(s)) return json({ error: "주문 링크가 없으면 '손님 전화 받기'를 체크해 주세요." }, 400);
    const pending = await getList(env, "pending");
    if (pending.length >= 200) return json({ error: "신청이 많이 밀려 있어요. 잠시 후 다시 시도해 주세요." }, 429);
    pending.unshift({ ...s, id: "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), createdAt: Date.now(), ad: false, example: false });
    await putList(env, "pending", pending);
    return json({ ok: true });
  }

  if (path === "click" && method === "POST") {
    const id = clip(body.id, 40);
    if (id) {
      const k = "click:" + id;
      const n = parseInt((await env.DB.get(k)) || "0", 10) + 1;
      await env.DB.put(k, String(n));
    }
    return json({ ok: true });
  }

  if (path === "visit" && method === "POST") {
    const k = "visit:" + kstDay(0);
    const n = parseInt((await env.DB.get(k)) || "0", 10) + 1;
    await env.DB.put(k, String(n), { expirationTtl: 400 * 864e2 });
    return json({ ok: true });
  }

  // ── 관리자용 ──
  if (path.startsWith("admin/")) {
    if (!(await isAdmin(request, env))) return json({ error: "비밀번호가 맞지 않아요." }, 401);
    const act = path.slice(6);

    if (act === "list") {
      const [stores, pending] = await Promise.all([getList(env, "stores"), getList(env, "pending")]);
      const clicks = {};
      const qrs = {};
      await Promise.all(stores.map(async (s) => {
        clicks[s.id] = parseInt((await env.DB.get("click:" + s.id)) || "0", 10);
        if (s.plan === "qr") qrs[s.id] = parseInt((await env.DB.get("qr:" + s.id)) || "0", 10);
      }));
      const visits = await Promise.all([0, 1, 2, 3, 4, 5, 6].map(async (d) => ({ day: kstDay(d), n: parseInt((await env.DB.get("visit:" + kstDay(d))) || "0", 10) })));
      return json({ stores, pending, clicks, qrs, visits });
    }
    if (method !== "POST") return json({ error: "잘못된 요청이에요." }, 405);
    if (act === "photo") {
      // 휴대폰에서 줄여 보낸 JPEG(base64)를 KV에 저장하고 번호를 돌려줘요
      const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.data || ""));
      if (!m) return json({ error: "사진 파일을 확인해 주세요." }, 400);
      const bin = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
      if (bin.length > 600 * 1024) return json({ error: "사진이 너무 커요. (600KB 이하)" }, 400);
      const key = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      await env.DB.put("img:" + key, bin, { metadata: { type: "image/" + m[1] } });
      return json({ ok: true, key });
    }
    if (act === "geocode") {
      const hit = await geocode(body.addr, env);
      return hit ? json({ ok: true, ...hit }) : json({ error: "주소로 위치를 찾지 못했어요. 지도에서 직접 눌러 주세요." }, 404);
    }
    const id = clip(body.id, 40);
    let stores = await getList(env, "stores");
    let pending = await getList(env, "pending");

    if (act === "approve") {
      const p = pending.find((x) => x.id === id);
      if (!p) return json({ error: "신청을 찾지 못했어요." }, 404);
      const s = cleanStore(body, { ...p, id: "s" + Date.now().toString(36) });
      if (!s.name) return json({ error: "가게 이름을 넣어 주세요." }, 400);
      if (s.link && !okLink(s.link)) return json({ error: "주문 링크는 https:// 로 시작해야 해요." }, 400);
      if (!hasAction(s)) return json({ error: "주문 링크를 넣거나 '손님 전화 공개'를 체크해 주세요." }, 400);
      stores.unshift(s);
      pending = pending.filter((x) => x.id !== id);
      await Promise.all([putList(env, "stores", stores), putList(env, "pending", pending)]);
      return json({ ok: true });
    }
    if (act === "reject") {
      await putList(env, "pending", pending.filter((x) => x.id !== id));
      return json({ ok: true });
    }
    if (act === "update") {
      const i = stores.findIndex((x) => x.id === id);
      if (i < 0) return json({ error: "가게를 찾지 못했어요." }, 404);
      const s = cleanStore(body, stores[i]);
      if (s.link && !okLink(s.link)) return json({ error: "주문 링크는 https:// 로 시작해야 해요." }, 400);
      if (!s.example && !hasAction(s)) return json({ error: "주문 링크를 넣거나 '손님 전화 공개'를 체크해 주세요." }, 400);
      stores[i] = s;
      await putList(env, "stores", stores);
      return json({ ok: true });
    }
    if (act === "delete") {
      const gone = stores.find((x) => x.id === id);
      await putList(env, "stores", stores.filter((x) => x.id !== id));
      await Promise.all([env.DB.delete("click:" + id), env.DB.delete("qr:" + id), ...((gone && gone.photos) || []).map((k) => env.DB.delete("img:" + k))]);
      return json({ ok: true });
    }
    return json({ error: "없는 기능이에요." }, 404);
  }

  return json({ error: "없는 주소예요." }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // www.dongnebaedal.com → dongnebaedal.com 으로 통일 (검색 점수가 한 주소로 모여요)
    if (url.hostname.startsWith("www.")) { url.hostname = url.hostname.slice(4); return Response.redirect(url.toString(), 301); }
    if (url.pathname.startsWith("/api/")) {
      try { return await handleApi(request, env, url.pathname.slice(5)); }
      catch (e) { return json({ error: "서버 오류가 났어요. 잠시 후 다시 시도해 주세요." }, 500); }
    }
    // 가게 사진
    const im = /^\/img\/([a-z0-9]{8,40})$/.exec(url.pathname);
    if (im && env.DB) {
      const { value, metadata } = await env.DB.getWithMetadata("img:" + im[1], "arrayBuffer");
      if (!value) return new Response("not found", { status: 404 });
      return new Response(value, { headers: { "content-type": (metadata && metadata.type) || "image/jpeg", "cache-control": "public, max-age=31536000, immutable" } });
    }
    // 가게 전용 페이지 /s/가게번호 → s.html (가게 정보는 화면에서 /api/store로 불러와요)
    if (/^\/s\/[A-Za-z0-9_-]{1,40}\/?$/.test(url.pathname)) {
      for (const p of ["/s.html", "/s"]) {
        const r = await env.ASSETS.fetch(new Request(new URL(p, url), { headers: request.headers }));
        if (r.ok) return new Response(r.body, { status: 200, headers: r.headers });
      }
    }
    return env.ASSETS.fetch(request);
  },
};

function kstDay(back) {
  return new Date(Date.now() + 9 * 3600e3 - back * 864e5).toISOString().slice(0, 10);
}
