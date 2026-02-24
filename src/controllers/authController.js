const { supabaseAdmin } = require("../config/supabaseClient");
const { env } = require("../config/env");

const isProduction = process.env.NODE_ENV === "production";
async function register(req, res, next) {
  try {
    const { email, password, fullName } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const { data, error } = await supabaseAdmin.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName || null,
        },
      },
    });

    if (error) {
      // LOG DETALLADO EN EL SERVIDOR
      console.error("Supabase signUp error:", {
        message: error.message,
        code: error.code,
        status: error.status,
        name: error.name,
        full: error,
      });

      // RESPUESTA AL CLIENTE (sin filtrar)
      return res.status(400).json({
        error: error.message,
        code: error.code,
        status: error.status,
      });
    }

    // --- Start Invitation Bonus Logic ---
    try {
      if (data && data.user && data.user.id) {
        const { data: settingsRow, error: settingsErr } = await supabaseAdmin
          .from('settings')
          .select('value')
          .eq('key', 'invitation_bonus_config')
          .maybeSingle();

        if (settingsRow && settingsRow.value) {
          let config = null;
          try {
            config = JSON.parse(settingsRow.value);
          } catch (parseErr) {
            console.error("Error parsing invitation_bonus_config JSON:", parseErr);
          }

          if (config && config.signup_bonus?.enabled === true && config.signup_bonus?.qty !== undefined) {
            const qty = parseInt(config.signup_bonus.qty, 10);

            if (!Number.isNaN(qty) && qty > 0) {
              const newUserId = data.user.id;

              // Check Idempotency
              const { data: existingBonus, error: checkErr } = await supabaseAdmin
                .from('invitation_purchases')
                .select('id')
                .eq('user_id', newUserId)
                .eq('product_type', 'signup_bonus')
                .limit(1);

              if (!checkErr && existingBonus && existingBonus.length === 0) {
                // Grant Bonus (Insert Purchase)
                const { error: insertErr } = await supabaseAdmin
                  .from('invitation_purchases')
                  .insert({
                    user_id: newUserId,
                    pack_name: 'Welcome pack',
                    product_type: 'signup_bonus',
                    quantity: qty,
                    price: 0,
                    currency: 'EUR',
                    payment_status: 'gifted',
                    unit_type: 'invitation',
                    notes: 'Signup bonus',
                    stripe_event_id: null,
                    checkout_session_id: null
                  });

                if (insertErr) {
                  console.error("Error inserting signup bonus purchase:", insertErr);
                } else {
                  // Update/Insert Balance
                  const consolidatedType = "all";
                  const { data: balance, error: fetchBalanceErr } = await supabaseAdmin
                    .from("invitation_balances")
                    .select("id, total_purchased")
                    .eq("user_id", newUserId)
                    .eq("product_type", consolidatedType)
                    .maybeSingle();

                  if (!fetchBalanceErr) {
                    if (balance) {
                      await supabaseAdmin
                        .from("invitation_balances")
                        .update({
                          total_purchased: (Number(balance.total_purchased) || 0) + qty,
                          updated_at: new Date().toISOString(),
                        })
                        .eq("id", balance.id);
                    } else {
                      await supabaseAdmin
                        .from("invitation_balances")
                        .insert({
                          user_id: newUserId,
                          product_type: consolidatedType,
                          total_purchased: qty,
                          total_used: 0,
                          updated_at: new Date().toISOString(),
                        });
                    }
                  } else {
                    console.error("Error fetching balance for signup bonus:", fetchBalanceErr);
                  }
                }
              } else if (checkErr) {
                console.error("Error checking existing signup bonus:", checkErr);
              }
            } // end if (!Number.isNaN(qty) && qty > 0)
          }
        }
      }
    } catch (bonusErr) {
      console.error("Unexpected error in signup bonus logic:", bonusErr);
    }
    // --- End Invitation Bonus Logic ---

    // Return success to client
    return res.status(201).json({
      user: data.user,
      session: data.session,
    });
  } catch (err) {
    next(err);
  }
}



async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ error: "Email and password are required" });
    }

    const { data, error } = await supabaseAdmin.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    const accessToken = data.session?.access_token;
    const refreshToken = data.session?.refresh_token;

    if (!accessToken) {
      return res
        .status(500)
        .json({ error: "No access token returned from Supabase" });
    }

    res.cookie("access_token", accessToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      domain: isProduction ? ".invitapop.com" : undefined,
      path: "/",
      maxAge: 60 * 60 * 1000,
    });


    res.json({
      user: data.user,

      // access_token: accessToken,
      // refresh_token: refreshToken,
    });
  } catch (err) {
    next(err);
  }
}

async function me(req, res, next) {
  try {
    const user = req.user;

    if (!user) {
      return res.status(401).json({ error: "No autenticado" });
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("*, roles(*)")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      console.error("Error cargando profile:", profileError);
    }

    return res.json({
      user,
      profile: profile || null,
    });
  } catch (err) {
    next(err);
  }
}



async function forgotPassword(req, res, next) {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const redirectTo = `${env.FRONTEND_PUBLIC_URL}/reset-password`;


    const { data, error } = await supabaseAdmin.auth.resetPasswordForEmail(
      email,
      {
        redirectTo,
      }
    );

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({
      message:
        "Si el correo existe, hemos enviado un enlace para restablecer la contraseña.",
    });
  } catch (err) {
    next(err);
  }
}

async function resetPassword(req, res, next) {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res
        .status(400)
        .json({ error: "Token and new password are required" });
    }

    if (password.length < 8) {
      return res
        .status(400)
        .json({ error: "La contraseña debe tener al menos 8 caracteres." });
    }

    const {
      data: { user },
      error,
    } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      return res
        .status(400)
        .json({ error: "Token inválido o caducado. Solicita uno nuevo." });
    }

    const { error: updateError } =
      await supabaseAdmin.auth.admin.updateUserById(user.id, {
        password,
      });

    if (updateError) {
      return res.status(400).json({ error: updateError.message });
    }

    return res.json({ message: "Contraseña actualizada correctamente." });
  } catch (err) {
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    res.clearCookie("access_token", {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      domain: isProduction ? ".invitapop.com" : undefined,
      path: "/",
    });


    return res.json({ message: "Sesión cerrada correctamente." });
  } catch (err) {
    next(err);
  }
}



module.exports = {
  register,
  login,
  me,
  forgotPassword,
  resetPassword,
  logout
};
