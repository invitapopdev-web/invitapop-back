// src/controllers/stripeController.js
const Stripe = require("stripe");
const { env } = require("../config/env");
const { supabaseAdmin } = require("../config/supabaseClient");

const stripe = new Stripe(env.STRIPE_SECRET_KEY);

const getProducts = async (req, res) => {
    try {
        const products = await stripe.products.list({
            active: true,
            expand: ["data.default_price"],
        });

        const formattedProducts = products.data.map((product) => {
            const price = product.default_price;
            return {
                id: product.id,
                name: product.name,
                description: product.description,
                image: product.images?.[0] || null,
                priceId: price ? price.id : null,
                amount: price ? price.unit_amount / 100 : 0,
                currency: price ? price.currency : "eur",
                metadata: product.metadata,
            };
        });

        return res.json(formattedProducts);
    } catch (error) {
        console.error("Error fetching products from Stripe:", error);
        return res.status(500).json({ error: "Error al obtener productos de Stripe" });
    }
};

const createCheckoutSession = async (req, res) => {
    try {
        const { priceId, eventId, targetMaxGuests, publishAfterPayment } = req.body;
        const userId = req.user.id;

        if (!priceId) return res.status(400).json({ error: "Missing priceId" });

        const price = await stripe.prices.retrieve(priceId, { expand: ["product"] });
        const product = price.product;

        const metadata = {
            userId: String(userId || ""),
            productType: String(product?.metadata?.type || "standard"),
            invitations: String(product?.metadata?.invitations || "0"),
            packName: String(product?.name || ""),
            eventId: eventId ? String(eventId) : "",
            targetMaxGuests: targetMaxGuests ? String(targetMaxGuests) : "",
            publishAfterPayment: publishAfterPayment ? "true" : "false",
        };

        const successUrl = `${env.FRONTEND_PUBLIC_URL}/dashboard/events/${eventId}?payment=success&session_id={CHECKOUT_SESSION_ID}`;
        const cancelUrl = `${env.FRONTEND_PUBLIC_URL}/dashboard/events/${eventId}?payment=cancel`;

        // 1) Crear la session primero
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: [{ price: priceId, quantity: 1 }],
            mode: "payment",
            success_url: successUrl,
            cancel_url: cancelUrl,
            metadata,
            payment_intent_data: { metadata },
        });

        // 2) Si éxito, marcar como pending
        if (eventId) {
            const { data: ev } = await supabaseAdmin
                .from("events")
                .select("status")
                .eq("id", eventId)
                .maybeSingle();

            if (ev?.status === "draft") {
                await supabaseAdmin
                    .from("events")
                    .update({ status: "pending", updated_at: new Date().toISOString() })
                    .eq("id", eventId);
            }
        }

        return res.json({ url: session.url });
    } catch (error) {
        console.error("Error creating stripe checkout session:", error);
        return res.status(500).json({ error: "Error al crear la sesión de pago" });
    }
};

/**
 * finalizePurchase(session, stripeEventId)
 * Flujo: Registrar Compra -> Actualizar Balance -> Actualizar Evento
 */
const finalizePurchase = async (session, stripeEventId = null) => {
    const sessionId = session?.id;
    const meta = session?.metadata || {};
    const { userId, productType, invitations, packName, eventId, targetMaxGuests, publishAfterPayment } = meta;
    const quantity = parseInt(invitations, 10) || 0;

    console.log(`[Stripe Webhook] Iniciando procesamiento: ${sessionId}`);

    if (!sessionId || !userId || !productType) {
        throw new Error("Missing critical metadata in Stripe session");
    }

    // 1) Registrar la compra (IDEMPOTENTE por DB constraint)
    const { data: inserted, error: insertError } = await supabaseAdmin
        .from("invitation_purchases")
        .upsert({
            user_id: userId,
            pack_name: packName || null,
            quantity,
            price: (session.amount_total || 0) / 100,
            currency: session.currency || "eur",
            payment_status: "paid",
            checkout_session_id: sessionId,
            stripe_event_id: stripeEventId || sessionId,
            product_type: productType,
            unit_type: "invitation",
        }, {
            onConflict: "checkout_session_id",
            ignoreDuplicates: true
        })
        .select("id");

    if (insertError) throw insertError;

    // Si no se insertó nada nuevo, es que ya estaba procesado
    if (!inserted || inserted.length === 0) {
        console.log(`[Stripe Webhook] Sesión ya procesada anteriormente: ${sessionId}`);
        return { ok: true, alreadyProcessed: true };
    }

    // 2) Actualizar Balance
    const { data: balance, error: fetchError } = await supabaseAdmin
        .from("invitation_balances")
        .select("id, total_purchased")
        .eq("user_id", userId)
        .eq("product_type", productType)
        .maybeSingle();

    if (fetchError) throw fetchError;

    if (balance) {
        const { error: updErr } = await supabaseAdmin
            .from("invitation_balances")
            .update({
                total_purchased: (Number(balance.total_purchased) || 0) + quantity,
                updated_at: new Date().toISOString(),
            })
            .eq("id", balance.id);
        if (updErr) throw updErr;
    } else {
        const { error: insErr } = await supabaseAdmin
            .from("invitation_balances")
            .insert({
                user_id: userId,
                product_type: productType,
                total_purchased: quantity,
                total_used: 0,
                updated_at: new Date().toISOString(),
            });
        if (insErr) throw insErr;
    }

    // 3) Actualizar Evento
    if (eventId && eventId !== "null") {
        const patch = { updated_at: new Date().toISOString() };

        const newMax = parseInt(targetMaxGuests, 10);
        if (!isNaN(newMax)) patch.max_guests = newMax;

        if (publishAfterPayment === "true") {
            patch.status = "published";
        }

        const { error: evErr } = await supabaseAdmin
            .from("events")
            .update(patch)
            .match({ id: eventId, user_id: userId });

        if (evErr) {
            console.error(`[Stripe Webhook] Error actualizando evento ${eventId}:`, evErr);
        }
    }

    console.log(`[Stripe Webhook] Compra finalizada con éxito: ${sessionId}`);
    return { ok: true, alreadyProcessed: false };
};

const verifyCheckoutSession = async (req, res) => {
    try {
        const { sessionId } = req.body;
        if (!sessionId) return res.status(400).json({ error: "Missing sessionId" });

        const session = await stripe.checkout.sessions.retrieve(sessionId);

        // Seguridad: la sesión debe pertenecer al usuario autenticado
        if (String(session?.metadata?.userId) !== String(req.user.id)) {
            return res.status(403).json({ error: "No tienes permiso para validar esta sesión." });
        }

        return res.json({
            ok: true,
            payment_status: session.payment_status,
            status: session.status,
            metadata: session.metadata
        });
    } catch (error) {
        console.error("[Stripe] Error verificando sesión:", error);
        return res.status(500).json({ error: "Error al verificar la sesión de pago" });
    }
};

const webhookHandler = async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error("Webhook signature verification failed:", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        console.log(`[Stripe Webhook] Recibido evento: ${session.id}`);

        try {
            await finalizePurchase(session, event.id);
        } catch (err) {
            console.error("[Stripe Webhook] Error crítico procesando compra:", err);
            return res.status(500).json({ error: "Failed to process purchase" });
        }
    }

    return res.json({ received: true });
};

module.exports = {
    getProducts,
    createCheckoutSession,
    webhookHandler,
    verifyCheckoutSession,
};
