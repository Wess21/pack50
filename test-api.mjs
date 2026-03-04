import fetch from 'node-fetch';

async function testPasswordChange() {
    console.log('--- Testing Password Change ---');
    // First login to get a token
    const loginRes = await fetch('http://localhost:3000/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'changeme_OtzZjXJDMu4=' })
    });

    if (!loginRes.ok) {
        console.error('Failed to log in as admin:', await loginRes.text());
        return;
    }

    const { token } = await loginRes.json();
    console.log('Login successful. Token acquired.');

    // Try changing password
    console.log('Attempting to change password...');
    const changeRes = await fetch('http://localhost:3000/api/admin/change-password', {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ currentPassword: 'changeme_OtzZjXJDMu4=', newPassword: 'newpassword123' })
    });

    const text = await changeRes.text();
    console.log('Change Password Response:', changeRes.status, text);

    if (changeRes.ok) {
        console.log('Password change logic SUCCESSFUL.');

        // Change back
        const restoreRes = await fetch('http://localhost:3000/api/admin/change-password', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ currentPassword: 'newpassword123', newPassword: 'changeme_OtzZjXJDMu4=' })
        });
        console.log('Restore Password Response:', restoreRes.status, await restoreRes.text());
    } else {
        console.error('Password change failed!');
    }
}

async function testConfigChange() {
    console.log('\n--- Testing Contacts Config Save ---');
    const loginRes = await fetch('http://localhost:3000/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'changeme_OtzZjXJDMu4=' })
    });
    const { token } = await loginRes.json();

    const putRes = await fetch('http://localhost:3000/api/admin/config', {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ contact_notification_transport: 'telegram_chat', contact_notification_destination: '12345' })
    });

    console.log('Config Update Response:', putRes.status, await putRes.text());

    const getRes = await fetch('http://localhost:3000/api/admin/config', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const config = await getRes.json();
    console.log('Fetched config saved values:', {
        transport: config.contact_notification_transport,
        destination: config.contact_notification_destination
    });
}

async function runAll() {
    await testPasswordChange();
    await testConfigChange();
}

runAll();
