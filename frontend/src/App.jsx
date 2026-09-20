
import { useEffect, useState } from "react";
import {
  Activity, Boxes, LayoutDashboard, Package, Building2, LogOut, Tags, Truck,
  Plus, Search, RefreshCw, CheckCircle2, XCircle,
  Clock3, AlertTriangle, ArrowUpRight, Menu, X, ShieldCheck, Pencil, Trash2,
  ArrowDownToLine, ArrowUpFromLine, History, PanelLeftClose, PanelLeftOpen,
  IndianRupee, BarChart3, ArrowLeftRight, ClipboardList, ClipboardCheck,
  Download, CircleDollarSign, ArrowRight, TrendingUp
} from "lucide-react";
import OrbitingNexStockCards from "./OrbitingNexStockCards";
import "./styles.css";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:5000";

async function api(path, options = {}, token = "") {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || data.message || "Request failed");
  }
  return data;
}

const initialCategory = { category_name: "", description: "" };
const initialSupplier = {
  supplier_name: "", contact_name: "", email: "", phone: "", address: ""
};

const initialProduct = {
  sku: "",
  product_name: "",
  description: "",
  category_id: "",
  supplier_id: "",
  unit_price: "0",
  quantity: "0",
  reorder_level: "5",
  unit: "pcs",
};

function localDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function App() {
  const [session, setSession] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("nexstock_session") || "null");
    } catch {
      return null;
    }
  });
  const [screen, setScreen] = useState("dashboard");
  const [showWelcome, setShowWelcome] = useState(true);
  const [editingProduct, setEditingProduct] = useState(null);
  const [stockTransactions, setStockTransactions] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [showStockForm, setShowStockForm] = useState(false);
  const [stockForm, setStockForm] = useState({ product_id: "", transaction_type: "IN", quantity: "", reason: "" });
  const [purchaseOrderForm, setPurchaseOrderForm] = useState({
    supplier_id: "", expected_date: "", notes: "",
    items: [{ product_id: "", quantity: "1", unit_cost: "0" }],
  });
  const [showPurchaseOrderForm, setShowPurchaseOrderForm] = useState(false);
  const [purchaseOrderStatusFilter, setPurchaseOrderStatusFilter] = useState("ALL");
  const [purchaseOrderSearch, setPurchaseOrderSearch] = useState("");
  const [inventoryStatusFilter, setInventoryStatusFilter] = useState("ALL");
  const [inventoryCategoryFilter, setInventoryCategoryFilter] = useState("ALL");
  const [inventorySortBy, setInventorySortBy] = useState("name-asc");
  const [transactionTypeFilter, setTransactionTypeFilter] = useState("ALL");
  const [reportTo, setReportTo] = useState(() => localDateInputValue(new Date()));
  const [reportFrom, setReportFrom] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 29);
    return localDateInputValue(date);
  });
  const [authMode, setAuthMode] = useState("login");
  const [form, setForm] = useState({
    email: "", password: "", full_name: "",
    business_name: "", phone: "", address: "",
  });
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [businesses, setBusinesses] = useState([]);
  const [stats, setStats] = useState({});
  const [productForm, setProductForm] = useState(initialProduct);
  const [showProductForm, setShowProductForm] = useState(false);
  const [categoryForm, setCategoryForm] = useState(initialCategory);
  const [supplierForm, setSupplierForm] = useState(initialSupplier);
  const [editingCategory, setEditingCategory] = useState(null);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const isAdmin = session?.user?.role === "SUPER_ADMIN";
  const displayName = String(
    session?.user?.name || session?.user?.full_name || session?.user?.fullName || "there"
  ).trim().split(/\s+/)[0];
  const currentHour = new Date().getHours();
  const timeGreeting =
    currentHour < 12 ? "Good morning" :
    currentHour < 17 ? "Good afternoon" :
    currentHour < 21 ? "Good evening" : "Welcome back";
  const greetingEmoji =
    currentHour < 12 ? "👋" :
    currentHour < 17 ? "😎" :
    currentHour < 21 ? "😉" : "🌙";

  function updateForm(key, value) {
    setForm((old) => ({ ...old, [key]: value }));
  }

  function notifyError(err) {
    setError(err.message || "Something went wrong");
    setNotice("");
  }

  // API endpoints may return either a raw array or an object wrapping rows.
  // Normalize both forms so React state always receives arrays.
  function getRows(payload, keys = []) {
    if (Array.isArray(payload)) return payload;
    if (payload && typeof payload === "object") {
      for (const key of [...keys, "data", "items", "results", "rows"]) {
        if (Array.isArray(payload[key])) return payload[key];
      }
    }
    return [];
  }

  async function loadDashboard(activeSession = session) {
    if (!activeSession?.token) return;
    setLoading(true);
    setError("");

    const token = activeSession.token;
    const isSuperAdmin = activeSession.user?.role === "SUPER_ADMIN";

    try {
      // Stats are supplementary: a stats failure must not hide inventory.
      try {
        const statsResponse = await api("/api/dashboard/stats", {}, token);
        setStats(
          statsResponse && typeof statsResponse === "object" && !Array.isArray(statsResponse)
            ? (statsResponse.stats || statsResponse.data || statsResponse)
            : {}
        );
      } catch (statsError) {
        console.error("Dashboard stats could not be loaded:", statsError);
        setStats({});
      }

      if (isSuperAdmin) {
        const registrations = await api("/api/admin/registrations", {}, token);
        setBusinesses(getRows(registrations, ["businesses", "registrations"]));
        return;
      }

      // Load products independently first. Optional endpoints (especially
      // Purchase Orders, which may not be migrated yet) must not block inventory.
      try {
        const productResponse = await api("/api/products", {}, token);
        const productRows = getRows(productResponse, ["products", "inventory"]);
        setProducts(productRows);
        if (!productRows.length) {
          console.info("NexStock: /api/products returned no product rows.", productResponse);
        }
      } catch (productError) {
        console.error("Inventory request failed:", productError);
        throw new Error(`Could not load inventory: ${productError.message}`);
      }

      const optionalLoads = [
        {
          label: "Categories",
          request: () => api("/api/categories", {}, token),
          set: (payload) => setCategories(getRows(payload, ["categories"])),
        },
        {
          label: "Suppliers",
          request: () => api("/api/suppliers", {}, token),
          set: (payload) => setSuppliers(getRows(payload, ["suppliers"])),
        },
        {
          label: "Stock transactions",
          request: () => api("/api/stock-transactions", {}, token),
          set: (payload) => setStockTransactions(getRows(payload, ["transactions", "stock_transactions"])),
        },
        {
          label: "Purchase orders",
          request: () => api("/api/purchase-orders", {}, token),
          set: (payload) => setPurchaseOrders(getRows(payload, ["purchase_orders", "orders"])),
        },
      ];

      const results = await Promise.allSettled(optionalLoads.map((item) => item.request()));
      results.forEach((result, index) => {
        const item = optionalLoads[index];
        if (result.status === "fulfilled") {
          item.set(result.value);
        } else {
          console.error(`${item.label} could not be loaded:`, result.reason);
          if (item.label === "Purchase orders") setPurchaseOrders([]);
          if (item.label === "Categories") setCategories([]);
          if (item.label === "Suppliers") setSuppliers([]);
          if (item.label === "Stock transactions") setStockTransactions([]);
        }
      });
    } catch (err) {
      notifyError(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (session?.token) loadDashboard(session);
    // Initial load when the session changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token]);

  async function submitAuth(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setNotice("");

    try {
      if (authMode === "register") {
        await api("/api/register", {
          method: "POST",
          body: JSON.stringify(form),
        });
        setNotice("Registration submitted! You can sign in after the administrator approves your business.");
        setAuthMode("login");
        setForm((old) => ({ ...old, password: "" }));
      } else {
        const data = await api("/api/login", {
          method: "POST",
          body: JSON.stringify({
            email: form.email,
            password: form.password,
          }),
        });
        localStorage.setItem("nexstock_session", JSON.stringify(data));
        setSession(data);
        setScreen("dashboard");
        setNotice("");
      }
    } catch (err) {
      notifyError(err);
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    localStorage.removeItem("nexstock_session");
    setSession(null);
    setProducts([]);
    setStockTransactions([]);
    setPurchaseOrders([]);
    setCategories([]);
    setSuppliers([]);
    setBusinesses([]);
    setStats({});
    setCategoryForm(initialCategory);
    setSupplierForm(initialSupplier);
    setEditingCategory(null);
    setEditingSupplier(null);
    setScreen("dashboard");
    setAuthMode("login");
    setShowWelcome(true);
    setError("");
    setNotice("");
  }

  async function reviewBusiness(clientId, decision) {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      await api(
        `/api/admin/registrations/${clientId}/decision`,
        {
          method: "POST",
          body: JSON.stringify({ decision }),
        },
        session.token
      );
      setNotice(`Business ${decision.toLowerCase()} successfully.`);
      await loadDashboard(session);
    } catch (err) {
      notifyError(err);
    } finally {
      setLoading(false);
    }
  }

  async function saveProduct(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const payload = {
        ...productForm,
        category_id: Number(productForm.category_id),
        supplier_id: Number(productForm.supplier_id),
        unit_price: Number(productForm.unit_price),
        reorder_level: Number(productForm.reorder_level),
      };
      if (!editingProduct) payload.quantity = Number(productForm.quantity);
      await api(
        editingProduct ? `/api/products/${editingProduct.product_id}` : "/api/products",
        {
          method: editingProduct ? "PUT" : "POST",
          body: JSON.stringify(payload),
        },
        session.token
      );
      setProductForm(initialProduct);
      setEditingProduct(null);
      setShowProductForm(false);
      setNotice(editingProduct ? "Product updated successfully." : "Product added successfully.");
      await loadDashboard(session);
    } catch (err) {
      notifyError(err);
    } finally {
      setLoading(false);
    }
  }

  function startEditProduct(product) {
    setEditingProduct(product);
    setProductForm({
      sku: product.sku || "",
      product_name: product.product_name || "",
      description: product.description || "",
      category_id: String(product.category_id ?? ""),
      supplier_id: String(product.supplier_id ?? ""),
      unit_price: String(product.unit_price ?? 0),
      quantity: String(product.quantity ?? 0),
      reorder_level: String(product.reorder_level ?? 5),
      unit: product.unit || "pcs",
    });
    setShowProductForm(true);
    setError("");
    setNotice("");
  }

  async function deleteProduct(product) {
    if (!window.confirm(`Delete product "${product.product_name}"? Its stock transaction history will be retained.`)) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      await api(`/api/products/${product.product_id}`, { method: "DELETE" }, session.token);
      setNotice("Product deleted successfully. Transaction history has been retained.");
      await loadDashboard(session);
    } catch (err) {
      notifyError(err);
    } finally {
      setLoading(false);
    }
  }

  function openStockForm(product, transactionType) {
    setStockForm({ product_id: String(product.product_id), transaction_type: transactionType, quantity: "", reason: "" });
    setShowStockForm(true);
    setError("");
    setNotice("");
  }

  async function saveStockTransaction(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const productId = Number(stockForm.product_id);
      await api(`/api/products/${productId}/stock-transactions`, {
        method: "POST",
        body: JSON.stringify({
          transaction_type: stockForm.transaction_type,
          quantity: Number(stockForm.quantity),
          reason: stockForm.reason,
        }),
      }, session.token);
      setShowStockForm(false);
      setStockForm({ product_id: "", transaction_type: "IN", quantity: "", reason: "" });
      setNotice(`Stock ${stockForm.transaction_type === "IN" ? "in" : "out"} recorded successfully.`);
      await loadDashboard(session);
    } catch (err) {
      notifyError(err);
    } finally {
      setLoading(false);
    }
  }

  async function saveCategory(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setNotice("");
    try {
      await api(
        editingCategory ? `/api/categories/${editingCategory.category_id}` : "/api/categories",
        {
          method: editingCategory ? "PUT" : "POST",
          body: JSON.stringify(categoryForm),
        },
        session.token
      );
      setCategoryForm(initialCategory);
      setEditingCategory(null);
      setShowCategoryForm(false);
      setNotice(editingCategory ? "Category updated successfully." : "Category created successfully.");
      await loadDashboard(session);
    } catch (err) {
      notifyError(err);
    } finally {
      setLoading(false);
    }
  }

  function startEditCategory(category) {
    setEditingCategory(category);
    setCategoryForm({
      category_name: category.category_name || "",
      description: category.description || "",
    });
    setShowCategoryForm(true);
    setError("");
    setNotice("");
  }

  async function deleteCategory(category) {
    if (!window.confirm(`Delete category "${category.category_name}"?`)) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      await api(`/api/categories/${category.category_id}`, { method: "DELETE" }, session.token);
      setNotice("Category deleted successfully.");
      await loadDashboard(session);
    } catch (err) {
      notifyError(err);
    } finally {
      setLoading(false);
    }
  }

  async function saveSupplier(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setNotice("");
    try {
      await api(
        editingSupplier ? `/api/suppliers/${editingSupplier.supplier_id}` : "/api/suppliers",
        {
          method: editingSupplier ? "PUT" : "POST",
          body: JSON.stringify(supplierForm),
        },
        session.token
      );
      setSupplierForm(initialSupplier);
      setEditingSupplier(null);
      setShowSupplierForm(false);
      setNotice(editingSupplier ? "Supplier updated successfully." : "Supplier created successfully.");
      await loadDashboard(session);
    } catch (err) {
      notifyError(err);
    } finally {
      setLoading(false);
    }
  }

  function startEditSupplier(supplier) {
    setEditingSupplier(supplier);
    setSupplierForm({
      supplier_name: supplier.supplier_name || "",
      contact_name: supplier.contact_name || "",
      email: supplier.email || "",
      phone: supplier.phone || "",
      address: supplier.address || "",
    });
    setShowSupplierForm(true);
    setError("");
    setNotice("");
  }

  async function deleteSupplier(supplier) {
    if (!window.confirm(`Delete supplier "${supplier.supplier_name}"?`)) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      await api(`/api/suppliers/${supplier.supplier_id}`, { method: "DELETE" }, session.token);
      setNotice("Supplier deleted successfully.");
      await loadDashboard(session);
    } catch (err) {
      notifyError(err);
    } finally {
      setLoading(false);
    }
  }

  function updatePurchaseOrderItem(index, key, value) {
    setPurchaseOrderForm((previous) => ({
      ...previous,
      items: previous.items.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        const next = { ...item, [key]: value };
        if (key === "product_id") {
          const selected = products.find((product) => String(product.product_id) === String(value));
          next.unit_cost = String(selected?.unit_price ?? "0");
        }
        return next;
      }),
    }));
  }

  function addPurchaseOrderItem() {
    setPurchaseOrderForm((previous) => ({
      ...previous,
      items: [...previous.items, { product_id: "", quantity: "1", unit_cost: "0" }],
    }));
  }

  function removePurchaseOrderItem(index) {
    setPurchaseOrderForm((previous) => ({
      ...previous,
      items: previous.items.length === 1
        ? previous.items
        : previous.items.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  async function createPurchaseOrder(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const items = purchaseOrderForm.items.map((item) => ({
        product_id: Number(item.product_id),
        quantity: Number(item.quantity),
        unit_cost: Number(item.unit_cost),
      }));
      if (!purchaseOrderForm.supplier_id) throw new Error("Select a supplier.");
      if (items.some((item) => !item.product_id || !Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.unit_cost) || item.unit_cost < 0)) {
        throw new Error("Choose a product and enter valid quantity and unit cost for every line.");
      }
      if (new Set(items.map((item) => item.product_id)).size !== items.length) {
        throw new Error("Each product can appear only once in a purchase order. Adjust its quantity on the existing line.");
      }
      await api("/api/purchase-orders", {
        method: "POST",
        body: JSON.stringify({
          supplier_id: Number(purchaseOrderForm.supplier_id),
          expected_date: purchaseOrderForm.expected_date || null,
          notes: purchaseOrderForm.notes,
          items,
        }),
      }, session.token);
      setPurchaseOrderForm({
        supplier_id: "", expected_date: "", notes: "",
        items: [{ product_id: "", quantity: "1", unit_cost: "0" }],
      });
      setShowPurchaseOrderForm(false);
      setNotice("Purchase order created successfully.");
      await loadDashboard(session);
    } catch (err) {
      notifyError(err);
    } finally {
      setLoading(false);
    }
  }

  async function receivePurchaseOrder(order) {
    if (!window.confirm(`Receive all remaining items for ${order.order_number}? This will increase stock and create stock-in ledger entries.`)) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      await api(`/api/purchase-orders/${order.purchase_order_id}/receive`, {
        method: "POST",
        body: JSON.stringify({}),
      }, session.token);
      setNotice(`${order.order_number} received and stock updated.`);
      await loadDashboard(session);
    } catch (err) {
      notifyError(err);
    } finally {
      setLoading(false);
    }
  }

  async function cancelPurchaseOrder(order) {
    if (!window.confirm(`Cancel ${order.order_number}?`)) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      await api(`/api/purchase-orders/${order.purchase_order_id}/status`, {
        method: "PUT",
        body: JSON.stringify({ status: "CANCELLED" }),
      }, session.token);
      setNotice(`${order.order_number} cancelled.`);
      await loadDashboard(session);
    } catch (err) {
      notifyError(err);
    } finally {
      setLoading(false);
    }
  }

  function downloadCsv(filename, rows) {
    if (!rows.length) {
      setNotice("There is no data to export yet.");
      return;
    }
    const columns = Object.keys(rows[0]);
    const escapeCsv = (value) => {
      const text = value == null ? "" : String(value);
      return `"${text.replace(/"/g, '""')}"`;
    };
    const csv = [columns.map(escapeCsv).join(","), ...rows.map((row) => columns.map((key) => escapeCsv(row[key])).join(","))].join("\\r\\n");
    const blob = new Blob(["\\ufeff", csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function exportInventoryCsv() {
    downloadCsv("nexstock-inventory.csv", products.map((product) => ({
      SKU: product.sku,
      Product: product.product_name,
      Category: product.category_name || "",
      Supplier: product.supplier_name || "",
      Quantity: Number(product.quantity) || 0,
      Unit: product.unit || "",
      UnitPriceINR: Number(product.unit_price) || 0,
      InventoryValueINR: (Number(product.quantity) || 0) * (Number(product.unit_price) || 0),
      ReorderLevel: Number(product.reorder_level) || 0,
    })));
  }

  function exportTransactionsCsv() {
    downloadCsv("nexstock-transactions.csv", stockTransactions.map((transaction) => ({
      TransactionID: transaction.transaction_id,
      Date: transaction.created_at || "",
      Product: transaction.product_name || "",
      SKU: transaction.sku || "",
      Type: transaction.transaction_type || "",
      Quantity: Number(transaction.quantity) || 0,
      PreviousStock: Number(transaction.previous_quantity) || 0,
      NewStock: Number(transaction.new_quantity) || 0,
      Reason: transaction.reason || "",
      RecordedBy: transaction.created_by || "",
    })));
  }

  function exportReportTransactionsCsv() {
    downloadCsv(`nexstock-transactions-${reportFrom || "all"}-to-${reportTo || "all"}.csv`, reportTransactions.map((transaction) => ({
      TransactionID: transaction.transaction_id,
      Date: transaction.created_at || "",
      Product: transaction.product_name || "",
      SKU: transaction.sku || "",
      Type: transaction.transaction_type || "",
      Quantity: Number(transaction.quantity) || 0,
      PreviousStock: Number(transaction.previous_quantity) || 0,
      NewStock: Number(transaction.new_quantity) || 0,
      Reason: transaction.reason || "",
      RecordedBy: transaction.created_by || "",
    })));
  }

  const filteredCategories = categories.filter((category) =>
    `${category.category_name} ${category.description || ""}`.toLowerCase().includes(search.toLowerCase())
  );
  const filteredSuppliers = suppliers.filter((supplier) =>
    `${supplier.supplier_name} ${supplier.contact_name || ""} ${supplier.email || ""} ${supplier.phone || ""}`
      .toLowerCase().includes(search.toLowerCase())
  );

  const filteredProducts = products.filter((product) => {
    const term = search.trim().toLowerCase();
    const matchesSearch = !term || `${product.product_name} ${product.sku} ${product.category_name || ""} ${product.supplier_name || ""}`.toLowerCase().includes(term);
    const quantity = Number(product.quantity) || 0;
    const reorder = Number(product.reorder_level) || 0;
    const status = quantity <= 0 ? "OUT OF STOCK" : quantity <= reorder ? "LOW STOCK" : "IN STOCK";
    const matchesStatus = inventoryStatusFilter === "ALL" || status === inventoryStatusFilter;
    const matchesCategory = inventoryCategoryFilter === "ALL" || (product.category_name || "Uncategorised") === inventoryCategoryFilter;
    return matchesSearch && matchesStatus && matchesCategory;
  }).sort((a, b) => {
    const av = Number(a.quantity) || 0;
    const bv = Number(b.quantity) || 0;
    const ap = Number(a.unit_price) || 0;
    const bp = Number(b.unit_price) || 0;
    const sorters = {
      "name-asc": () => String(a.product_name || "").localeCompare(String(b.product_name || "")),
      "name-desc": () => String(b.product_name || "").localeCompare(String(a.product_name || "")),
      "stock-asc": () => av - bv,
      "stock-desc": () => bv - av,
      "price-asc": () => ap - bp,
      "price-desc": () => bp - ap,
      "value-desc": () => bv * bp - av * ap,
    };
    return (sorters[inventorySortBy] || sorters["name-asc"])();
  });

  const filteredTransactions = stockTransactions.filter((transaction) =>
    transactionTypeFilter === "ALL" || transaction.transaction_type === transactionTypeFilter
  );
  const reportTransactions = stockTransactions.filter((transaction) => {
    if (!transaction.created_at) return false;
    const transactionDate = new Date(transaction.created_at);
    if (Number.isNaN(transactionDate.getTime())) return false;
    const day = localDateInputValue(transactionDate);
    return (!reportFrom || day >= reportFrom) && (!reportTo || day <= reportTo);
  });
  const reportMovementRows = [
    { label: "Stock in", value: reportTransactions.filter((row) => row.transaction_type === "IN").reduce((sum, row) => sum + (Number(row.quantity) || 0), 0) },
    { label: "Stock out", value: reportTransactions.filter((row) => row.transaction_type === "OUT").reduce((sum, row) => sum + (Number(row.quantity) || 0), 0) },
  ];
  const filteredPurchaseOrders = purchaseOrders.filter((order) =>
    purchaseOrderStatusFilter === "ALL" || order.status === purchaseOrderStatusFilter
  );
  const stockHealthRows = [
    { label: "In stock", value: products.filter((p) => Number(p.quantity) > Number(p.reorder_level)).length },
    { label: "Low stock", value: products.filter((p) => Number(p.quantity) > 0 && Number(p.quantity) <= Number(p.reorder_level)).length },
    { label: "Out of stock", value: products.filter((p) => Number(p.quantity) <= 0).length },
  ];
  const lowStockProducts = products.filter((p) => Number(p.quantity) <= Number(p.reorder_level));
  const topValueProducts = [...products].sort((a, b) =>
    (Number(b.quantity) || 0) * (Number(b.unit_price) || 0) -
    (Number(a.quantity) || 0) * (Number(a.unit_price) || 0)
  ).slice(0, 5);

  if (!session && showWelcome) {
    return (
      <div className="welcome-page">
        <div className="welcome-glow welcome-glow-one" />
        <div className="welcome-glow welcome-glow-two" />

        <header className="welcome-nav">
          <div className="brand">
            <div className="brand-icon"><Boxes size={24} /></div>
            <div>
              <span className="brand-name">NexStock</span>
              <span className="brand-caption">INVENTORY INTELLIGENCE</span>
            </div>
          </div>

          <button
            className="button button-secondary"
            onClick={() => {
              setShowWelcome(false);
              setAuthMode("login");
              setError("");
              setNotice("");
            }}
          >
            Sign in <ArrowUpRight size={17} />
          </button>
        </header>

        <main className="welcome-content">
          <div className="welcome-badge">
            <span className="live-dot" />
            SMARTER INVENTORY. BETTER BUSINESS.
          </div>

          <h1>
            Take control of your
            <span> entire inventory.</span>
          </h1>

          <p className="welcome-description">
            NexStock brings your products, categories, suppliers, and stock
            levels together in one place. Spend less time managing inventory
            and more time growing your business.
          </p>

          <div className="welcome-actions">
            <button
              className="button button-primary welcome-cta"
              onClick={() => {
                setShowWelcome(false);
                setAuthMode("login");
                setError("");
                setNotice("");
              }}
            >
              Get Started <ArrowUpRight size={19} />
            </button>
            <span className="welcome-action-note">
              Simple. Organized. Built for your business.
            </span>
          </div>

          <div className="welcome-features">
            <div className="welcome-feature">
              <div className="welcome-feature-icon"><Package size={23} /></div>
              <h3>Product Management</h3>
              <p>Keep your products, quantities, and prices organized.</p>
            </div>

            <div className="welcome-feature">
              <div className="welcome-feature-icon"><Tags size={23} /></div>
              <h3>Smart Categorization</h3>
              <p>Group inventory into categories for easy management.</p>
            </div>

            <div className="welcome-feature">
              <div className="welcome-feature-icon"><Truck size={23} /></div>
              <h3>Supplier Management</h3>
              <p>Keep supplier information accessible in one place.</p>
            </div>

            <div className="welcome-feature">
              <div className="welcome-feature-icon"><LayoutDashboard size={23} /></div>
              <h3>Inventory Overview</h3>
              <p>Get a clear view of stock levels and business activity.</p>
            </div>
          </div>
        </main>

        <footer className="welcome-footer">
          <span>© {new Date().getFullYear()} NexStock</span>
          <span>Inventory management, made clearer.</span>
        </footer>
      </div>
    );
  }

  const inventoryValue = products.reduce((sum, product) => sum + (Number(product.quantity) || 0) * (Number(product.unit_price) || 0), 0);
  const categoryValueRows = Object.values(products.reduce((acc, product) => {
    const label = product.category_name || "Uncategorised";
    if (!acc[label]) acc[label] = { label, value: 0 };
    acc[label].value += (Number(product.quantity) || 0) * (Number(product.unit_price) || 0);
    return acc;
  }, {})).sort((a, b) => b.value - a.value).slice(0, 6);
  const categoryCountRows = Object.values(products.reduce((acc, product) => {
    const label = product.category_name || "Uncategorised";
    if (!acc[label]) acc[label] = { label, value: 0 };
    acc[label].value += 1;
    return acc;
  }, {})).sort((a, b) => b.value - a.value).slice(0, 6);
  const stockMovementRows = [
    { label: "Stock in", value: stockTransactions.filter((row) => row.transaction_type === "IN").reduce((sum, row) => sum + (Number(row.quantity) || 0), 0) },
    { label: "Stock out", value: stockTransactions.filter((row) => row.transaction_type === "OUT").reduce((sum, row) => sum + (Number(row.quantity) || 0), 0) },
  ];

  const pageTitles = {
    dashboard: isAdmin ? "Platform overview" : "Dashboard",
    businesses: "Business registrations",
    products: "Inventory",
    stock: "Stock movement",
    transactions: "Transaction history",
    categories: "Category management",
    suppliers: "Supplier management",
    "purchase-orders": "Purchase orders",
    reports: "Reports & analytics",
  };
  const pageDescriptions = {
    dashboard: isAdmin ? "A clear view of businesses using NexStock." : "A clear overview of your inventory and business activity.",
    businesses: "Review business applications and manage access.",
    products: "Find products, monitor availability, and identify stock that needs attention.",
    stock: "Record incoming deliveries and outgoing stock with confidence.",
    transactions: "Review recorded inventory movements, quantities, references and stock balances.",
    categories: "Create and maintain the categories used to organize products.",
    suppliers: "Maintain supplier details and manage your supplier directory.",
    "purchase-orders": "Create supplier orders, track outstanding quantities, and receive stock into inventory.",
    reports: "Analyze inventory value, stock health, supplier coverage and recorded movements.",
  };
  const pageTitle = pageTitles[screen] || "Overview";
  const pageDescription = pageDescriptions[screen] || "Manage your NexStock workspace.";

  if (!session) {
    return (
      <div className="auth-page">
        <div className="auth-decoration decoration-one" />
        <div className="auth-decoration decoration-two" />
        <div className="auth-card">
          <div className="brand auth-brand">
            <div className="brand-icon"><Boxes size={24} /></div>
            <div>
              <span className="brand-name">NexStock</span>
              <span className="brand-caption">INVENTORY INTELLIGENCE</span>
            </div>
          </div>

          <div className="auth-heading">
            <span className="eyebrow">
              {authMode === "login" ? "WELCOME BACK" : "GET STARTED"}
            </span>
            <h1>
              {authMode === "login"
                ? "Your business, in control."
                : "Bring your inventory together."}
            </h1>
            <p>
              {authMode === "login"
                ? "Sign in to manage your inventory with clarity."
                : "Register your business to request access to NexStock."}
            </p>
          </div>

          <div className="auth-tabs">
            <button
              className={authMode === "login" ? "active" : ""}
              onClick={() => { setAuthMode("login"); setError(""); setNotice(""); }}
            >Sign in</button>
            <button
              className={authMode === "register" ? "active" : ""}
              onClick={() => { setAuthMode("register"); setError(""); setNotice(""); }}
            >Register business</button>
          </div>

          {error && <div className="alert alert-error"><AlertTriangle size={17} />{error}</div>}
          {notice && <div className="alert alert-success"><CheckCircle2 size={17} />{notice}</div>}

          <form className="auth-form" onSubmit={submitAuth}>
            {authMode === "register" && (
              <>
                <Field label="Business name">
                  <input required value={form.business_name} onChange={(e) => updateForm("business_name", e.target.value)} placeholder="e.g. Acme Retail" />
                </Field>
                <Field label="Your full name">
                  <input required value={form.full_name} onChange={(e) => updateForm("full_name", e.target.value)} placeholder="Full name" />
                </Field>
                <Field label="Phone (optional)">
                  <input value={form.phone} onChange={(e) => updateForm("phone", e.target.value)} placeholder="Business contact number" />
                </Field>
                <Field label="Business address (optional)">
                  <input value={form.address} onChange={(e) => updateForm("address", e.target.value)} placeholder="Business address" />
                </Field>
              </>
            )}
            <Field label="Email address">
              <input type="email" required value={form.email} onChange={(e) => updateForm("email", e.target.value)} placeholder="you@company.com" autoComplete="email" />
            </Field>
            <Field label="Password">
              <input type="password" required minLength={12} value={form.password} onChange={(e) => updateForm("password", e.target.value)} placeholder="At least 12 characters" autoComplete={authMode === "login" ? "current-password" : "new-password"} />
            </Field>
            <button className="button button-primary auth-submit" disabled={loading}>
              {loading ? "Please wait..." : authMode === "login" ? "Sign in to NexStock" : "Submit registration"}
              {!loading && <ArrowUpRight size={18} />}
            </button>
          </form>

          <div className="auth-foot"><ShieldCheck size={16} /> Secure, role-based business access</div>
        </div>
        <div className="auth-footer">NexStock · Inventory management, made clearer.</div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {mobileNav && <button className="mobile-overlay" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
        <div className="brand sidebar-brand">
          <div className="brand-icon"><Boxes size={23} /></div>
          <div><span className="brand-name">NexStock</span><span className="brand-caption">INVENTORY INTELLIGENCE</span></div>
          <button className="mobile-close" onClick={() => setMobileNav(false)} aria-label="Close menu"><X size={19} /></button>
        </div>

        <div className="workspace-label">WORKSPACE</div>
        <button title="Overview" className={`nav-item ${screen === "dashboard" ? "selected" : ""}`} onClick={() => { setScreen("dashboard"); setMobileNav(false); }}>
          <LayoutDashboard size={19} /> Overview
        </button>
        {isAdmin ? (
          <button className={`nav-item ${screen === "businesses" ? "selected" : ""}`} onClick={() => { setScreen("businesses"); setMobileNav(false); }}>
            <Building2 size={19} /> Businesses
            {Number(stats.pending_businesses) > 0 && <span className="nav-count">{stats.pending_businesses}</span>}
          </button>
        ) : (
          <>
            <button title="Categories" className={`nav-item ${screen === "categories" ? "selected" : ""}`} onClick={() => { setScreen("categories"); setMobileNav(false); }}>
              <Tags size={19} /> Categories
            </button>
            <button title="Suppliers" className={`nav-item ${screen === "suppliers" ? "selected" : ""}`} onClick={() => { setScreen("suppliers"); setMobileNav(false); }}>
              <Truck size={19} /> Suppliers
            </button>
            <button title="Inventory" className={`nav-item ${screen === "products" ? "selected" : ""}`} onClick={() => { setScreen("products"); setMobileNav(false); }}>
              <Package size={19} /> Inventory
            </button>
            <button title="Stock movement" className={`nav-item ${screen === "stock" ? "selected" : ""}`} onClick={() => { setScreen("stock"); setMobileNav(false); }}>
              <ArrowLeftRight size={19} /> Stock movement
            </button>
            <button title="Transactions" className={`nav-item ${screen === "transactions" ? "selected" : ""}`} onClick={() => { setScreen("transactions"); setMobileNav(false); }}>
              <ClipboardList size={19} /> Transactions
            </button>
            <button title="Purchase orders" className={`nav-item ${screen === "purchase-orders" ? "selected" : ""}`} onClick={() => { setScreen("purchase-orders"); setMobileNav(false); }}>
              <ClipboardCheck size={19} /> Purchase orders
            </button>
            <button title="Reports & analytics" className={`nav-item ${screen === "reports" ? "selected" : ""}`} onClick={() => { setScreen("reports"); setMobileNav(false); }}>
              <BarChart3 size={19} /> Reports & analytics
            </button>
          </>
        )}

        <div className="sidebar-bottom">
          <div className="profile-card">
            <div className="avatar">{(session.user.name || "N").slice(0, 1).toUpperCase()}</div>
            <div className="profile-info"><strong>{session.user.name}</strong><span>{isAdmin ? "Super Administrator" : "Business Administrator"}</span></div>
          </div>
          <button className="nav-item logout-item" onClick={logout}><LogOut size={18} /> Sign out</button>
        </div>
      </aside>

      <main className={`main-area ${sidebarCollapsed ? "sidebar-main-collapsed" : ""}`}>
        <header className="topbar">
          <div className="topbar-leading">
            <button className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={21} /></button>
            <button className="sidebar-toggle" onClick={() => setSidebarCollapsed((value) => !value)} aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
              {sidebarCollapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
            </button>
            <div className="breadcrumb">NexStock <span>/</span> <strong>{pageTitle}</strong></div>
          </div>
          <div className="topbar-right">
            <span className="connection-pill"><span className="live-dot" /> API workspace</span>
            <div className="avatar avatar-small">{(session.user.name || "N").slice(0, 1).toUpperCase()}</div>
          </div>
        </header>

        <div className="page-content">
          {error && <div className="alert alert-error page-alert"><AlertTriangle size={17} />{error}<button onClick={() => setError("")}><X size={16} /></button></div>}
          {notice && <div className="alert alert-success page-alert"><CheckCircle2 size={17} />{notice}<button onClick={() => setNotice("")}><X size={16} /></button></div>}

          <div className="page-heading">
            <div>
              {screen === "dashboard" && (
                <div
                  className="dashboard-greeting"
                  style={{
                    fontSize: "clamp(28px, 3vw, 40px)",
                    fontWeight: 750,
                    lineHeight: 1.15,
                    letterSpacing: "-0.035em",
                    marginBottom: 12,
                    color: "var(--text-primary, #202536)",
                  }}
                >
                  {timeGreeting}, {displayName} <span role="img" aria-label="greeting">{greetingEmoji}</span>
                </div>
              )}
              <span className="eyebrow">{isAdmin ? "ADMINISTRATION" : "YOUR WORKSPACE"}</span>
              <h1>{pageTitle}</h1>
              <p>{pageDescription}</p>
            </div>
            <button className="button button-secondary refresh-button" onClick={() => loadDashboard()} disabled={loading}>
              <RefreshCw size={16} className={loading ? "spin" : ""} /> Refresh
            </button>
          </div>

          {screen === "dashboard" && isAdmin && (
            <>
              <div className="metric-grid">
                <Metric label="Total businesses" value={stats.total_businesses ?? "—"} icon={<Building2 />} tone="violet" detail="Registered accounts" />
                <Metric label="Awaiting review" value={stats.pending_businesses ?? "—"} icon={<Clock3 />} tone="amber" detail="Require your attention" />
                <Metric label="Approved businesses" value={stats.approved_businesses ?? "—"} icon={<CheckCircle2 />} tone="green" detail="Active business access" />
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <div><h2>Recent business registrations</h2><p>Review applications submitted to NexStock.</p></div>
                  <button className="text-button" onClick={() => setScreen("businesses")}>View all <ArrowUpRight size={16} /></button>
                </div>
                <BusinessTable rows={businesses.slice(0, 5)} onReview={reviewBusiness} loading={loading} />
              </section>
            </>
          )}

          {screen === "dashboard" && !isAdmin && (
            <>
              <OrbitingNexStockCards onNavigate={(destination) => {
                const destinations = {
                  "Inventory": "products",
                  "Purchase Orders": "purchase-orders",
                  "Suppliers": "suppliers",
                  "Stock Movement": "stock",
                  "Reports": "reports",
                };
                setScreen(destinations[destination] || "dashboard");
                setMobileNav(false);
              }} />
              <div className="metric-grid">
                <Metric label="Total products" value={stats.total_products ?? "—"} icon={<Package />} tone="violet" detail="Active product records" />
                <Metric label="Units in stock" value={stats.total_units ?? "—"} icon={<Boxes />} tone="blue" detail="Across active products" />
                <Metric label="Low-stock items" value={stats.low_stock_products ?? "—"} icon={<AlertTriangle />} tone="amber" detail="At or below reorder level" />
                <Metric label="Inventory value" value={`₹${inventoryValue.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`} icon={<IndianRupee />} tone="green" detail="Current quantity × unit price" />
              </div>
              <div className="chart-grid">
                <section className="panel chart-panel">
                  <div className="panel-heading"><div><h2>Inventory value by category</h2><p>Estimated value of current stock.</p></div><BarChart3 size={19} /></div>
                  <MiniBarChart rows={categoryValueRows} currency />
                </section>
                <section className="panel chart-panel">
                  <div className="panel-heading"><div><h2>Stock movement summary</h2><p>Total recorded units moved.</p></div><ArrowLeftRight size={19} /></div>
                  <MiniBarChart rows={stockMovementRows} />
                </section>
                <section className="panel chart-panel">
                  <div className="panel-heading"><div><h2>Stock health</h2><p>Products by availability status.</p></div><Activity size={19} /></div>
                  <PieChart rows={stockHealthRows} />
                </section>
                <section className="panel chart-panel">
                  <div className="panel-heading"><div><h2>Products by category</h2><p>How your product catalogue is distributed.</p></div><Tags size={19} /></div>
                  <PieChart rows={categoryCountRows} />
                </section>
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <div><h2>Recently listed products</h2><p>Your latest inventory records.</p></div>
                  <button className="text-button" onClick={() => setScreen("products")}>View inventory <ArrowUpRight size={16} /></button>
                </div>
                <ProductTable rows={products.slice(0, 5)} />
              </section>
              <section className="panel dashboard-transactions">
                <div className="panel-heading">
                  <div><h2>Recent stock activity</h2><p>Latest receipts and issues recorded in the stock ledger.</p></div>
                  <button className="text-button" onClick={() => setScreen("transactions")}>View transactions <ArrowRight size={15} /></button>
                </div>
                <TransactionTable rows={stockTransactions.slice(0, 5)} />
              </section>
            </>
          )}

          {screen === "businesses" && isAdmin && (
            <section className="panel">
              <div className="panel-heading panel-heading-wrap">
                <div><h2>All businesses</h2><p>Approve or reject pending applications. You can also suspend approved accounts.</p></div>
                <span className="table-total">{businesses.length} records</span>
              </div>
              <BusinessTable rows={businesses} onReview={reviewBusiness} loading={loading} />
            </section>
          )}

          {screen === "categories" && !isAdmin && (
            <>
              <div className="inventory-toolbar">
                <div className="search-box"><Search size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search categories..." /></div>
                <button className="button button-primary" onClick={() => { setEditingCategory(null); setCategoryForm(initialCategory); setShowCategoryForm((v) => !v); }}><Plus size={17} /> Add category</button>
              </div>
              {showCategoryForm && (
                <section className="panel product-form-panel">
                  <div className="panel-heading"><div><h2>{editingCategory ? "Edit category" : "Add a category"}</h2><p>Give your inventory a clear, consistent structure.</p></div><button className="icon-button" onClick={() => { setShowCategoryForm(false); setEditingCategory(null); setCategoryForm(initialCategory); }}><X size={18} /></button></div>
                  <form className="product-form" onSubmit={saveCategory}>
                    <Field label="Category name"><input required value={categoryForm.category_name} onChange={(e) => setCategoryForm({ ...categoryForm, category_name: e.target.value })} placeholder="e.g. Electronics" /></Field>
                    <div className="form-wide"><Field label="Description (optional)"><textarea rows="2" value={categoryForm.description} onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })} placeholder="What belongs in this category?" /></Field></div>
                    <div className="form-actions"><button type="button" className="button button-secondary" onClick={() => { setShowCategoryForm(false); setEditingCategory(null); setCategoryForm(initialCategory); }}>Cancel</button><button className="button button-primary" disabled={loading}>{loading ? "Saving..." : editingCategory ? "Save changes" : "Create category"}</button></div>
                  </form>
                </section>
              )}
              <section className="panel">
                <div className="panel-heading"><div><h2>All categories</h2><p>Categories are private to your business.</p></div><span className="table-total">{filteredCategories.length} categories</span></div>
                <CategoryTable rows={filteredCategories} onEdit={startEditCategory} onDelete={deleteCategory} loading={loading} />
              </section>
            </>
          )}

          {screen === "suppliers" && !isAdmin && (
            <>
              <div className="inventory-toolbar">
                <div className="search-box"><Search size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search suppliers..." /></div>
                <button className="button button-primary" onClick={() => { setEditingSupplier(null); setSupplierForm(initialSupplier); setShowSupplierForm((v) => !v); }}><Plus size={17} /> Add supplier</button>
              </div>
              {showSupplierForm && (
                <section className="panel product-form-panel">
                  <div className="panel-heading"><div><h2>{editingSupplier ? "Edit supplier" : "Add a supplier"}</h2><p>Store supplier and contact information.</p></div><button className="icon-button" onClick={() => { setShowSupplierForm(false); setEditingSupplier(null); setSupplierForm(initialSupplier); }}><X size={18} /></button></div>
                  <form className="product-form" onSubmit={saveSupplier}>
                    <Field label="Supplier name"><input required value={supplierForm.supplier_name} onChange={(e) => setSupplierForm({ ...supplierForm, supplier_name: e.target.value })} placeholder="e.g. Acme Distributors" /></Field>
                    <Field label="Contact person"><input value={supplierForm.contact_name} onChange={(e) => setSupplierForm({ ...supplierForm, contact_name: e.target.value })} placeholder="Contact name" /></Field>
                    <Field label="Email"><input type="email" value={supplierForm.email} onChange={(e) => setSupplierForm({ ...supplierForm, email: e.target.value })} placeholder="supplier@company.com" /></Field>
                    <Field label="Phone"><input value={supplierForm.phone} onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })} placeholder="Contact number" /></Field>
                    <div className="form-wide"><Field label="Address (optional)"><textarea rows="2" value={supplierForm.address} onChange={(e) => setSupplierForm({ ...supplierForm, address: e.target.value })} placeholder="Supplier address" /></Field></div>
                    <div className="form-actions"><button type="button" className="button button-secondary" onClick={() => { setShowSupplierForm(false); setEditingSupplier(null); setSupplierForm(initialSupplier); }}>Cancel</button><button className="button button-primary" disabled={loading}>{loading ? "Saving..." : editingSupplier ? "Save changes" : "Create supplier"}</button></div>
                  </form>
                </section>
              )}
              <section className="panel">
                <div className="panel-heading"><div><h2>All suppliers</h2><p>Manage the businesses that supply your stock.</p></div><span className="table-total">{filteredSuppliers.length} suppliers</span></div>
                <SupplierTable rows={filteredSuppliers} onEdit={startEditSupplier} onDelete={deleteSupplier} loading={loading} />
              </section>
            </>
          )}

          {screen === "products" && !isAdmin && (
            <>
              <div className="inventory-toolbar inventory-toolbar-wrap">
                <div className="search-box"><Search size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search product, SKU, category or supplier..." /></div>
                <div className="inventory-filters">
                  <select value={inventoryCategoryFilter} onChange={(e) => setInventoryCategoryFilter(e.target.value)} aria-label="Filter by category">
                    <option value="ALL">All categories</option>
                    {[...new Set(products.map((p) => p.category_name || "Uncategorised"))].sort().map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                  <select value={inventoryStatusFilter} onChange={(e) => setInventoryStatusFilter(e.target.value)} aria-label="Filter by stock status">
                    <option value="ALL">All stock statuses</option><option value="IN STOCK">In stock</option><option value="LOW STOCK">Low stock</option><option value="OUT OF STOCK">Out of stock</option>
                  </select>
                  <select value={inventorySortBy} onChange={(e) => setInventorySortBy(e.target.value)} aria-label="Sort inventory">
                    <option value="name-asc">Name: A–Z</option><option value="name-desc">Name: Z–A</option><option value="stock-asc">Stock: low to high</option><option value="stock-desc">Stock: high to low</option><option value="price-asc">Price: low to high</option><option value="price-desc">Price: high to low</option><option value="value-desc">Value: high to low</option>
                  </select>
                </div>
                <div className="panel-actions">
                  <button className="button button-secondary" onClick={exportInventoryCsv}><Download size={16} /> Export CSV</button>
                  <button className="button button-primary" onClick={() => { setEditingProduct(null); setProductForm(initialProduct); setShowProductForm((v) => !v); }}><Plus size={17} /> Add product</button>
                </div>
              </div>

              {showProductForm && (
                <section className="panel product-form-panel">
                  <div className="panel-heading">
                    <div><h2>{editingProduct ? "Edit product" : "Add a product"}</h2><p>{editingProduct ? "Update product details. Change stock using Stock In or Stock Out." : "Enter the details for this inventory item."}</p></div>
                    <button className="icon-button" onClick={() => { setShowProductForm(false); setEditingProduct(null); setProductForm(initialProduct); }}><X size={18} /></button>
                  </div>
                  <form className="product-form" onSubmit={saveProduct}>
                    <Field label="Product name"><input required value={productForm.product_name} onChange={(e) => setProductForm({ ...productForm, product_name: e.target.value })} placeholder="Product name" /></Field>
                    <Field label="SKU"><input required value={productForm.sku} onChange={(e) => setProductForm({ ...productForm, sku: e.target.value })} placeholder="e.g. SKU-1001" /></Field>
                    <Field label="Category">
                      <select required value={productForm.category_id} onChange={(e) => setProductForm({ ...productForm, category_id: e.target.value })}>
                        <option value="">Select category</option>
                        {categories.map((category) => <option key={category.category_id} value={category.category_id}>{category.category_name}</option>)}
                      </select>
                    </Field>
                    <Field label="Supplier">
                      <select required value={productForm.supplier_id} onChange={(e) => setProductForm({ ...productForm, supplier_id: e.target.value })}>
                        <option value="">Select supplier</option>
                        {suppliers.map((supplier) => <option key={supplier.supplier_id} value={supplier.supplier_id}>{supplier.supplier_name}</option>)}
                      </select>
                    </Field>
                    <Field label="Unit price"><input type="number" min="0" step="0.01" required value={productForm.unit_price} onChange={(e) => setProductForm({ ...productForm, unit_price: e.target.value })} /></Field>
                    <Field label={editingProduct ? `Current quantity: ${Number(editingProduct.quantity).toLocaleString("en-IN")} ${editingProduct.unit}` : "Opening quantity"}>
                      <input type="number" min="0" step="0.01" required={!editingProduct} disabled={Boolean(editingProduct)} value={productForm.quantity} onChange={(e) => setProductForm({ ...productForm, quantity: e.target.value })} />
                    </Field>
                    <Field label="Reorder level"><input type="number" min="0" step="0.01" required value={productForm.reorder_level} onChange={(e) => setProductForm({ ...productForm, reorder_level: e.target.value })} /></Field>
                    <Field label="Unit"><input required value={productForm.unit} onChange={(e) => setProductForm({ ...productForm, unit: e.target.value })} placeholder="pcs, kg, box..." /></Field>
                    <div className="form-wide"><Field label="Description (optional)"><textarea rows="2" value={productForm.description} onChange={(e) => setProductForm({ ...productForm, description: e.target.value })} placeholder="Product details" /></Field></div>
                    <div className="form-actions">
                      <button type="button" className="button button-secondary" onClick={() => { setShowProductForm(false); setEditingProduct(null); setProductForm(initialProduct); }}>Cancel</button>
                      <button className="button button-primary" disabled={loading}>{loading ? "Saving..." : editingProduct ? "Save changes" : "Save product"}</button>
                    </div>
                  </form>
                </section>
              )}

              <section className="panel">
                <div className="panel-heading"><div><h2>Inventory list</h2><p>Edit product details or delete items. Record stock movements from the Stock movements page.</p></div><span className="table-total">{filteredProducts.length} products</span></div>
                <ProductTable rows={filteredProducts} onEdit={startEditProduct} onDelete={deleteProduct} loading={loading} />
              </section>
            </>
          )}

          {screen === "stock" && !isAdmin && (
            <>
              <section className="panel product-form-panel stock-movement-panel">
                <div className="panel-heading">
                  <div><h2>Record a stock movement</h2><p>Use Stock In for received goods and Stock Out for sales, usage, damage or dispatch.</p></div>
                </div>
                <div className="movement-type-switch" role="group" aria-label="Stock movement type">
                  <button type="button" className={stockForm.transaction_type === "IN" ? "active movement-in" : ""} onClick={() => setStockForm({ ...stockForm, transaction_type: "IN" })}><ArrowDownToLine size={17} /> Stock In</button>
                  <button type="button" className={stockForm.transaction_type === "OUT" ? "active movement-out" : ""} onClick={() => setStockForm({ ...stockForm, transaction_type: "OUT" })}><ArrowUpFromLine size={17} /> Stock Out</button>
                </div>
                <form className="product-form" onSubmit={saveStockTransaction}>
                  <Field label="Product">
                    <select required value={stockForm.product_id} onChange={(e) => setStockForm({ ...stockForm, product_id: e.target.value })}>
                      <option value="">Select product</option>
                      {products.map((product) => <option key={product.product_id} value={product.product_id}>{product.product_name} ({product.sku}) — {Number(product.quantity).toLocaleString("en-IN")} {product.unit || "units"} available</option>)}
                    </select>
                  </Field>
                  <Field label="Movement type">
                    <select required value={stockForm.transaction_type} onChange={(e) => setStockForm({ ...stockForm, transaction_type: e.target.value })}>
                      <option value="IN">Stock In — add quantity</option>
                      <option value="OUT">Stock Out — remove quantity</option>
                    </select>
                  </Field>
                  <Field label="Quantity"><input type="number" min="0.01" step="0.01" required value={stockForm.quantity} onChange={(e) => setStockForm({ ...stockForm, quantity: e.target.value })} placeholder="Enter quantity" /></Field>
                  <div className="form-wide"><Field label="Reason / reference (optional)"><textarea rows="2" maxLength="500" value={stockForm.reason} onChange={(e) => setStockForm({ ...stockForm, reason: e.target.value })} placeholder="e.g. Purchase order, sale, damaged items, return..." /></Field></div>
                  <div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setStockForm({ product_id: "", transaction_type: "IN", quantity: "", reason: "" })}>Clear</button><button className="button button-primary" disabled={loading}>{loading ? "Recording..." : stockForm.transaction_type === "IN" ? "Record stock in" : "Record stock out"}</button></div>
                </form>
              </section>
            </>
          )}

          {screen === "transactions" && !isAdmin && (
            <section className="panel">
              <div className="panel-heading panel-heading-wrap">
                <div><h2>Transaction history</h2><p>Complete stock movement ledger. Newest records appear first.</p></div>
                <div className="panel-actions">
                  <select value={transactionTypeFilter} onChange={(e) => setTransactionTypeFilter(e.target.value)} aria-label="Filter transaction type">
                    <option value="ALL">All movements</option><option value="IN">Stock in</option><option value="OUT">Stock out</option>
                  </select>
                  <button className="button button-secondary" onClick={exportTransactionsCsv}><Download size={16} /> Export CSV</button>
                </div>
              </div>
              <TransactionTable rows={filteredTransactions} />
              <div className="panel-footer"><span>{filteredTransactions.length} transactions</span><span>Stock ledger retained when products are archived</span></div>
            </section>
          )}

          {screen === "purchase-orders" && !isAdmin && (
            <>
              <div className="purchase-order-summary">
                <Metric label="Total orders" value={purchaseOrders.length} icon={<ClipboardCheck />} tone="green" detail="All purchase orders" />
                <Metric label="Open orders" value={purchaseOrders.filter((o) => ["ORDERED", "PARTIALLY_RECEIVED"].includes(o.status)).length} icon={<Clock3 />} tone="amber" detail="Awaiting receipt" />
                <Metric label="Received orders" value={purchaseOrders.filter((o) => o.status === "RECEIVED").length} icon={<CheckCircle2 />} tone="blue" detail="Fully received" />
                <Metric label="Order value" value={`₹${purchaseOrders.reduce((sum, o) => sum + (Number(o.total_value) || 0), 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`} icon={<CircleDollarSign />} tone="violet" detail="Value at order cost" />
              </div>
              <div className="inventory-toolbar inventory-toolbar-wrap">
                <div className="search-box"><Search size={18} /><input value={purchaseOrderSearch} onChange={(e) => setPurchaseOrderSearch(e.target.value)} placeholder="Search order number or supplier..." /></div>
                <div className="panel-actions">
                  <select value={purchaseOrderStatusFilter} onChange={(e) => setPurchaseOrderStatusFilter(e.target.value)} aria-label="Filter purchase orders">
                    <option value="ALL">All statuses</option><option value="ORDERED">Ordered</option><option value="PARTIALLY_RECEIVED">Partially received</option><option value="RECEIVED">Received</option><option value="CANCELLED">Cancelled</option>
                  </select>
                  <button className="button button-primary" onClick={() => setShowPurchaseOrderForm((v) => !v)}><Plus size={17} /> Create purchase order</button>
                </div>
              </div>
              {showPurchaseOrderForm && (
                <section className="panel product-form-panel">
                  <div className="panel-heading"><div><h2>Create purchase order</h2><p>Select a supplier and add the products you want to order.</p></div><button className="icon-button" onClick={() => setShowPurchaseOrderForm(false)} aria-label="Close form"><X size={18} /></button></div>
                  <form className="product-form" onSubmit={createPurchaseOrder}>
                    <Field label="Supplier">
                      <select required value={purchaseOrderForm.supplier_id} onChange={(e) => setPurchaseOrderForm({ ...purchaseOrderForm, supplier_id: e.target.value })}>
                        <option value="">Select supplier</option>{suppliers.map((supplier) => <option key={supplier.supplier_id} value={supplier.supplier_id}>{supplier.supplier_name}</option>)}
                      </select>
                    </Field>
                    <Field label="Expected delivery date"><input type="date" value={purchaseOrderForm.expected_date} onChange={(e) => setPurchaseOrderForm({ ...purchaseOrderForm, expected_date: e.target.value })} /></Field>
                    <div className="form-wide po-items-heading"><strong>Order items</strong><button type="button" className="button button-secondary" onClick={addPurchaseOrderItem}><Plus size={15} /> Add item</button></div>
                    {purchaseOrderForm.items.map((item, index) => (
                      <div className="po-item-row form-wide" key={`po-item-${index}`}>
                        <Field label={`Product ${index + 1}`}>
                          <select required value={item.product_id} onChange={(e) => updatePurchaseOrderItem(index, "product_id", e.target.value)}>
                            <option value="">Select product</option>{products.map((product) => <option key={product.product_id} value={product.product_id}>{product.product_name} ({product.sku})</option>)}
                          </select>
                        </Field>
                        <Field label="Quantity"><input type="number" min="0.01" step="0.01" required value={item.quantity} onChange={(e) => updatePurchaseOrderItem(index, "quantity", e.target.value)} /></Field>
                        <Field label="Unit cost (₹)"><input type="number" min="0" step="0.01" required value={item.unit_cost} onChange={(e) => updatePurchaseOrderItem(index, "unit_cost", e.target.value)} /></Field>
                        <button type="button" className="icon-button po-remove" disabled={purchaseOrderForm.items.length === 1} onClick={() => removePurchaseOrderItem(index)} title="Remove item"><Trash2 size={16} /></button>
                      </div>
                    ))}
                    <div className="form-wide"><Field label="Notes (optional)"><textarea rows="2" maxLength="1000" value={purchaseOrderForm.notes} onChange={(e) => setPurchaseOrderForm({ ...purchaseOrderForm, notes: e.target.value })} placeholder="Delivery instructions or order notes" /></Field></div>
                    <div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setShowPurchaseOrderForm(false)}>Cancel</button><button className="button button-primary" disabled={loading || products.length === 0 || suppliers.length === 0}>{loading ? "Saving..." : "Create order"}</button></div>
                  </form>
                </section>
              )}
              <section className="panel">
                <div className="panel-heading"><div><h2>Purchase order register</h2><p>Orders are tracked separately; stock increases only when you receive them.</p></div><span className="table-total">{filteredPurchaseOrders.filter((o) => `${o.order_number} ${o.supplier_name}`.toLowerCase().includes(purchaseOrderSearch.toLowerCase())).length} orders</span></div>
                <PurchaseOrderTable
                  rows={filteredPurchaseOrders.filter((o) => `${o.order_number} ${o.supplier_name}`.toLowerCase().includes(purchaseOrderSearch.toLowerCase()))}
                  loading={loading}
                  onReceive={receivePurchaseOrder}
                  onCancel={cancelPurchaseOrder}
                />
              </section>
            </>
          )}

          {screen === "reports" && !isAdmin && (
            <>
              <div className="report-toolbar">
                <div><span className="soft-tag"><TrendingUp size={15} /> Live inventory analysis</span><p>Current inventory metrics with movement activity filtered to the selected date range.</p></div>
                <div className="report-controls">
                  <Field label="From"><input type="date" value={reportFrom} max={reportTo || undefined} onChange={(e) => setReportFrom(e.target.value)} /></Field>
                  <Field label="To"><input type="date" value={reportTo} min={reportFrom || undefined} onChange={(e) => setReportTo(e.target.value)} /></Field>
                  <div className="panel-actions">
                    <button className="button button-secondary" onClick={exportInventoryCsv}><Download size={16} /> Inventory CSV</button>
                    <button className="button button-secondary" onClick={exportReportTransactionsCsv}><Download size={16} /> Activity CSV</button>
                  </div>
                </div>
              </div>
              <div className="metric-grid">
                <Metric label="Inventory value" value={`₹${inventoryValue.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`} icon={<IndianRupee />} tone="green" detail="Quantity × listed unit price" />
                <Metric label="Products to reorder" value={lowStockProducts.length} icon={<AlertTriangle />} tone="amber" detail="At or below reorder level" />
                <Metric label="Stock-in units" value={reportMovementRows[0].value.toLocaleString("en-IN")} icon={<ArrowDownToLine />} tone="blue" detail="Recorded stock receipts" />
                <Metric label="Stock-out units" value={reportMovementRows[1].value.toLocaleString("en-IN")} icon={<ArrowUpFromLine />} tone="violet" detail="Recorded stock issues" />
              </div>
              <div className="chart-grid">
                <section className="panel chart-panel"><div className="panel-heading"><div><h2>Stock health</h2><p>Products grouped by stock status.</p></div><Activity size={19} /></div><MiniBarChart rows={stockHealthRows} /></section>
                <section className="panel chart-panel"><div className="panel-heading"><div><h2>Inventory value by category</h2><p>Estimated value using current listed prices.</p></div><BarChart3 size={19} /></div><MiniBarChart rows={categoryValueRows} currency /></section>
                <section className="panel chart-panel"><div className="panel-heading"><div><h2>Movement in selected period</h2><p>{reportFrom || "All dates"} to {reportTo || "today"}.</p></div><ArrowLeftRight size={19} /></div><MiniBarChart rows={reportMovementRows} /></section>
              </div>
              <section className="panel">
                <div className="panel-heading"><div><h2>Highest-value products</h2><p>Products with the largest estimated on-hand value.</p></div><span className="soft-tag"><CircleDollarSign size={15} /> Top 5</span></div>
                <ProductTable rows={topValueProducts} loading={loading} />
              </section>
              <section className="panel report-low-stock">
                <div className="panel-heading"><div><h2>Reorder attention</h2><p>Products at or below their reorder level.</p></div><button className="text-button" onClick={() => setScreen("products")}>Review inventory <ArrowRight size={15} /></button></div>
                <ProductTable rows={lowStockProducts} loading={loading} />
              </section>
              <section className="panel report-low-stock">
                <div className="panel-heading"><div><h2>Movement detail</h2><p>{reportTransactions.length} transactions in the selected period.</p></div><button className="text-button" onClick={() => setScreen("transactions")}>Open full ledger <ArrowRight size={15} /></button></div>
                <TransactionTable rows={reportTransactions.slice(0, 10)} />
              </section>
            </>
          )}

          <footer className="page-footer"><span>© {new Date().getFullYear()} NexStock</span><span><span className="live-dot" /> Connected workspace</span></footer>
        </div>
      </main>
    </div>
  );
}

