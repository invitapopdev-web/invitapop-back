// src/controllers/paymentController.js
const { supabaseAdmin } = require("../config/supabaseClient");
const Stripe = require("stripe");
const { env } = require("../config/env");

const stripe = new Stripe(env.STRIPE_SECRET_KEY);

/**
 * GET /payments
 */
async function getUserPayments(req, res, next) {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ error: "No autenticado" });

        const { data: payments, error } = await supabaseAdmin
            .from("invitation_purchases")
            .select("*")
            .eq("user_id", userId)
            .order("created_at", { ascending: false });

        if (error) {
            console.error("Error fetching payments:", error);
            return res.status(500).json({ error: "Error al obtener el historial de pagos" });
        }

        return res.json({ payments });
    } catch (err) {
        next(err);
    }
}

/**
 * POST /payments/request-invoice
 */
async function requestInvoice(req, res, next) {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ error: "No autenticado" });

        const { checkoutSessionId, billingDetails } = req.body || {};
        if (!checkoutSessionId || !billingDetails) {
            return res.status(400).json({ error: "Faltan datos de facturación o el ID de la sesión." });
        }

        const { name, email, taxId, address, city, postalCode, country } = billingDetails;

        if (!name || !address || !city || !postalCode || !country) {
            return res.status(400).json({ error: "Faltan campos de facturación obligatorios." });
        }

        // 1) Buscar compra y verificar ownership + que no exista factura
        const { data: purchase, error: purchaseError } = await supabaseAdmin
            .from("invitation_purchases")
            .select("*")
            .eq("checkout_session_id", checkoutSessionId)
            .eq("user_id", userId)
            .single();

        if (purchaseError || !purchase) {
            return res.status(404).json({ error: "Compra no encontrada o no autorizada." });
        }

        if (purchase.stripe_invoice_id) {
            return res.status(400).json({ error: "Esta transacción ya tiene una factura." });
        }

        // 2) Recuperar sesión de Stripe
        const session = await stripe.checkout.sessions.retrieve(checkoutSessionId, {
            expand: ["line_items"],
        });

        if (!session) {
            return res.status(404).json({ error: "Sesión de Stripe no encontrada." });
        }

        // 3) Determinar email (prioridad: modal -> session.customer_details -> session.customer_email)
        const sessionEmail = email || session.customer_details?.email || session.customer_email;

        if (!sessionEmail) {
            return res.status(400).json({ error: "No se pudo obtener el email del comprador para emitir la factura." });
        }

        // 4) Determinar customerId:
        //    - Si Checkout Session tiene customer => usarlo
        //    - Si no => buscar/crear customer por email (solo para facturas)
        let customerId = session.customer || null;

        if (!customerId) {
            const search = await stripe.customers.search({
                query: `email:'${sessionEmail.replace(/'/g, "\\'")}'`,
                limit: 1,
            });

            if (search.data.length > 0) {
                customerId = search.data[0].id;
            } else {
                const created = await stripe.customers.create({
                    email: sessionEmail,
                });
                customerId = created.id;
            }
        }

        // 5) Actualizar customer con datos del modal (mínimo viable)
        await stripe.customers.update(customerId, {
            name,
            email: sessionEmail,
            address: {
                line1: address,
                city,
                postal_code: postalCode,
                country,
            },
            ...(taxId ? { metadata: { tax_id: String(taxId) } } : {}),
        });

        // 6) Importe real del checkout (en céntimos)
        const amount = session.amount_total;
        const currency = session.currency;

        if (typeof amount !== "number" || amount <= 0 || !currency) {
            return res.status(400).json({ error: "No se pudo obtener el total del pago desde Stripe." });
        }

        // 7) Crear invoice primero (para poder asociar el item con invoice: invoice.id)
        const invoice = await stripe.invoices.create({
            customer: customerId,
            auto_advance: false,
            metadata: {
                checkout_session_id: checkoutSessionId,
            },
        });

        // 8) Crear InvoiceItem DENTRO de esa invoice (para que salga descripción/cantidad/precio)
        await stripe.invoiceItems.create({
            customer: customerId,
            invoice: invoice.id, // <- ahora sí existe
            currency,
            description: purchase.pack_name || "Pack de invitaciones",
            amount: amount, // precio total (céntimos), Stripe no usa unit_amount aquí directamente
            metadata: {
                checkout_session_id: checkoutSessionId,
            },
        });

        // 9) Finalizar
        const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id);

        // 10) Marcar pagada solo si no está pagada ya
        if (finalizedInvoice.status !== "paid") {
            await stripe.invoices.pay(finalizedInvoice.id, { paid_out_of_band: true });
        }

        // 11) Recuperar invoice final para hosted url
        const paidInvoice = await stripe.invoices.retrieve(finalizedInvoice.id);

        // 12) Guardar en BD
        const { error: updateError } = await supabaseAdmin
            .from("invitation_purchases")
            .update({
                stripe_invoice_id: paidInvoice.id,
                stripe_invoice_url: paidInvoice.hosted_invoice_url || null,
            })
            .eq("id", purchase.id);

        if (updateError) {
            console.error("[Invoice] Error actualizando BD:", updateError);
            return res.status(500).json({ error: "Factura generada, pero error guardando en base de datos." });
        }

        return res.json({
            stripe_invoice_id: paidInvoice.id,
            invoice_url: paidInvoice.hosted_invoice_url || null,
        });
    } catch (err) {
        console.error("[Invoice] Error solicitando factura:", {
            message: err?.raw?.message || err?.message,
            type: err?.raw?.type,
            code: err?.raw?.code,
            param: err?.raw?.param,
            requestId: err?.requestId,
        });
        return res.status(400).json({ error: err?.raw?.message || err?.message || "Error solicitando factura" });
    }
}

module.exports = { getUserPayments, requestInvoice };