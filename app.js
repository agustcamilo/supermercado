// app.js — Tienda (ES Module)
import PRODUCTS from './data/products.js';

const state = {
  products: [],
  categories: new Set(),
  cart: JSON.parse(localStorage.getItem('cart') || '[]'),
  coupon: null,
  shipping: 2500, // CLP
};

const el = (sel) => document.querySelector(sel);
const money = (n) =>
  n.toLocaleString('es-CL', {
    style: 'currency',
    currency: 'CLP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

// Carga catálogo base (desde data/products.js) + merge con customProducts guardados
async function loadProducts() {
  const baseData = PRODUCTS; // ← viene del módulo

  const saved = JSON.parse(localStorage.getItem('customProducts') || '[]');
  const merged = Array.isArray(saved) && saved.length
    ? [...baseData, ...saved.filter(p => !baseData.some(b => String(b.id) === String(p.id)))]
    : baseData;

  state.products = merged;
  state.categories = new Set(merged.map(p => p.category));

  renderFilters();
  renderCatalog(merged);
  updateCartCount();
  computeTotals();
  updateLiveStock();
}

// Filtros dinámicos
function renderFilters() {
  const select = el('#filterCategory');
  select.innerHTML = '<option value="">Todas las categorias</option>';
  state.categories.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    select.appendChild(opt);
  });
}

// Render del catálogo (sin imágenes), con stock en vivo
function renderCatalog(list) {
  const host = el('#catalog');
  host.innerHTML = '';
  const tpl = el('#tplCard');

  list.forEach(p => {
    const node = tpl.content.cloneNode(true);
    const card = node.querySelector('.card');
    const title = node.querySelector('.title');
    const desc  = node.querySelector('.desc');
    const price = node.querySelector('.price');
    const stock = node.querySelector('.stock');
    const qty   = node.querySelector('.qty');

    card.dataset.id = p.id;
    title.textContent = p.title;
    desc.textContent  = p.description;
    price.textContent = money(p.price);

    const remaining = Math.max(0, p.stock - qtyInCart(p.id));
    stock.innerHTML  = `Stock: <span class="badge" data-role="stockQty">${remaining}</span>`;

    card.querySelector('[data-action="less"]').addEventListener('click', () => {
      qty.value = Math.max(1, Number(qty.value) - 1);
    });
    card.querySelector('[data-action="more"]').addEventListener('click', () => {
      qty.value = Number(qty.value) + 1;
    });
    card.querySelector('[data-action="add"]').addEventListener('click', () => {
      addToCart(p.id, Number(qty.value));
    });

    host.appendChild(node);
  });

  updateLiveStock();
}

// Búsqueda y filtrado (por título, descripción y categoría)
function applySearchFilter() {
  const q   = el('#q').value.trim().toLowerCase();
  const cat = el('#filterCategory').value;

  const filtered = state.products.filter(p => {
    const coincideTexto = !q || [p.title, p.description, p.category]
      .some(s => (s || '').toLowerCase().includes(q));
    const coincideCategoria = !cat || p.category === cat;
    return coincideTexto && coincideCategoria;
  });

  renderCatalog(filtered);
  updateLiveStock();
}

// Persistencia del carrito
function saveCart() {
  localStorage.setItem('cart', JSON.stringify(state.cart));
}

// ===== Stock en vivo =====
function qtyInCart(productId) {
  const item = state.cart.find(i => i.id === productId);
  return item ? item.qty : 0;
}

function updateLiveStock() {
  document.querySelectorAll('#catalog .card').forEach(card => {
    const id = Number(card.dataset.id);
    const p = state.products.find(x => x.id === id);
    const badge = card.querySelector('[data-role="stockQty"]');
    if (p && badge) badge.textContent = Math.max(0, p.stock - qtyInCart(id));
  });
}

