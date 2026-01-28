const Stripe = require("stripe");
const { env } = require("../config/env");

const stripe = new Stripe(env.STRIPE_SECRET_KEY);

const getProducts = async (req, res) => {
    try {
        // Obtenemos los productos activos
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

module.exports = {
    getProducts,
};
