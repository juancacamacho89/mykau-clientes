// ═══════════ MYKAU CLIENTES · capa del ID oculto ═══════════
// La base de clientes guarda cada vaca con un ID interno = código del cliente + número (ej. Andrew404).
// La app (copia de Mykau) solo conoce el número (404). Esta capa se pone entre la app y Supabase:
//   · al LEER: quita el código del cliente (Andrew404 → 404)
//   · al ESCRIBIR o FILTRAR: lo pone (404 → Andrew404), con el cliente de la finca abierta
//   · si el usuario tiene fincas de varios clientes (Juan), solo deja ver las del cliente escogido
// También esconde los módulos que todavía no van para clientes.
(function () {
  "use strict";
  const realFetch = window.fetch.bind(window);
  const COW_KEYS = ["cow_id", "dam"];                 // columnas que guardan un ID de vaca
  const RPC_KEYS = ["p_cow", "cid"];                   // parámetros de funciones con un ID de vaca
  const ID_TABLES = ["cows", "cow_merit"];           // tablas/vistas donde "id" es el ID de la vaca (cow_merit: índice de Vida productiva)
  // tablas que se filtran por finca cuando el usuario tiene varios clientes
  const FARM_TABLES = ["user_farm_access", "farm_lists", "farm_settings", "daily_milk", "lot_feed", "cow_plans",
    "treatments_cow", "repro_checks", "app_event_log", "cow_pen_history", "cows"];
  // módulos que SÍ se ven en la app de clientes (permisos de app_profiles)
  const ALLOW = new Set(["chequeo", "chequeo_tratamientos", "chequeo_resultados",
    "pesaje_registrar", "pesaje_totales", "diaria_registrar", "diaria_totales", "diaria_resumen",
    // 24/11/2026: módulos que funcionan con las tablas que ya tiene la base de clientes
    "registros_ver", "listas_ver", "pesot_registrar", "generador_ver",
    // Reportes: solo Reproducción e IA y toros (resumen de fertilidad: SQL/clientes/06_reporte_fertilidad_clientes.sql)
    "reporte_ver",
    // 26/11/2026: Suplementación (ración de concentrado por finca en ☰ Configuración → Ración; tabla cow_concentrate en 07_modulos_clientes.sql)
    "racion_ver", "racion_registrar"]);
  // módulos que solo ve Juan (Admin Principal) hasta que él los prenda a un perfil en ☰ Usuarios y permisos
  // (sin el "permiso parecido" de Mykau: el perfil tiene que tener ESE permiso). 26/11/2026: Suplementación
  const EXPLICIT = new Set(["racion_ver", "racion_registrar"]);
  const mkcExplicit = k => { try { return myProfile === "Admin Principal" || ["R", "V"].includes(perms[k]) && (k !== "racion_registrar" || perms[k] === "R"); } catch (e) { return false; } };
  const DENY = new Set([]);                           // fotos: activas desde el 24/11/2026 (SQL/clientes/05_fotos_clientes.sql)

  // módulos que se prenden / apagan por cliente (☰ Configuración → 🧩 Módulos; clients.modules). Mis vacas siempre va.
  const MODS = [["chequeo", "🩺 Chequeo repro", /^chequeo/], ["pesaje", "🥛 Pesaje de leche", /^pesaje_/], ["diaria", "🥛 Leche diaria", /^diaria_/],
    ["racion", "🌾 Suplementación", /^racion_/], ["listas", "📋 Listas de trabajo", /^listas_ver$/], ["generador", "🧾 Generador de listas", /^generador_ver$/],
    ["pesot", "⚖️ Pesaje terneras", /^pesot_/], ["reporte", "📊 Reportes", /^reporte_ver$/], ["registros", "🗂️ Registros", /^registros_ver$/]];
  let modsOf = {};                                     // cliente → { módulo: false }
  const modOf = k => (MODS.find(m => m[2].test(k)) || [])[0];
  const modOff = k => { const m = modOf(k); return !!m && (modsOf[MKC.client] || {})[m] === false; };
  const isBoss = () => { try { return myProfile === "Admin Principal"; } catch (e) { return false; } };
  const MKC = window.MKC = {
    MODS,
    setMods: (cl, m) => { modsOf[cl] = m || {}; },
    // en el Inicio, a Juan le marca "apagado" lo que el cliente no ve
    markHome: () => { document.querySelectorAll(".apps [data-perm]").forEach(el => {
      const off = el.dataset.perm.split(" ").every(k => !modOf(k) || modOff(k)) && el.dataset.perm.split(" ").some(modOf);
      let tag = el.querySelector(".mkc-off");
      if (off && !tag){ tag = document.createElement("i"); tag.className = "mkc-off"; tag.textContent = "apagado";
        tag.style.cssText = "position:absolute;top:2px;left:50%;transform:translateX(-50%);font-size:10px;font-style:normal;background:#888;color:#fff;border-radius:6px;padding:0 5px";
        el.style.position = "relative"; el.appendChild(tag); }
      if (!off && tag) tag.remove(); }); },
    client: localStorage.getItem("mkClient") || "",   // código del cliente activo
    clients: [],                                       // clientes a los que entra este usuario
    farmClient: {},                                    // finca → cliente
    ok: k => !DENY.has(k) && (ALLOW.has(k) || /^vacas_/.test(k)) && (!EXPLICIT.has(k) || mkcExplicit(k)) && (isBoss() || !modOff(k)),
  };

  let mapAuth = null, mapPromise = null;
  // carga (una vez por sesión) de qué cliente es cada finca que el usuario puede ver
  function loadMap(headers) {
    const auth = headers.get("Authorization") || "";
    if (mapPromise && auth === mapAuth) return mapPromise;
    mapAuth = auth;
    const h = new Headers({ apikey: headers.get("apikey") || "", Authorization: auth, Accept: "application/json" });
    mapPromise = realFetch(window.APP_CONFIG.SUPABASE_URL + "/rest/v1/farms?select=id,client,name&order=name", { headers: h })
      .then(r => r.ok ? r.json() : [])
      .then(rows => {
        MKC.farmClient = Object.fromEntries((rows || []).map(f => [f.id, f.client]));
        MKC.farmName = Object.fromEntries((rows || []).map(f => [f.id, f.name]));
        realFetch(window.APP_CONFIG.SUPABASE_URL + "/rest/v1/clients?select=code,modules", { headers: h }).then(r => r.ok ? r.json() : [])
          .then(cl => { modsOf = Object.fromEntries((cl || []).map(x => [x.code, x.modules || {}])); try { if (typeof renderHome === "function" && !document.getElementById("tabInicio")?.classList.contains("hidden")) renderHome(); } catch (e) {} })
          .catch(() => {});
        MKC.clients = [...new Set((rows || []).map(f => f.client).filter(Boolean))].sort();
        if (!MKC.clients.includes(MKC.client)) MKC.client = MKC.clients[0] || "";
        localStorage.setItem("mkClient", MKC.client);
        drawPicker(); drawFarmBox();
        return MKC;
      })
      .catch(() => { mapPromise = null; return MKC; });
    return mapPromise;
  }
  // fincas del cliente activo · las que la persona escogió NO ver en ☰ → "🏡 Fincas que veo" (en este celular; Juan 27/11/2026)
  const clientFarms = () => Object.keys(MKC.farmClient).filter(f => MKC.farmClient[f] === MKC.client);
  const hideFarms = () => { try { return new Set(JSON.parse(localStorage.getItem("mkHideFarms") || "[]").map(String)); } catch (e) { return new Set(); } };
  const myFarmIds = () => { const all = clientFarms(), h = hideFarms(), v = all.filter(f => !h.has(String(f))); return v.length ? v : all; };
  const farmsHidden = () => myFarmIds().length < clientFarms().length;
  const pre = () => MKC.client;
  const add = v => (typeof v === "string" || typeof v === "number") && String(v) !== "" && pre() && !String(v).startsWith(pre()) ? pre() + String(v).toUpperCase() : v;
  const strip = v => typeof v === "string" && pre() && v.startsWith(pre()) && v.length > pre().length ? v.slice(pre().length) : v;

  // ── filtros de la URL (cow_id=eq.404 → cow_id=eq.Andrew404) ──
  function fixFilter(val) {
    const m = /^(not\.)?(eq|neq|like|ilike|in)\.(.*)$/s.exec(val);
    if (!m) return val;
    const [, not = "", op, rest] = m;
    if (op === "in") {
      const inner = rest.replace(/^\(|\)$/g, "");
      const items = inner.match(/"(?:[^"\\]|\\.)*"|[^,]+/g) || [];
      return `${not}in.(${items.map(it => {
        const q = it.startsWith('"'), raw = q ? it.slice(1, -1) : it;
        const v = add(raw); return q ? `"${v}"` : `"${v}"`;
      }).join(",")})`;
    }
    if ((op === "like" || op === "ilike") && /^[%*]/.test(rest)) return val;   // búsqueda "contiene": se deja igual
    return `${not}${op}.${add(rest)}`;
  }
  function fixOr(val) {   // or=(cow_id.eq.404,...)
    return val.replace(/\b(cow_id|dam)\.(eq|neq)\.([^,()]+)/g, (_, k, op, v) => `${k}.${op}.${add(v)}`)
              .replace(/\b(cow_id|dam)\.in\.\(([^)]*)\)/g, (_, k, l) => `${k}.in.(${l.split(",").map(x => add(x.replace(/"/g, ""))).join(",")})`);
  }
  // ── cuerpo JSON al escribir ──
  function fixBody(obj, table, rpc) {
    if (Array.isArray(obj)) return obj.map(o => fixBody(o, table, rpc));
    if (!obj || typeof obj !== "object") return obj;
    const o = { ...obj };
    for (const k of COW_KEYS) if (k in o && o[k] != null) o[k] = add(o[k]);
    if (table === "cows" && o.id != null) o.id = add(o.id);
    if (rpc) for (const k of RPC_KEYS) if (k in o && o[k] != null) o[k] = add(o[k]);
    return o;
  }
  // ── respuesta: quita el código del cliente ──
  function fixResp(x, cowRow) {
    if (Array.isArray(x)) return x.map(r => fixResp(r, cowRow));
    if (!x || typeof x !== "object") return x;
    for (const k of Object.keys(x)) {
      const v = x[k];
      if (COW_KEYS.includes(k)) x[k] = strip(v);
      else if (k === "id" && cowRow) x[k] = strip(v);
      else if (k === "cows" && v && typeof v === "object") x[k] = fixResp(v, true);   // embebido: cows(...)
      else if (k !== "details" && v && typeof v === "object") x[k] = fixResp(v, false);
    }
    return x;
  }

  // fotos: en Storage cada foto va en la carpeta de la vaca con su ID interno (404/… → Andrew404/…),
  // así las reglas de la base saben de qué finca es. En la ficha (photo_path) queda como la ve la app.
  const fixPath = p => { const i = p.indexOf("/"); return i > 0 ? add(decodeURIComponent(p.slice(0, i))) + p.slice(i) : p; };
  async function fixStorage(url, init) {
    await loadMap(new Headers(init.headers || {}));
    if (!pre()) return realFetch(url.toString(), init);
    const m = url.pathname.match(/^(.*\/storage\/v1\/object\/(?:sign\/|public\/|authenticated\/)?cow-photos\/)(.+)$/);
    if (m) url.pathname = m[1] + fixPath(m[2]);
    let body = init.body;
    if (typeof body === "string" && body) {
      try {
        const o = JSON.parse(body);
        if (Array.isArray(o.paths)) o.paths = o.paths.map(fixPath);          // createSignedUrls
        if (Array.isArray(o.prefixes)) o.prefixes = o.prefixes.map(fixPath);  // remove
        body = JSON.stringify(o);
      } catch (e) { /* no era JSON (la foto) */ }
    }
    const res = await realFetch(url.toString(), { ...init, body });
    const ct = res.headers.get("Content-Type") || "";
    if (!/json/i.test(ct)) return res;
    // respuesta de createSignedUrls: devuelve "path" como lo pidió la app
    const txt = await res.text();
    let fixed = txt;
    try { const j = JSON.parse(txt); if (Array.isArray(j)) j.forEach(x => { if (x && typeof x.path === "string") x.path = strip(x.path); }); fixed = JSON.stringify(j); } catch (e) { /* igual */ }
    const h2 = new Headers(res.headers); h2.delete("Content-Length"); h2.delete("Content-Encoding");
    return new Response(fixed, { status: res.status, statusText: res.statusText, headers: h2 });
  }

  MKC.fetch = async function (input, init = {}) {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (/\/storage\/v1\/object\//.test(url.pathname) && /cow-photos/.test(url.pathname)) return fixStorage(url, init);
    const m = url.pathname.match(/\/rest\/v1\/(rpc\/)?([A-Za-z0-9_]+)/);
    if (!m) return realFetch(input, init);
    const rpc = !!m[1], table = m[2];
    const headers = new Headers(init.headers || (typeof input !== "string" ? input.headers : undefined));
    if (table !== "farms" || rpc || url.searchParams.get("select") !== "id,client") await loadMap(headers);
    if (!pre()) return realFetch(input, init);
    const method = (init.method || "GET").toUpperCase();

    // filtros
    const sp = url.searchParams, out = new URLSearchParams();
    for (const [k, v] of sp) {
      if (COW_KEYS.includes(k) || (k === "id" && ID_TABLES.includes(table))) out.append(k, fixFilter(v));
      else if (k === "or" || k === "and") out.append(k, fixOr(v));
      else out.append(k, v);
    }
    // solo lo del cliente activo (para Juan, que entra a fincas de varios clientes)
    if (!rpc && (MKC.clients.length > 1 || farmsHidden())) {
      const ids = myFarmIds();
      if (table === "farms") out.append("id", `in.(${ids.join(",")})`);
      else if (FARM_TABLES.includes(table) && method === "GET") out.append("farm_id", `in.(${ids.join(",")})`);
      if (["cow_events", "cow_milk"].includes(table) && method === "GET") out.append("cow_id", `like.${pre()}*`);
    }
    url.search = out.toString();

    let body = init.body;
    if (typeof body === "string" && body && /json/i.test(headers.get("Content-Type") || "json")) {
      try { body = JSON.stringify(fixBody(JSON.parse(body), table, rpc)); } catch (e) { /* no era JSON */ }
    }
    const res = await realFetch(url.toString(), { ...init, headers, body });
    const ct = res.headers.get("Content-Type") || "";
    if (!/json/i.test(ct) || res.status === 204) return res;
    const txt = await res.text();
    let fixed = txt;
    try { fixed = JSON.stringify(fixResp(JSON.parse(txt), ID_TABLES.includes(table) && !rpc)); } catch (e) { /* se deja igual */ }
    const h2 = new Headers(res.headers); h2.delete("Content-Length"); h2.delete("Content-Encoding");
    return new Response(fixed, { status: res.status, statusText: res.statusText, headers: h2 });
  };

  // ☰ menú → "🏡 Fincas que veo": prender / apagar las fincas que esta persona ve en este celular (si tiene 2 o más del cliente)
  MKC.menuNeeded = () => clientFarms().length > 1;
  MKC.drawFarmBox = () => drawFarmBox();
  function drawFarmBox() {
    const put = () => {
      const list = document.querySelector("#drawer .dw-list"); if (!list) return;
      let box = document.getElementById("mkcFarmBox");
      const fs = clientFarms();
      if (fs.length < 2) { box?.remove(); return; }
      if (!box) {
        box = document.createElement("div"); box.id = "mkcFarmBox"; box.style.cssText = "padding:10px 14px;border-top:1px solid var(--line)";
        box.addEventListener("change", e => {
          const t = e.target.closest("[data-mkcfarm]"); if (!t) return;
          const h = hideFarms(); t.checked ? h.delete(t.dataset.mkcfarm) : h.add(t.dataset.mkcfarm);
          if (fs.every(f => h.has(String(f)))) { t.checked = true; return alert("Deja al menos una finca prendida"); }
          localStorage.setItem("mkHideFarms", JSON.stringify([...h]));
          // lo guardado en el celular era con las fincas anteriores: se vuelve a bajar
          const keep = {}; for (const k of Object.keys(localStorage)) if (/^sb-|^mkClient$|^mkHideFarms$|^perms$|^profile$|^myName$/.test(k)) keep[k] = localStorage.getItem(k);
          localStorage.clear(); for (const k in keep) localStorage.setItem(k, keep[k]);
          location.hash = ""; location.reload();
        });
        list.appendChild(box);
      }
      const h = hideFarms();
      box.innerHTML = `<b>🏡 Fincas que veo</b><div class="sub" style="margin:2px 0 6px">Solo en este celular. Apaga las que no quieres ver ahora.</div>`
        + fs.map(f => `<label style="display:flex;gap:10px;align-items:center;padding:6px 0;color:var(--ink)"><input type="checkbox" data-mkcfarm="${f}" ${h.has(String(f)) ? "" : "checked"} style="width:22px;height:22px">${(MKC.farmName[f] || "Finca " + f).replace(/[<>&]/g, "")}</label>`).join("");
      try { if (MKC.menuNeeded()) document.getElementById("menuBtn")?.classList.remove("hidden"); } catch (e) {}
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", put); else put();
  }

  // selector de cliente (solo si el usuario entra a fincas de más de un cliente)
  function drawPicker() {
    const put = () => {
      const hdr = document.querySelector("#tabInicio header .brand > div");
      if (!hdr) return;
      let sel = document.getElementById("mkcSel");
      if (MKC.clients.length < 2) { sel?.remove(); return; }
      if (!sel) {
        sel = document.createElement("select"); sel.id = "mkcSel";
        sel.style.cssText = "margin-top:4px;padding:4px 8px;font-size:13px;width:auto;border-radius:8px";
        sel.addEventListener("change", () => {
          // otro cliente: se borra lo guardado en el celular (era del cliente anterior) y se recarga
          const keep = {}; for (const k of Object.keys(localStorage)) if (/^sb-/.test(k)) keep[k] = localStorage.getItem(k);
          localStorage.clear(); for (const k in keep) localStorage.setItem(k, keep[k]);
          localStorage.setItem("mkClient", sel.value); location.hash = ""; location.reload();
        });
        hdr.appendChild(sel);
      }
      sel.innerHTML = MKC.clients.map(c => `<option value="${c}" ${c === MKC.client ? "selected" : ""}>Cliente: ${c}</option>`).join("");
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", put); else put();
  }

  // lo que no va en la versión de clientes
  const st = document.createElement("style");
  st.textContent = `[data-dw-bn]{display:none!important}
    .brand img,.brand-login img{background:#0b367a!important}   /* logo azul: Mykau Clientes (la Mykau de El Recodo / La Isla es verde) */
    html:root{--accent:#1f5fbf;--soft:#eef3fb}   /* botones, menús y pestañas en azul (html:root gana al :root de la app) */
    @media (prefers-color-scheme: dark){ html:root:not([data-theme="light"]){--accent:#5b9bff;--soft:#1b2433} }
    html:root[data-theme="dark"]{--accent:#5b9bff;--soft:#1b2433}`;
  (document.head || document.documentElement).appendChild(st);
})();