// ===== Carrito =====
function addToCart(productId, qty = 1) {
  const product = state.products.find(p => p.id === productId);
  if (!product) return;

  const existing   = state.cart.find(i => i.id === productId);
  const currentQty = existing?.qty || 0;

  if (product.stock <= 0) {
    Swal.fire({ icon: 'info', title: 'Sin stock', text: `${product.title} no tiene stock disponible.` });
    return;
  }
  if (currentQty >= product.stock) {
    Swal.fire({ icon: 'info', title: 'Sin stock', text: `No hay más stock disponible para ${product.title}.` });
    return;
  }

  const disponible = product.stock - currentQty;
  const toAdd = Math.min(disponible, Math.max(1, Number(qty) || 1));
  const newQty = currentQty + toAdd;

  if (existing) existing.qty = newQty;
  else state.cart.push({ id: productId, qty: newQty });

  saveCart();
  updateCartCount();
  renderCartModal();
  computeTotals();
  updateLiveStock();

  if (toAdd < qty) {
    Toastify({ text: `${product.title}: solo ${toAdd} por stock.`, duration: 2500 }).showToast();
  } else if (toAdd > 0) {
    Toastify({ text: `${product.title} agregado (${toAdd}).`, duration: 2000 }).showToast();
  }
}

function removeFromCart(productId) {
  state.cart = state.cart.filter(i => i.id !== productId);
  saveCart();
  updateCartCount();
  renderCartModal();
  computeTotals();
  updateLiveStock();
}

function setQty(productId, qty) {
  const item = state.cart.find(i => i.id === productId);
  if (!item) return;
  const product = state.products.find(p => p.id === productId);
  item.qty = Math.min(product.stock, Math.max(1, qty));
  saveCart();
  renderCartModal();
  computeTotals();
  updateLiveStock();
}

function clearCart() {
  state.cart = [];
  state.coupon = null;
  saveCart();
  updateCartCount();
  computeTotals();
  el('#couponInput').value = '';
  updateLiveStock();
}

// Totales + cupones
function computeTotals() {
  const subtotal = state.cart.reduce((acc, i) => {
    const p = state.products.find(p => p.id === i.id);
    return acc + (p ? p.price * i.qty : 0);
  }, 0);

  let shipping = state.cart.length ? state.shipping : 0;
  let discount = 0;

  if (state.coupon) {
    if (state.coupon.type === 'percent') discount = Math.round(subtotal * state.coupon.value);
    if (state.coupon.type === 'freeship') shipping = 0;
  }

  const total = Math.max(0, subtotal + shipping - discount);

  el('#subtotal').textContent   = money(subtotal);
  el('#shipping').textContent   = money(shipping);
  el('#discount').textContent   = discount ? `− ${money(discount)}` : money(0);
  el('#grandTotal').textContent = money(total);

  return { subtotal, shipping, discount, total };
}

function applyCoupon(codeRaw) {
  const code = (codeRaw || '').trim().toUpperCase();
  const coupons = {
    'BIENVENID@':  { type: 'percent', value: 0.10, label: '10% OFF' },
    'ENVIOGRATIS': { type: 'freeship', value: 0,   label: 'Envio sin cargo' },
  };
  const found = coupons[code];
  if (!found) {
    Swal.fire({ icon: 'error', title: 'Cupon invalido', text: 'Revisa el codigo e intenta nuevamente.' });
    return;
  }
  state.coupon = found;
  computeTotals();
  Swal.fire({ icon: 'success', title: 'Cupon aplicado', text: found.label });
}

