const STORAGE_KEYS = {
  CATALOG: "app.catalog",
  CART: "app.cart",
  CUPON: "app.cupon",
};

const storage = {
  save(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  },
  load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  },
  remove(key) {
    localStorage.removeItem(key);
  },
};

// ------- Utilidades
function currency(n) {
  return n.toLocaleString("es-CL", { style: "currency", currency: "CLP" });
}
function clamp(n, min, max) {
  return Math.max(min, Math.min(n, max));
}
function escapeHTML(str) {
  return String(str).replace(/[&<>'"]/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[c]);
}
function debounce(fn, delay = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(null, args), delay);
  };
}

let catalog = [];
let cart = storage.load(STORAGE_KEYS.CART, {});
let appliedCupon = storage.load(STORAGE_KEYS.CUPON, null);

const defaultCatalog = [
  { id: "d1", name: "Leche entera 1L", price: 1200, category: "Lacteos", stock: 23 },
  { id: "d2", name: "Pan marraqueta (kg)", price: 1800, category: "Panaderia", stock: 12 },
  { id: "d3", name: "Arroz 1kg", price: 1400, category: "Abarrotes", stock: 29 },
];

const ui = {
  q: document.querySelector("#q"),
  categoryFilter: document.querySelector("#categoryFilter"),
  btnReset: document.querySelector("#btnReset"),
  catalog: document.querySelector("#catalog"),
  catalogEmpty: document.querySelector("#catalogEmpty"),
  cart: document.querySelector("#cart"),
  cartEmpty: document.querySelector("#cartEmpty"),
  btnClearCart: document.querySelector("#btnClearCart"),
  summaryItems: document.querySelector("#summaryItems"),
  summarySubtotal: document.querySelector("#summarySubtotal"),
  summaryDiscount: document.querySelector("#summaryDiscount"),
  summaryTotal: document.querySelector("#summaryTotal"),
  cuponForm: document.querySelector("#cuponForm"),
  cupon: document.querySelector("#cupon"),
  cuponMsg: document.querySelector("#cuponMsg"),
  btnCheckout: document.querySelector("#btnCheckout"),
  receipt: document.querySelector("#receipt"),
  addForm: document.querySelector("#addForm"),
  addMsg: document.querySelector("#addMsg"),
  // NUEVO: modal de comprobante
  receiptModal: document.querySelector("#receiptModal"),
  receiptBody: document.querySelector("#receiptBody"),
  modalClose: document.querySelector("#receiptModal .modal-close"),
};
function openReceiptModal(html){
  ui.receiptBody.innerHTML = html;
  ui.receiptModal.style.display = "flex";
  ui.receiptModal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden"; // bloquea scroll del fondo
}

function closeReceiptModal(){
  ui.receiptModal.style.display = "none";
  ui.receiptModal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = ""; // restaura scroll
}

if (ui.modalClose) ui.modalClose.addEventListener("click", closeReceiptModal);
if (ui.receiptModal) {
  ui.receiptModal.addEventListener("click", (e) => {
    if (e.target === ui.receiptModal) closeReceiptModal(); // click fuera de la caja
  });
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && ui.receiptModal && ui.receiptModal.style.display === "flex") {
    closeReceiptModal();
  }
});


async function loadCatalog() {
  try {
    const res = await fetch("./data/products.json");
    if (!res.ok) throw new Error();
    const data = await res.json();
    const persisted = storage.load(STORAGE_KEYS.CATALOG, []);
    catalog = [...data, ...persisted];
  } catch {
    const persisted = storage.load(STORAGE_KEYS.CATALOG, []);
    catalog = [...defaultCatalog, ...persisted];
  }
}

