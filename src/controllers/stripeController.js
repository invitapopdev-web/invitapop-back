// src/controllers/stripeController.js
const Stripe = require("stripe");
const { env } = require("../config/env");
const { supabaseAdmin } = require("../config/supabaseClient");

const stripe = new Stripe(env.STRIPE_SECRET_KEY);

function parsePositiveInt(value) {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) return null;
    return n;
}

function parseTier(product) {
    const metadata = product?.metadata || {};
    const tierMin = parsePositiveInt(metadata.tier_min);
    const rawTierMax = metadata.tier_max;
    const tierMax =
        rawTierMax === undefined || rawTierMax === null || String(rawTierMax).trim() === ""
            ? null
            : parsePositiveInt(rawTierMax);

    if (!tierMin) return null;
    if (rawTierMax !== undefined && rawTierMax !== null && String(rawTierMax).trim() !== "" && !tierMax) {
        return null;
    }
    if (tierMax && tierMax < tierMin) return null;

    return { tierMin, tierMax };
}

function formatStripeProduct(product) {
    const price = product.default_price;
    const tier = parseTier(product);

    if (!price || typeof price === "string" || !price.id || !tier) return null;

    return {
        id: product.id,
        name: product.name,
        description: product.description,
        image: product.images?.[0] || null,
        priceId: price.id,
        amount: price.unit_amount ? price.unit_amount / 100 : 0,
        currency: price.currency || "eur",
        tierMin: tier.tierMin,
        tierMax: tier.tierMax,
        metadata: product.metadata,
        product,
        price,
    };
}

async function listInvitationTierProducts() {
    const products = await stripe.products.list({
        active: true,
        limit: 100,
        expand: ["data.default_price"],
    });

    return products.data
        .filter((product) => {
            const metadata = product.metadata || {};
            return metadata.type === "all" && metadata.unit_type === "invitation";
        })
        .map(formatStripeProduct)
        .filter(Boolean)
        .sort((a, b) => a.tierMin - b.tierMin);
}

async function findProductForQuantity(quantity) {
    const products = await listInvitationTierProducts();
    return products.find((product) => {
        if (quantity < product.tierMin) return false;
        if (product.tierMax === null) return true;
        return quantity <= product.tierMax;
    }) || null;
}

const getProducts = async (req, res) => {
    try {
        const formattedProducts = (await listInvitationTierProducts()).map(({ product, price, ...item }) => item);

        return res.json(formattedProducts);
    } catch (error) {
        console.error("Error fetching products from Stripe:", error);
        return res.status(500).json({ error: "Error al obtener productos de Stripe" });
    }
};

const createCheckoutSession = async (req, res) => {
    try {
        const { priceId, quantity: rawQuantity, eventId, targetMaxGuests, publishAfterPayment } = req.body;
        const userId = req.user.id;

        const quantity = parsePositiveInt(rawQuantity);
        let selectedPriceId = priceId || null;
        let product = null;
        let tierMin = "";
        let tierMax = "";
        let purchasedInvitations = quantity;

        if (quantity) {
            const selected = await findProductForQuantity(quantity);
            if (!selected) {
                return res.status(400).json({
                    error: "No hay un producto de Stripe configurado para esa cantidad de invitaciones",
                });
            }

            selectedPriceId = selected.priceId;
            product = selected.product;
            tierMin = String(selected.tierMin);
            tierMax = selected.tierMax === null ? "" : String(selected.tierMax);
        } else {
            // Fallback temporal para el front actual basado en packs fijos.
            if (!priceId) return res.status(400).json({ error: "Missing quantity" });

            const price = await stripe.prices.retrieve(priceId, { expand: ["product"] });
            product = price.product;
            purchasedInvitations = parsePositiveInt(product?.metadata?.invitations);
            if (!purchasedInvitations) {
                return res.status(400).json({ error: "Missing quantity" });
            }
            tierMin = product?.metadata?.tier_min ? String(product.metadata.tier_min) : "";
            tierMax = product?.metadata?.tier_max ? String(product.metadata.tier_max) : "";
        }

        const metadata = {
            userId: String(userId || ""),
            productType: "all",
            invitations: String(purchasedInvitations),
            packName: String(product?.name || ""),
            eventId: eventId ? String(eventId) : "",
            targetMaxGuests: targetMaxGuests ? String(targetMaxGuests) : "",
            publishAfterPayment: publishAfterPayment ? "true" : "false",
            tierMin,
            tierMax,
        };

        const successUrl = `${env.FRONTEND_PUBLIC_URL}/dashboard/events/${eventId}?payment=success&session_id={CHECKOUT_SESSION_ID}`;
        const cancelUrl = `${env.FRONTEND_PUBLIC_URL}/dashboard/events/${eventId}?payment=cancel`;

        // 1) Crear la session primero
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: [{ price: selectedPriceId, quantity: purchasedInvitations }],
            mode: "payment",
            success_url: successUrl,
            cancel_url: cancelUrl,
            metadata,
            payment_intent_data: { metadata },
            allow_promotion_codes: true,
            customer_creation: "always",
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

    // 2) Actualizar Balance (Siempre como tipo "all")
    const consolidatedType = "all";
    const { data: balance, error: fetchError } = await supabaseAdmin
        .from("invitation_balances")
        .select("id, total_purchased")
        .eq("user_id", userId)
        .eq("product_type", consolidatedType)
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
                product_type: consolidatedType,
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
