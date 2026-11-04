(() => {
  const config = window.GO_STORE_SUPABASE_CONFIG || {};
  const client = config.url && config.anonKey && window.supabase?.createClient
    ? window.supabase.createClient(config.url, config.anonKey)
    : null;
  const $ = selector => document.querySelector(selector);
  const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const money = value => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 }).format(Number(value) || 0);
  const orderMoney = (value, currency = "ARS") => new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(value) || 0);
  const orderStatuses = { received: "Recibido", accepted: "Aceptado", preparing: "Preparando", ready: "Listo", completed: "Entregado", cancelled: "Cancelado" };
  const slugify = value => String(value || "productos").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "productos";
  let store = null;
  let products = [];
  let categories = [];
  let editingProductId = null;
  let selectedLogoFile = null;
  let removeCurrentLogo = false;
  const templateColors = { huerta: "#536a43", costa: "#24445a", barro: "#975d43" };

  function authScreen(message = "") {
    $("#authScreen").classList.remove("hidden");
    $("#passwordRecoveryCard").classList.add("hidden");
    $("#managerPanel").classList.add("hidden");
    $("#signOutButton").classList.add("hidden");
    $("#authMessage").textContent = message;
  }

  function showWorkspaceView(view, updateLocation = false) {
    const selected = ["products", "store", "orders"].includes(view) ? view : "products";
    $("#productsView").classList.toggle("hidden", selected !== "products");
    $("#store-settings").classList.toggle("hidden", selected !== "store");
    $("#ordersView").classList.toggle("hidden", selected !== "orders");
    document.querySelectorAll("[data-view-link]").forEach(link => {
      const active = link.dataset.viewLink === selected;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    if (updateLocation) {
      const url = new URL(location.href);
      url.searchParams.delete("view");
      url.hash = selected === "store" ? "store-settings" : selected;
      history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
    if (selected === "orders") loadOrders();
  }

  function openDialog(product = null) {
    editingProductId = product?.id || null;
    $("#dialogTitle").textContent = product ? "Editar producto" : "Agregar producto";
    $("#productName").value = product?.name || "";
    $("#productDescription").value = product?.description || "";
    $("#productPrice").value = product?.price ?? "";
    $("#productCategory").value = product?.category || "";
    $("#productAvailable").checked = product?.available ?? true;
    $("#dialogMessage").textContent = "";
    $("#productDialog").classList.remove("hidden");
    $("#productName").focus();
  }

  function closeDialog() {
    $("#productDialog").classList.add("hidden");
    $("#productForm").reset();
    editingProductId = null;
  }

  function renderProducts() {
    $("#productCount").textContent = products.length;
    $("#catalogMessage").textContent = products.length ? "Estos productos aparecen en el catálogo de tu tienda." : "Todavía no cargaste productos. Agregá el primero para completar tu catálogo.";
    $("#productList").innerHTML = products.map(product => `<article class="product-row ${product.available ? "" : "unavailable"}">
      <div class="product-avatar" aria-hidden="true">${escape((product.name || "P").slice(0, 1).toUpperCase())}</div>
      <div class="product-details"><div class="product-title"><h3>${escape(product.name)}</h3><strong>${money(product.price)}</strong></div><p>${escape(product.description || "Sin descripción")}</p><small>${escape(product.category || "Sin categoría")}</small></div>
      <div class="product-actions"><button class="availability-toggle ${product.available ? "is-available" : ""}" type="button" data-toggle-product="${escape(product.id)}" aria-pressed="${product.available}">${product.available ? "Disponible" : "Pausado"}</button><button class="row-action" type="button" data-edit-product="${escape(product.id)}">Editar</button><button class="row-action danger" type="button" data-delete-product="${escape(product.id)}">Eliminar</button></div>
    </article>`).join("");
    $("#productList").querySelectorAll("[data-edit-product]").forEach(button => button.addEventListener("click", () => openDialog(products.find(product => product.id === button.dataset.editProduct))));
    $("#productList").querySelectorAll("[data-toggle-product]").forEach(button => button.addEventListener("click", () => toggleProduct(button.dataset.toggleProduct)));
    $("#productList").querySelectorAll("[data-delete-product]").forEach(button => button.addEventListener("click", () => deleteProduct(button.dataset.deleteProduct)));
  }

  async function loadCatalog() {
    $("#catalogMessage").textContent = "Cargando catálogo…";
    const [productResult, categoryResult] = await Promise.all([
      client.from("products").select("id,name,description,price,available,sort_order,category_id").eq("store_id", store.id).order("sort_order"),
      client.from("categories").select("id,name,slug,sort_order").eq("store_id", store.id).order("sort_order")
    ]);
    if (productResult.error) throw productResult.error;
    if (categoryResult.error) throw categoryResult.error;
    categories = categoryResult.data || [];
    const categoryNames = new Map(categories.map(category => [category.id, category.name]));
    products = (productResult.data || []).map(product => ({ ...product, category: categoryNames.get(product.category_id) || "" }));
    renderProducts();
  }

  async function loadOrders() {
    $("#ordersMessage").textContent = "Cargando pedidos…";
    try {
      const { data: orders, error } = await client.from("orders")
        .select("id,reference,status,customer_name,customer_phone,fulfillment_method,delivery_address,customer_note,currency,subtotal,created_at")
        .eq("store_id", store.id).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      let items = [];
      if (orders.length) {
        const result = await client.from("order_items")
          .select("order_id,product_name,quantity,line_total")
          .eq("store_id", store.id).in("order_id", orders.map(order => order.id));
        if (result.error) throw result.error;
        items = result.data || [];
      }
      const byOrder = new Map();
      items.forEach(item => { if (!byOrder.has(item.order_id)) byOrder.set(item.order_id, []); byOrder.get(item.order_id).push(item); });
      $("#ordersMessage").textContent = orders.length ? `${orders.length} pedidos recientes` : "Todavía no recibiste pedidos.";
      $("#ordersList").innerHTML = (orders || []).map(order => {
        const date = new Date(order.created_at).toLocaleString("es-AR", { dateStyle: "medium", timeStyle: "short" });
        const fulfillment = order.fulfillment_method === "delivery" ? `Delivery · ${escape(order.delivery_address)}` : "Retiro por el local";
        const orderItems = (byOrder.get(order.id) || []).map(item => `<li><span>${Number(item.quantity) || 0} × ${escape(item.product_name)}</span><strong>${orderMoney(item.line_total, order.currency)}</strong></li>`).join("");
        return `<article class="order-card"><header class="order-head"><div><span class="order-ref">Pedido ${escape(order.reference)}</span><time>${escape(date)}</time></div><label class="status-picker"><span>Estado</span><select data-status-order="${escape(order.id)}">${Object.entries(orderStatuses).map(([value, label]) => `<option value="${value}" ${value === order.status ? "selected" : ""}>${label}</option>`).join("")}</select></label></header><div class="order-customer"><strong>${escape(order.customer_name)}</strong><a href="tel:${escape(order.customer_phone)}">${escape(order.customer_phone)}</a></div><p class="fulfillment">${fulfillment}</p><ul class="order-items">${orderItems}</ul>${order.customer_note ? `<p class="customer-note"><b>Nota:</b> ${escape(order.customer_note)}</p>` : ""}<footer class="order-total"><span>Total del pedido</span><strong>${orderMoney(order.subtotal, order.currency)}</strong></footer></article>`;
      }).join("");
      $("#ordersList").querySelectorAll("[data-status-order]").forEach(select => select.addEventListener("change", async () => {
        select.disabled = true;
        try {
          const { error } = await client.from("orders").update({ status: select.value }).eq("store_id", store.id).eq("id", select.dataset.statusOrder);
          if (error) throw error;
          $("#ordersMessage").textContent = "Estado del pedido actualizado.";
        } catch (error) {
          $("#ordersMessage").textContent = `No pudimos actualizar el estado: ${error.message}`;
          await loadOrders();
        } finally { select.disabled = false; }
      }));
    } catch (error) {
      $("#ordersMessage").textContent = `No pudimos cargar los pedidos: ${error.message}`;
      $("#ordersList").replaceChildren();
    }
  }

  async function loadStore() {
    const requestedId = new URLSearchParams(location.search).get("store");
    let query = client.from("stores").select("id,slug,name,tagline,description,welcome_title,menu_title,template_key,primary_color,logo_path,logo_text,contact_phone,status,updated_at").order("updated_at", { ascending: false }).limit(1);
    if (requestedId) query = client.from("stores").select("id,slug,name,tagline,description,welcome_title,menu_title,template_key,primary_color,logo_path,logo_text,contact_phone,status,updated_at").eq("id", requestedId).limit(1);
    const { data, error } = await query;
    if (error) throw error;
    store = data?.[0] || null;
    if (!store) {
      location.replace("../creator/");
      return;
    }
    $("#sidebarStoreName").textContent = store.name;
    $("#adminHomeLink").href = `./?store=${encodeURIComponent(store.id)}`;
    $("#storeMeta").textContent = `/${store.slug}`;
    $("#storeStatus").textContent = store.status === "published" ? "Publicada" : store.status === "paused" ? "Pausada" : "Borrador privado";
    $("#storeNameInput").value = store.name || "";
    $("#storeTagline").value = store.tagline || "";
    $("#storeWelcome").value = store.welcome_title || "";
    $("#storeDescription").value = store.description || "";
    $("#storeMenuTitle").value = store.menu_title || "";
    $("#storeLogoText").value = store.logo_text || "";
    $("#storeTemplate").value = store.template_key || "costa";
    $("#storeColor").value = store.primary_color || templateColors[store.template_key] || templateColors.costa;
    $("#storeColorValue").textContent = $("#storeColor").value.toUpperCase();
    $("#storeContactPhone").value = store.contact_phone || "";
    setLogoPreview();
    if (store.status === "published") {
      $("#publicStoreLink").href = `../storefront/?slug=${encodeURIComponent(store.slug)}`;
      $("#publicStoreLink").classList.remove("hidden");
    } else {
      $("#publicStoreLink").classList.add("hidden");
    }
    $("#authScreen").classList.add("hidden");
    $("#managerPanel").classList.remove("hidden");
    $("#signOutButton").classList.remove("hidden");
    await loadCatalog();
    const initialView = new URLSearchParams(location.search).get("view") || location.hash.slice(1);
    showWorkspaceView(initialView === "store-settings" ? "store" : initialView);
  }

  function setLogoPreview(previewUrl = "") {
    const target = $("#logoPreview");
    const imageUrl = previewUrl || (!removeCurrentLogo && store?.logo_path ? client.storage.from("store-assets").getPublicUrl(store.logo_path).data.publicUrl : "");
    target.replaceChildren();
    if (imageUrl) {
      const image = document.createElement("img");
      image.src = imageUrl;
      image.alt = `Logo de ${store?.name || "la tienda"}`;
      target.append(image);
    } else {
      target.textContent = $("#storeLogoText").value.trim() || "GS";
    }
    $("#removeLogoButton").classList.toggle("hidden", !imageUrl);
  }

  async function saveStoreSettings(event) {
    event.preventDefault();
    const button = event.currentTarget.querySelector('[type="submit"]');
    const name = $("#storeNameInput").value.trim();
    if (!name) return $("#storeMessage").textContent = "El nombre de la tienda es obligatorio.";
    if (selectedLogoFile && selectedLogoFile.size > 5 * 1024 * 1024) return $("#storeMessage").textContent = "El logo debe pesar menos de 5 MB.";
    button.disabled = true;
    $("#storeMessage").textContent = "Guardando cambios…";
    let nextLogoPath = store.logo_path;
    try {
      if (selectedLogoFile) {
        const extension = selectedLogoFile.type === "image/png" ? "png" : selectedLogoFile.type === "image/webp" ? "webp" : "jpg";
        nextLogoPath = `${store.id}/brand-logo.${extension}`;
        const { error: uploadError } = await client.storage.from("store-assets").upload(nextLogoPath, selectedLogoFile, {
          contentType: selectedLogoFile.type,
          upsert: true
        });
        if (uploadError) throw uploadError;
      } else if (removeCurrentLogo) {
        nextLogoPath = null;
      }
      const updates = {
        name,
        tagline: $("#storeTagline").value.trim() || null,
        welcome_title: $("#storeWelcome").value.trim() || null,
        description: $("#storeDescription").value.trim() || null,
        menu_title: $("#storeMenuTitle").value.trim() || null,
        logo_text: $("#storeLogoText").value.trim().toUpperCase() || null,
        template_key: $("#storeTemplate").value,
        primary_color: $("#storeColor").value,
        contact_phone: $("#storeContactPhone").value.trim() || null,
        logo_path: nextLogoPath
      };
      const { error } = await client.from("stores").update(updates).eq("id", store.id);
      if (error) throw error;
      if (store.logo_path && store.logo_path !== nextLogoPath) {
        await client.storage.from("store-assets").remove([store.logo_path]);
      }
      store = { ...store, ...updates };
      $("#sidebarStoreName").textContent = store.name;
      selectedLogoFile = null;
      removeCurrentLogo = false;
      $("#storeLogoFile").value = "";
      setLogoPreview();
      $("#storeMessage").textContent = "Identidad y diseño guardados. La tienda ya refleja los cambios.";
    } catch (error) {
      $("#storeMessage").textContent = `No pudimos guardar los cambios: ${error.message}`;
    } finally {
      button.disabled = false;
    }
  }

  async function resolveCategory(name) {
    const cleanName = name.trim();
    if (!cleanName) return null;
    const slug = slugify(cleanName);
    const sortOrder = categories.find(category => category.slug === slug)?.sort_order ?? categories.length;
    const { data, error } = await client.from("categories")
      .upsert({ store_id: store.id, name: cleanName, slug, sort_order: sortOrder }, { onConflict: "store_id,slug" })
      .select("id,name,slug,sort_order").single();
    if (error) throw error;
    categories = [...categories.filter(category => category.id !== data.id), data];
    return data.id;
  }

  async function saveProduct(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    const name = $("#productName").value.trim();
    const price = Number($("#productPrice").value);
    if (!name || !Number.isFinite(price) || price < 0) return;
    submit.disabled = true;
    $("#dialogMessage").textContent = "Guardando producto…";
    try {
      const categoryId = await resolveCategory($("#productCategory").value);
      const fields = {
        store_id: store.id,
        category_id: categoryId,
        name,
        description: $("#productDescription").value.trim() || null,
        price,
        currency: "ARS",
        available: $("#productAvailable").checked,
        sort_order: editingProductId ? (products.find(product => product.id === editingProductId)?.sort_order ?? products.length) : products.length
      };
      const result = editingProductId
        ? await client.from("products").update(fields).eq("store_id", store.id).eq("id", editingProductId)
        : await client.from("products").insert(fields);
      if (result.error) throw result.error;
      closeDialog();
      await loadCatalog();
      $("#catalogMessage").textContent = "Producto guardado. El catálogo ya refleja los cambios.";
    } catch (error) {
      $("#dialogMessage").textContent = `No pudimos guardar el producto: ${error.message}`;
    } finally {
      submit.disabled = false;
    }
  }

  async function toggleProduct(id) {
    const product = products.find(item => item.id === id);
    if (!product) return;
    const { error } = await client.from("products").update({ available: !product.available }).eq("store_id", store.id).eq("id", id);
    if (error) return $("#catalogMessage").textContent = `No pudimos cambiar la disponibilidad: ${error.message}`;
    product.available = !product.available;
    renderProducts();
    $("#catalogMessage").textContent = "Disponibilidad actualizada.";
  }

  async function deleteProduct(id) {
    const product = products.find(item => item.id === id);
    if (!product || !window.confirm(`¿Eliminar “${product.name}” del catálogo?`)) return;
    const { error } = await client.from("products").delete().eq("store_id", store.id).eq("id", id);
    if (error) return $("#catalogMessage").textContent = `No pudimos eliminar el producto: ${error.message}`;
    products = products.filter(item => item.id !== id);
    renderProducts();
    $("#catalogMessage").textContent = "Producto eliminado.";
  }

  async function init() {
    if (!client) return authScreen("Falta configurar Supabase en creator/supabase-config.js.");
    const { data: { session }, error } = await client.auth.getSession();
    if (error) return authScreen(`No pudimos validar tu sesión: ${error.message}`);
    if (new URLSearchParams(location.search).get("password") === "recovery" || new URLSearchParams(location.hash.slice(1)).get("type") === "recovery") {
      $("#authScreen").classList.add("hidden");
      $("#managerPanel").classList.add("hidden");
      $("#passwordRecoveryCard").classList.remove("hidden");
      return;
    }
    if (!session) return authScreen();
    try { await loadStore(); }
    catch (error) { authScreen(`No pudimos cargar el panel: ${error.message}`); }
  }

  $("#loginForm").addEventListener("submit", async event => {
    event.preventDefault();
    if (!client) return authScreen("Falta configurar Supabase en creator/supabase-config.js.");
    const button = event.currentTarget.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const { error } = await client.auth.signInWithPassword({
        email: $("#loginEmail").value.trim(),
        password: $("#loginPassword").value
      });
      if (error) throw error;
      await init();
    } catch (error) {
      authScreen(`No pudimos ingresar: ${error.message}`);
    } finally { button.disabled = false; }
  });

  $("#googleLoginButton").addEventListener("click", async () => {
    try {
      localStorage.setItem("goStorePostAuth", "admin");
      const { error } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${location.origin}/creator/index.html` } });
      if (error) throw error;
    } catch (error) {
      localStorage.removeItem("goStorePostAuth");
      authScreen(`No pudimos iniciar con Google: ${error.message}. Verificá que Google esté habilitado en Supabase.`);
    }
  });

  $("#forgotPasswordButton").addEventListener("click", async () => {
    const email = $("#loginEmail").value.trim();
    if (!email) return authScreen("Escribí tu correo para enviarte un enlace para crear o recuperar la contraseña.");
    try {
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/admin/?password=recovery` });
      if (error) throw error;
      authScreen(`Te enviamos un enlace a ${email}. Usalo una vez para crear o cambiar tu contraseña.`);
    } catch (error) {
      authScreen(`No pudimos enviar el enlace: ${error.message}`);
    }
  });

  $("#passwordRecoveryForm").addEventListener("submit", async event => {
    event.preventDefault();
    const password = $("#newPassword").value;
    if (password !== $("#confirmPassword").value) {
      $("#passwordRecoveryMessage").textContent = "Las contraseñas no coinciden.";
      return;
    }
    const button = event.currentTarget.querySelector('[type="submit"]');
    button.disabled = true;
    $("#passwordRecoveryMessage").textContent = "Guardando contraseña…";
    try {
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
      const url = new URL(location.href);
      url.searchParams.delete("password");
      history.replaceState(null, "", url.pathname + url.search);
      await init();
    } catch (error) {
      $("#passwordRecoveryMessage").textContent = `No pudimos guardar la contraseña: ${error.message}`;
    } finally { button.disabled = false; }
  });

  $("#addProductButton").addEventListener("click", () => openDialog());
  document.querySelectorAll("[data-view-link]").forEach(link => link.addEventListener("click", () => showWorkspaceView(link.dataset.viewLink, true)));
  window.addEventListener("hashchange", () => showWorkspaceView(location.hash === "#store-settings" ? "store" : location.hash.slice(1)));
  $("#refreshOrdersButton").addEventListener("click", loadOrders);
  $("#storeForm").addEventListener("submit", saveStoreSettings);
  $("#storeLogoText").addEventListener("input", () => { if ((!store?.logo_path || removeCurrentLogo) && !selectedLogoFile) setLogoPreview(); });
  $("#storeLogoFile").addEventListener("change", event => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      $("#storeMessage").textContent = "Elegí una imagen PNG, JPG o WebP.";
      event.currentTarget.value = "";
      return;
    }
    selectedLogoFile = file;
    removeCurrentLogo = false;
    setLogoPreview(URL.createObjectURL(file));
    $("#storeMessage").textContent = "El logo se guardará cuando presiones Guardar identidad y diseño.";
  });
  $("#removeLogoButton").addEventListener("click", () => {
    selectedLogoFile = null;
    $("#storeLogoFile").value = "";
    removeCurrentLogo = Boolean(store?.logo_path);
    setLogoPreview();
    if (!removeCurrentLogo) $("#storeMessage").textContent = "La imagen seleccionada se quitó del borrador. Guardá para aplicar el cambio.";
  });
  $("#storeColor").addEventListener("input", event => { $("#storeColorValue").textContent = event.currentTarget.value.toUpperCase(); });
  $("#storeTemplate").addEventListener("change", event => {
    $("#storeColor").value = templateColors[event.currentTarget.value] || templateColors.costa;
    $("#storeColorValue").textContent = $("#storeColor").value.toUpperCase();
  });
  $("#closeDialogButton").addEventListener("click", closeDialog);
  $("#cancelDialogButton").addEventListener("click", closeDialog);
  $("#productForm").addEventListener("submit", saveProduct);
  $("#productDialog").addEventListener("click", event => { if (event.target === event.currentTarget) closeDialog(); });
  function closePasswordDialog() {
    $("#passwordChangeDialog").classList.add("hidden");
    $("#passwordChangeForm").reset();
    $("#passwordChangeMessage").textContent = "";
  }
  $("#changePasswordButton").addEventListener("click", () => {
    $("#passwordChangeForm").reset();
    $("#passwordChangeMessage").textContent = "";
    $("#passwordChangeDialog").classList.remove("hidden");
    $("#accountNewPassword").focus();
  });
  $("#closePasswordDialog").addEventListener("click", closePasswordDialog);
  $("#cancelPasswordDialog").addEventListener("click", closePasswordDialog);
  $("#passwordChangeDialog").addEventListener("click", event => { if (event.target === event.currentTarget) closePasswordDialog(); });
  $("#passwordChangeForm").addEventListener("submit", async event => {
    event.preventDefault();
    const password = $("#accountNewPassword").value;
    if (password !== $("#accountConfirmPassword").value) {
      $("#passwordChangeMessage").textContent = "Las contraseñas no coinciden.";
      return;
    }
    const button = event.currentTarget.querySelector('[type="submit"]');
    button.disabled = true;
    $("#passwordChangeMessage").textContent = "Guardando contraseña…";
    try {
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
      $("#passwordChangeMessage").textContent = "Contraseña actualizada. La próxima vez podés ingresar con tu correo y esta contraseña.";
      event.currentTarget.reset();
    } catch (error) {
      $("#passwordChangeMessage").textContent = `No pudimos actualizarla: ${error.message}`;
    } finally { button.disabled = false; }
  });
  $("#signOutButton").addEventListener("click", async () => { await client.auth.signOut(); authScreen("Sesión cerrada."); });
  init();
})();
