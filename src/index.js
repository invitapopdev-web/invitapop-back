const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { env } = require("./config/env");

const authRoutes = require("./routes/authRoutes");
const templateRoutes = require("./routes/templatesRoutes");
const eventRoutes = require("./routes/eventRoutes");
const templateImagesRoutes = require("./routes/templateImagesRoutes");
const eventQuestionsRoutes = require("./routes/eventQuestionsRoutes");
const rsvpRoutes = require("./routes/rsvpRoutes");
const templateCategoriesRoutes = require("./routes/templateCategoriesRoutes");
const categoriesRoutes = require("./routes/categoriesRoutes");
const invitationBalancesRoutes = require("./routes/invitationBalancesRoutes");
const stripeRoutes = require("./routes/stripeRoutes");

const app = express();

// ✅ permite previews de Vercel del proyecto (ajusta si quieres más estricto)
function isAllowedVercelPreview(origin) {
  try {
    const u = new URL(origin);

    // 1) cualquier vercel.app
    if (!u.hostname.endsWith(".vercel.app")) return false;

    // 2) restringe a tus previews reales (según tus logs)
    // - inviteflow-git-*-invitapop.vercel.app
    // - inviteflow-git-*.vercel.app (si tu proyecto siempre empieza así)
    const host = u.hostname.toLowerCase();
    return host.startsWith("inviteflow-") && host.includes("-invitapop");
  } catch {
    return false;
  }
}

const corsOptions = {
  origin: (origin, cb) => {
    // healthchecks/curl no envían Origin
    if (!origin) return cb(null, true);

    // ✅ exact match (prod/local)
    if (env.FRONTEND_ORIGINS.includes(origin)) return cb(null, true);

    // ✅ vercel previews (branch deployments)
    if (isAllowedVercelPreview(origin)) return cb(null, true);

    return cb(
      new Error(
        `CORS blocked for origin: ${origin} de ${env.FRONTEND_ORIGINS}`
      )
    );
  },
  credentials: true,
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // ✅ crucial

app.use(express.json());
app.use(cookieParser());

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "Invitapop API funcionando" });
});

app.use("/api/auth", authRoutes);
app.use("/api/templates", templateRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/templates", templateImagesRoutes);
app.use("/api/event-questions", eventQuestionsRoutes);
app.use("/api/template-categories", templateCategoriesRoutes);
app.use("/api/categories", categoriesRoutes);
app.use("/api", rsvpRoutes);
app.use("/api/invitation-balances", invitationBalancesRoutes);
app.use("/api/stripe", stripeRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);

  if (String(err.message || "").startsWith("CORS blocked")) {
    return res.status(403).json({ error: err.message });
  }

  res.status(500).json({ error: "Internal server error" });
});

app.listen(env.PORT, () => {
  console.log(`API escuchando en http://localhost:${env.PORT}`);
});