// Modal del carrito
function renderCartModal() {
  const list = el('#cartItems');
  list.innerHTML = '';

  state.cart.forEach(i => {
    const p = state.products.find(p => p.id === i.id);
    if (!p) return;

    const row = document.createElement('div');
    row.className = 'cart-item';
    row.innerHTML = `
      <div>
        <h4>${p.title}</h4>
        <div class="badge">${p.category}</div>
        <div>${money(p.price)} c/u</div>
      </div>
      <div class="qty-controls">
        <button class="btn" data-a="less">−</button>
        <input class="qty" type="number" min="1" value="${i.qty}">
        <button class="btn" data-a="more">+</button>
        <button class="btn" data-a="rm">✕</button>
      </div>
    `;

    const less = row.querySelector('button[data-a="less"]');
    const more = row.querySelector('button[data-a="more"]');
    const rm   = row.querySelector('button[data-a="rm"]');
    const qtyInput = row.querySelector('input.qty');

    less.addEventListener('click', () => setQty(p.id, Number(qtyInput.value) - 1));
    more.addEventListener('click', () => setQty(p.id, Number(qtyInput.value) + 1));
    qtyInput.addEventListener('change', e => setQty(p.id, Number(e.target.value)));
    rm.addEventListener('click', () => removeFromCart(p.id));

    list.appendChild(row);
  });
}

function updateCartCount() {
  el('#cartCount').textContent = state.cart.reduce((a, b) => a + b.qty, 0);
}

// Validación simple de tarjeta (Luhn)
function validateCardNumber(num) {
  const digits = (num || '').replace(/\D/g, '').split('').map(Number);
  if (digits.length < 13) return false;
  const sum = digits.reverse().reduce((acc, d, idx) => {
    if (idx % 2 === 1) {
      let x = d * 2;
      if (x > 9) x -= 9;
      return acc + x;
    }
    return acc + d;
  }, 0);
  return sum % 10 === 0;
}

// Checkout
function handleCheckoutSubmit(e) {
  e.preventDefault();
  if (!state.cart.length) {
    Swal.fire({ icon: 'warning', title: 'Tu carrito esta vacio' });
    return;
  }
  const form = new FormData(e.target);
  const order = {
    id: 'ORD-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
    customer: {
      name: form.get('name').trim(),
      email: form.get('email').trim(),
      country: form.get('country').trim(),
      zip: form.get('zip').trim(),
    },
    payment: {
      card: form.get('card'),
      exp: form.get('exp'),
      cvv: form.get('cvv'),
    },
    items: state.cart.map(i => {
      const p = state.products.find(p => p.id === i.id);
      return { id: p.id, title: p.title, price: p.price, qty: i.qty };
    }),
    totals: computeTotals(),
    coupon: state.coupon,
    createdAt: new Date().toISOString(),
  };

  if (!validateCardNumber(order.payment.card)) {
    Swal.fire({ icon: 'error', title: 'Tarjeta invalida', text: 'Verifica el numero de tarjeta.' });
    return;
  }

  Swal.fire({ title: 'Procesando pago…', allowOutsideClick: false, didOpen: () => Swal.showLoading() }).then();

  setTimeout(() => {
    Swal.close();
    const html = `
      <p><strong>Gracias, ${order.customer.name}!</strong></p>
      <p>Tu orden <strong>${order.id}</strong> fue generada.</p>
      <p>Total pagado: <strong>${money(order.totals.total)}</strong></p>
    `;
    Swal.fire({ icon: 'success', title: 'Compra realizada', html });
    const history = JSON.parse(localStorage.getItem('orders') || '[]');
    history.push(order);
    localStorage.setItem('orders', JSON.stringify(history));
    clearCart();
    renderCartModal();
    computeTotals();
    updateLiveStock();
  }, 800);
}

// Eventos UI
function setupEvents() {
  el('#q').addEventListener('input', applySearchFilter);
  el('#filterCategory').addEventListener('change', applySearchFilter);
  el('#btnCart').addEventListener('click', () => {
    renderCartModal();
    el('#cartModal').classList.remove('hidden');
  });
  el('#closeCart').addEventListener('click', () => el('#cartModal').classList.add('hidden'));
  el('#applyCoupon').addEventListener('click', () => applyCoupon(el('#couponInput').value));
  el('#clearCart').addEventListener('click', () => {
    Swal.fire({
      title: '¿Vaciar carrito?',
      showCancelButton: true,
      confirmButtonText: 'Si, vaciar',
      cancelButtonText: 'Cancelar',
      icon: 'warning'
    }).then(res => { if (res.isConfirmed) clearCart(); });
  });
  el('#checkoutForm').addEventListener('submit', handleCheckoutSubmit);
}

