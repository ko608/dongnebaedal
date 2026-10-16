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

const CATS = ["치킨", "한식", "분식", "카페", "중식", "일식", "피자", "야식", "디저트", "기타"];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

const clip = (v, n) => String(v ?? "").trim().slice(0, n);
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
  if (b.phone !== undefined) s.phone = clip(b.phone, 20);
  if (b.addr !== undefined) s.addr = clip(b.addr, 80);
  if (b.intro !== undefined) s.intro = clip(b.intro, 120);
  if (b.lat !== undefined) s.lat = num(b.lat);
  if (b.lng !== undefined) s.lng = num(b.lng);
  if (b.ad !== undefined) s.ad = !!b.ad;
  if (b.example !== undefined) s.example = !!b.example;
  return s;
}
// 손님에게 보여 줄 때는 전화번호·소개 외 필요한 것만
const publicStore = (s) => ({ id: s.id, name: s.name, cat: s.cat, menu: s.menu, link: s.link, addr: s.addr, intro: s.intro, lat: s.lat, lng: s.lng, ad: !!s.ad, example: !!s.example });

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

async function handleApi(request, env, path) {
  if (!env.DB) return json({ error: "서버 설정이 아직 안 됐어요. (KV 바인딩 DB 필요)" }, 500);
  const method = request.method;
  let body = {};
  if (method === "POST") { try { body = await request.json(); } catch { return json({ error: "잘못된 요청이에요." }, 400); } }

  // ── 손님용 ──
  if (path === "stores" && method === "GET") {
    const stores = await getList(env, "stores");
    return json({ stores: stores.map(publicStore) });
  }

  if (path === "apply" && method === "POST") {
    if (!body.agree) return json({ error: "개인정보 수집·이용에 동의해 주세요." }, 400);
    const s = cleanStore(body);
    if (!s.name || !s.menu || !s.phone || !s.addr) return json({ error: "필수 항목을 모두 입력해 주세요." }, 400);
    if (!okLink(s.link)) return json({ error: "주문 링크는 https:// 로 시작하는 주소를 넣어 주세요." }, 400);
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

  // ── 관리자용 ──
  if (path.startsWith("admin/")) {
    if (!(await isAdmin(request, env))) return json({ error: "비밀번호가 맞지 않아요." }, 401);
    const act = path.slice(6);

    if (act === "list") {
      const [stores, pending] = await Promise.all([getList(env, "stores"), getList(env, "pending")]);
      const clicks = {};
      await Promise.all(stores.map(async (s) => { clicks[s.id] = parseInt((await env.DB.get("click:" + s.id)) || "0", 10); }));
      return json({ stores, pending, clicks });
    }
    if (method !== "POST") return json({ error: "잘못된 요청이에요." }, 405);
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
      if (!s.name || !okLink(s.link)) return json({ error: "가게 이름과 https:// 주문 링크를 확인해 주세요." }, 400);
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
      stores[i] = s;
      await putList(env, "stores", stores);
      return json({ ok: true });
    }
    if (act === "delete") {
      await putList(env, "stores", stores.filter((x) => x.id !== id));
      await env.DB.delete("click:" + id);
      return json({ ok: true });
    }
    return json({ error: "없는 기능이에요." }, 404);
  }

  return json({ error: "없는 주소예요." }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try { return await handleApi(request, env, url.pathname.slice(5)); }
      catch (e) { return json({ error: "서버 오류가 났어요. 잠시 후 다시 시도해 주세요." }, 500); }
    }
    return env.ASSETS.fetch(request);
  },
};
