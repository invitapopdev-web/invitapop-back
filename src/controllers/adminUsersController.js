const { supabaseAdmin } = require("../config/supabaseClient");

async function listUsers(req, res, next) {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 30;
        const search = req.query.search || "";

        // Calculate pagination for array slicing later
        const startOffset = (page - 1) * limit;

        // 1. Get users from Supabase Auth mapping
        // Note: Supabase Admin listUsers doesn't support complex server-side direct search for email natively easily inside the paginator unless it's just raw iteration.
        // However we can list all or use Auth Admin search. But let's fetch first.
        let authUsersResponse;
        if (search.trim() !== "") {
            // Unfortunately supabaseAdmin.auth.admin does not have a native search by email that returns a list, except using generic listUsers, 
            // we might have to fetch a bunch of users and filter.
            // There is 'await supabaseAdmin.auth.admin.listUsers()' which returns up to 50 users natively per page.
            // Alternatively, if we only need one user by exact email we could use getUserById, but this is a like search.
            // We will fetch up to 1000 users max for safety to filter in memory if searching, as it's an admin internal tool.
            authUsersResponse = await supabaseAdmin.auth.admin.listUsers({
                perPage: 1000,
                page: 1
            });

        } else {
            authUsersResponse = await supabaseAdmin.auth.admin.listUsers({
                perPage: limit,
                page: page
            });
        }

        if (authUsersResponse.error) {
            return res.status(500).json({ error: "Error fetching auth users: " + authUsersResponse.error.message });
        }

        let authUsers = authUsersResponse.data.users || [];
        let totalCount = authUsersResponse.data.total || authUsers.length;

        // Filter by search text in email if search is active
        if (search.trim() !== "") {
            const lowerSearch = search.toLowerCase();
            authUsers = authUsers.filter(u => u.email && u.email.toLowerCase().includes(lowerSearch));
            totalCount = authUsers.length;

            // Paginate manually after search
            authUsers = authUsers.slice(startOffset, startOffset + limit);
        }

        if (authUsers.length === 0) {
            return res.json({ users: [], totalCount, page, limit });
        }

        const userIds = authUsers.map(u => u.id);

        // 2. Cross-reference with Profiles
        const { data: profiles, error: profilesErr } = await supabaseAdmin
            .from("profiles")
            .select("id, first_name, last_name, phone, roles!inner(name)")
            .in("id", userIds);

        if (profilesErr) {
            return res.status(500).json({ error: "Error fetching profiles: " + profilesErr.message });
        }

        const profilesMap = (profiles || []).reduce((acc, p) => {
            acc[p.id] = p;
            return acc;
        }, {});

        // 3. Cross-reference with invitation_balances for 'all' product_type
        const { data: balances, error: balancesErr } = await supabaseAdmin
            .from("invitation_balances")
            .select("user_id, total_purchased, total_used")
            .in("user_id", userIds)
            .eq("product_type", "all");

        if (balancesErr) {
            return res.status(500).json({ error: "Error fetching balances: " + balancesErr.message });
        }

        const balancesMap = (balances || []).reduce((acc, b) => {
            acc[b.user_id] = b;
            return acc;
        }, {});

        // 4. Combine results
        const combinedUsers = authUsers.map(u => {
            const profile = profilesMap[u.id] || {};
            const balance = balancesMap[u.id] || { total_purchased: 0, total_used: 0 };

            return {
                id: u.id,
                email: u.email,
                created_at: u.created_at,
                first_name: profile.first_name || "",
                last_name: profile.last_name || "",
                phone: profile.phone || "",
                role: profile.roles?.name || "user",
                balance: balance.total_purchased,
                used: balance.total_used
            };
        });

        return res.json({
            users: combinedUsers,
            totalCount: totalCount,
            page,
            limit
        });

    } catch (err) {
        next(err);
    }
}

async function updateUserBalance(req, res, next) {
    try {
        const { id } = req.params; // user_id
        const amount = parseInt(req.body.amount);

        if (isNaN(amount) || amount === 0) {
            return res.status(400).json({ error: "Amount must be a non-zero integer" });
        }

        // 1. Check if user has an 'all' balance
        const { data: currentBalance, error: balanceFetchErr } = await supabaseAdmin
            .from("invitation_balances")
            .select("*")
            .eq("user_id", id)
            .eq("product_type", "all")
            .maybeSingle();

        if (balanceFetchErr) {
            return res.status(500).json({ error: "Error checking user balance" });
        }

        if (!currentBalance) {
            // No previous balance
            if (amount < 0) {
                return res.status(400).json({ error: "Usuario no tiene saldo, no se puede descontar" });
            }

            // Create initial balance
            const newPayload = {
                user_id: id,
                total_purchased: amount,
                total_used: 0,
                product_type: "all",
                updated_at: new Date().toISOString()
            };

            const { data, error: insertErr } = await supabaseAdmin
                .from("invitation_balances")
                .insert(newPayload)
                .select()
                .single();

            if (insertErr) {
                return res.status(500).json({ error: "Error creating balance: " + insertErr.message });
            }

            return res.status(201).json({ balance: data.total_purchased });
        } else {
            // Balance exists, update it
            let newTotal = currentBalance.total_purchased + amount;

            if (newTotal < 0) {
                return res.status(400).json({ error: "El saldo total no puede quedar en negativo." });
            }

            const { data, error: updateErr } = await supabaseAdmin
                .from("invitation_balances")
                .update({
                    total_purchased: newTotal,
                    updated_at: new Date().toISOString()
                })
                .eq("id", currentBalance.id)
                .select()
                .single();

            if (updateErr) {
                return res.status(500).json({ error: "Error updating balance: " + updateErr.message });
            }

            return res.json({ balance: data.total_purchased });
        }

    } catch (err) {
        next(err);
    }
}

module.exports = {
    listUsers,
    updateUserBalance
};
