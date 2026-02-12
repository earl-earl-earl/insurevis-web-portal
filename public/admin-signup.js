'use strict';

let supabaseClient = null;

// Initialize Supabase client from backend config
async function initSupabase() {
  if (supabaseClient) return supabaseClient;
  
  try {
    const response = await fetch('/api/config/supabase');
    const result = await response.json();
    
    if (!result.success || !result.data) {
      throw new Error('Failed to load Supabase configuration');
    }
    
    supabaseClient = window.supabase.createClient(result.data.url, result.data.anonKey, {
      auth: {
        persistSession: false,
        detectSessionInUrl: true
      }
    });
    
    return supabaseClient;
  } catch (error) {
    console.error('Error initializing Supabase:', error);
    throw error;
  }
}

const ROLE_LABELS = {
  admin: 'Platform administrator',
  'car-company': 'Car company partner',
  'insurance-company': 'Insurance company partner'
};

function normalizeSelection(role) {
  if (!role) return { dbRole: 'user', metadataRole: 'user' };

  const metadataRole = `${role}`
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-');

  if (metadataRole.includes('car') && metadataRole.includes('company')) {
    return { dbRole: 'car_company', metadataRole: 'car-company' };
  }

  if (metadataRole.includes('insurance') && metadataRole.includes('company')) {
    return { dbRole: 'insurance_company', metadataRole: 'insurance-company' };
  }

  if (metadataRole.includes('admin')) {
    return { dbRole: 'admin', metadataRole: 'admin' };
  }

  return { dbRole: 'user', metadataRole: metadataRole || 'user' };
}

function qs(id) {
  return document.getElementById(id);
}

function showMessage(message, variant = 'info') {
  const banner = qs('signupMessage');
  if (!banner) return;
  banner.textContent = message || '';
  banner.className = `status-message${variant ? ` ${variant}` : ''}`;
}

function setLoading(isLoading) {
  const button = qs('signupSubmit');
  if (!button) return;
  button.disabled = isLoading;
  button.classList.toggle('loading', isLoading);
}

function validatePayload(email, password, confirmPassword, role) {
  if (!email) {
    showMessage('Enter an email address to continue.', 'error');
    return false;
  }

  if (!password || password.length < 8) {
    showMessage('Choose a password with at least 8 characters.', 'error');
    return false;
  }

  if (password !== confirmPassword) {
    showMessage('Passwords do not match. Please re-enter and try again.', 'error');
    return false;
  }

  if (!role) {
    showMessage('Select the portal role that should be assigned to this account.', 'error');
    return false;
  }

  return true;
}

async function handleSignup(event) {
  event.preventDefault();
  const email = qs('adminEmail')?.value.trim();
  const password = qs('adminPassword')?.value;
  const confirmPassword = qs('confirmPassword')?.value;
  const selectedRole = qs('portalRole')?.value;
  const { dbRole, metadataRole } = normalizeSelection(selectedRole);

  if (!validatePayload(email, password, confirmPassword, dbRole)) {
    return;
  }

  setLoading(true);
  showMessage('Creating account…');

  try {
    await initSupabase();
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: {
          role: dbRole,
          portal_role: metadataRole,
          portalRole: metadataRole
        },
        emailRedirectTo: `${window.location.origin}/`
      }
    });

    if (error) {
      throw error;
    }

    const createdUser = data?.user;
    if (createdUser) {
      await supabaseClient.auth
        .updateUser({
          data: {
            role: dbRole,
            portal_role: metadataRole,
            portalRole: metadataRole
          }
        })
        .catch(() => null);
    }

    const roleName = ROLE_LABELS[metadataRole] || 'new user';
    if (createdUser?.email_confirmed_at) {
      showMessage(`Account created successfully. The ${roleName} can now sign in.`, 'success');
    } else {
      showMessage(
        `Account request sent. Ask the ${roleName} to check ${email} for the confirmation email.`,
        'success'
      );
    }

    await supabaseClient.auth.signOut({ scope: 'local' }).catch(() => null);
    event.target.reset();
  } catch (signupError) {
    console.error('Signup error:', signupError);
    const code = signupError?.code;
    const message =
      code === 'user_already_exists'
        ? 'An account with this email already exists.'
        : signupError.message || 'Unable to create the account right now. Please try again later.';
    showMessage(message, 'error');
  } finally {
    setLoading(false);
  }
}

function wireEvents() {
  const form = qs('signupForm');
  form?.addEventListener('submit', handleSignup, { passive: false });
  
  const logoutButton = qs('logoutButton');
  logoutButton?.addEventListener('click', async () => {
    try {
      await initSupabase();
      // Sign out from Supabase
      await supabaseClient.auth.signOut({ scope: 'global' });
      // Clear all local storage related to Supabase
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('sb-')) {
          localStorage.removeItem(key);
        }
      });
    } catch (error) {
      console.error('Sign out error:', error);
    } finally {
      // Force navigation to login with href (not replace) to ensure fresh page load
      window.location.href = '/';
    }
  });
}

async function init() {
  await initSupabase();
  wireEvents();
  showMessage('Enter the administrator details to provision a new account.');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
