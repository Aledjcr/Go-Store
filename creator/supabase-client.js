(() => {
  const config = window.GO_STORE_SUPABASE_CONFIG || {};
  const createClient = window.supabase?.createClient;
  const configured = Boolean(config.url && config.anonKey && createClient);
  const client = configured ? createClient(config.url, config.anonKey) : null;

  function slugify(value) {
    return String(value || "mi-tienda")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "mi-tienda";
  }

  function productId(product) {
    if (!product.id) product.id = crypto.randomUUID();
    return product.id;
  }

  async function sendSignInLink(state) {
    if (!client) throw new Error("Falta configurar la URL y la clave pública de Supabase.");
    if (location.protocol === "file:") {
      throw new Error("Abrí el creador desde un servidor local (http://localhost), no como archivo. Consultá la guía de Supabase del proyecto.");
    }

    const { error } = await client.auth.signInWithOtp({
      email: state.ownerEmail.trim(),
      options: {
        data: {
          full_name: state.ownerName.trim(),
          phone: state.ownerPhone.trim() || null
        },
        emailRedirectTo: `${location.origin}${location.pathname}`
      }
    });
    if (error) throw error;
  }

  async function saveStore(state) {
    if (!client) throw new Error("Falta configurar Supabase.");
    const { data: { user }, error: userError } = await client.auth.getUser();
    if (userError) throw userError;
    if (!user) throw new Error("Iniciá sesión desde el enlace que enviamos a tu correo.");
    if (user.email?.toLowerCase() !== state.ownerEmail.trim().toLowerCase()) {
      throw new Error("La sesión abierta pertenece a otro correo. Cerrá sesión y volvé a intentarlo con el correo del creador.");
    }
    const namedProducts = state.products.filter(product => product.name.trim());
    const invalidPrice = namedProducts.find(product => !Number.isFinite(Number(product.price)) || Number(product.price) < 0);
    if (invalidPrice) throw new Error(`Revisá el precio de “${invalidPrice.name}”. Debe ser un número igual o mayor que cero.`);

    state.remoteStoreId ||= crypto.randomUUID();
    state.products.forEach(productId);
    const store = {
      id: state.remoteStoreId,
      owner_id: user.id,
      slug: slugify(state.slug || state.name),
      name: state.name.trim(),
      tagline: state.tagline.trim() || null,
      description: state.description.trim() || null,
      welcome_title: state.slogan.trim() || null,
      menu_title: state.menuTitle.trim() || null,
      template_key: state.template,
      primary_color: state.customGreen || (state.template === "huerta" ? "#536a43" : state.template === "barro" ? "#975d43" : "#24445a"),
      logo_text: state.logoText.trim() || null,
      status: state.storeStatus || "draft"
    };

    const { data: existingStore, error: lookupError } = await client
      .from("stores").select("id").eq("id", state.remoteStoreId).maybeSingle();
    if (lookupError) throw lookupError;

    const storeFields = { ...store };
    delete storeFields.id;
    delete storeFields.owner_id;
    const storeResult = existingStore
      ? await client.from("stores").update(storeFields).eq("id", state.remoteStoreId).select("id").single()
      : await client.from("stores").insert(store).select("id").single();
    if (storeResult.error?.code === "23505" && storeResult.error.message.includes("stores_one_store_per_owner_idx")) {
      throw new Error("Esta cuenta ya tiene una tienda. Abrí Mis tiendas para continuar editándola.");
    }
    if (storeResult.error?.code === "23505") {
      throw new Error("Ese identificador ya está en uso. Elegí otro antes de guardar.");
    }
    if (storeResult.error) throw storeResult.error;

    const categoryNames = [...new Set(namedProducts.map(product => product.category.trim()).filter(Boolean))];
    const categorySlugs = new Map();
    const usedSlugs = new Set();
    const categories = categoryNames.map((name, index) => {
      const baseSlug = slugify(name);
      let slug = baseSlug;
      let suffix = 2;
      while (usedSlugs.has(slug)) slug = `${baseSlug}-${suffix++}`;
      usedSlugs.add(slug);
      categorySlugs.set(name, slug);
      return { store_id: state.remoteStoreId, name, slug, sort_order: index };
    });

    if (categories.length) {
      const { error } = await client.from("categories").upsert(categories, { onConflict: "store_id,slug" });
      if (error) throw error;
    }

    const { data: savedCategories, error: categoriesError } = await client
      .from("categories").select("id,name,slug").eq("store_id", state.remoteStoreId);
    if (categoriesError) throw categoriesError;
    const categoryIds = new Map(savedCategories.map(category => [category.slug, category.id]));
    const products = namedProducts.map((product, index) => ({
      id: product.id,
      store_id: state.remoteStoreId,
      category_id: product.category.trim() ? categoryIds.get(categorySlugs.get(product.category.trim())) || null : null,
      name: product.name.trim(),
      description: product.description.trim() || null,
      price: Number(product.price) || 0,
      currency: "ARS",
      available: true,
      sort_order: index
    }));

    if (products.length) {
      const { error } = await client.from("products").upsert(products, { onConflict: "id" });
      if (error) throw error;
    }
    const activeIds = products.map(product => product.id);
    let cleanup = client.from("products").delete().eq("store_id", state.remoteStoreId);
    if (activeIds.length) cleanup = cleanup.not("id", "in", `(${activeIds.join(",")})`);
    const { error: cleanupError } = await cleanup;
    if (cleanupError) throw cleanupError;

    if (state.logo?.startsWith("data:")) {
      const response = await fetch(state.logo);
      const blob = await response.blob();
      const extension = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
      const path = `${state.remoteStoreId}/logo.${extension}`;
      const { error: uploadError } = await client.storage.from("store-assets").upload(path, blob, {
        contentType: blob.type,
        upsert: true
      });
      if (uploadError) throw uploadError;
      const { error: logoError } = await client.from("stores")
        .update({ logo_path: path }).eq("id", state.remoteStoreId);
      if (logoError) throw logoError;
    }

    return { id: state.remoteStoreId, slug: store.slug };
  }

  async function getAccount() {
    if (!client) throw new Error("Falta configurar Supabase.");
    const { data: { user }, error: userError } = await client.auth.getUser();
    if (userError) throw userError;
    if (!user) throw new Error("Iniciá sesión para ver tus tiendas.");
    const { data: profile, error: profileError } = await client
      .from("profiles").select("full_name,phone").maybeSingle();
    if (profileError) throw profileError;
    return { user, profile };
  }

  async function listMyStores() {
    if (!client) throw new Error("Falta configurar Supabase.");
    const { data, error } = await client
      .from("stores")
      .select("id,slug,name,status,template_key,updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return data;
  }

  async function publishStore(storeId, slug) {
    if (!client) throw new Error("Falta configurar Supabase.");
    const cleanSlug = slugify(slug);
    const { data, error } = await client.from("stores")
      .update({ slug: cleanSlug, status: "published", published_at: new Date().toISOString() })
      .eq("id", storeId)
      .select("id,slug,status,published_at")
      .single();
    if (error?.code === "23505") throw new Error("Esa dirección ya está ocupada. Elegí otra y volvé a publicar.");
    if (error) throw error;
    return data;
  }

  async function loadStore(storeId) {
    if (!client) throw new Error("Falta configurar Supabase.");
    const { data: store, error: storeError } = await client
      .from("stores")
      .select("id,slug,name,tagline,description,welcome_title,menu_title,template_key,primary_color,logo_path,logo_text,status")
      .eq("id", storeId)
      .single();
    if (storeError) throw storeError;

    const [categoriesResult, productsResult, account] = await Promise.all([
      client.from("categories").select("id,name,slug,sort_order,active")
        .eq("store_id", storeId).order("sort_order"),
      client.from("products").select("id,category_id,name,description,price,currency,image_path,available,sort_order")
        .eq("store_id", storeId).order("sort_order"),
      getAccount()
    ]);
    if (categoriesResult.error) throw categoriesResult.error;
    if (productsResult.error) throw productsResult.error;

    const categoryNames = new Map(categoriesResult.data.map(category => [category.id, category.name]));
    let logo = "";
    if (store.logo_path) {
      logo = client.storage.from("store-assets").getPublicUrl(store.logo_path).data.publicUrl;
    }
    const templateColor = templates[store.template_key]?.palette?.green;
    return {
      remoteStoreId: store.id,
      slug: store.slug,
      ownerName: account.profile?.full_name || "",
      ownerEmail: account.user.email || "",
      ownerPhone: account.profile?.phone || "",
      name: store.name,
      tagline: store.tagline || "",
      description: store.description || "",
      slogan: store.welcome_title || "",
      menuTitle: store.menu_title || "",
      template: store.template_key,
      customGreen: store.primary_color?.toLowerCase() === templateColor?.toLowerCase() ? "" : store.primary_color,
      logoText: store.logo_text || "",
      logo,
      storeStatus: store.status,
      products: productsResult.data.map(product => ({
        id: product.id,
        name: product.name,
        price: String(product.price),
        category: categoryNames.get(product.category_id) || "",
        description: product.description || ""
      })),
      step: 1,
      authPending: false,
      remoteSaved: true
    };
  }

  async function signOut() {
    if (!client) return;
    const { error } = await client.auth.signOut();
    if (error) throw error;
  }

  window.goStoreSupabase = {
    configured,
    client,
    sendSignInLink,
    saveStore,
    publishStore,
    getAccount,
    listMyStores,
    loadStore,
    signOut,
    onAuthStateChange(callback) {
      if (!client) return;
      client.auth.onAuthStateChange((event, session) => {
        window.setTimeout(() => callback(event, session), 0);
      });
    }
  };
})();