function renderCategories() {
  const prev = ui.categoryFilter.value || "all";
  const cats = Array.from(new Set(catalog.map((p) => p.category))).sort((a, b) =>
    a.localeCompare(b, "es", { sensitivity: "base" })
  );
  ui.categoryFilter.innerHTML =
    '<option value="all">Todas</option>' +
    cats.map((c) => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join("");
  ui.categoryFilter.value = cats.includes(prev) || prev === "all" ? prev : "all";
}

function renderCatalog() {
  const q = (ui.q.value || "").toLowerCase().trim();
  const category = (ui.categoryFilter.value || "all").toLowerCase();

  const filtered = catalog.filter((p) => {
    const inName = p.name.toLowerCase().includes(q);
    const inCategory = category === "all" || p.category.toLowerCase() === category;
    return inName && inCategory;
  });

  ui.catalog.innerHTML = filtered.map((p) => `
    <li class="card" data-id="${p.id}">
      <h3>${escapeHTML(p.name)}</h3>
      <div class="meta">
        <span class="badge">${escapeHTML(p.category)}</span>
        <span>Stock: ${p.stock}</span>
      </div>
      <div class="price">${currency(p.price)}</div>
      <div class="actions">
        <input type="number" class="qty-input" min="1" max="${p.stock}" value="1" aria-label="Cantidad para ${escapeHTML(p.name)}"/>
        <button class="btn primary add-to-cart" type="button" aria-label="Agregar ${escapeHTML(p.name)} al carrito">Agregar</button>
      </div>
    </li>
  `).join("");

  ui.catalogEmpty.classList.toggle("hidden", filtered.length !== 0);
}

function renderCart() {
  const entries = Object.entries(cart).filter(([_, qty]) => qty > 0);
  if (entries.length === 0) {
    ui.cart.innerHTML = "";
    ui.cartEmpty.classList.remove("hidden");
    ui.btnCheckout.disabled = true;
    updateSummary();
    return;
  }
  ui.cartEmpty.classList.add("hidden");
  ui.btnCheckout.disabled = false;

  ui.cart.innerHTML = entries.map(([id, qty]) => {
    const product = catalog.find((p) => p.id === id);
    if (!product) return "";
    const subtotal = product.price * qty;
    return `
      <div class="cart-item" data-id="${id}">
        <div>
          <strong>${escapeHTML(product.name)}</strong>
          <div class="meta">
            <span class="badge">${escapeHTML(product.category)}</span>
            <span>${currency(product.price)} c/u</span>
          </div>
        </div>
        <div class="qty">
          <button class="btn secondary dec" type="button" aria-label="Disminuir cantidad de ${escapeHTML(product.name)}">−</button>
          <input type="number" class="qty-input" min="1" max="${product.stock}" value="${qty}" aria-label="Cantidad de ${escapeHTML(product.name)}"/>
          <button class="btn secondary inc" type="button" aria-label="Aumentar cantidad de ${escapeHTML(product.name)}">+</button>
        </div>
        <div><strong>${currency(subtotal)}</strong></div>
        <div><button class="btn danger remove" type="button" aria-label="Eliminar ${escapeHTML(product.name)} del carrito">Eliminar</button></div>
      </div>
    `;
  }).join("");

  updateSummary();
}

function updateSummary() {
  const entries = Object.entries(cart);
  let items = 0;
  let subtotal = 0;
  for (const [id, qty] of entries) {
    const p = catalog.find((x) => x.id === id);
    if (!p) continue;
    items += qty;
    subtotal += p.price * qty;
  }
  const discount = appliedCupon ? Math.round(subtotal * appliedCupon.discount) : 0;
  const total = subtotal - discount;
  ui.summaryItems.textContent = String(items);
  ui.summarySubtotal.textContent = currency(subtotal);
  ui.summaryDiscount.textContent = currency(discount);
  ui.summaryTotal.textContent = currency(total);
}

function addToCart(id, qty = 1) {
  const p = catalog.find((x) => x.id === id);
  if (!p) return;
  const newQty = clamp((cart[id] || 0) + qty, 1, p.stock);
  cart[id] = newQty;
  storage.save(STORAGE_KEYS.CART, cart);
  renderCart();
}

function setQuantity(id, qty) {
  const p = catalog.find((x) => x.id === id);
  if (!p) return;
  cart[id] = clamp(qty, 1, p.stock);
  storage.save(STORAGE_KEYS.CART, cart);
  renderCart();
}

function removeFromCart(id) {
  delete cart[id];
  storage.save(STORAGE_KEYS.CART, cart);
  renderCart();
}

function clearCart() {
  cart = {};
  storage.save(STORAGE_KEYS.CART, cart);
  renderCart();
}

const CUPONES = [
  { code: "BIENVENIDO", discount: 0.1 },
  { code: "CODERHOUSE", discount: 0.15 },
];

function applyCupon(code) {
  const trimmed = (code || "").trim();
  if (!trimmed) {
    appliedCupon = null;
    storage.remove(STORAGE_KEYS.CUPON);
    ui.cuponMsg.textContent = "Ingresa un cupón.";
    updateSummary();
    return;
  }
  const found = CUPONES.find((c) => c.code.toLowerCase() === trimmed.toLowerCase());
  if (!found) {
    appliedCupon = null;
    storage.remove(STORAGE_KEYS.CUPON);
    ui.cuponMsg.textContent = "Cupón inválido.";
    updateSummary();
    return;
  }
  appliedCupon = found;
  storage.save(STORAGE_KEYS.CUPON, appliedCupon);
  ui.cuponMsg.textContent = `Cupon aplicado: ${found.code} (${found.discount * 100}% de descuento)`;
  updateSummary();
}

function checkout() {
  const entries = Object.entries(cart);
  if (entries.length === 0) return;

  // Descontar stock
  for (const [id, qty] of entries) {
    const p = catalog.find((x) => x.id === id);
    if (p) p.stock = Math.max(0, p.stock - qty);
  }

  // Armar filas del comprobante
  const rows = entries
    .map(([id, qty]) => {
      const p = catalog.find((x) => x.id === id);
      if (!p) return "";
      const line = p.price * qty;
      return `<tr><td>${p.name}</td><td>${qty}</td><td>${currency(p.price)}</td><td>${currency(line)}</td></tr>`;
    })
    .join("");

  // Totales
  const subtotal = entries.reduce((acc, [id, qty]) => {
    const p = catalog.find((x) => x.id === id);
    return acc + (p ? p.price * qty : 0);
  }, 0);
  const discount = appliedCupon ? Math.round(subtotal * appliedCupon.discount) : 0;
  const total = subtotal - discount;

  // >>> NUEVO: mostrar en modal/overlay
  const html = `
    <div class="receipt">
      <h3>Comprobante</h3>
      <table>
        <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr><th colspan="3" style="text-align:right">Subtotal</th><th>${currency(subtotal)}</th></tr>
          <tr><th colspan="3" style="text-align:right">Descuento</th><th>${currency(discount)}</th></tr>
          <tr><th colspan="3" style="text-align:right">Total</th><th>${currency(total)}</th></tr>
        </tfoot>
      </table>
      <p>¡Gracias por tu compra!</p>
    </div>
  `;
  openReceiptModal(html); // <<< aquí se abre el overlay

  // Persistir SOLO productos del usuario con stock actualizado
  const persistedUserProducts = storage.load(STORAGE_KEYS.CATALOG, []);
  storage.save(
    STORAGE_KEYS.CATALOG,
    catalog.filter((p) => persistedUserProducts.some((u) => u.id === p.id))
  );

  // Limpiar carrito y refrescar UI
  clearCart();
  renderCatalog();
}


function validateAddForm(data) {
  const errors = [];
  if (!data.name || data.name.trim().length < 3) errors.push("Nombre mínimo 3 caracteres.");
  if (!(data.price >= 0)) errors.push("Precio debe ser un número ≥ 0.");
  if (!data.category) errors.push("Categoría obligatoria.");
  if (!(Number.isInteger(data.stock) && data.stock >= 0)) errors.push("Stock debe ser un entero ≥ 0.");
  return errors;
}

function bindEvents() {
  const debouncedSearch = debounce(renderCatalog, 200);

  if (ui.q) ui.q.addEventListener("input", debouncedSearch);
  if (ui.categoryFilter) ui.categoryFilter.addEventListener("change", renderCatalog);
  if (ui.btnReset)
    ui.btnReset.addEventListener("click", () => {
      ui.q.value = "";
      ui.categoryFilter.value = "all";
      renderCatalog();
    });

  if (ui.catalog) {
    ui.catalog.addEventListener("click", (e) => {
      const li = e.target.closest("li.card");
      if (!li) return;
      const id = li.dataset.id;
      if (e.target.matches(".add-to-cart")) {
        const qtyInput = li.querySelector(".qty-input");
        const qty = parseInt(qtyInput.value, 10) || 1;
        addToCart(id, qty);
      }
    });

    // Enter en el input de cantidad agrega al carrito
    ui.catalog.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || !e.target.matches(".qty-input")) return;
      const li = e.target.closest("li.card");
      if (!li) return;
      const id = li.dataset.id;
      const qty = parseInt(e.target.value, 10) || 1;
      addToCart(id, qty);
    });
  }

  if (ui.cart) {
    ui.cart.addEventListener("click", (e) => {
      const item = e.target.closest(".cart-item");
      if (!item) return;
      const id = item.dataset.id;
      if (e.target.matches(".inc")) addToCart(id, 1);
      if (e.target.matches(".dec")) setQuantity(id, (cart[id] || 1) - 1);
      if (e.target.matches(".remove")) removeFromCart(id);
    });
    ui.cart.addEventListener("change", (e) => {
      if (e.target.matches(".qty-input")) {
        const item = e.target.closest(".cart-item");
        const id = item.dataset.id;
        const value = parseInt(e.target.value, 10) || 1;
        setQuantity(id, value);
      }
    });
  }

  if (ui.btnClearCart) ui.btnClearCart.addEventListener("click", clearCart);

  if (ui.cuponForm)
    ui.cuponForm.addEventListener("submit", (e) => {
      e.preventDefault();
      applyCupon(ui.cupon.value);
    });

  if (ui.btnCheckout) ui.btnCheckout.addEventListener("click", checkout);

  if (ui.addForm)
    ui.addForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const data = {
        id: "u" + Math.random().toString(36).slice(2, 8),
        name: form.name.value.trim(),
        price: Number(form.price.value),
        category: form.category.value.trim(),
        stock: Number(form.stock.value),
      };
      const errors = validateAddForm(data);
      if (errors.length) {
        ui.addMsg.textContent = errors.join(" ");
        return;
      }
      const persisted = storage.load(STORAGE_KEYS.CATALOG, []);
      persisted.push(data);
      storage.save(STORAGE_KEYS.CATALOG, persisted);
      catalog.push(data);
      renderCategories();
      renderCatalog();
      form.reset();
      ui.addMsg.textContent = "Producto agregado al catálogo.";
    });
}

async function init() {
  await loadCatalog();
  renderCategories();
  renderCatalog();
  renderCart();
  if (appliedCupon) {
    ui.cupon.value = appliedCupon.code;
    ui.cuponMsg.textContent = `Cupon aplicado: ${appliedCupon.code} (${appliedCupon.discount * 100}% de descuento)`;
  }
  bindEvents();
}

// Módulos se ejecutan tras el parseo del DOM; basta con llamar init()
init();
