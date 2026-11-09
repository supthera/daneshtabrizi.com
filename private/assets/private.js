/** Shared private-shell helpers */

export async function api(path, options = {}) {
  const isForm = typeof FormData !== "undefined" && options.body instanceof FormData;
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      ...(options.body && !isForm ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || res.statusText || "Request failed");
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function setActiveNav() {
  const path = location.pathname.replace(/\/$/, "/") || "/";
  document.querySelectorAll("[data-nav]").forEach((a) => {
    const href = a.getAttribute("href") || "";
    const norm = href.replace(/\/$/, "/") ;
    a.classList.toggle("on", path === norm || path.startsWith(norm));
  });
}

export function iconGlyph(name) {
  const map = {
    publish: "◈",
    agenda: "◷",
    trade: "↗",
    project: "▣",
    admin: "⚙",
    app: "◻",
  };
  return map[name] || map.app;
}

export async function requireSession() {
  try {
    return await api("/api/health");
  } catch (e) {
    if (e.status === 401) {
      document.body.innerHTML = `
        <main class="wrap" style="padding-top:20vh">
          <p class="hero-line">Private Access</p>
          <h1>Authentication required</h1>
          <p class="lede">Sign in through Cloudflare Access to continue.</p>
          <a class="btn" href="/">Return to public site</a>
        </main>`;
      throw e;
    }
    throw e;
  }
}

/** Ordinova-style floating toast (pastel perimeter). */
export function showToast(message, tone = "ok", durationMs = 3200) {
  let host = document.getElementById("toast-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "toast-host";
    host.className = "toast-host";
    host.setAttribute("aria-live", "polite");
    document.body.appendChild(host);
  }

  const node = document.createElement("div");
  node.className = `toast-dark toast-dark-${tone === "err" ? "error" : "success"}`;
  node.setAttribute("role", "status");
  const text = document.createElement("span");
  text.className = "toast-dark-text";
  text.textContent = message;
  node.appendChild(text);
  host.appendChild(node);

  requestAnimationFrame(() => node.classList.add("is-in"));
  window.setTimeout(() => {
    node.classList.remove("is-in");
    node.classList.add("is-out");
    window.setTimeout(() => node.remove(), 220);
  }, durationMs);
  return node;
}
