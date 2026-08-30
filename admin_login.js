const loginForm = document.getElementById('adminLoginForm');
const passwordToggle = document.querySelector('.toggle-password');

loginForm?.addEventListener('submit', handleLogin);
passwordToggle?.addEventListener('click', togglePasswordVisibility);

// ✅ Koi bhi hardcoded password ya ID nahi hai
// Credentials Vercel environment variables mein hain
// /api/auth endpoint se verify hoga

// Agar valid secure session already hai to login screen skip karo.
fetch('/api/auth', { cache: 'no-store' })
    .then(response => { if (response.ok) window.location.replace('admin.html'); })
    .catch(() => {});

function togglePasswordVisibility() {
    const passwordInput = document.getElementById('password');
    const eyeIcon = document.getElementById('eyeIcon');
    const toggleButton = document.querySelector('.toggle-password');
    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        eyeIcon.textContent = '🙈';
        toggleButton.setAttribute('aria-label', 'Hide password');
    } else {
        passwordInput.type = 'password';
        eyeIcon.textContent = '👁️';
        toggleButton.setAttribute('aria-label', 'Show password');
    }
}

async function handleLogin(event) {
    event.preventDefault();

    const userIdInput = document.getElementById('userId');
    const passwordInput = document.getElementById('password');
    const idError = document.getElementById('idError');
    const passError = document.getElementById('passError');
    const submitBtn = document.getElementById('submitBtn');
    const btnText = document.getElementById('btnText');
    const btnSpinner = document.getElementById('btnSpinner');
    const btnIcon = document.getElementById('btnIcon');

    // Errors reset karo
    idError.style.display = 'none';
    passError.style.display = 'none';
    userIdInput.style.borderColor = 'var(--border-color)';
    passwordInput.style.borderColor = 'var(--border-color)';

    // Loading state
    submitBtn.disabled = true;
    btnText.textContent = 'Authenticating...';
    btnIcon.style.display = 'none';
    btnSpinner.style.display = 'block';

    try {
        // Secure API call - credentials server par verify honge
        const response = await fetch('/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: userIdInput.value.trim(),
                password: passwordInput.value
            })
        });

        const result = await response.json();

        if (response.ok && result.success) {
            // Success
            btnText.textContent = 'Success!';
            btnSpinner.style.display = 'none';
            btnIcon.textContent = '✓';
            btnIcon.style.display = 'block';
            submitBtn.style.backgroundColor = '#10b981';

            // Server has set a signed HttpOnly session cookie.
            passwordInput.value = '';

            setTimeout(() => {
                window.location.href = 'admin.html';
            }, 600);

        } else {
            // Error
            btnText.textContent = 'Sign In';
            btnSpinner.style.display = 'none';
            btnIcon.style.display = 'block';
            submitBtn.disabled = false;

            idError.style.display = 'flex';
            passError.style.display = 'flex';
            userIdInput.style.borderColor = 'var(--error-color)';
            passwordInput.style.borderColor = 'var(--error-color)';
        }

    } catch (err) {
        btnText.textContent = 'Sign In';
        btnSpinner.style.display = 'none';
        btnIcon.style.display = 'block';
        submitBtn.disabled = false;
        alert('Network error! Internet connection check karein.');
    }
}