// Inicio
loadProducts().then(() => {
  setupEvents();
});

// ===== Alta de productos (sin imagen) =====
(function injectAddButton() {
  const actions = document.querySelector('.header-actions');
  if (!actions || document.getElementById('btnAddProduct')) return;
  const btn = document.createElement('button');
  btn.id = 'btnAddProduct';
  btn.className = 'btn';
  btn.textContent = 'Agregar producto';
  actions.insertBefore(btn, document.getElementById('btnCart'));
  btn.addEventListener('click', openAddProductDialog);
})();

async function openAddProductDialog() {
  const { value: formValues } = await Swal.fire({
    title: 'Nuevo producto',
    html: `
      <div class="form-row"><label>Título</label><input id="np-title" placeholder="Nombre del producto"></div>
      <div class="form-row"><label>Descripción</label><input id="np-desc" placeholder="Descripcion corta"></div>
      <div class="form-row split">
        <div><label>Precio (CLP)</label><input id="np-price" type="number" min="0" step="1" value="0"></div>
        <div><label>Stock</label><input id="np-stock" type="number" min="0" step="1" value="1"></div>
      </div>
      <div class="form-row"><label>Categoría</label><input id="np-cat" placeholder="Categoria"></div>
    `,
    focusConfirm: false,
    confirmButtonText: 'Guardar',
    showCancelButton: true,
    preConfirm: () => {
      const get = (id) => document.getElementById(id).value.trim();
      const title = get('np-title');
      const description = get('np-desc');
      const price = Number(document.getElementById('np-price').value);
      const stock = Number(document.getElementById('np-stock').value);
      const category = get('np-cat');

      if (!title || !description || !category) {
        Swal.showValidationMessage('Completa el titulo, descripcion y categoria');
        return false;
      }
      if (!(price >= 0) || !(stock >= 0)) {
        Swal.showValidationMessage('Precio y stock deben ser numeros ≥ 0');
        return false;
      }
      return { title, description, price, stock, category };
    }
  });

  if (!formValues) return;

  const nextId = Math.max(0, ...state.products.map(p => Number(p.id) || 0)) + 1;

  const newProduct = {
    id: nextId,
    title: formValues.title,
    description: formValues.description,
    price: Math.round(formValues.price),
    stock: Math.round(formValues.stock),
    category: formValues.category
  };

  state.products.push(newProduct);
  state.categories.add(newProduct.category);
  ensureCategoryOption(newProduct.category);

  const saved = JSON.parse(localStorage.getItem('customProducts') || '[]');
  saved.push(newProduct);
  localStorage.setItem('customProducts', JSON.stringify(saved));

  el('#filterCategory').value = newProduct.category;
  applySearchFilter();
  updateLiveStock();

  Toastify({ text: 'Producto creado', duration: 1800 }).showToast();

  if (newProduct.stock > 0) {
    const { isConfirmed, value } = await Swal.fire({
      title: '¿Agregar al carrito?',
      input: 'number',
      inputLabel: `Cantidad (stock: ${newProduct.stock})`,
      inputAttributes: { min: 1, max: newProduct.stock, step: 1 },
      inputValue: 1,
      confirmButtonText: 'Agregar',
      showCancelButton: true
    });
    if (isConfirmed) {
      const qty = Math.min(newProduct.stock, Math.max(1, Number(value) || 1));
      addToCart(newProduct.id, qty);
    }
  } else {
    Swal.fire({ icon: 'info', title: 'Sin stock', text: 'No hay stock para agregar este producto.' });
  }
}

// Asegura que la categoría exista en el <select>
function ensureCategoryOption(category) {
  const sel = el('#filterCategory');
  if (!sel) return;
  const exists = Array.from(sel.options).some(o => o.value === category);
  if (!exists) {
    const opt = document.createElement('option');
    opt.value = category;
    opt.textContent = category;
    sel.appendChild(opt);
  }
}
