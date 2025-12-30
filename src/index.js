const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { env } = require("./config/env");
const authRoutes = require("./routes/authRoutes");
const templateRoutes = require("./routes/templatesRoutes");
const eventRoutes = require("./routes/eventRoutes");
const templateImagesRoutes = require("./routes/templateImagesRoutes");
const eventQuestionsRoutes = require("./routes/eventQuestionsRoutes");
const app = express();

app.use(
  cors({
    origin: env.FRONTEND_ORIGIN, // ej: http://localhost:3000
    credentials: true,
  })
);

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


app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(env.PORT, () => {
  console.log(`API escuchando en http://localhost:${env.PORT}`);
});