function PieChart({ rows }) {
  const palette = ["#4d956a", "#e6a23c", "#dc6262", "#7d83e8", "#4f9bc4", "#b078c8"];
  const values = rows.map((row) => Math.max(0, Number(row.value) || 0));
  const total = values.reduce((sum, value) => sum + value, 0);
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  if (!rows.length || total <= 0) {
    return <div className="chart-empty">Not enough recorded data to chart yet.</div>;
  }

  const segments = rows.map((row, index) => {
    const value = values[index];
    const segment = total > 0 ? (value / total) * circumference : 0;
    const currentOffset = offset;
    offset += segment;
    return { row, value, segment, currentOffset, color: palette[index % palette.length] };
  }).filter((segment) => segment.value > 0);

  return (
    <div className="pie3d-layout" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 24, flexWrap: "wrap", padding: "18px 20px 22px" }}>
      <div className="pie3d-wrap" style={{ width: 190, height: 190, flex: "0 0 190px", position: "relative" }}>
        <svg className="pie3d-svg" viewBox="0 0 100 108" role="img" aria-label="Inventory distribution pie chart" style={{ width: "100%", height: "100%", display: "block" }}>
          <defs>
            <radialGradient id="pie3dCenterGlow" cx="35%" cy="25%" r="80%">
              <stop offset="0%" stopColor="#172842" />
              <stop offset="100%" stopColor="#0b1424" />
            </radialGradient>
          </defs>
          {/* Lower duplicate ring, vertically offset to create an extruded 3D edge. */}
          <g className="pie3d-extrusion" transform="translate(0 5)" aria-hidden="true">
            <circle cx="50" cy="50" r={radius} fill="none" stroke="rgba(148,169,205,.16)" strokeWidth="13" />
            {segments.map(({ row, segment, currentOffset, color }) => (
              <circle key={`side-${row.label}`} cx="50" cy="50" r={radius} fill="none" stroke={color} strokeWidth="13"
                strokeDasharray={`${segment} ${circumference - segment}`} strokeDashoffset={-currentOffset}
                transform="rotate(-90 50 50)" strokeLinecap="butt" />
            ))}
          </g>
          {/* Top face */}
          <g className="pie3d-top">
            <circle cx="50" cy="50" r={radius} fill="none" stroke="rgba(148,169,205,.13)" strokeWidth="13" />
            {segments.map(({ row, segment, currentOffset, color }) => (
              <circle key={row.label} cx="50" cy="50" r={radius} fill="none" stroke={color} strokeWidth="13"
                strokeDasharray={`${segment} ${circumference - segment}`} strokeDashoffset={-currentOffset}
                transform="rotate(-90 50 50)" strokeLinecap="butt" />
            ))}
          </g>
          <circle cx="50" cy="50" r="30" fill="url(#pie3dCenterGlow)" stroke="rgba(82,229,255,.12)" strokeWidth=".6" />
          <text className="pie3d-center-total" x="50" y="48" textAnchor="middle">{total.toLocaleString("en-IN")}</text>
          <text className="pie3d-center-label" x="50" y="59" textAnchor="middle">Products</text>
        </svg>
      </div>
      <div className="pie3d-legend" style={{ display: "grid", gap: 13, minWidth: 145, flex: "1 1 145px" }}>
        {rows.map((row, index) => {
          const value = values[index];
          const percent = total ? Math.round((value / total) * 100) : 0;
          return (
            <div key={row.label} style={{ display: "grid", gridTemplateColumns: "10px minmax(0, 1fr) auto", alignItems: "center", gap: 9, fontSize: 13 }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: palette[index % palette.length], boxShadow: `0 0 12px ${palette[index % palette.length]}55` }} />
              <span style={{ color: "#c2d0e5", fontWeight: 500 }}>{row.label}</span>
              <strong style={{ color: "#f0f6ff", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{value.toLocaleString("en-IN")} <span style={{ fontWeight: 500, color: "#a9bddb" }}>({percent}%)</span></strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MiniBarChart({ rows, currency = false }) {
  const max = Math.max(1, ...rows.map((row) => Number(row.value) || 0));
  if (!rows.length || rows.every((row) => Number(row.value) === 0)) {
    return <div className="chart-empty">Not enough recorded data to chart yet.</div>;
  }
  return (
    <div className="mini-chart">
      {rows.map((row) => (
        <div className="chart-row" key={row.label}>
          <div className="chart-row-label" title={row.label}>{row.label}</div>
          <div className="chart-track"><div className={`chart-bar ${row.label.toLowerCase().includes("out") ? "chart-bar-out" : row.label.toLowerCase().includes("low") ? "chart-bar-low" : ""}`} style={{ width: `${Math.max(2, (Number(row.value) / max) * 100)}%` }} /></div>
          <div className="chart-value">{currency ? `₹${Number(row.value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : Number(row.value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</div>
        </div>
      ))}
    </div>
  );
}

function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function Metric({ label, value, icon, tone, detail }) {
  return (
    <div className="metric-card">
      <div className={`metric-icon ${tone}`}>{icon}</div>
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      <span className="metric-detail">{detail}</span>
    </div>
  );
}

function BusinessTable({ rows, onReview, loading }) {
  if (!rows.length) {
    return <div className="empty-state"><div className="empty-icon"><Building2 size={23} /></div><strong>No business registrations yet</strong><p>New business applications will appear here.</p></div>;
  }
  return (
    <div className="table-scroll">
      <table>
        <thead><tr><th>Business</th><th>Contact</th><th>Submitted</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.client_id}>
              <td><div className="table-primary">{row.business_name}</div><div className="table-secondary">ID #{row.client_id}</div></td>
              <td><div className="table-primary">{row.email}</div><div className="table-secondary">{row.phone || "No phone provided"}</div></td>
              <td>{row.created_at ? new Date(row.created_at).toLocaleDateString() : "—"}</td>
              <td><Status value={row.status} /></td>
              <td>
                <div className="row-actions">
                  {row.status === "PENDING" && <>
                    <button className="action-approve" disabled={loading} onClick={() => onReview(row.client_id, "APPROVED")} title="Approve"><CheckCircle2 size={16} /> Approve</button>
                    <button className="action-reject" disabled={loading} onClick={() => onReview(row.client_id, "REJECTED")} title="Reject"><XCircle size={16} /></button>
                  </>}
                  {row.status === "APPROVED" && <button className="action-reject" disabled={loading} onClick={() => onReview(row.client_id, "SUSPENDED")}>Suspend</button>}
                  {(row.status === "SUSPENDED" || row.status === "REJECTED") && <button className="action-approve" disabled={loading} onClick={() => onReview(row.client_id, "REACTIVATED")}>Reactivate</button>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProductTable({ rows, onEdit, onDelete, loading = false }) {
  if (!rows.length) {
    return <div className="empty-state"><div className="empty-icon"><Package size={23} /></div><strong>No products to display</strong><p>Add your first product to start managing stock.</p></div>;
  }
  return (
    <div className="table-scroll">
      <table>
        <thead><tr><th>Product</th><th>SKU</th><th>Category</th><th>Supplier</th><th>Unit price</th><th>Quantity</th><th>Reorder level</th><th>Stock status</th>{onEdit && <th>Actions</th>}</tr></thead>
        <tbody>
          {rows.map((product) => {
            const quantity = Number(product.quantity) || 0;
            const reorder = Number(product.reorder_level) || 0;
            const stockStatus = quantity <= 0 ? "OUT OF STOCK" : quantity <= reorder ? "LOW STOCK" : "IN STOCK";
            return (
              <tr key={product.product_id}>
                <td><div className="product-cell"><div className="product-mini"><Package size={17} /></div><div><div className="table-primary">{product.product_name}</div><div className="table-secondary">{product.description || "Inventory item"}</div></div></div></td>
                <td><span className="sku-tag">{product.sku}</span></td>
                <td>{product.category_name || "—"}</td>
                <td>{product.supplier_name || "—"}</td>
                <td>₹{Number(product.unit_price).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td><strong>{Number(product.quantity).toLocaleString("en-IN")}</strong> <span className="muted">{product.unit}</span></td>
                <td>{Number(product.reorder_level).toLocaleString("en-IN")}</td>
                <td><Status value={stockStatus} /></td>
                {onEdit && <td><div className="row-actions product-actions">
                  <button className="action-edit" disabled={loading} onClick={() => onEdit(product)} title="Edit product"><Pencil size={15} /></button>
                  <button className="action-reject" disabled={loading} onClick={() => onDelete(product)} title="Delete product"><Trash2 size={15} /></button>
                </div></td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TransactionTable({ rows }) {
  if (!rows.length) {
    return <div className="empty-state"><div className="empty-icon"><History size={23} /></div><strong>No stock transactions yet</strong><p>Stock-in and stock-out activity will appear here.</p></div>;
  }
  return (
    <div className="table-scroll">
      <table>
        <thead><tr><th>Date / time</th><th>Product</th><th>SKU</th><th>Movement</th><th>Quantity</th><th>Previous stock</th><th>New stock</th><th>Reason / reference</th><th>Recorded by</th></tr></thead>
        <tbody>{rows.map((row) => (
          <tr key={row.transaction_id}>
            <td>{row.created_at ? new Date(row.created_at).toLocaleString() : "—"}</td>
            <td><div className="table-primary">{row.product_name}</div><div className="table-secondary">Transaction #{row.transaction_id}</div></td>
            <td><span className="sku-tag">{row.sku}</span></td>
            <td><Status value={row.transaction_type === "IN" ? "STOCK IN" : "STOCK OUT"} /></td>
            <td><strong>{Number(row.quantity).toLocaleString("en-IN")}</strong></td>
            <td>{Number(row.previous_quantity).toLocaleString("en-IN")}</td>
            <td>{Number(row.new_quantity).toLocaleString("en-IN")}</td>
            <td>{row.reason || "—"}</td>
            <td>{row.created_by || "—"}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function CategoryTable({ rows, onEdit, onDelete, loading }) {
  if (!rows.length) {
    return <div className="empty-state"><div className="empty-icon"><Tags size={23} /></div><strong>No categories yet</strong><p>Create categories such as Electronics, Grocery, or Clothing.</p></div>;
  }
  return (
    <div className="table-scroll">
      <table>
        <thead><tr><th>Category</th><th>Description</th><th>Actions</th></tr></thead>
        <tbody>{rows.map((row) => (
          <tr key={row.category_id}>
            <td><div className="table-primary">{row.category_name}</div><div className="table-secondary">ID #{row.category_id}</div></td>
            <td>{row.description || "—"}</td>
            <td><div className="row-actions">
              <button className="action-approve" disabled={loading} onClick={() => onEdit(row)}><Pencil size={15} /> Edit</button>
              <button className="action-reject" disabled={loading} onClick={() => onDelete(row)} title="Delete category"><Trash2 size={15} /></button>
            </div></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function SupplierTable({ rows, onEdit, onDelete, loading }) {
  if (!rows.length) {
    return <div className="empty-state"><div className="empty-icon"><Truck size={23} /></div><strong>No suppliers yet</strong><p>Add your first supplier to keep contact information in one place.</p></div>;
  }
  return (
    <div className="table-scroll">
      <table>
        <thead><tr><th>Supplier</th><th>Contact person</th><th>Contact details</th><th>Address</th><th>Actions</th></tr></thead>
        <tbody>{rows.map((row) => (
          <tr key={row.supplier_id}>
            <td><div className="table-primary">{row.supplier_name}</div><div className="table-secondary">ID #{row.supplier_id}</div></td>
            <td>{row.contact_name || "—"}</td>
            <td><div className="table-primary">{row.email || "No email"}</div><div className="table-secondary">{row.phone || "No phone"}</div></td>
            <td>{row.address || "—"}</td>
            <td><div className="row-actions">
              <button className="action-approve" disabled={loading} onClick={() => onEdit(row)}><Pencil size={15} /> Edit</button>
              <button className="action-reject" disabled={loading} onClick={() => onDelete(row)} title="Delete supplier"><Trash2 size={15} /></button>
            </div></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function PurchaseOrderTable({ rows, loading, onReceive, onCancel }) {
  if (loading && !rows.length) {
    return <div className="empty-state"><div className="empty-icon"><ClipboardCheck size={23} /></div><strong>Loading purchase orders...</strong></div>;
  }
  if (!rows.length) {
    return <div className="empty-state"><div className="empty-icon"><ClipboardCheck size={23} /></div><strong>No purchase orders yet</strong><p>Create a purchase order to track incoming supplier deliveries.</p></div>;
  }
  return (
    <div className="table-scroll">
      <table>
        <thead><tr><th>Order</th><th>Supplier</th><th>Created</th><th>Expected</th><th>Items</th><th>Outstanding units</th><th>Order value</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>{rows.map((order) => (
          <tr key={order.purchase_order_id}>
            <td>
              <div className="table-primary">{order.order_number}</div>
              <div className="table-secondary">{order.notes || "Purchase order"}</div>
              {Array.isArray(order.items) && order.items.length > 0 && (
                <details className="po-line-details">
                  <summary>View order items</summary>
                  <div className="po-line-table">
                    <table><thead><tr><th>Product</th><th>Ordered</th><th>Received</th><th>Outstanding</th><th>Unit cost</th></tr></thead>
                      <tbody>{order.items.map((item) => <tr key={item.purchase_order_item_id}><td>{item.product_name}<small>{item.sku || "—"}</small></td><td>{Number(item.quantity_ordered).toLocaleString("en-IN")}</td><td>{Number(item.quantity_received).toLocaleString("en-IN")}</td><td>{Number(item.outstanding_quantity).toLocaleString("en-IN")}</td><td>₹{Number(item.unit_cost).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</td></tr>)}</tbody>
                    </table>
                  </div>
                </details>
              )}
            </td>
            <td>{order.supplier_name || "—"}</td>
            <td>{order.created_at ? new Date(order.created_at).toLocaleDateString("en-IN") : "—"}</td>
            <td>{order.expected_date ? new Date(order.expected_date).toLocaleDateString("en-IN") : "—"}</td>
            <td>{Number(order.item_count) || 0}</td>
            <td>{Number((order.items || []).reduce((sum, item) => sum + (Number(item.outstanding_quantity) || 0), 0)).toLocaleString("en-IN")}</td>
            <td>₹{Number(order.total_value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td><Status value={order.status} /></td>
            <td><div className="row-actions">
              {["ORDERED", "PARTIALLY_RECEIVED"].includes(order.status) && <button className="action-approve" disabled={loading} onClick={() => onReceive(order)} title="Receive remaining items"><ArrowDownToLine size={14} /> Receive</button>}
              {order.status === "ORDERED" && <button className="action-reject" disabled={loading} onClick={() => onCancel(order)} title="Cancel order"><X size={14} /></button>}
            </div></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function Status({ value }) {
  const cls = value === "APPROVED" || value === "IN STOCK" || value === "RECEIVED" ? "status-green"
    : value === "PENDING" || value === "LOW STOCK" || value === "ORDERED" || value === "PARTIALLY_RECEIVED" ? "status-amber"
    : value === "SUSPENDED" || value === "REJECTED" || value === "OUT OF STOCK" || value === "CANCELLED" ? "status-red" : "status-neutral";
  return <span className={`status-pill ${cls}`}><span />{value}</span>;
}

export default App;
