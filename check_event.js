const { supabaseAdmin } = require('./src/config/supabaseClient');

async function check() {
    const id = 'e7dc00c2-b19e-4b8c-8e83-000dd043eecd';
    const { data, error } = await supabaseAdmin
        .from('events')
        .select('id, status, title_text')
        .eq('id', id)
        .maybeSingle();

    if (error) {
        console.error('ERROR:', error);
    } else {
        console.log('DATA:', JSON.stringify(data, null, 2));
    }
}

check();
