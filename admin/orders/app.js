(() => {
  const config = window.GO_STORE_SUPABASE_CONFIG || {};
  const client = config.url && config.anonKey && window.supabase?.createClient
    ? window.supabase.createClient(config.url, config.anonKey)
    : null;
  const $ = selector => document.querySelector(selector);
  const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const currency = (amount, code) => new Intl.NumberFormat("es-AR", { style: "currency", currency: code, maximumFractionDigits: 0 }).format(Number(amount) || 0);
  const statuses = { received: "Recibido", accepted: "Aceptado", preparing: "Preparando", ready: "Listo", completed: "Entregado", cancelled: "Cancelado" };
  let storeId = null;

  function showAuth(message = "") {
    $("#authScreen").classList.remove("hidden");
    $("#ordersPanel").classList.add("hidden");
    $("#signOutButton").classList.add("hidden");
    $("#authMessage").textContent = message;
  }

  async function loadOrders() {
    $("#ordersMessage").textContent = "Cargando pedidos…";
    try {
      const { data: orders, error } = await client.from("orders")
        .select("id,reference,status,customer_name,customer_phone,fulfillment_method,delivery_address,customer_note,currency,subtotal,created_at")
        .eq("store_id", storeId).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      let items = [];
      if (orders.length) {
        const result = await client.from("order_items")
          .select("order_id,product_name,quantity,unit_price,line_total")
          .eq("store_id", storeId).in("order_id", orders.map(order => order.id));
        if (result.error) throw result.error;
        items = result.data;
      }
      const byOrder = new Map();
      items.forEach(item => { if (!byOrder.has(item.order_id)) byOrder.set(item.order_id, []); byOrder.get(item.order_id).push(item); });
      $("#ordersMessage").textContent = orders.length ? `${orders.length} pedidos recientes` : "Todavía no recibiste pedidos.";
      $("#ordersList").innerHTML = orders.map(order => {
        const date = new Date(order.created_at).toLocaleString("es-AR", { dateStyle: "medium", timeStyle: "short" });
        const fulfillment = order.fulfillment_method === "delivery" ? `Delivery · ${escape(order.delivery_address)}` : "Retiro por el local";
        const orderItems = (byOrder.get(order.id) || []).map(item => `<li><span>${item.quantity} × ${escape(item.product_name)}</span><strong>${currency(item.line_total, order.currency)}</strong></li>`).join("");
        return `<article class="order-card"><header class="order-head"><div><span class="order-ref">Pedido ${escape(order.reference)}</span><time>${escape(date)}</time></div><label class="status-picker"><span>Estado</span><select data-status-order="${escape(order.id)}">${Object.entries(statuses).map(([value, label]) => `<option value="${value}" ${value === order.status ? "selected" : ""}>${label}</option>`).join("")}</select></label></header><div class="order-customer"><strong>${escape(order.customer_name)}</strong><a href="tel:${escape(order.customer_phone)}">${escape(order.customer_phone)}</a></div><p class="fulfillment">${fulfillment}</p><ul class="order-items">${orderItems}</ul>${order.customer_note ? `<p class="customer-note"><b>Nota:</b> ${escape(order.customer_note)}</p>` : ""}<footer class="order-total"><span>Total del pedido</span><strong>${currency(order.subtotal, order.currency)}</strong></footer></article>`;
      }).join("");
      $("#ordersList").querySelectorAll("[data-status-order]").forEach(select => select.addEventListener("change", async () => {
        select.disabled = true;
        try {
          const { error } = await client.from("orders").update({ status: select.value }).eq("id", select.dataset.statusOrder);
          if (error) throw error;
          $("#ordersMessage").textContent = "Estado del pedido actualizado.";
        } catch (error) {
          $("#ordersMessage").textContent = `No pudimos actualizar el estado: ${error.message}`;
          await loadOrders();
        } finally { select.disabled = false; }
      }));
    } catch (error) {
      $("#ordersMessage").textContent = `No pudimos cargar los pedidos: ${error.message}`;
    }
  }

  async function init() {
    if (!client) return showAuth("Falta configurar Supabase en creator/supabase-config.js.");
    const { data: { session }, error } = await client.auth.getSession();
    if (error) return showAuth(`No pudimos validar tu sesión: ${error.message}`);
    if (!session) return showAuth();
    const { data: stores, error: storeError } = await client.from("stores").select("id,name,status").limit(1);
    if (storeError) return showAuth(`No pudimos cargar la tienda: ${storeError.message}`);
    if (!stores.length) return showAuth("Esta cuenta todavía no tiene una tienda guardada.");
    storeId = stores[0].id;
    $("#storeLabel").textContent = stores[0].name;
    $("#authScreen").classList.add("hidden");
    $("#ordersPanel").classList.remove("hidden");
    $("#signOutButton").classList.remove("hidden");
    await loadOrders();
  }

  $("#loginForm").addEventListener("submit", async event => {
    event.preventDefault();
    if (!client) return showAuth("Falta configurar Supabase en creator/supabase-config.js.");
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    try {
      sessionStorage.setItem("goStoreReturnToOrders", "1");
      const { error } = await client.auth.signInWithOtp({
        email: $("#loginEmail").value.trim(),
        options: { emailRedirectTo: `${location.origin}/creator/index.html` }
      });
      if (error) throw error;
      showAuth("Te enviamos un enlace. Abrilo en este mismo navegador para entrar al panel de pedidos.");
    } catch (error) {
      sessionStorage.removeItem("goStoreReturnToOrders");
      showAuth(`No pudimos enviar el enlace: ${error.message}`);
    } finally { button.disabled = false; }
  });

  $("#refreshButton").addEventListener("click", loadOrders);
  $("#signOutButton").addEventListener("click", async () => { await client.auth.signOut(); showAuth("Sesión cerrada."); });
  client?.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") showAuth();
    else if (session && event === "SIGNED_IN") init();
  });
  init();
})();
