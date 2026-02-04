const { Resend } = require("resend");
const { env } = require("../config/env");

let resend;

if (env.RESEND_API_KEY) {
  resend = new Resend(env.RESEND_API_KEY);
}

/**
 * Envia un correo utilizando un template de Resend.
 * @param {Object} options - Opciones del correo
 * @param {string} options.to - Email del destinatario
 * @param {string} options.subject - Asunto del correo
 * @param {Object} options.variables - Variables para el template
 */
async function sendTemplatedEmail({ to, subject, variables }) {
  if (!resend) {
    throw new Error("RESEND_API_KEY is not configured in .env");
  }

  if (!env.RESEND_TEMPLATE_ID) {
    throw new Error("RESEND_TEMPLATE_ID (alias) is not configured in .env");
  }

  try {
    const { data, error } = await resend.emails.send({
      from: "Invitapop <hola@peettag.com>", // Ajustar cuando el dominio esté verificado
      to,
      subject,
      template: {
        id: env.RESEND_TEMPLATE_ID,
        variables: variables,
      },
    });

    if (error) {
      console.error("Resend API Error:", error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data.id };
  } catch (err) {
    console.error("Email service exception:", err);
    return { success: false, error: err.message };
  }
}

module.exports = { sendTemplatedEmail };
