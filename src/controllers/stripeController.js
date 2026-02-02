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
                image: product.images[0] || null,
                priceId: price ? price.id : null,
                amount: price ? price.unit_amount / 100 : 0,
                currency: price ? price.currency : "eur",
                metadata: product.metadata,
            };
        });

        res.json(formattedProducts);
    } catch (error) {
        console.error("Error fetching products from Stripe:", error);
        res.status(500).json({ error: "Error al obtener productos de Stripe" });
    }
};

const createCheckoutSession = async (req, res) => {
    try {
        const { priceId } = req.body;
        const userId = req.user.id;

        if (!priceId) {
            return res.status(400).json({ error: "Missing priceId" });
        }

        // Fetch price/product details to get metadata
        const price = await stripe.prices.retrieve(priceId, {
            expand: ["product"],
        });
        const product = price.product;

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: [
                {
                    price: priceId,
                    quantity: 1,
                },
            ],
            mode: "payment",
            success_url: `${env.FRONTEND_PUBLIC_URL}/dashboard/events/edit/${req.body.eventId}?step=5&payment=success`,
            cancel_url: `${env.FRONTEND_PUBLIC_URL}/dashboard/events/edit/${req.body.eventId}?step=5&payment=cancel`,
            metadata: {
                userId: userId,
                productType: product.metadata.type || "standard",
                invitations: product.metadata.invitations || "0",
                packName: product.name,
                eventId: req.body.eventId || null,
            },
        });

        res.json({ url: session.url });
    } catch (error) {
        console.error("Error creating stripe checkout session:", error);
        res.status(500).json({ error: "Error al crear la sesión de pago" });
    }
};

const webhookHandler = async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
        // Stripe webhook expects the raw body
        // Note: index.js must use express.raw for this route or handle it specifically
        event = stripe.webhooks.constructEvent(
            req.body,
            sig,
            env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error("Webhook signature verification failed:", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
        const session = event.data.object;

        const { userId, productType, invitations, packName } = session.metadata;
        const quantity = parseInt(invitations, 10) || 0;

        try {
            // 1. Record the purchase
            await supabaseAdmin.from("invitation_purchases").insert({
                user_id: userId,
                pack_name: packName,
                quantity: quantity,
                price: session.amount_total / 100,
                currency: session.currency,
                payment_status: "paid",
                stripe_event_id: event.id,
                product_type: productType,
                unit_type: "invitation",
            });

            // 2. Update the balance
            // Use RPC or a transaction logic if possible, 
            // but here we can check if it exists and update or insert
            const { data: balance, error: balanceFetchError } = await supabaseAdmin
                .from("invitation_balances")
                .select("*")
                .eq("user_id", userId)
                .eq("product_type", productType)
                .maybeSingle();

            if (balanceFetchError) throw balanceFetchError;

            if (balance) {
                await supabaseAdmin
                    .from("invitation_balances")
                    .update({
                        total_purchased: (balance.total_purchased || 0) + quantity,
                        updated_at: new Date().toISOString(),
                    })
                    .eq("id", balance.id);
            } else {
                await supabaseAdmin.from("invitation_balances").insert({
                    user_id: userId,
                    product_type: productType,
                    total_purchased: quantity,
                    total_used: 0,
                    updated_at: new Date().toISOString(),
                });
            }

            console.log(`Purchase processed for user ${userId}: ${quantity} ${productType} invitations`);
        } catch (err) {
            console.error("Error updating invitation balance after webhook:", err);
            // Even if it fails, return 200 to Stripe and maybe log for manual retry
            // Or better, let Stripe retry later by returning 500? 
            // In a real app, idempotency is key.
            return res.status(500).json({ error: "Failed to process purchase" });
        }
    }

    res.json({ received: true });
};

module.exports = {
    getProducts,
    createCheckoutSession,
    webhookHandler,
};
