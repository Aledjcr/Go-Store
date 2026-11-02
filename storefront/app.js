(() => {
  const config = window.GO_STORE_SUPABASE_CONFIG || {};
  const createClient = window.supabase?.createClient;
  const state = { category: "all", search: "", store: null, categories: [], products: [], cart: new Map() };
  const $ = selector => document.querySelector(selector);
  const safe = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const money = (amount, currency = "ARS") => new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(amount) || 0);
  const showError = message => { const box = $("#pageState"); box.textContent = message; box.classList.remove("hidden"); $("#storeContent").classList.add("hidden"); };

  function renderCategories() {
    const categories = [{ id: "all", name: "Todos" }, ...state.categories];
    $("#categoryNav").innerHTML = categories.map(category => `<button type="button" class="${state.category === category.id ? "active" : ""}" data-category="${safe(category.id)}">${safe(category.name)}</button>`).join("");
    $("#categoryNav").querySelectorAll("button").forEach(button => button.addEventListener("click", () => {
      state.category = button.dataset.category;
      renderCategories();
      renderProducts();
    }));
  }

  function renderProducts() {
    const categoryNames = new Map(state.categories.map(category => [category.id, category.name]));
    const query = state.search.trim().toLocaleLowerCase("es-AR");
    const products = state.products.filter(product => {
      const matchesCategory = state.category === "all" || product.category_id === state.category;
      const matchesSearch = !query || `${product.name} ${product.description || ""} ${categoryNames.get(product.category_id) || ""}`.toLocaleLowerCase("es-AR").includes(query);
      return matchesCategory && matchesSearch;
    });
    const list = $("#productList"), empty = $("#catalogState");
    if (!products.length) {
      list.innerHTML = "";
      empty.textContent = state.products.length ? "No encontramos productos con esos filtros." : "Esta tienda todavía no tiene productos disponibles.";
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");
    list.innerHTML = products.map(product => {
      const image = product.image_path ? `<img src="${safe(state.client.storage.from("store-assets").getPublicUrl(product.image_path).data.publicUrl)}" alt="${safe(product.name)}" loading="lazy">` : `<span class="product-placeholder" aria-hidden="true">✳</span>`;
      const count = state.cart.get(product.id)?.quantity || 0;
      return `<article class="product-card"><div class="product-visual">${image}</div><div class="product-info"><div class="product-meta"><h3>${safe(product.name)}</h3><span class="product-price">${money(product.price, product.currency)}</span></div>${product.description ? `<p>${safe(product.description)}</p>` : ""}${categoryNames.has(product.category_id) ? `<span class="product-category">${safe(categoryNames.get(product.category_id))}</span>` : ""}<button type="button" class="add-to-cart" data-add-product="${safe(product.id)}">${count ? `Agregar otro · ${count} en el pedido` : "Agregar al pedido"}<span>＋</span></button></div></article>`;
    }).join("");
    list.querySelectorAll("[data-add-product]").forEach(button => button.addEventListener("click", () => addProduct(button.dataset.addProduct)));
  }

  function addProduct(productId) {
    const product = state.products.find(item => item.id === productId);
    if (!product) return;
    const row = state.cart.get(productId) || { product, quantity: 0 };
    row.quantity = Math.min(row.quantity + 1, 20);
    state.cart.set(productId, row);
    renderProducts();
    renderCart();
  }

  function renderCart() {
    const rows = [...state.cart.values()];
    const quantity = rows.reduce((total, row) => total + row.quantity, 0);
    $("#cartCount").textContent = String(quantity);
    $("#cartItems").innerHTML = rows.length ? rows.map(({ product, quantity: count }) => `<div class="cart-item"><div><strong>${safe(product.name)}</strong><small>${money(product.price, product.currency)} c/u</small></div><div class="cart-item-controls"><button type="button" data-cart-qty="${safe(product.id)}" data-delta="-1" aria-label="Quitar una unidad">−</button><span>${count}</span><button type="button" data-cart-qty="${safe(product.id)}" data-delta="1" aria-label="Agregar una unidad">＋</button></div></div>`).join("") : `<p class="cart-empty">Todavía no agregaste productos.</p>`;
    $("#cartItems").querySelectorAll("[data-cart-qty]").forEach(button => button.addEventListener("click", () => {
      const id = button.dataset.cartQty, row = state.cart.get(id);
      if (!row) return;
      row.quantity = Math.min(20, row.quantity + Number(button.dataset.delta));
      if (row.quantity < 1) state.cart.delete(id);
      else state.cart.set(id, row);
      renderCart(); renderProducts();
    }));
    const subtotal = rows.reduce((total, row) => total + Number(row.product.price) * row.quantity, 0);
    $("#cartTotal").textContent = rows.length ? money(subtotal, rows[0].product.currency) : money(0, "ARS");
    $("#submitOrder").disabled = !rows.length;
  }

  async function submitOrder(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity() || !state.cart.size) return;
    const fields = new FormData(form), fulfillment = fields.get("fulfillment");
    const button = $("#submitOrder"), message = $("#checkoutMessage");
    const items = [...state.cart.entries()].map(([product_id, row]) => ({ product_id, quantity: row.quantity }));
    button.disabled = true;
    message.classList.add("hidden");
    try {
      const { data, error } = await state.client.rpc("create_store_order", {
        p_store_slug: state.store.slug,
        p_customer_name: String(fields.get("customerName") || "").trim(),
        p_customer_phone: String(fields.get("customerPhone") || "").trim(),
        p_fulfillment_method: fulfillment,
        p_delivery_address: fulfillment === "delivery" ? String(fields.get("deliveryAddress") || "").trim() : null,
        p_customer_note: String(fields.get("customerNote") || "").trim() || null,
        p_items: items
      });
      if (error) throw error;
      $("#checkoutForm").classList.add("hidden");
      $("#successText").textContent = `La tienda recibió tu pedido ${data.reference}. Total: ${money(data.subtotal, data.currency)}. Se pondrá en contacto con vos para coordinar el pago y la entrega.`;
      $("#orderSuccess").classList.remove("hidden");
      state.cart.clear(); renderCart(); renderProducts();
    } catch (error) {
      message.textContent = error.message || "No pudimos enviar el pedido. Revisá los datos e intentá de nuevo.";
      message.classList.remove("hidden");
      button.disabled = false;
    }
  }

  async function init() {
    const slug = new URLSearchParams(location.search).get("slug");
    if (!slug) return showError("Esta dirección no incluye una tienda. Volvé al enlace que te compartieron.");
    if (!config.url || !config.anonKey || !createClient) return showError("No se pudo conectar con el catálogo. Revisá la configuración pública de Supabase.");
    const client = createClient(config.url, config.anonKey);
    state.client = client;
    const { data: store, error: storeError } = await client.from("storefronts_public")
      .select("id,slug,name,tagline,description,welcome_title,menu_title,template_key,primary_color,logo_path,logo_text")
      .eq("slug", slug).maybeSingle();
    if (storeError) return showError("No pudimos cargar esta tienda. Intentá nuevamente más tarde.");
    if (!store) return showError("No encontramos una tienda publicada con esa dirección.");
    const [categoriesResult, productsResult] = await Promise.all([
      client.from("categories").select("id,name,slug,sort_order,active").eq("store_id", store.id).eq("active", true).order("sort_order"),
      client.from("products").select("id,category_id,name,description,price,currency,image_path,available,sort_order").eq("store_id", store.id).eq("available", true).order("sort_order")
    ]);
    if (categoriesResult.error || productsResult.error) return showError("No pudimos cargar el catálogo de esta tienda.");

    state.store = store;
    state.categories = categoriesResult.data || [];
    state.products = productsResult.data || [];
    document.documentElement.style.setProperty("--brand", store.primary_color || "#24445a");
    document.title = `${store.name} · Catálogo`;
    $("#storeName").textContent = store.name;
    $("#heroName").textContent = store.name;
    $("#storeTagline").textContent = store.tagline || "CATÁLOGO DIGITAL";
    $("#welcomeTitle").textContent = store.welcome_title || `Conocé ${store.name}`;
    $("#storeDescription").textContent = store.description || "Explorá los productos disponibles en nuestra tienda.";
    $("#menuTitle").textContent = store.menu_title || "Nuestro catálogo";
    $("#footerName").textContent = store.name;
    const logoUrl = store.logo_path ? client.storage.from("store-assets").getPublicUrl(store.logo_path).data.publicUrl : "";
    for (const id of ["brandMark", "footerMark"]) {
      const mark = document.getElementById(id);
      if (logoUrl) mark.innerHTML = `<img src="${safe(logoUrl)}" alt="">`;
      else mark.textContent = store.logo_text || store.name.slice(0, 1).toUpperCase();
    }
    $("#pageState").classList.add("hidden");
    $("#storeContent").classList.remove("hidden");
    renderCategories();
    renderProducts();
    renderCart();
    $("#searchInput").addEventListener("input", event => { state.search = event.target.value; renderProducts(); });
    $("#cartTrigger").addEventListener("click", () => $("#cartDialog").showModal());
    $("#closeCart").addEventListener("click", () => $("#cartDialog").close());
    $("#finishOrder").addEventListener("click", () => { $("#orderSuccess").classList.add("hidden"); $("#checkoutForm").classList.remove("hidden"); $("#checkoutForm").reset(); $("#cartDialog").close(); });
    $("#checkoutForm").addEventListener("submit", submitOrder);
    document.querySelectorAll('[name="fulfillment"]').forEach(radio => radio.addEventListener("change", () => {
      const delivery = document.querySelector('[name="fulfillment"]:checked').value === "delivery";
      $("#addressField").classList.toggle("hidden", !delivery);
      $("#addressField input").required = delivery;
    }));
  }

  init().catch(error => {
    console.error("Go Store storefront:", error);
    showError("Ocurrió un problema al abrir esta tienda. Intentá nuevamente más tarde.");
  });
})();
