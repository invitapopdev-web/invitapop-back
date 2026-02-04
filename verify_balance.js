const { supabaseAdmin } = require('./src/config/supabaseClient');

async function verify() {
    const userId = '09882dc9-840c-4b9c-8f9f-7f551795c3a1';
    const productType = 'url';

    // 1. Balance en DB
    const { data: balance } = await supabaseAdmin
        .from('invitation_balances')
        .select('*')
        .eq('user_id', userId)
        .eq('product_type', productType)
        .maybeSingle();

    // 2. Eventos publicados
    const { data: events } = await supabaseAdmin
        .from('events')
        .select('id, max_guests, status')
        .eq('user_id', userId)
        .eq('status', 'published')
        .ilike('invitation_type', `${productType}%`);

    const totalReserved = (events || []).reduce((acc, ev) => acc + (Number(ev.max_guests) || 0), 0);
    const purchased = balance?.total_purchased || 0;
    const available = purchased - totalReserved;

    console.log('--- VERIFICACIÓN ---');
    console.log('Producto:', productType);
    console.log('Compradas (total_purchased):', purchased);
    console.log('Eventos Publicados:', events?.length || 0);
    console.log('Total Reservado (Suma max_guests):', totalReserved);
    console.log('Disponible Calculado (Compras - Reserva):', available);
    console.log('--------------------');
}

verify();
