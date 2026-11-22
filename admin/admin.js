(() => {
  const $ = (id) => document.getElementById(id);
  let csrf = "";
  let orders = [];
  let searchTerm = "";
  let statusHistory = [];
  const money = (n) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(n / 100);
  const escapeHtml = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const statusNames = {
    awaiting_payment: "Aguardando pagamento",
    payment_setup_error: "Pagamento pendente · finalizar pelo WhatsApp",
    awaiting_owner_approval: "Aguardando aprovação",
    test_paid: "Teste pago · sem compra",
    supplier_setup_required: "Configuração do fornecedor",
    processing_supplier: "Processando fornecedor",
    supplier_ordered: "Compra registrada",
    shipped: "Enviado",
    delivered: "Entregue",
    rejected: "Rejeitado",
  };
  async function api(url, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };
    if (options.method && options.method !== "GET")
      headers["X-CSRF-Token"] = csrf;
    const r = await fetch(url, {
      ...options,
      headers,
      cache: "no-store",
      credentials: "same-origin",
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || "Falha na operação");
    return data;
  }
  function toast(msg) {
    $("toast").textContent = msg;
    $("toast").style.display = "block";
    setTimeout(() => ($("toast").style.display = "none"), 5000);
  }
  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("login-error").textContent = "";
    try {
      const d = await api("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ password: $("password").value }),
      });
      csrf = d.csrfToken;
      showDashboard();
      await load();
    } catch (err) {
      $("login-error").textContent = err.message;
    }
  });
  function showDashboard() {
    $("login-view").hidden = true;
    $("dashboard").hidden = false;
    $("logout").hidden = false;
  }
  async function session() {
    try {
      const d = await api("/api/admin/session");
      csrf = d.csrfToken;
      showDashboard();
      await load();
    } catch (_) { }
  }
  async function load() {
    const d = await api("/api/admin/orders");
    orders = d.orders;
    statusHistory = d.history || [];
    renderOrders();
    renderAudit(d.audit);
    const count = (s) => orders.filter((o) => o.status === s).length;
    $("stat-total").textContent = orders.length;
    $("stat-payment").textContent = count("awaiting_payment");
    $("stat-approval").textContent = count("awaiting_owner_approval");
    $("stat-sent").textContent = orders.filter((o) =>
      ["supplier_ordered", "shipped"].includes(o.status),
    ).length;
    await loadSuppliers();
    await loadSupplierProducts();
    await loadMetrics();
    await loadReconciliation();
  }
  async function loadMetrics() {
    const [m, b] = await Promise.all([
      api("/api/admin/metrics"),
      api("/api/admin/backups"),
    ]);
    $("metric-gross").textContent = money(m.metrics.gross || 0);
    $("metric-paid").textContent = money(m.metrics.paid || 0);
    $("metric-margin").textContent =
      m.metrics.estimated_margin == null
        ? "Sem custo aprovado"
        : money(m.metrics.estimated_margin);
    if ($("metric-awaiting-finance"))
      $("metric-awaiting-finance").textContent = money(
        m.metrics.awaiting_finance || 0,
      );
    if ($("metric-refunded"))
      $("metric-refunded").textContent = money(m.metrics.refunded || 0);
    if ($("metric-awaiting-purchase"))
      $("metric-awaiting-purchase").textContent =
        m.metrics.awaiting_purchase || 0;
    $("backup-count").textContent = b.backups.length;
    const stamp = $("last-dashboard-update");
    if (stamp) stamp.textContent = new Date().toLocaleTimeString("pt-BR");
  }
  async function loadReconciliation() {
    const d = await api("/api/admin/reconciliation");
    $("reconciliation").innerHTML =
      d.orders
        .map(
          (o) =>
            `<div><b>${escapeHtml(o.id)}</b> · ${money(o.total)} · ${escapeHtml(o.payment_provider || "sem gateway")} · ${escapeHtml(o.payment_status)} · ${Number(o.event_count)} evento(s) · último: ${escapeHtml(o.last_event || "sem notificação")}${o.last_event_at ? ` (${new Date(o.last_event_at).toLocaleString("pt-BR")})` : ""}</div>`,
        )
        .join("") || '<p class="empty">Sem pagamentos para conciliar.</p>';
  }
  async function loadSuppliers() {
    const d = await api("/api/admin/suppliers");
    $("suppliers").innerHTML = d.suppliers
      .map(
        (s) =>
          `<article class="supplier"><strong>${escapeHtml(s.name)}</strong><small>${s.credentialsPresent ? "Credenciais presentes — falta validar escopo" : "Aguardando credenciais e autorização"}</small><br><span class="status">${s.status === "not_configured" ? "Não conectado" : "Não validado"}</span>${s.docs ? `<p><a target="_blank" rel="noopener" href="${escapeHtml(s.docs)}">Documentação oficial ↗</a></p>` : ""}</article>`,
      )
      .join("");
  }
  const supplierLabels = {
    shopee: "Shopee",
    aliexpress: "AliExpress",
    mercadolivre: "Mercado Livre",
    other: "Outro fornecedor",
  };
  async function loadSupplierProducts() {
    const d = await api("/api/admin/supplier-products");
    $("supplier-products").innerHTML =
      d.products
        .map(
          (p) => `
        <article class="supplier-product">
          <div class="supplier-product-main">
            <strong>${escapeHtml(p.supplier_title || "Produto vinculado")}</strong>
            <small>${escapeHtml(p.product_id)} · ${escapeHtml(supplierLabels[p.supplier] || p.supplier)} · ${escapeHtml(p.supplier_item_id)}</small>
            <span class="status">${p.status === "approved" ? "Aprovado" : p.status === "rejected" ? "Rejeitado" : "Aguardando conferência"}</span>
            <a href="${escapeHtml(p.supplier_url)}" target="_blank" rel="noopener">Abrir produto na loja ↗</a>
            <small>Custo cadastrado: ${p.supplier_cost == null ? "não informado" : money(p.supplier_cost)} · Prazo: ${p.estimated_delivery_days ? `${p.estimated_delivery_days} dias` : "não informado"}</small>
            <small>Condições: ${escapeHtml(p.conditions || "não informadas")}</small>
            ${p.costHistory?.length ? `<small>Histórico de custos: ${p.costHistory.map((h) => `${money(h.new_cost)} (${new Date(h.changed_at).toLocaleDateString("pt-BR")})`).join(" · ")}</small>` : ""}
          </div>
          <div class="supplier-product-actions">
            ${p.status !== "approved" ? `<button type="button" class="approve" data-product-action="review" data-id="${p.id}">Conferir e aprovar</button>` : ""}
            ${p.status !== "rejected" ? `<button type="button" class="danger" data-product-action="reject-review" data-id="${p.id}">Rejeitar vínculo</button>` : ""}
            <button type="button" data-product-action="edit" data-id="${p.id}">Editar</button>
            <button type="button" class="danger" data-product-action="delete" data-id="${p.id}">Apagar</button>
          </div>
        </article>`,
        )
        .join("") || '<p class="empty">Nenhum produto vinculado.</p>';
    $("supplier-products").dataset.items = JSON.stringify(d.products);
  }
  function resetSupplierProductForm() {
    $("supplier-product-form").reset();
    $("supplier-product-edit-id").value = "";
    $("supplier-product-submit").textContent = "Vincular produto";
    $("supplier-product-cancel").hidden = true;
    $("supplier-product-message").textContent = "";
  }
  $("supplier-product-cancel").addEventListener(
    "click",
    resetSupplierProductForm,
  );
  $("supplier-products").addEventListener("click", async (e) => {
    const button = e.target.closest("[data-product-action]");
    if (!button) return;
    const id = Number(button.dataset.id);
    const items = JSON.parse($("supplier-products").dataset.items || "[]");
    const product = items.find((item) => Number(item.id) === id);
    if (!product) return;
    if (
      button.dataset.productAction === "review" ||
      button.dataset.productAction === "reject-review"
    ) {
      const approve = button.dataset.productAction === "review";
      let supplierCost = null;
      if (approve) {
        const entered = prompt(
          "Informe o custo total atual do fornecedor em reais (ex.: 607,99):",
        );
        if (entered === null) return;
        const normalized = entered.trim().replace(/\\./g, "").replace(",", ".");
        const value = Number(normalized);
        if (!Number.isFinite(value) || value <= 0) {
          toast("Informe um custo válido.");
          return;
        }
        supplierCost = Math.round(value * 100);
      }
      const note =
        prompt(
          approve
            ? "Observação da conferência (opcional):"
            : "Motivo da rejeição (opcional):",
          "",
        ) || "";
      try {
        const result = await api(`/api/admin/supplier-products/${id}/review`, {
          method: "POST",
          body: JSON.stringify({
            decision: approve ? "approved" : "rejected",
            supplierCost,
            note,
          }),
        });
        toast(result.message);
        await loadSupplierProducts();
      } catch (err) {
        toast(err.message);
      }
      return;
    }
    if (button.dataset.productAction === "edit") {
      $("supplier-product-edit-id").value = String(product.id);
      $("linked-product").value = product.product_id;
      $("supplier-store").value = product.supplier;
      $("supplier-product-url").value = product.supplier_url;
      $("supplier-product-title").value = product.supplier_title || "";
      $("supplier-delivery-days").value = product.estimated_delivery_days || "";
      $("supplier-conditions").value = product.conditions || "";
      $("supplier-product-submit").textContent = "Salvar alterações";
      $("supplier-product-cancel").hidden = false;
      $("supplier-product-message").textContent =
        "Ao salvar, o vínculo voltará para Aguardando conferência.";
      $("supplier-product-form").scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      return;
    }
    if (
      !confirm(
        `Apagar o vínculo "${product.supplier_title || product.supplier_item_id}"?`,
      )
    )
      return;
    try {
      const result = await api(`/api/admin/supplier-products/${id}`, {
        method: "DELETE",
        body: "{}",
      });
      toast(result.message);
      await loadSupplierProducts();
    } catch (err) {
      toast(err.message);
    }
  });
  $("supplier-product-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("supplier-product-message");
    msg.textContent = "";
    const editId = $("supplier-product-edit-id").value;
    const payload = {
      productId: $("linked-product").value,
      supplier: $("supplier-store").value,
      url: $("supplier-product-url").value,
      title: $("supplier-product-title").value,
      deliveryDays: $("supplier-delivery-days").value,
      conditions: $("supplier-conditions").value,
    };
    try {
      const d = await api(
        editId
          ? `/api/admin/supplier-products/${editId}`
          : "/api/admin/supplier-products",
        {
          method: editId ? "PUT" : "POST",
          body: JSON.stringify(payload),
        },
      );
      msg.textContent = d.message;
      resetSupplierProductForm();
      await loadSupplierProducts();
      toast(d.message);
    } catch (err) {
      msg.textContent = err.message;
    }
  });
  function renderOrders() {
    const filter = $("filter").value;
    const product = $("product-filter").value;
    const from = $("date-from").value
      ? new Date($("date-from").value + "T00:00:00").getTime()
      : 0;
    const to = $("date-to").value
      ? new Date($("date-to").value + "T23:59:59").getTime()
      : Infinity;
    const list = orders.filter((o) => {
      const created = new Date(o.created_at).getTime();
      return (
        (filter === "all" || o.status === filter) &&
        (product === "all" || o.product_id === product) &&
        created >= from &&
        created <= to &&
        (!searchTerm ||
          [o.id, o.customer_name, o.email].some((v) =>
            String(v || "")
              .toLowerCase()
              .includes(searchTerm),
          ))
      );
    });
    if (!list.length) {
      $("orders").innerHTML =
        '<p class="empty">Nenhum pedido neste filtro.</p>';
      return;
    }
    const paymentLabels = {
      pending: "Pendente",
      under_review: "Em análise",
      paid: "Confirmado",
      declined: "Recusado",
      expired: "Expirado",
      refunded: "Estornado",
    };
    const stageOptions = [
      ["awaiting_payment", "Aguardando pagamento"],
      ["payment_setup_error", "Pix não gerado · atendimento WhatsApp"],
      ["test_paid", "Pagamento de teste confirmado"],
      ["awaiting_owner_approval", "Pagamento confirmado · análise da loja"],
      ["processing_supplier", "Processando compra"],
      ["supplier_setup_required", "Aguardando compra"],
      ["supplier_ordered", "Compra realizada"],
      ["shipped", "Pedido enviado"],
      ["delivered", "Pedido entregue"],
      ["rejected", "Cancelado / rejeitado"],
    ];
    $("orders").innerHTML = list
      .map((o) => {
        const stageSelect = stageOptions
          .map(
            ([value, label]) =>
              `<option value="${value}" ${o.status === value ? "selected" : ""}>${label}</option>`,
          )
          .join("");
        const receipt = o.payment_receipt_url
          ? `<a href="/api/admin/orders/${encodeURIComponent(o.id)}/payment-receipt" target="_blank" rel="noopener">Visualizar comprovante ↗</a>`
          : "Não anexado";
        return `<article class="order">
        <div class="order-top"><div><h3>${escapeHtml(o.id)} · ${escapeHtml(o.customer_name)}</h3><p>${new Date(o.created_at).toLocaleString("pt-BR")} · ${escapeHtml(o.email)}</p></div><span class="tag">${o.is_test ? "TESTE · R$ 0,01" : escapeHtml(statusNames[o.status] || o.status)}</span></div>
        <div class="order-grid">
          <div>Produto (Kronix)<b>${money(o.product_subtotal || o.unit_price * o.quantity)}</b></div><div>Frete internacional<b>${money(o.supplier_freight || 0)}</b></div><div>Imposto de Importação<b>${money(o.import_tax || 0)}</b></div><div>ICMS (${Number(o.tax_rate || 0)}%)<b>${money(o.icms_tax || 0)}</b></div><div>Total do pedido<b>${money(o.total)}</b></div>
          <div class="payment-status-editor"><span>CONTROLE FINANCEIRO</span><b><select data-action="payment-status" data-id="${escapeHtml(o.id)}" aria-label="Status financeiro" ${o.is_test ? "disabled" : ""}>${Object.entries(
          paymentLabels,
        )
            .map(
              ([v, l]) =>
                `<option value="${v}" ${o.payment_status === v ? "selected" : ""}>${l}</option>`,
            )
            .join(
              "",
            )}</select></b><small>Independente da etapa de compra e entrega.</small></div>
          <div>Comprovante de pagamento<b>${receipt}<input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" data-action="payment-receipt" data-id="${escapeHtml(o.id)}"><small>PNG, JPG, WEBP ou PDF · até 5 MB</small></b></div>
          <div>Telefone<b>${escapeHtml(o.phone || "—")}</b></div><div>Plataforma<b>${escapeHtml(o.platform || "—")}</b></div><div>Endereço<b>${escapeHtml(o.postal_code)} · ${escapeHtml(o.street)}, ${escapeHtml(o.street_number)} ${escapeHtml(o.complement)}</b></div><div>Bairro / cidade<b>${escapeHtml(o.neighborhood)} · ${escapeHtml(o.city)}/${escapeHtml(o.state)}</b></div><div>Observações<b>${escapeHtml(o.notes || "—")}</b></div>
          <div class="supplier-reference-editor"><span>Fornecedor e referência da compra</span><label class="sr-only" for="supplier-choice-${escapeHtml(o.id)}">Fornecedor</label><select id="supplier-choice-${escapeHtml(o.id)}"><option value="">Selecione o fornecedor</option><option value="shopee" ${o.supplier === "shopee" ? "selected" : ""}>Shopee</option><option value="aliexpress" ${o.supplier === "aliexpress" ? "selected" : ""}>AliExpress</option><option value="mercadolivre" ${o.supplier === "mercadolivre" ? "selected" : ""}>Mercado Livre</option><option value="other" ${o.supplier === "other" ? "selected" : ""}>Outro fornecedor</option></select><label class="sr-only" for="supplier-reference-${escapeHtml(o.id)}">Referência do pedido no fornecedor</label><input id="supplier-reference-${escapeHtml(o.id)}" type="text" maxlength="120" value="${escapeHtml(o.supplier_order_id || "")}" placeholder="Número / referência da compra"><button type="button" data-action="supplier-reference-save" data-id="${escapeHtml(o.id)}">Salvar fornecedor e referência</button></div>
          <div class="workflow-editor"><span>ETAPA DO PEDIDO</span><small>Altere a etapa operacional. O pagamento é controlado separadamente.</small><select id="workflow-stage-${escapeHtml(o.id)}" data-order-stage="true" data-id="${escapeHtml(o.id)}" ${o.is_test ? "disabled" : ""}>${stageSelect}</select><label for="tracking-code-${escapeHtml(o.id)}">Código de rastreamento</label><input type="text" id="tracking-code-${escapeHtml(o.id)}" value="${escapeHtml(o.tracking_code || "")}" placeholder="Obrigatório para marcar como enviado"><label for="delivery-date-${escapeHtml(o.id)}">Previsão de entrega</label><input type="date" id="delivery-date-${escapeHtml(o.id)}" value="${escapeHtml(o.expected_delivery_date || "")}"><button type="button" data-action="workflow-save" data-id="${escapeHtml(o.id)}" ${o.is_test ? "disabled" : ""}>Salvar etapa e logística</button></div>
          <div>Comprovante da compra no fornecedor<b>${o.supplier_receipt_url ? `<a href="${escapeHtml(o.supplier_receipt_url)}" target="_blank" rel="noopener">Abrir comprovante ↗</a>` : "Não anexado"}</b></div>
        </div>
        ${o.rejection_reason ? `<p>Motivo: ${escapeHtml(o.rejection_reason)}</p>` : ""}
        <details><summary>Histórico completo</summary>${statusHistory
            .filter((h) => h.order_id === o.id)
            .map(
              (h) =>
                `<p>${escapeHtml(h.old_status || "inicial")} → <b>${escapeHtml(h.new_status)}</b> · Financeiro: ${escapeHtml(h.old_payment_status || "—")} → ${escapeHtml(h.new_payment_status || "—")} · ${new Date(h.changed_at).toLocaleString("pt-BR")}</p>`,
            )
            .join("") || "Sem alterações registradas."
          }</details>
        <div class="actions">${o.is_test && o.status === "awaiting_payment" ? `<button data-action="confirm-test-payment" data-id="${escapeHtml(o.id)}">Confirmar Pix de teste</button>` : ""}${o.status === "awaiting_owner_approval" ? `<button class="approve" data-action="approve" data-id="${escapeHtml(o.id)}">Registrar compra via integração</button><button class="danger" data-action="reject" data-id="${escapeHtml(o.id)}">Rejeitar</button>` : ""}${o.status === "supplier_setup_required" && o.payment_status === "paid" ? `<button data-action="manual" data-id="${escapeHtml(o.id)}">Registrar compra manual</button>` : ""}<button class="danger" data-action="delete-order" data-id="${escapeHtml(o.id)}">Excluir pedido</button></div>
      </article>`;
      })
      .join("");
  }
  function renderAudit(items) {
    $("audit").innerHTML =
      items
        .map(
          (a) =>
            `<div><b>${escapeHtml(a.action)}</b> · ${escapeHtml(a.order_id || "Sistema")} · ${new Date(a.created_at).toLocaleString("pt-BR")}<br>${escapeHtml(a.details)}</div>`,
        )
        .join("") || '<p class="empty">Sem atividades.</p>';
  }
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-action]");
    if (!b || b.matches("select")) return;
    const id = b.dataset.id,
      act = b.dataset.action;
    try {
      if (act === "delete-order") {
        if (
          !confirm(
            "Excluir definitivamente este pedido e seus registros financeiros e de histórico? Esta ação não pode ser desfeita.",
          )
        )
          return;
        const confirmation = prompt("Digite EXCLUIR PEDIDO para confirmar:");
        if (confirmation !== "EXCLUIR PEDIDO") {
          toast("Exclusão cancelada.");
          return;
        }
        const result = await api(
          `/api/admin/orders/${encodeURIComponent(id)}`,
          { method: "DELETE", body: JSON.stringify({ confirmation }) },
        );
        toast(result.message || "Pedido excluído.");
      }
      if (act === "confirm-test-payment") {
        if (
          !confirm(
            "Confirma que o crédito real de R$ 0,01 apareceu na conta Pix da Kronix? Esta ação é exclusiva para o pedido de teste.",
          )
        )
          return;
        await api(`/api/admin/orders/${id}/confirm-test-payment`, {
          method: "POST",
          body: "{}",
        });
      }
      if (act === "paid") {
        if (
          !confirm(
            "Confirma que verificou o recebimento no banco/provedor de pagamento?",
          )
        )
          return;
        await api(`/api/admin/orders/${id}/mark-paid`, {
          method: "POST",
          body: "{}",
        });
      }
      if (act === "approve") {
        const supplier = prompt(
          "Fornecedor escolhido (shopee, aliexpress, mercadolivre ou other):",
          "aliexpress",
        );
        if (!supplier) return;
        const supplierOrderId = prompt(
          "Depois de realizar a compra manualmente no fornecedor, informe o número do pedido externo:",
        );
        if (!supplierOrderId) return;
        const receiptUrl =
          prompt("Link HTTPS do comprovante (opcional):", "") || "";
        const expectedDeliveryDate =
          prompt("Data estimada de entrega (AAAA-MM-DD, opcional):", "") || "";
        const d = await api(`/api/admin/orders/${id}/manual-supplier`, {
          method: "POST",
          body: JSON.stringify({
            supplier,
            supplierOrderId,
            receiptUrl,
            expectedDeliveryDate,
          }),
        });
        toast(d.message || "Compra manual registrada.");
      }
      if (act === "reject") {
        const reason = prompt("Motivo da rejeição (opcional):", "");
        await api(`/api/admin/orders/${id}/reject`, {
          method: "POST",
          body: JSON.stringify({ reason: reason || "" }),
        });
      }
      if (act === "manual") {
        const supplier = prompt(
          "Fornecedor usado (shopee, aliexpress, mercadolivre ou other):",
          "aliexpress",
        );
        if (!supplier) return;
        const supplierOrderId = prompt(
          "Número/identificador do pedido realizado na plataforma:",
        );
        if (!supplierOrderId) return;
        const receiptUrl =
          prompt("Link HTTPS do comprovante (opcional):", "") || "";
        const expectedDeliveryDate =
          prompt("Data estimada de entrega (AAAA-MM-DD, opcional):", "") || "";
        await api(`/api/admin/orders/${id}/manual-supplier`, {
          method: "POST",
          body: JSON.stringify({
            supplier,
            supplierOrderId,
            receiptUrl,
            expectedDeliveryDate,
          }),
        });
      }
      if (act === "workflow-save") {
        const stage =
          document.getElementById(`workflow-stage-${id}`)?.value || "";
        const trackingCode =
          document.getElementById(`tracking-code-${id}`)?.value.trim() || "";
        const expectedDeliveryDate =
          document.getElementById(`delivery-date-${id}`)?.value || "";
        const result = await api(
          `/api/admin/orders/${encodeURIComponent(id)}/workflow`,
          {
            method: "POST",
            body: JSON.stringify({ stage, trackingCode, expectedDeliveryDate }),
          },
        );
        toast(result.message || "Etapa operacional atualizada.");
      }
      if (act === "supplier-reference-save") {
        const supplier =
          document.getElementById(`supplier-choice-${id}`)?.value || "";
        const supplierOrderId =
          document.getElementById(`supplier-reference-${id}`)?.value.trim() ||
          "";
        const result = await api(
          `/api/admin/orders/${encodeURIComponent(id)}/supplier-reference`,
          {
            method: "POST",
            body: JSON.stringify({ supplier, supplierOrderId }),
          },
        );
        toast(result.message || "Fornecedor e referência atualizados.");
      }
      if (act === "tracking-save") {
        const trackingCode = document
          .getElementById(`tracking-code-${id}`)
          ?.value.trim();
        if (!trackingCode) {
          toast("Informe o código de rastreamento.");
          return;
        }
        const result = await api(`/api/admin/orders/${id}/tracking`, {
          method: "POST",
          body: JSON.stringify({ trackingCode }),
        });
        toast(result.message || "Rastreamento salvo.");
      }
      if (act === "delivery-save") {
        const expectedDeliveryDate =
          document.getElementById(`delivery-date-${id}`)?.value || "";
        const result = await api(`/api/admin/orders/${id}/delivery-estimate`, {
          method: "POST",
          body: JSON.stringify({ expectedDeliveryDate }),
        });
        toast(result.message || "Previsão atualizada.");
      }
      if (act === "delivered") {
        if (!confirm("Confirma que o cliente recebeu o pedido?")) return;
        await api(`/api/admin/orders/${id}/delivered`, {
          method: "POST",
          body: "{}",
        });
      }
      await load();
    } catch (err) {
      toast(err.message);
      await load();
    }
  });
  document.addEventListener("change", async (e) => {
    const select = e.target.closest('select[data-action="payment-status"]');
    if (!select) return;
    if (select.dataset.action === "payment-status") {
      try {
        const result = await api(
          `/api/admin/orders/${encodeURIComponent(select.dataset.id)}/payment-status`,
          {
            method: "POST",
            body: JSON.stringify({ paymentStatus: select.value }),
          },
        );
        toast(result.message);
        await load();
      } catch (err) {
        toast(err.message);
        await load();
      }
      return;
    }
  });
  document.addEventListener("change", async (e) => {
    const input = e.target.closest(
      'input[type="file"][data-action="payment-receipt"]',
    );
    if (!input || !input.files?.[0]) return;
    const file = input.files[0];
    if (file.size > 5 * 1024 * 1024) {
      toast("O comprovante deve ter no máximo 5 MB.");
      input.value = "";
      return;
    }
    const allowed = [
      "image/png",
      "image/jpeg",
      "image/webp",
      "application/pdf",
    ];
    if (!allowed.includes(file.type)) {
      toast("Formato inválido. Use PNG, JPG, WEBP ou PDF.");
      input.value = "";
      return;
    }
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () =>
          reject(new Error("Não foi possível ler o arquivo."));
        reader.readAsDataURL(file);
      });
      const result = await api(
        `/api/admin/orders/${encodeURIComponent(input.dataset.id)}/payment-receipt`,
        { method: "POST", body: JSON.stringify({ dataUrl }) },
      );
      toast(result.message);
      await load();
    } catch (err) {
      toast(err.message);
      input.value = "";
    }
  });
  $("refresh").addEventListener("click", () =>
    load().catch((e) => toast(e.message)),
  );
  $("filter").addEventListener("change", renderOrders);
  $("order-search").addEventListener("input", (e) => {
    searchTerm = e.target.value.trim().toLowerCase();
    renderOrders();
  });
  ["product-filter", "date-from", "date-to"].forEach((id) =>
    $(id).addEventListener("change", renderOrders),
  );
  $("create-backup").addEventListener("click", async () => {
    const el = $("backup-message");
    el.textContent = "Criando cópia consistente do banco…";
    try {
      const r = await api("/api/admin/backups", { method: "POST", body: "{}" });
      el.textContent = `Backup criado: ${r.fileName} (${Math.round(r.sizeBytes / 1024)} KB).`;
      await loadMetrics();
    } catch (e) {
      el.textContent = e.message;
    }
  });
  $("clear-orders").addEventListener("click", async () => {
    const first = confirm(
      "Isso apagará somente pedidos de teste. Pedidos reais serão preservados. Deseja continuar?",
    );
    if (!first) return;
    const confirmation = prompt(
      "Para confirmar a limpeza dos pedidos de teste, digite exatamente: LIMPAR PEDIDOS",
    );
    if (confirmation !== "LIMPAR PEDIDOS") {
      toast("Limpeza cancelada. A confirmação não corresponde.");
      return;
    }
    try {
      const result = await api("/api/admin/orders", {
        method: "DELETE",
        body: JSON.stringify({ confirmation }),
      });
      toast(result.message);
      await load();
    } catch (err) {
      toast(err.message);
    }
  });
  $("logout").addEventListener("click", async () => {
    try {
      await api("/api/admin/logout", { method: "POST", body: "{}" });
    } catch (_) { }
    location.reload();
  });
  session();
  let refreshInProgress = false;
  setInterval(async () => {
    if (document.hidden || $("dashboard").hidden || refreshInProgress) return;
    refreshInProgress = true;
    try {
      await load();
      const stamp = $("last-dashboard-update");
      if (stamp) stamp.textContent = new Date().toLocaleTimeString("pt-BR");
    } catch (err) {
      console.warn("Atualização automática do painel:", err.message);
    } finally {
      refreshInProgress = false;
    }
  }, 15000);
})();
