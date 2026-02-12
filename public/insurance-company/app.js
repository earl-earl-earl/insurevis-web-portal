// Insurance Company Portal - Document Verification & Claims Approval System
// Supabase Configuration - loaded from backend
let supabaseClient = null;
let supabaseUrl = null;
let supabaseAnonKey = null;

// Initialize Supabase client from backend config
async function initSupabase() {
  if (supabaseClient) return supabaseClient;
  
  try {
    const response = await fetch('/api/config/supabase');
    const result = await response.json();
    
    if (!result.success || !result.data) {
      throw new Error('Failed to load Supabase configuration');
    }
    
    supabaseUrl = result.data.url;
    supabaseAnonKey = result.data.anonKey;
    supabaseClient = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
    
    return supabaseClient;
  } catch (error) {
    console.error('Error initializing Supabase:', error);
    throw error;
  }
}

// Global variables
let currentClaim = null;
let currentClaimData = null;
let currentDocuments = [];
let currentClaimApproved = false;

// Real-time subscription trackers
let claimsRealtimeSubscription = null;
let documentsRealtimeSubscription = null;
let claimsRealtimeReloadTimeout = null;
let documentsRealtimeReloadTimeout = null;
// Polling intervals as fallback
let claimsPollingInterval = null;
let documentsPollingInterval = null;

// Insurance company verifiable document types
const INSURANCE_DOCUMENT_TYPES = [
    'lto_or',
    'lto_cr', 
    'drivers_license',
    'owner_valid_id',
    'stencil_strips',
    'damage_photos',
    'job_estimate',
    'insurance_policy',
    'police_report',
    'additional_documents'
];

// Car company verifiable document types
const CAR_COMPANY_DOCUMENT_TYPES = [
    'lto_or',
    'lto_cr', 
    'drivers_license',
    'owner_valid_id',
    'stencil_strips',
    'damage_photos',
    'job_estimate'
];

// Document type display names
const DOCUMENT_TYPE_NAMES = {
    'lto_or': 'LTO Official Receipt',
    'lto_cr': 'LTO Certificate of Registration',
    'drivers_license': "Driver's License",
    'owner_valid_id': 'Owner Valid ID',
    'stencil_strips': 'Stencil Strips',
    'damage_photos': 'Damage Photos',
    'job_estimate': 'Job Estimate',
    'police_report': 'Police Report',
    'insurance_policy': 'Insurance Policy',
    'additional_documents': 'Additional Documents'
};

const ROLE_ROUTES = {
    car_company: '/car-company/',
    'car-company': '/car-company/',
    insurance_company: '/insurance-company/',
    'insurance-company': '/insurance-company/'
};

function normalizeRole(role) {
    if (!role) return null;
    const value = String(role).toLowerCase().trim().replace(/[\s-]+/g, '_');
    if (value.includes('car') && value.includes('company')) return 'car_company';
    if (value.includes('insurance') && value.includes('company')) return 'insurance_company';
    return ROLE_ROUTES[value] ? value : null;
}

function extractRoleFromMetadata(user) {
    if (!user) return null;
    const { app_metadata: appMeta = {}, user_metadata: userMeta = {} } = user;
    const candidates = [];
    if (appMeta.role) candidates.push(appMeta.role);
    if (Array.isArray(appMeta.roles) && appMeta.roles.length > 0) candidates.push(appMeta.roles[0]);
    if (userMeta.role) candidates.push(userMeta.role);
    if (Array.isArray(userMeta.roles) && userMeta.roles.length > 0) candidates.push(userMeta.roles[0]);
    for (const candidate of candidates) {
        const normalized = normalizeRole(candidate);
        if (normalized) return normalized;
    }
    return null;
}

async function resolveUserRole(user) {
    const metaRole = extractRoleFromMetadata(user);
    if (metaRole) return metaRole;

    const fallbackSources = [
        { table: 'profiles', column: 'role' },
        { table: 'portal_profiles', column: 'role' }
    ];

    for (const source of fallbackSources) {
        try {
            const { data, error } = await supabaseClient
                .from(source.table)
                .select(source.column)
                .eq('id', user.id)
                .maybeSingle();

            if (!error && data && data[source.column]) {
                const normalized = normalizeRole(data[source.column]);
                if (normalized) return normalized;
            }
        } catch (err) {
            console.debug(`Role lookup for ${source.table} skipped:`, err.message || err);
        }
    }

    return null;
}

function redirectTo(path) {
    if (!path) return;
    window.location.replace(path);
}

async function bootstrapPortal() {
    try {
        await initSupabase();
        const { data: { session } } = await supabaseClient.auth.getSession();
        const user = session?.user;

        if (!user) {
            redirectTo('/');
            return;
        }

        const role = await resolveUserRole(user);
        if (role !== 'insurance_company') {
            const destination = ROLE_ROUTES[role] || '/';
            redirectTo(destination);
            return;
        }

        initializeApp();
    } catch (error) {
        console.error('Failed to initialise insurance company portal:', error);
        redirectTo('/');
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', bootstrapPortal);

async function initializeApp() {
    console.log('Initializing Insurance Company Portal...');
    
    // Set up event listeners
    setupEventListeners();
    
    // Load claims data
    await loadClaims();
}

function setupEventListeners() {
    // Helper function to safely add event listeners
    function addEventListenerSafely(id, event, handler) {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener(event, handler);
        } else {
            console.warn(`Element with ID '${id}' not found. Skipping event listener.`);
        }
    }
    
    // Search functionality
    addEventListenerSafely('claimsSearch', 'input', filterClaims);
    addEventListenerSafely('statusFilter', 'change', filterClaims);
    
    // Navigation
    addEventListenerSafely('backToClaims', 'click', showClaimsPage);
    
    // Logout
    const logoutButton = document.getElementById('logoutButton');
    if (logoutButton) {
        logoutButton.addEventListener('click', async () => {
            try {
                // Set flag to prevent login page from auto-redirecting
                sessionStorage.setItem('justLoggedOut', 'true');
                await supabaseClient.auth.signOut();
            } catch (error) {
                console.error('Failed to sign out:', error);
            } finally {
                window.location.replace('/');
            }
        });
    }

    // Audit Log button
    const auditLogBtn = document.getElementById('auditLogBtn');
    if (auditLogBtn) {
        auditLogBtn.addEventListener('click', toggleAuditLog);
    }
    
    // Document verification
    // addEventListenerSafely('saveVerification', 'click', saveDocumentVerification); // Removed

    // Batch Verification Navigation
    addEventListenerSafely('prevDocBtn', 'click', () => navigateDocument(-1));
    addEventListenerSafely('nextDocBtn', 'click', () => navigateDocument(1));
    
    // Verification Actions
    addEventListenerSafely('verifyDocBtn', 'click', () => handleDocumentDecision('verify'));
    addEventListenerSafely('rejectDocumentBtn', 'click', () => openDocumentRejectionPane());
    
    // Claim approval
    // Approve should open the approval modal (insurance flow)
    addEventListenerSafely('approveClaimBtn', 'click', showApprovalModal);
    // For Car Company decisions (approve/reject/hold) wire to decideClaim
    addEventListenerSafely('rejectClaimBtn', 'click', openRejectionModal);
    addEventListenerSafely('holdClaimBtn', 'click', function() { decideClaim('under_review'); });
}

// override confirmApproval handler to dispatch based on chosen action
const originalApproveClaim = approveClaim;
document.addEventListener('DOMContentLoaded', () => {
    const confirmBtn = document.getElementById('confirmApproval');
    if (confirmBtn) {
        confirmBtn.addEventListener('click', async function() {
            await approveClaim();
        });
    }
});

async function performClaimAction(status, extraFields = {}) {
    if (!currentClaim) return;
    try {
        const updatePayload = { status, ...extraFields };
        const { error } = await supabaseClient
            .from('claims')
            .update(updatePayload)
            .eq('id', currentClaim);

        if (error) {
            console.error('Error updating claim status:', error);
            showError('Failed to update claim status');
            return;
        }

        showSuccess(`Claim ${formatStatus(status)} successfully!`);
        // Refresh data and UI
        setTimeout(() => {
            showClaimsPage();
            loadClaims();
        }, 800);

    } catch (err) {
        console.error('performClaimAction error:', err);
        showError('Failed to update claim');
    }
}


async function decideClaim(decision, notes = '') {
    if (!currentClaim) {
        showError('No claim selected');
        return;
    }

    try {
        const updateData = {};
        if (decision === 'approved') {
            updateData.status = 'approved';
            updateData.is_approved_by_insurance_company = true;
            updateData.insurance_company_approval_date = new Date().toISOString();
            updateData.approved_at = new Date().toISOString();
            if (notes) updateData.insurance_company_approval_notes = notes;

            // Notify claim owner
            (async () => {
                try {
                    const { data: claimData } = await supabaseClient
                        .from('claims')
                        .select('user_id, claim_number')
                        .eq('id', currentClaim)
                        .single();
                    if (claimData?.user_id) {
                        sendNotifToUser(claimData.user_id, 'Claim Approved', `Your claim ${claimData.claim_number} has been approved by the Insurance Company.`, 'approved');
                    }
                } catch (e) {
                    console.warn('Error sending notification:', e);
                }
            })();

        } else if (decision === 'rejected') {
            console.log('🔴 Processing REJECTED decision');
            updateData.status = 'rejected';
            updateData.is_approved_by_insurance_company = false;
            updateData.rejected_at = new Date().toISOString();
            console.log('📝 rejected_at set to:', updateData.rejected_at);
            if (notes) updateData.insurance_company_approval_notes = notes;

            (async () => {
                try {
                    const { data: claimData } = await supabaseClient
                        .from('claims')
                        .select('user_id, claim_number')
                        .eq('id', currentClaim)
                        .single();
                    if (claimData?.user_id) {
                        const message = notes 
                            ? `Your claim ${claimData.claim_number} has been rejected by the Insurance Company. \n\nReason: \n${notes}`
                            : `Your claim ${claimData.claim_number} has been rejected by the Insurance Company.`;
                        sendNotifToUser(claimData.user_id, 'Claim Rejected', message, 'rejected');
                    }
                } catch (e) {
                    console.warn('Error sending notification:', e);
                }
            })();

        } else if (decision === 'under_review') {
            updateData.status = 'under_review';
            if (notes) updateData.insurance_company_approval_notes = notes;

            (async () => {
                try {
                    const { data: claimData } = await supabaseClient
                        .from('claims')
                        .select('user_id, claim_number')
                        .eq('id', currentClaim)
                        .single();
                    if (claimData?.user_id) {
                        sendNotifToUser(claimData.user_id, 'Claim Under Review', `Your claim ${claimData.claim_number} is marked as Under Review by the Insurance Company.`, 'review');
                    }
                } catch (e) {
                    console.warn('Error sending notification:', e);
                }
            })();
        }

        const { error } = await supabaseClient
            .from('claims')
            .update(updateData)
            .eq('id', currentClaim);

        if (error) {
            console.error('Error updating claim decision:', error);
            showError('Failed to update claim status');
            return;
        }

        console.log('✅ Claim updated successfully with:', updateData);

        // Update UI
        const actionsRow = document.getElementById('approvalActionsRow');
        if (actionsRow) actionsRow.style.display = 'none';
        
        showSuccess(decision === 'approved' ? 'Claim approved' : decision === 'rejected' ? 'Claim rejected' : 'Claim marked as Under Review');
        
        // Redirect to home after decision
        setTimeout(() => {
            showClaimsPage();
            loadClaims();
        }, 1000);

    } catch (err) {
        console.error('Error in decideClaim:', err);
        showError('Failed to perform claim decision');
    }
}


function sendNotifToUser(userId, title, message, status) {
    const uri = 'https://vvnsludqdidnqpbzzgeb.supabase.co/functions/v1/send-notification';
    // Wrap in an async IIFE so callers can optionally await the returned promise
    return (async function() {
        if (!userId) {
            console.warn('sendNotifToUser called without userId');
            return { error: 'missing_userId' };
        }

        const payload = {
            targetUserId: userId,
            title: title || 'Notification',
            body: message || '',
            status: status || null
        };

        try {
            const resp = await fetch(uri, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    // Use public anon key to authenticate the request to Supabase Edge Function
                    'Authorization': 'Bearer ' + supabaseAnonKey,
                },
                body: JSON.stringify(payload)
            });

            const text = await resp.text();
            let data = null;
            try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }

            if (!resp.ok) {
                console.error('sendNotifToUser failed', resp.status, data);
                return { ok: false, status: resp.status, data };
            }

            console.log('sendNotifToUser succeeded', data);
            return { ok: true, status: resp.status, data };

        } catch (err) {
            console.error('sendNotifToUser error', err);
            return { ok: false, error: err.message || err };
        }
    })();
}

// Claims Management
async function loadClaims() {
    const loadingElement = document.getElementById('loadingClaims');
    const tableBody = document.getElementById('claimsTableBody');
    
    loadingElement.style.display = 'block';
    
    try {
        // First, migrate existing claims that have status='approved' but no is_approved_by_insurance_company flag
        try {
            const { data: claimsToMigrate, error: migrateCheckError } = await supabaseClient
                .from('claims')
                .select('id, status, is_approved_by_insurance_company')
                .eq('status', 'approved')
                .or('is_approved_by_insurance_company.is.null,is_approved_by_insurance_company.eq.false');
            
            if (!migrateCheckError && claimsToMigrate && claimsToMigrate.length > 0) {
                // Update claims in batches
                for (const claim of claimsToMigrate) {
                    await supabaseClient
                        .from('claims')
                        .update({ is_approved_by_insurance_company: true })
                        .eq('id', claim.id);
                }
                
                console.log(`✅ Migrated ${claimsToMigrate.length} claims to set is_approved_by_insurance_company`);
            }
        } catch (migrateError) {
            console.warn('Migration check skipped:', migrateError);
        }
        
        // Fetch claims with user information and document counts
        // Only show claims where ALL car company documents are verified
        const { data: claims, error } = await supabaseClient
            .from('claims')
            .select(`
                *,
                users:user_id (
                    name,
                    email
                ),
                documents (
                    id,
                    type,
                    verified_by_car_company,
                    verified_by_insurance_company,
                    insurance_verification_notes
                )
            `)
            // Prefer the claim's `updated_at` timestamp for sorting. If it's
            // `NULL` (older rows or missing values), fall back to `submitted_at`, then `created_at`.
            .order('created_at', { ascending: false })
            .order('submitted_at', { ascending: false })
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching claims:', error);
            showError('Failed to load claims');
            return;
        }

        console.log('Loaded claims:', claims);
        
        // Set up realtime subscription for claims changes
        setupClaimsRealtimeSubscription();
        
        // Filter claims to only show those where ALL car company documents are verified
        const eligibleClaims = claims.filter(claim => {
            const carCompanyDocs = claim.documents.filter(doc => 
                CAR_COMPANY_DOCUMENT_TYPES.includes(doc.type)
            );
            
            // If there are no car company documents, claim is not eligible
            if (carCompanyDocs.length === 0) {
                return false;
            }
            
            // All car company documents must be verified
            return carCompanyDocs.every(doc => doc.verified_by_car_company);
        });
        
        // Process eligible claims data
        const processedClaims = eligibleClaims.map(claim => {
            const insuranceDocs = claim.documents.filter(doc => 
                INSURANCE_DOCUMENT_TYPES.includes(doc.type)
            );
            const verifiedInsuranceDocs = insuranceDocs.filter(doc => 
                doc.verified_by_insurance_company
            );
            const rejectedInsuranceDocs = insuranceDocs.filter(doc => 
                doc.insurance_verification_notes
            );
            
            const allDocsVerified = insuranceDocs.length > 0 && 
                insuranceDocs.every(doc => doc.verified_by_insurance_company);
            
            return {
                ...claim,
                totalInsuranceDocs: insuranceDocs.length,
                verifiedInsuranceDocs: verifiedInsuranceDocs.length,
                rejectedInsuranceDocs: rejectedInsuranceDocs.length,
                pendingInsuranceDocs: insuranceDocs.length - verifiedInsuranceDocs.length - rejectedInsuranceDocs.length,
                readyForApproval: allDocsVerified
            };
        });

        displayClaims(processedClaims);
        
        // Set up realtime subscription for claims changes
        setupClaimsRealtimeSubscription();
        
    } catch (error) {
        console.error('Error loading claims:', error);
        showError('Failed to load claims');
    } finally {
        loadingElement.style.display = 'none';
    }
}

async function setupClaimsRealtimeSubscription() {
    // Unsubscribe from any existing subscription (only this channel)
    if (claimsRealtimeSubscription) {
        try {
            supabaseClient.removeChannel(claimsRealtimeSubscription);
            console.log('🔴 Unsubscribed from previous claims realtime channel');
        } catch (err) {
            console.warn('Failed to remove previous channel via removeChannel, falling back to removeAllChannels:', err);
            try { await supabaseClient.removeAllChannels(); } catch (e) { /* ignore */ }
        }
        claimsRealtimeSubscription = null;
    }

    // Subscribe to claims table changes
    claimsRealtimeSubscription = supabaseClient
        .channel('claims-changes')
        .on('postgres_changes', 
            { 
                event: '*', // Listen to INSERT, UPDATE, DELETE
                schema: 'public', 
                table: 'claims' 
            }, 
            async (payload) => {
                console.log('📡 Realtime claims event received:', payload.eventType, payload.new || payload.old);

                // Only handle events that include new data (INSERT/UPDATE), or deleted claims which also affect the list
                const eventType = String(payload.eventType || '').toLowerCase();
                if (!['insert', 'update', 'delete', 'postgres_changes', '*'].includes(eventType) && !payload.new && !payload.old) {
                    // Not a meaningful change for claim list
                    return;
                }

                // Debounce reloads to avoid repeated full table reloads when many events occur
                if (claimsRealtimeReloadTimeout) clearTimeout(claimsRealtimeReloadTimeout);
                claimsRealtimeReloadTimeout = setTimeout(async () => {
                    try {
                        console.log('🔄 Reloading claims from realtime event...');
                        await loadClaims();
                    } catch (err) {
                        console.error('Error reloading claims from realtime event:', err);
                    } finally {
                        claimsRealtimeReloadTimeout = null;
                    }
                }, 450);
            }
        )
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                console.log('✅ Subscribed to claims realtime updates (insurance company)');
            } else if (status === 'CLOSED') {
                console.log('❌ Realtime subscription closed');
            } else if (status === 'CHANNEL_ERROR') {
                console.error('❌ Realtime channel error - starting polling fallback');
                startClaimsPolling();
            }
        });
    
    // Start polling as fallback (every 5 seconds)
    startClaimsPolling();
}

function startClaimsPolling() {
    // Clear existing interval
    if (claimsPollingInterval) {
        clearInterval(claimsPollingInterval);
    }
    
    // Poll every 5 seconds
    claimsPollingInterval = setInterval(async () => {
        try {
            // Only poll when on claims page (not viewing a specific claim)
            if (document.getElementById('claimsPage').classList.contains('active')) {
                console.log('🔄 Polling claims (fallback)...');
                await loadClaims();
            }
        } catch (err) {
            console.error('Error in claims polling:', err);
        }
    }, 5000);
    
    console.log('✅ Claims polling started (5s interval)');
}

function stopClaimsPolling() {
    if (claimsPollingInterval) {
        clearInterval(claimsPollingInterval);
        claimsPollingInterval = null;
        console.log('🛑 Claims polling stopped');
    }
}

async function setupDocumentsRealtimeSubscription() {
    // Unsubscribe from any existing documents subscription
    if (documentsRealtimeSubscription) {
        try {
            supabaseClient.removeChannel(documentsRealtimeSubscription);
            console.log('🔴 Unsubscribed from previous documents realtime channel');
        } catch (err) {
            console.warn('Failed to remove documents channel:', err);
        }
        documentsRealtimeSubscription = null;
    }

    // Only subscribe if we're viewing a specific claim
    if (!currentClaim) {
        console.log('ℹ️ No current claim - skipping documents subscription');
        return;
    }

    // Subscribe to documents table changes for current claim
    documentsRealtimeSubscription = supabaseClient
        .channel('documents-changes')
        .on('postgres_changes', 
            { 
                event: '*', // Listen to INSERT, UPDATE, DELETE
                schema: 'public', 
                table: 'documents',
                filter: `claim_id=eq.${currentClaim}`
            }, 
            async (payload) => {
                console.log('📡 Realtime documents event received:', payload.eventType, payload.new || payload.old);

                // Debounce reloads to avoid repeated full table reloads when many events occur
                if (documentsRealtimeReloadTimeout) clearTimeout(documentsRealtimeReloadTimeout);
                documentsRealtimeReloadTimeout = setTimeout(async () => {
                    try {
                        console.log('🔄 Reloading documents from realtime event...');
                        // Reload the current claim's documents
                        await loadClaimDocuments(currentClaim);
                        
                        // Also refresh the claims list to update counts
                        await loadClaims();
                    } catch (err) {
                        console.error('Error reloading documents from realtime event:', err);
                    } finally {
                        documentsRealtimeReloadTimeout = null;
                    }
                }, 450);
            }
        )
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                console.log('✅ Subscribed to documents realtime updates for claim:', currentClaim);
            } else if (status === 'CLOSED') {
                console.log('❌ Documents realtime subscription closed');
            } else if (status === 'CHANNEL_ERROR') {
                console.error('❌ Documents channel error - starting polling fallback');
                startDocumentsPolling();
            }
        });
    
    // Start polling as fallback (every 5 seconds)
    startDocumentsPolling();
}

function startDocumentsPolling() {
    // Clear existing interval
    if (documentsPollingInterval) {
        clearInterval(documentsPollingInterval);
    }
    
    // Only poll if viewing a claim
    if (!currentClaim) return;
    
    // Poll every 5 seconds
    documentsPollingInterval = setInterval(async () => {
        try {
            // Only poll when on documents page
            if (currentClaim && document.getElementById('documentsPage').classList.contains('active')) {
                console.log('🔄 Polling documents (fallback) for claim:', currentClaim);
                await loadClaimDocuments(currentClaim);
            }
        } catch (err) {
            console.error('Error in documents polling:', err);
        }
    }, 5000);
    
    console.log('✅ Documents polling started (5s interval) for claim:', currentClaim);
}

function stopDocumentsPolling() {
    if (documentsPollingInterval) {
        clearInterval(documentsPollingInterval);
        documentsPollingInterval = null;
        console.log('🛑 Documents polling stopped');
    }
}

function displayClaims(claims) {
    const tableBody = document.getElementById('claimsTableBody');
    
    if (!claims || claims.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="8" class="no-data">
                    <i class="fas fa-inbox"></i>
                    <p>No claims ready for insurance verification</p>
                </td>
            </tr>
        `;
        return;
    }

    tableBody.innerHTML = claims.map(claim => `
        <tr class="claim-row ${((claim.is_approved_by_insurance_company || claim.status === 'approved') ? 'approved-row' : (claim.status === 'rejected' ? 'rejected-row' : ''))}" data-claim-id="${claim.id}">
            <td>
                <strong>${claim.claim_number}</strong>
            </td>
            <td>
                <div class="user-info">
                    <span class="user-name">${claim.users?.name || 'Unknown'}</span>
                    <small>${claim.users?.email || ''}</small>
                </div>
            </td>
            <td>
                <span class="status-badge status-${claim.status}">
                    ${formatStatus(claim.status)}
                </span>
            </td>
            <td>
                <div class="verification-status">
                    ${(() => {
                        const carStatus = claim.car_company_status || 'pending';
                        if (carStatus === 'approved') {
                            return '<i class="fas fa-check-circle text-success"></i> Approved';
                        } else if (carStatus === 'rejected') {
                            return '<i class="fas fa-times-circle text-danger"></i> Rejected';
                        } else if (carStatus === 'under_review') {
                            return '<i class="fas fa-hourglass-half text-info"></i> Under Review';
                        } else {
                            return '<i class="fas fa-clock text-warning"></i> Pending';
                        }
                    })()}
                </div>
            </td>
            <td>
                <span class="doc-count">${claim.totalInsuranceDocs}</span>
            </td>
            <td>
                <span class="pending-count ${claim.pendingInsuranceDocs > 0 ? 'has-pending' : ''}">
                    ${claim.pendingInsuranceDocs}
                </span>
            </td>
            <td>
                <span class="date">${formatDate(claim.created_at)}</span>
            </td>
            <td>
                <button class="btn-primary btn-sm" onclick="viewClaimDocuments('${claim.id}')">
                    <i class="fas fa-eye"></i> View Documents
                </button>
            </td>
        </tr>
    `).join('');

    // Add click handlers to table rows
    document.querySelectorAll('.claim-row').forEach(row => {
        row.addEventListener('click', function(e) {
            if (!e.target.closest('button')) {
                const claimId = this.dataset.claimId;
                viewClaimDocuments(claimId);
            }
        });
    });
}

async function viewClaimDocuments(claimId) {
    currentClaim = claimId;
    
    // Verify this claim is eligible for insurance review
    const { data: claim, error: claimError } = await supabaseClient
        .from('claims')
        .select(`
            *,
            documents (
                id,
                type,
                verified_by_car_company
            )
        `)
        .eq('id', claimId)
        .single();

    if (claimError) {
        console.error('Error fetching claim:', claimError);
        showError('Failed to load claim details');
        return;
    }

    // Check if all car company documents are verified
    const carCompanyDocs = claim.documents.filter(doc => 
        CAR_COMPANY_DOCUMENT_TYPES.includes(doc.type)
    );
    
    const allCarDocsVerified = carCompanyDocs.length > 0 && 
        carCompanyDocs.every(doc => doc.verified_by_car_company);
    
    if (!allCarDocsVerified) {
        showError('This claim is not ready for insurance review. All car company documents must be verified first.');
        return;
    }
    
    // Show documents page
    showDocumentsPage();
    
    // Load documents for this claim
    await loadClaimDocuments(claimId);
    
    // Set up real-time subscription for documents
    await setupDocumentsRealtimeSubscription();
}

async function loadClaimDocuments(claimId) {
    const loadingElement = document.getElementById('loadingDocuments');
    
    loadingElement.style.display = 'block';
    
    try {
        // Fetch claim details
        const { data: claim, error: claimError } = await supabaseClient
            .from('claims')
            .select(`
                *,
                users:user_id (name, email)
            `)
            .eq('id', claimId)
            .single();

        if (claimError) {
            console.error('Error fetching claim:', claimError);
            showError('Failed to load claim details');
            return;
        }

    // Store claim data globally for use in document viewer
        currentClaimData = claim;
    // Track approval state - both approved and rejected should be view-only
    const isApproved = claim.status === 'approved';
    const isRejected = claim.status === 'rejected';
    currentClaimApproved = isApproved || isRejected;

        // Update claim header
        document.getElementById('claimTitle').textContent = `Claim ${claim.claim_number}`;
        document.getElementById('claimDescription').textContent = 
            `Documents for ${claim.users?.name || 'Unknown User'} - Insurance Verification & Approval`;

        // Populate vehicle summary (replacing user/incident cards)
        try {
            // Prefer vehicle fields stored on the claim record
            const vehicleMake = claim.vehicle_make || null;
            const vehicleModel = claim.vehicle_model || null;
            const vehicleYear = claim.vehicle_year || null;
            const vehiclePlate = claim.vehicle_plate_number || null;

            document.getElementById('summaryClaim').textContent = `Claim ${claim.claim_number}`;
            document.getElementById('summaryUser').textContent = `${claim.users?.name || 'Unknown User'} · ${claim.users?.email || ''}`;
            
            // Update status pill
            const pill = document.getElementById('statusPill');
            if (pill) {
                if (claim.status === 'under_review') {
                    pill.textContent = 'In Review';
                    pill.className = 'status-pill status-under_review';
                } else {
                    const normalized = (claim.status || 'draft').toLowerCase();
                    pill.textContent = formatStatus(normalized);
                    pill.className = 'status-pill status-' + normalized.replace(/\s+/g, '_');
                }
                pill.style.textTransform = 'none';
                pill.style.display = '';
            }

            document.getElementById('summaryMake').textContent = vehicleMake || '-';
            document.getElementById('summaryModel').textContent = vehicleModel || '-';
            document.getElementById('summaryYear').textContent = vehicleYear || '-';
            document.getElementById('summaryPlate').textContent = vehiclePlate || '-';
        } catch (err) {
            console.warn('Could not populate vehicle summary:', err);
        }

        // Fetch all documents for this claim
        const { data: documents, error: docsError } = await supabaseClient
            .from('documents')
            .select('*')
            .eq('claim_id', claimId)
            .order('is_primary', { ascending: false })
            .order('created_at', { ascending: true });

        if (docsError) {
            console.error('Error fetching documents:', docsError);
            showError('Failed to load documents');
            return;
        }

        console.log('Loaded documents:', documents);
        currentDocuments = documents;

        // Separate documents by verification responsibility
        const insuranceDocuments = documents.filter(doc => 
            INSURANCE_DOCUMENT_TYPES.includes(doc.type)
        );
        const carDocuments = documents.filter(doc => 
            CAR_COMPANY_DOCUMENT_TYPES.includes(doc.type) && 
            !INSURANCE_DOCUMENT_TYPES.includes(doc.type)
        );

        // Update stats
        updateDocumentStats(documents, insuranceDocuments);
        
        // Display documents
        displayInsuranceDocuments(insuranceDocuments);

        // Update approval button status
        updateApprovalButtonStatus(insuranceDocuments);

        // Apply approved state (banner and view-only UI)
        applyApprovedState();
        
        // Ensure decision actions visibility is correct after all updates
        // This helps with the initial load issue
        // BUT only if the document viewer modal is NOT open
        setTimeout(() => {
            const decisionActions = document.getElementById('approvalActionsRow');
            const isModalOpen = document.getElementById('documentViewerModal').style.display === 'flex';
            if (decisionActions && !currentClaimApproved && currentClaim && !isModalOpen) {
                decisionActions.style.display = 'flex';
            }
        }, 100);

    } catch (error) {
        console.error('Error loading claim documents:', error);
        showError('Failed to load documents');
    } finally {
        loadingElement.style.display = 'none';
    }
}

function updateDocumentStats(allDocuments, insuranceDocuments) {
    const carVerified = allDocuments.filter(doc => doc.verified_by_car_company).length;
    const insuranceVerified = insuranceDocuments.filter(doc => doc.verified_by_insurance_company).length;
    const rejectedInsurance = insuranceDocuments.filter(doc => doc.insurance_verification_notes).length;
    const pendingInsurance = insuranceDocuments.filter(doc => !doc.verified_by_insurance_company && !doc.insurance_verification_notes).length;
    const total = allDocuments.length;

    document.getElementById('carVerifiedDocs').textContent = carVerified;
    document.getElementById('insuranceVerifiedDocs').textContent = insuranceVerified;
    document.getElementById('pendingInsuranceDocs').textContent = pendingInsurance;
    document.getElementById('rejectedInsuranceDocs').textContent = rejectedInsurance;
    document.getElementById('totalDocs').textContent = total;
}

function displayInsuranceDocuments(documents) {
    const documentsGrid = document.getElementById('insuranceDocumentsGrid');
    
    if (!documents || documents.length === 0) {
        documentsGrid.innerHTML = `
            <div class="no-data">
                <i class="fas fa-inbox"></i>
                <p>No insurance verifiable documents found for this claim</p>
            </div>
        `;
        return;
    }

    documentsGrid.innerHTML = documents.map(doc => `
        <div class="document-list-item ${doc.verified_by_insurance_company ? 'verified' : 'pending'}" 
             data-document-id="${doc.id}">
            ${doc.is_primary ? '<div class="primary-badge">Primary</div>' : ''}
            
            <div class="document-icon">
                <i class="fas ${getDocumentIcon(doc.type)}"></i>
            </div>
            
            <div class="document-details">
                <div class="document-title">
                    <span class="doc-type-name">${DOCUMENT_TYPE_NAMES[doc.type] || doc.type}</span>
                    ${doc.verified_by_insurance_company ? 
                        '<span class="status-badge-mini verified"><i class="fas fa-check-circle"></i> Verified</span>' : 
                        (doc.insurance_verification_notes ? 
                            '<span class="status-badge-mini rejected"><i class="fas fa-times-circle"></i> Rejected</span>' :
                            (currentClaimApproved ? '' : '<span class="status-badge-mini pending"><i class="fas fa-clock"></i> Pending</span>')
                        )
                    }
                </div>
                <div class="document-meta">
                    <span class="file-name">${doc.file_name}</span>
                    <span class="meta-divider">•</span>
                    <span class="upload-date">Uploaded ${formatDate(doc.created_at)}</span>
                    ${doc.insurance_verification_date ? 
                        `<span class="meta-divider">•</span><span class="verified-date">Verified ${formatDate(doc.insurance_verification_date)}</span>` : 
                        ''
                    }
                </div>
                ${doc.verified_by_car_company ? 
                    '<div class="verification-tags"><span class="tag-car-verified"><i class="fas fa-car"></i> Car Verified</span></div>' : ''
                }
            </div>

            <div class="document-list-actions">
                <button class="btn-view" onclick="viewDocument('${doc.id}', ${!currentClaimApproved})">
                    <i class="fas fa-eye"></i> ${currentClaimApproved ? 'View' : 'View & Verify'}
                </button>
            </div>
        </div>
    `).join('');
}

function displayCarDocuments(documents) {
    const documentsGrid = document.getElementById('carDocumentsGrid');
    
    if (!documents || documents.length === 0) {
        documentsGrid.innerHTML = `
            <div class="no-data">
                <i class="fas fa-info-circle"></i>
                <p>No car company exclusive documents for this claim</p>
            </div>
        `;
        return;
    }

    documentsGrid.innerHTML = documents.map(doc => `
        <div class="document-list-item readonly verified" data-document-id="${doc.id}">
            ${doc.is_primary ? '<div class="primary-badge">Primary</div>' : ''}
            
            <div class="document-icon readonly-icon">
                <i class="fas ${getDocumentIcon(doc.type)}"></i>
            </div>
            
            <div class="document-details">
                <div class="document-title">
                    <span class="doc-type-name">${DOCUMENT_TYPE_NAMES[doc.type] || doc.type}</span>
                    <span class="status-badge-mini verified"><i class="fas fa-check-circle"></i> Car Verified</span>
                </div>
                <div class="document-meta">
                    <span class="file-name">${doc.file_name}</span>
                    <span class="meta-divider">•</span>
                    <span class="upload-date">Uploaded ${formatDate(doc.created_at)}</span>
                    <span class="meta-divider">•</span>
                    <span class="verified-date">Car Verified ${formatDate(doc.car_company_verification_date)}</span>
                </div>
            </div>

            <div class="document-list-actions">
                <button class="btn-view-secondary" onclick="viewDocument('${doc.id}', false)">
                    <i class="fas fa-eye"></i> View Only
                </button>
            </div>
        </div>
    `).join('');
}

async function viewDocument(documentId, canVerify) {
    const docIndex = currentDocuments.findIndex(d => d.id === documentId);
    const doc = currentDocuments[docIndex];

    if (!doc) {
        showError('Document not found');
        return;
    }

    // ALWAYS hide approve/reject buttons when document viewer modal opens
    const approvalActionsRow = document.getElementById('approvalActionsRow');
    if (approvalActionsRow) {
        approvalActionsRow.style.display = 'none';
        console.log('🙈 Hidden Approval Actions when opening document viewer');
    }

    // Populate modal with document information
    document.getElementById('documentTitle').textContent = DOCUMENT_TYPE_NAMES[doc.type] || doc.type;
    document.getElementById('docType').textContent = DOCUMENT_TYPE_NAMES[doc.type] || doc.type;
    document.getElementById('docFileName').textContent = doc.file_name;
    document.getElementById('docUploadDate').textContent = formatDate(doc.created_at);
    document.getElementById('docStatus').textContent = formatStatus(doc.status);

    // Populate vehicle information in modal
    try {
        const claim = currentClaimData || {};
        document.getElementById('vehicleMake').textContent = claim.vehicle_make || '-';
        document.getElementById('vehicleModel').textContent = claim.vehicle_model || '-';
        document.getElementById('vehicleYear').textContent = claim.vehicle_year || '-';
        document.getElementById('licensePlate').textContent = claim.vehicle_plate_number || '-';
    } catch (e) {
        console.warn('Error populating vehicle info in modal:', e);
    }

    // Show/hide verification controls based on whether this document can be verified by insurance
    const verificationSection = document.querySelector('.verification-section');
    const rejectionNoteDisplay = document.getElementById('documentRejectionNoteDisplay');
    
    if (canVerify && !currentClaimApproved) {
        if (verificationSection) verificationSection.style.display = 'block';
        if (rejectionNoteDisplay) rejectionNoteDisplay.style.display = 'none';
        
        // --- NEW LOGIC START ---
        
        // Update Navigation Buttons
        const prevBtn = document.getElementById('prevDocBtn');
        const nextBtn = document.getElementById('nextDocBtn');
        
        if (prevBtn) prevBtn.disabled = docIndex === 0;
        if (nextBtn) nextBtn.disabled = docIndex === currentDocuments.length - 1;
        
        // Update Verification Buttons State
        const verifyBtn = document.getElementById('verifyDocBtn');
        const rejectBtn = document.getElementById('rejectDocBtn');
        
        if (verifyBtn && rejectBtn) {
            // Reset styles
            verifyBtn.classList.remove('active-state');
            rejectBtn.classList.remove('active-state');
            verifyBtn.style.opacity = '1';
            rejectBtn.style.opacity = '1';

            if (doc.verified_by_insurance_company) {
                verifyBtn.innerHTML = '<i class="fas fa-check-circle"></i> Verified';
                verifyBtn.classList.add('btn-success');
                verifyBtn.classList.remove('btn-outline-success');
                rejectBtn.style.opacity = '0.5';
            } else {
                verifyBtn.innerHTML = '<i class="fas fa-check"></i> Verify';
            }
        }
        
        // Store current document ID for actions
        document.getElementById('documentViewerModal').dataset.currentDocId = documentId;

        // --- NEW LOGIC END ---
        
    } else {
        if (verificationSection) verificationSection.style.display = 'none';
        
        // Show document rejection note if claim is rejected and document has a rejection note
        if (currentClaimApproved && currentClaimData && currentClaimData.status === 'rejected' && doc.insurance_verification_notes) {
            if (rejectionNoteDisplay) {
                const rejectionNoteContent = document.getElementById('documentRejectionNoteContent');
                if (rejectionNoteContent) {
                    rejectionNoteContent.textContent = doc.insurance_verification_notes;
                }
                rejectionNoteDisplay.style.display = 'block';
            }
        } else if (rejectionNoteDisplay) {
            rejectionNoteDisplay.style.display = 'none';
        }
    }

    // Load document content
    await loadDocumentContent(doc);

    // Show modal
    document.getElementById('documentViewerModal').style.display = 'flex';
}

async function loadDocumentContent(doc) {
    const contentDiv = document.getElementById('documentContent');
    
    // Show loading state briefly
    contentDiv.innerHTML = `
        <div class="document-preview loading-preview">
            <i class="fas fa-spinner fa-spin" style="font-size: 2rem; color: #667eea;"></i>
            <p>Loading document...</p>
        </div>
    `;
    
    try {
        const fileUrl = await getDocumentUrl(doc, { expiresIn: 3600 });
        
        if (!fileUrl) {
            contentDiv.innerHTML = `
                <div class="no-preview">
                    <i class="fas fa-file"></i>
                    <p>Document URL not available</p>
                    <p>File: ${doc.file_name}</p>
                </div>
            `;
            return;
        }

        const fileExtension = getFileExtension(doc.file_name);
        
        if (isImageFile(fileExtension)) {
            // Display image directly
            contentDiv.innerHTML = `
                <div class="document-preview image-preview">
                    <img src="${fileUrl}" alt="${doc.file_name}" 
                         style="max-width: 100%; max-height: 600px; object-fit: contain; opacity: 0; transition: opacity 0.3s;"
                         onload="this.style.opacity='1'" 
                         onerror="this.parentElement.innerHTML='<div class=\\'error-preview\\'><i class=\\'fas fa-exclamation-triangle\\'></i><p>Failed to load image</p></div>';" />
                    <div class="image-info">
                        <p class="file-name">${doc.file_name}</p>
                        <p class="file-size">${formatFileSize(doc.file_size_bytes)}</p>
                        <button onclick="openDocumentInNewTab('${doc.id}')" class="btn-secondary">
                            <i class="fas fa-external-link-alt"></i> Open in New Tab
                        </button>
                    </div>
                </div>
            `;
        } else if (fileExtension === 'pdf') {
            // Display PDF using iframe with 125% zoom
            const pdfUrlWithZoom = fileUrl + '#zoom=100';
            contentDiv.innerHTML = `
                <div class="document-preview pdf-preview">
                    <iframe src="${pdfUrlWithZoom}" 
                            style="width: 100%; height: 600px; border: 1px solid #ddd; border-radius: 8px;"
                            title="PDF Viewer - ${doc.file_name}">
                        <p>Your browser doesn't support PDF viewing. 
                           <a href="javascript:void(0)" onclick="openDocumentInNewTab('${doc.id}')">Click here to open PDF</a>
                        </p>
                    </iframe>
                    <div class="pdf-info">
                        <p class="file-name">${doc.file_name}</p>
                        <p class="file-size">${formatFileSize(doc.file_size_bytes)}</p>
                        <button onclick="openDocumentInNewTab('${doc.id}')" class="btn-secondary">
                            <i class="fas fa-external-link-alt"></i> Open in New Tab
                        </button>
                    </div>
                </div>
            `;
        } else {
            // Show file info for other types
            contentDiv.innerHTML = `
                <div class="document-preview file-preview">
                    <div class="file-icon">
                        <i class="fas fa-file-${getFileTypeIcon(fileExtension)}"></i>
                    </div>
                    <div class="file-details">
                        <p class="file-name">${doc.file_name}</p>
                        <p class="file-size">${formatFileSize(doc.file_size_bytes)}</p>
                        <p class="file-type">Type: ${fileExtension.toUpperCase()}</p>
                        <button onclick="openDocumentInNewTab('${doc.id}')" class="btn-secondary">
                            <i class="fas fa-download"></i> Download / Open
                        </button>
                    </div>
                </div>
            `;
        }
        
    } catch (error) {
        console.error('Error loading document content:', error);
        contentDiv.innerHTML = `
            <div class="error-preview">
                <i class="fas fa-exclamation-triangle"></i>
                <p>Error loading document</p>
                <p class="error-details">${error.message}</p>
            </div>
        `;
    }
}

function navigateDocument(direction) {
    const currentDocId = document.getElementById('documentViewerModal').dataset.currentDocId;
    const currentIndex = currentDocuments.findIndex(d => d.id === currentDocId);
    
    if (currentIndex === -1) return;
    
    const newIndex = currentIndex + direction;
    
    if (newIndex >= 0 && newIndex < currentDocuments.length) {
        // Check if the next document is verifiable by insurance company
        // If not, we might want to skip it or just show it as view-only
        // For now, just view it, viewDocument handles the view-only logic
        const nextDoc = currentDocuments[newIndex];
        const canVerify = INSURANCE_DOCUMENT_TYPES.includes(nextDoc.type);
        viewDocument(nextDoc.id, canVerify);
    }
}

async function handleDocumentDecision(decision) {
    if (currentClaimApproved) {
        notify('error', 'Error', 'Claim is approved. Documents are view-only.', 1500);
        return;
    }
    
    const currentDocId = document.getElementById('documentViewerModal').dataset.currentDocId;
    if (!currentDocId) return;
    
    const isVerified = decision === 'verify';
    
    try {
        // Get current user for audit trail
        const { data: { user } } = await supabaseClient.auth.getUser();
        
        if (!user) {
            notify('error', 'Error', 'User session expired. Please login again.', 1500);
            window.location.replace('/');
            return;
        }

        const updateData = {
            verified_by_insurance_company: isVerified,
            insurance_verified_by: user.id  // Track WHO verified it
        };

        if (isVerified) {
            updateData.insurance_verification_date = new Date().toISOString();
            updateData.insurance_verification_notes = null;
        } else {
            updateData.insurance_verification_date = null;
        }

        const { error } = await supabaseClient
            .from('documents')
            .update(updateData)
            .eq('id', currentDocId);

        if (error) {
            console.error('Error updating document verification:', error);
            notify('error', 'Error', 'Failed to save verification status', 1500);
            return;
        }

        // If a document is unverified, immediately clear the insurance company approval on the claim
        if (!isVerified && currentClaim) {
            try {
                const { error: claimClearErr } = await supabaseClient
                    .from('claims')
                    .update({
                        is_approved_by_insurance_company: false,
                        // Clear approval date if present in schema; ignored if column doesn't exist
                        insurance_company_approval_date: null
                    })
                    .eq('id', currentClaim);
                if (claimClearErr) {
                    console.warn('Unable to clear insurance approval on claim after unverify:', claimClearErr);
                }
            } catch (e) {
                console.warn('Error clearing insurance approval on claim after unverify:', e);
            }
        }

        // Update local state
        const docIndex = currentDocuments.findIndex(doc => doc.id === currentDocId);
        if (docIndex !== -1) {
            currentDocuments[docIndex] = { ...currentDocuments[docIndex], ...updateData };
        }

        // IMPORTANT: Keep approval actions hidden while we're still in the modal
        const approvalActionsRow = document.getElementById('approvalActionsRow');
        if (approvalActionsRow) {
            approvalActionsRow.style.display = 'none';
        }
        
        // Refresh displays
        const insuranceDocuments = currentDocuments.filter(doc => 
            INSURANCE_DOCUMENT_TYPES.includes(doc.type)
        );
        updateDocumentStats(currentDocuments, insuranceDocuments);
        displayInsuranceDocuments(insuranceDocuments);
        updateApprovalButtonStatus(insuranceDocuments);
        
        // Show success message with shorter timeout (1.5 seconds)
        notify('success', 'Success', isVerified ? 'Document verified successfully!' : 'Document verification removed', 1500);
        
        // NOTE: We don't reload claims here to avoid flickering.
        // The claims list will auto-update via real-time subscriptions or when navigating back.
        
        // Ensure approval actions stay hidden after all updates
        if (approvalActionsRow) {
            approvalActionsRow.style.display = 'none';
        }
        
        // Auto-navigate to next document
        // Only if we are not at the last document
        const currentIndex = currentDocuments.findIndex(d => d.id === currentDocId);
        if (currentIndex < currentDocuments.length - 1) {
            setTimeout(() => {
                navigateDocument(1);
            }, 500);
        } else {
            // If last document, close the viewer to show decision actions
            document.getElementById('documentViewerModal').style.display = 'none';
            // Restore decision actions
            if (!currentClaimApproved && currentClaim) {
                if (approvalActionsRow) {
                    approvalActionsRow.style.display = 'flex';
                }
            }
        }

    } catch (error) {
        console.error('Error saving verification:', error);
        notify('error', 'Error', 'Failed to save verification status', 1500);
    }
}

function applyApprovedState() {
    const approvedBanner = document.getElementById('approvedBanner');
    const rejectedBanner = document.getElementById('rejectedBanner');
    const rejectionNotesDisplay = document.getElementById('rejectionNotesDisplay');
    const rejectionNotesContent = document.getElementById('rejectionNotesContent');
    const docsPage = document.getElementById('documentsPage');
    const actionsRow = document.getElementById('approvalActionsRow');
    
    const approved = currentClaimApproved && currentClaimData && currentClaimData.status === 'approved';
    const rejected = currentClaimData && currentClaimData.status === 'rejected';
    
    // Reset all banners first
    if (approvedBanner) approvedBanner.style.display = 'none';
    if (rejectedBanner) rejectedBanner.style.display = 'none';
    if (rejectionNotesDisplay) rejectionNotesDisplay.style.display = 'none';
    
    if (approved) {
        if (approvedBanner) approvedBanner.style.display = '';
        if (docsPage) docsPage.classList.add('view-only');
        if (actionsRow) actionsRow.style.display = 'none';
        // Disable verification controls proactively
        const checkbox = document.getElementById('verifyCheckbox');
        const saveBtn = document.getElementById('saveVerification');
        if (checkbox) checkbox.disabled = true;
        if (saveBtn) saveBtn.disabled = true;
    } else if (rejected) {
        if (rejectedBanner) rejectedBanner.style.display = '';
        if (docsPage) docsPage.classList.add('view-only');
        if (actionsRow) actionsRow.style.display = 'none';
        
        // Show rejection notes if they exist
        console.log('Rejected claim, checking notes:', currentClaimData.insurance_company_approval_notes);
        if (currentClaimData.insurance_company_approval_notes) {
            if (rejectionNotesContent) {
                rejectionNotesContent.textContent = currentClaimData.insurance_company_approval_notes;
            }
            if (rejectionNotesDisplay) {
                rejectionNotesDisplay.style.display = 'block';
                console.log('Rejection notes display set to block');
            }
        } else {
            console.log('No rejection notes found');
        }
        
        // Disable verification controls
        const checkbox = document.getElementById('verifyCheckbox');
        const saveBtn = document.getElementById('saveVerification');
        if (checkbox) checkbox.disabled = true;
        if (saveBtn) saveBtn.disabled = true;
    } else {
        if (docsPage) docsPage.classList.remove('view-only');
        // Visibility is handled by updateApprovalButtonStatus
        // if (actionsRow) actionsRow.style.display = 'flex';
        const checkbox = document.getElementById('verifyCheckbox');
        const saveBtn = document.getElementById('saveVerification');
        if (checkbox) checkbox.disabled = false;
        if (saveBtn) saveBtn.disabled = false;
    }
}

function updateApprovalButtonStatus(insuranceDocuments) {
    const approveBtn = document.getElementById('approveClaimBtn');
    const approvalActionsRow = document.getElementById('approvalActionsRow');
    
    const allVerified = insuranceDocuments.length > 0 && 
        insuranceDocuments.every(doc => doc.verified_by_insurance_company);
    
    // Show the action buttons as long as the claim is not approved/rejected
    // AND the document viewer modal is NOT currently open
    if (approvalActionsRow) {
        const isModalOpen = document.getElementById('documentViewerModal').style.display === 'flex';
        if (!currentClaimApproved && !isModalOpen) {
            approvalActionsRow.style.display = 'flex';
        } else {
            approvalActionsRow.style.display = 'none';
        }
    }
    
    if (allVerified) {
        approveBtn.disabled = false;
        approveBtn.classList.add('ready');
    } else {
        approveBtn.disabled = true;
        approveBtn.classList.remove('ready');
    }
}

function showApprovalModal() {
    if (!currentClaim) return;

    // Populate summary
    if (currentClaimData) {
        const summaryClaimNumber = document.getElementById('summaryClaimNumber');
        if (summaryClaimNumber) {
            summaryClaimNumber.textContent = currentClaimData.claim_number || '-';
        }
        
        const summaryVehicle = document.getElementById('summaryVehicle');
        if (summaryVehicle) {
            const vehicle = [
                currentClaimData.vehicle_year, 
                currentClaimData.vehicle_make, 
                currentClaimData.vehicle_model
            ].filter(Boolean).join(' ') || '-';
            summaryVehicle.textContent = vehicle;
        }
        
        const summaryTotalCost = document.getElementById('summaryTotalCost');
        if (summaryTotalCost) {
            // Use the specific column name provided by the user
            const cost = currentClaimData.estimated_damage_cost || 0;
                         
            summaryTotalCost.textContent = formatCurrency(cost);
        }
    }

    document.getElementById('approvalModal').style.display = 'flex';
}

async function approveClaim() {
    if (!currentClaim) return;
    
    const notes = document.getElementById('approvalNotes').value.trim();
    
    try {
        const { error } = await supabaseClient
            .from('claims')
            .update({
                is_successful: true,
                status: 'approved',
                is_approved_by_insurance_company: true,
                insurance_company_approval_date: new Date().toISOString()
            })
            .eq('id', currentClaim);

        if (error) {
            console.error('Error approving claim:', error);
            showError('Failed to approve claim');
            return;
        }

        // Send notification to claim owner
        (async () => {
            try {
                const { data: claimData } = await supabaseClient
                    .from('claims')
                    .select('user_id, claim_number')
                    .eq('id', currentClaim)
                    .single();
                if (claimData?.user_id) {
                    const message = notes && notes.trim()
                        ? `Your claim ${claimData.claim_number} has been approved by the Insurance Company.\n\nNotes: ${notes}`
                        : `Your claim ${claimData.claim_number} has been approved by the Insurance Company.`;
                    sendNotifToUser(claimData.user_id, 'Claim Approved', message, 'approved');
                }
            } catch (e) {
                console.warn('Error sending approval notification:', e);
            }
        })();

        closeApprovalModal();
        showSuccess('Claim approved successfully!');
        
        // Redirect to home after approval
        setTimeout(() => {
            showClaimsPage();
            loadClaims();
        }, 1000);

    } catch (error) {
        console.error('Error approving claim:', error);
        showError('Failed to approve claim');
    }
}

// Navigation functions
function showClaimsPage() {
    document.getElementById('claimsPage').classList.add('active');
    document.getElementById('documentsPage').classList.remove('active');
    currentClaim = null;
    currentClaimData = null;
    document.body.classList.remove('claim-view-active');
    
    // Hide the fixed action buttons when returning to claims page
    const approvalActionsRow = document.getElementById('approvalActionsRow');
    if (approvalActionsRow) {
        approvalActionsRow.style.display = 'none';
    }
    
    // Unsubscribe from documents real-time when leaving claim view
    if (documentsRealtimeSubscription) {
        try {
            supabaseClient.removeChannel(documentsRealtimeSubscription);
            console.log('🔴 Unsubscribed from documents realtime channel');
        } catch (err) {
            console.warn('Failed to unsubscribe from documents channel:', err);
        }
        documentsRealtimeSubscription = null;
    }
    
    // Stop documents polling
    stopDocumentsPolling();
    
    // Ensure claims polling is active
    if (!claimsPollingInterval) {
        startClaimsPolling();
    }
}

function showDocumentsPage() {
    document.getElementById('claimsPage').classList.remove('active');
    document.getElementById('documentsPage').classList.add('active');
    document.body.classList.add('claim-view-active');
}

function closeDocumentViewer() {
    document.getElementById('documentViewerModal').style.display = 'none';

    // ALWAYS restore approval actions visibility when closing viewer (if claim is open and not approved/rejected)
    if (currentClaim && !currentClaimApproved) {
        const approvalActionsRow = document.getElementById('approvalActionsRow');
        if (approvalActionsRow) {
            approvalActionsRow.style.display = 'flex';
            console.log('👁️ Restored Approval Actions after closing document viewer');
        }
    }
}

function closeApprovalModal() {
    document.getElementById('approvalModal').style.display = 'none';
    document.getElementById('approvalNotes').value = '';
}

function openRejectionModal() {
    console.log('openRejectionModal called, currentClaim:', currentClaim);
    if (!currentClaim) {
        console.error('No current claim selected');
        showError('Please select a claim first');
        return;
    }
    
    // Hide decision actions when rejection modal opens
    const decisionActions = document.getElementById('approvalActionsRow');
    if (decisionActions) {
        decisionActions.style.display = 'none';
    }
    
    const modal = document.getElementById('rejectionModal');
    console.log('Rejection modal element:', modal);
    const notesTextarea = document.getElementById('rejectionNotes');
    if (notesTextarea) notesTextarea.value = '';
    
    // Populate rejected documents
    populateRejectedDocuments();
    
    if (modal) {
        modal.style.display = 'flex';
        console.log('Modal display set to flex');
    } else {
        console.error('Rejection modal element not found');
    }
    
    // Set up confirm button handler
    const confirmBtn = document.getElementById('confirmRejectBtn');
    if (confirmBtn) {
        const newBtn = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);
        newBtn.addEventListener('click', async () => {
            const notes = document.getElementById('rejectionNotes').value.trim();
            if (!notes) {
                showError('Please provide a reason for rejection');
                return;
            }
            closeRejectionModal();
            await decideClaim('rejected', notes);
        });
    } else {
        console.error('Confirm reject button not found');
    }
}

function populateRejectedDocuments() {
    const container = document.getElementById('rejectedDocumentsContainer');
    if (!container) return;
    
    // Get all rejected documents (those with insurance_verification_notes set)
    const rejectedDocs = currentDocuments.filter(doc => doc.insurance_verification_notes);
    
    if (rejectedDocs.length === 0) {
        container.innerHTML = '';
        return;
    }
    
    let html = '<div class="rejected-documents-section"><h4><i class="fas fa-exclamation-circle"></i> Rejected Documents</h4>';
    
    const reasonMap = {
        'document_illegible': 'Document is illegible or unclear',
        'document_expired': 'Document is expired',
        'document_incomplete': 'Document is incomplete',
        'document_forged': 'Document appears to be forged',
        'document_wrong_type': 'Wrong document type submitted',
        'document_mismatch': 'Document information doesn\'t match claim'
    };
    
    rejectedDocs.forEach(doc => {
        let reason = doc.insurance_verification_notes || 'No reason provided';
        // Check if it's a dropdown option that needs formatting
        if (reasonMap[reason]) {
            reason = reasonMap[reason];
        }
        html += `
            <div class="rejected-document-item">
                <div class="rejected-document-name">
                    <i class="fas ${getDocumentIcon(doc.type)}"></i> ${DOCUMENT_TYPE_NAMES[doc.type] || doc.type}
                </div>
                <div class="rejected-document-reason">
                    <strong>Reason:</strong> ${reason}
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    container.innerHTML = html;
}

function closeRejectionModal() {
    const modal = document.getElementById('rejectionModal');
    if (modal) modal.style.display = 'none';
    
    // Restore decision actions visibility if claim is still open and not approved
    if (!currentClaimApproved && currentClaim) {
        const decisionActions = document.getElementById('approvalActionsRow');
        if (decisionActions) {
            decisionActions.style.display = 'flex';
        }
    }
}

// Filter functions
// Filter functions
function filterClaims() {
    const searchTerm = document.getElementById('claimsSearch')?.value.toLowerCase() || '';
    const statusFilter = document.getElementById('statusFilter')?.value || '';
    
    const rows = document.querySelectorAll('.claim-row');
    
    rows.forEach(row => {
        const claimNumber = row.querySelector('td:first-child')?.textContent.toLowerCase() || '';
        const userName = row.querySelector('.user-name')?.textContent.toLowerCase() || '';
        const userEmail = row.querySelector('.user-info small')?.textContent.toLowerCase() || '';
        const status = row.querySelector('.status-badge')?.textContent.toLowerCase() || '';
        
        const matchesSearch = !searchTerm || 
            claimNumber.includes(searchTerm) || 
            userName.includes(searchTerm) || 
            userEmail.includes(searchTerm);
            
        const matchesStatus = !statusFilter || status.includes(statusFilter.replace('_', ' '));
        
        row.style.display = matchesSearch && matchesStatus ? '' : 'none';
    });
}

// Utility functions
function formatStatus(status) {
    if (!status) return '';
    const normalized = String(status).toLowerCase();
    const displayMap = {
        'under_review': 'In Review',
        'appealed': 'Appealed',
        'approved': 'Approved',
        'rejected': 'Rejected',
        'submitted': 'Submitted',
        'draft': 'Draft'
    };
    if (displayMap[normalized]) return displayMap[normalized];
    return normalized.split('_').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatFileSize(bytes) {
    if (!bytes) return 'Unknown size';
    
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Format a number as currency (Philippine Peso by default).
 * Accepts numbers or numeric strings. Falls back to a simple formatted value on error.
 */
function formatCurrency(value, locale = 'en-PH', currency = 'PHP') {
    if (value === null || value === undefined || value === '') return '-';
    const num = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.-]+/g, ''));
    if (Number.isNaN(num)) return String(value);
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(num);
}

function getDocumentIcon(type) {
    const icons = {
        'lto_or': 'fa-receipt',
        'lto_cr': 'fa-certificate',
        'drivers_license': 'fa-id-card',
        'owner_valid_id': 'fa-id-badge',
        'stencil_strips': 'fa-barcode',
        'damage_photos': 'fa-images',
        'job_estimate': 'fa-calculator',
        'police_report': 'fa-file-alt',
        'insurance_policy': 'fa-file-contract',
        'additional_documents': 'fa-paperclip'
    };
    return icons[type] || 'fa-file';
}

function getFileTypeIcon(format) {
    const icons = {
        'pdf': 'pdf',
        'jpg': 'image',
        'jpeg': 'image',
        'png': 'image',
        'doc': 'word',
        'docx': 'word'
    };
    return icons[format] || 'alt';
}

function showError(message) {
    notify('error', 'Error', message);
}

function showSuccess(message) {
    notify('success', 'Success', message);
}

// Close modals when clicking outside
window.addEventListener('click', function(event) {
    const documentModal = document.getElementById('documentViewerModal');
    const approvalModal = document.getElementById('approvalModal');
    const rejectionModal = document.getElementById('rejectionModal');
    
    if (event.target === documentModal) {
        closeDocumentViewer();
    }
    if (event.target === approvalModal) {
        closeApprovalModal();
    }
    if (event.target === rejectionModal) {
        closeRejectionModal();
    }
});

// Document Rejection Pane Functions
function openDocumentRejectionPane() {
    const pane = document.getElementById('documentRejectionPane');
    if (pane) {
        pane.classList.add('open');
        document.getElementById('rejectionReasonSelect').value = '';
        document.getElementById('otherReasonText').value = '';
        document.getElementById('otherReasonContainer').classList.remove('show');
    }
}

function closeDocumentRejectionPane() {
    const pane = document.getElementById('documentRejectionPane');
    if (pane) {
        pane.classList.remove('open');
    }
}

// Handle rejection reason dropdown change
document.addEventListener('DOMContentLoaded', function() {
    const reasonSelect = document.getElementById('rejectionReasonSelect');
    if (reasonSelect) {
        reasonSelect.addEventListener('change', function() {
            const otherContainer = document.getElementById('otherReasonContainer');
            if (this.value === 'others') {
                otherContainer.classList.add('show');
                document.getElementById('otherReasonText').focus();
            } else {
                otherContainer.classList.remove('show');
            }
        });
    }
});

async function confirmDocumentRejection() {
    const reasonSelect = document.getElementById('rejectionReasonSelect');
    const otherReasonText = document.getElementById('otherReasonText');
    
    const reason = reasonSelect.value;
    if (!reason) {
        showError('Please select a rejection reason');
        return;
    }
    
    let rejectionNotes = reason;
    if (reason === 'others') {
        const customReason = otherReasonText.value.trim();
        if (!customReason) {
            showError('Please provide a specific reason');
            return;
        }
        rejectionNotes = `Other: ${customReason}`;
    }
    
    closeDocumentRejectionPane();
    
    const currentDocId = document.getElementById('documentViewerModal').dataset.currentDocId;
    if (!currentDocId) return;
    
    try {
        // Update document with rejection notes
        const { error } = await supabaseClient
            .from('documents')
            .update({
                verified_by_insurance_company: false,
                insurance_verification_date: null,
                insurance_verification_notes: rejectionNotes
            })
            .eq('id', currentDocId);

        if (error) {
            console.error('Error rejecting document:', error);
            showError('Failed to reject document');
            return;
        }

        // Update local state
        const docIndex = currentDocuments.findIndex(doc => doc.id === currentDocId);
        if (docIndex !== -1) {
            currentDocuments[docIndex] = {
                ...currentDocuments[docIndex],
                verified_by_insurance_company: false,
                insurance_verification_date: null,
                insurance_verification_notes: rejectionNotes
            };
        }

        // Clear insurance company approval if any document is rejected
        if (currentClaim) {
            await supabaseClient
                .from('claims')
                .update({ is_approved_by_insurance_company: false, insurance_company_approval_date: null })
                .eq('id', currentClaim);
        }

        // Refresh displays
        const insuranceDocuments = currentDocuments.filter(doc => 
            INSURANCE_DOCUMENT_TYPES.includes(doc.type)
        );
        updateDocumentStats(currentDocuments, insuranceDocuments);
        displayInsuranceDocuments(insuranceDocuments);
        updateApprovalButtonStatus(insuranceDocuments);
        
        showSuccess('Document rejected successfully!');

        // Auto-navigate to next document
        const currentIndex = currentDocuments.findIndex(d => d.id === currentDocId);
        if (currentIndex < currentDocuments.length - 1) {
            setTimeout(() => {
                navigateDocument(1);
            }, 500);
        } else {
            viewDocument(currentDocId, true);
        }

        // Reload claims to update counts
        setTimeout(() => {
            loadClaims();
        }, 1000);

    } catch (error) {
        console.error('Error in confirmDocumentRejection:', error);
        showError('Failed to reject document');
    }
}

// Toast/Pane notifications - centered popup
function notify(type, title, message, timeout = 4000) {
    try {
        const container = document.getElementById('toastContainer');
        if (!container) {
            console.warn('toastContainer not found');
            return;
        }
        const toast = document.createElement('div');
        toast.className = `toast toast-${type} toast-center`;
        toast.innerHTML = `
            <div class="toast-icon">${type === 'success' ? '✅' : type === 'error' ? '⚠️' : type === 'warning' ? '⚠️' : 'ℹ️'}</div>
            <div class="toast-content">
                <div class="toast-title">${title || (type === 'success' ? 'Success' : type === 'error' ? 'Error' : type === 'warning' ? 'Warning' : 'Notice')}</div>
                <div class="toast-message">${message || ''}</div>
            </div>
            <button class="toast-close" aria-label="Close">×</button>
        `;
        const closer = toast.querySelector('.toast-close');
        closer.addEventListener('click', () => {
            toast.classList.add('toast-hiding');
            setTimeout(() => {
                if (toast.parentNode === container) container.removeChild(toast);
            }, 300);
        });
        container.appendChild(toast);
        
        // Add show class for animation
        setTimeout(() => toast.classList.add('toast-show'), 10);
        
        if (timeout > 0) {
            setTimeout(() => {
                if (toast.parentNode === container) {
                    toast.classList.add('toast-hiding');
                    setTimeout(() => {
                        if (toast.parentNode === container) container.removeChild(toast);
                    }, 300);
                }
            }, timeout);
        }
    } catch (e) { console.warn('notify error', e); }
}

// Helper functions for document URL handling
function getFileExtension(filename) {
    return filename.split('.').pop().toLowerCase();
}

function isImageFile(extension) {
    const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'];
    return imageExtensions.includes(extension);
}

function parseStorageUrl(url) {
    if (!url || typeof url !== 'string') return null;
    try {
        const u = new URL(url);
        const pathname = u.pathname;
        const parts = pathname.split('/').filter(Boolean);
        const idx = parts.findIndex(p => p === 'object');
        if (idx === -1 || parts.length < idx + 3) return null;
        const kind = parts[idx + 1];
        let bucket, objectPath;
        if (kind === 'public' || kind === 'sign') {
            bucket = parts[idx + 2];
            objectPath = parts.slice(idx + 3).join('/');
        } else {
            bucket = parts[idx + 1];
            objectPath = parts.slice(idx + 2).join('/');
        }
        if (!bucket || !objectPath) return null;
        return { bucket, path: objectPath };
    } catch (_) {
        return null;
    }
}

function getDocumentUrl(doc, options = {}) {
    const { expiresIn = 3600, forceSigned = false } = options;
    return (async function() {
        const initialUrl = doc.remote_url || doc.url || null;
        if (initialUrl && !forceSigned) {
            const looksSigned = /[?&]token=/.test(initialUrl) || /\/storage\/v1\/object\/sign\//.test(initialUrl);
            if (!looksSigned) {
                try {
                    const resp = await fetch(initialUrl, { method: 'HEAD' });
                    if (resp.ok) return initialUrl;
                    if (resp.status !== 401 && resp.status !== 403) return initialUrl;
                } catch (err) { }
            }
        }

        let objectPath = doc.file_path || doc.path || doc.filePath || null;
        let bucketName = doc.bucket || 'insurevis-documents';
        if (!objectPath && initialUrl) {
            const parsed = parseStorageUrl(initialUrl);
            if (parsed) {
                bucketName = parsed.bucket || bucketName;
                objectPath = parsed.path;
            }
        }

        if (objectPath && typeof supabaseClient !== 'undefined') {
            try {
                const { data, error } = await supabaseClient.storage
                    .from(bucketName)
                    .createSignedUrl(objectPath, expiresIn);

                if (data && data.signedUrl) return data.signedUrl;
            } catch (err) {
                console.error('Error creating signed URL:', err);
            }
        }
        return initialUrl;
    })();
}

async function openDocumentInNewTab(documentId) {
    try {
        const doc = currentDocuments.find(d => d.id === documentId);
        if (!doc) return;
        const freshUrl = await getDocumentUrl(doc, { expiresIn: 3600, forceSigned: true });
        if (freshUrl) {
            window.open(freshUrl, '_blank', 'noopener');
        } else if (doc.remote_url) {
            window.open(doc.remote_url, '_blank', 'noopener');
        } else {
            showError('Unable to generate URL for this document.');
        }
    } catch (e) {
        console.error('openDocumentInNewTab error:', e);
        showError('Failed to open document: ' + (e.message || e));
    }
}

// --- Audit Log Feature (copied from Car Company portal and adapted) ---
let isShowingAuditLog = false;
let allAuditLogs = [];

// Toggle between claims table and audit log table
async function toggleAuditLog() {
    const claimsTableContainer = document.getElementById('claimsTableContainer');
    const auditLogTableContainer = document.getElementById('auditLogTableContainer');
    const auditLogControls = document.getElementById('auditLogControls');
    const auditLogBtn = document.getElementById('auditLogBtn');
    const loadingClaims = document.getElementById('loadingClaims');
    const loadingAuditLog = document.getElementById('loadingAuditLog');
    const searchContainer = document.querySelector('.search-container');
    
    isShowingAuditLog = !isShowingAuditLog;
    
    if (isShowingAuditLog) {
        if (claimsTableContainer) claimsTableContainer.style.display = 'none';
        if (auditLogTableContainer) auditLogTableContainer.style.display = 'block';
        if (auditLogControls) auditLogControls.style.display = 'block';
        if (loadingClaims) loadingClaims.style.display = 'none';
        if (searchContainer) searchContainer.style.display = 'none';
        
        if (auditLogBtn) auditLogBtn.innerHTML = '<i class="fas fa-table"></i> View Claims';
        setupAuditLogFilters();
        await loadAuditLogs();
    } else {
        if (claimsTableContainer) claimsTableContainer.style.display = 'block';
        if (auditLogTableContainer) auditLogTableContainer.style.display = 'none';
        if (auditLogControls) auditLogControls.style.display = 'none';
        if (loadingAuditLog) loadingAuditLog.style.display = 'none';
        if (searchContainer) searchContainer.style.display = 'flex';
        
        if (auditLogBtn) auditLogBtn.innerHTML = '<i class="fas fa-list-ul"></i> Audit Log';
        await loadClaims();
    }
}

// Load audit logs from Supabase
async function loadAuditLogs(filters = {}) {
    const loadingElement = document.getElementById('loadingAuditLog');
    const tableBody = document.getElementById('auditLogTableBody');
    if (!loadingElement || !tableBody) return;
    loadingElement.style.display = 'block';
    tableBody.innerHTML = '';
    try {
        let query = supabaseClient
            .from('audit_logs')
            .select(`
                id,
                user_id,
                user_role,
                user_name,
                claim_id,
                claim_number,
                action,
                action_description,
                timestamp,
                outcome,
                status,
                ip_address,
                user_agent,
                metadata,
                created_at,
                users:user_id (
                    name,
                    email,
                    role
                )
            `)
            .order('timestamp', { ascending: false })
            .limit(200);

        if (filters.action) query = query.eq('action', filters.action);
        if (filters.outcome) query = query.eq('outcome', filters.outcome);
        if (filters.search) query = query.or(`claim_number.ilike.%${filters.search}%,user_name.ilike.%${filters.search}%`);

        const { data: auditLogs, error } = await query;

        if (error) {
            console.error('Error fetching audit logs:', error);
            tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 40px; color: #666;">Failed to load audit logs. Please try again.</td></tr>';
            return;
        }

        if (!auditLogs || auditLogs.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 40px; color: #666;">No audit log entries found.</td></tr>';
            allAuditLogs = [];
            return;
        }

        allAuditLogs = auditLogs;
        displayAuditLogs(auditLogs);
    } catch (err) {
        console.error('Error loading audit logs:', err);
        tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 40px; color: #666;">An error occurred while loading audit logs.</td></tr>';
    } finally {
        loadingElement.style.display = 'none';
    }
}

function displayAuditLogs(auditLogs) {
    const tableBody = document.getElementById('auditLogTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    auditLogs.forEach(log => {
        const row = document.createElement('tr');
        row.style.cursor = 'pointer';
        row.title = 'Click to view details';
        row.addEventListener('click', () => showAuditLogDetails(log));

        const userName = log.user_name || (log.users && log.users.name) || 'Unknown User';
        const userEmail = log.users && log.users.email ? log.users.email : '';
        const userRole = log.user_role ? log.user_role.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') : '';
        const userCell = document.createElement('td');
        userCell.innerHTML = `
            <div style="display: flex; flex-direction: column;">
                <span style="font-weight: 500;">${escapeHtml(userName)}</span>
                <span style="font-size: 0.85rem; color: #666;">${escapeHtml(userRole)}</span>
                ${userEmail ? `<span style="font-size: 0.75rem; color: #999;">${escapeHtml(userEmail)}</span>` : ''}
            </div>
        `;
        row.appendChild(userCell);

        const claimCell = document.createElement('td');
        claimCell.innerHTML = `
            <div style="display: flex; flex-direction: column;">
                <span style="font-weight: 500;">${escapeHtml(log.claim_number)}</span>
                <span style="font-size: 0.75rem; color: #999; font-family: monospace;">${escapeHtml((log.claim_id || '').substring(0,8))}...</span>
            </div>
        `;
        row.appendChild(claimCell);

        const actionCell = document.createElement('td');
        const actionBadge = getActionBadge(log.action);
        const hasMetadata = log.metadata && Object.keys(log.metadata).length > 0;
        actionCell.innerHTML = `
            <div style="display: flex; flex-direction: column;">
                <span>${actionBadge}</span>
                ${log.action_description ? `<span style="font-size: 0.85rem; color: #666; margin-top: 4px;">${escapeHtml(log.action_description)}</span>` : ''}
                ${hasMetadata ? `<span style="font-size: 0.75rem; color: #3b82f6; margin-top: 2px;"><i class="fas fa-info-circle"></i> Has metadata</span>` : ''}
            </div>
        `;
        row.appendChild(actionCell);

        const timestampCell = document.createElement('td');
        const timestamp = new Date(log.timestamp);
        timestampCell.innerHTML = `
            <div style="display: flex; flex-direction: column;">
                <span style="font-weight: 500;">${formatDate(timestamp)}</span>
                <span style="font-size: 0.85rem; color: #666;">${formatTime(timestamp)}</span>
            </div>
        `;
        row.appendChild(timestampCell);

        const statusCell = document.createElement('td');
        statusCell.innerHTML = getStatusBadge(log.outcome || log.status);
        row.appendChild(statusCell);

        tableBody.appendChild(row);
    });
}

function setupAuditLogFilters() {
    const actionFilter = document.getElementById('actionFilter');
    const outcomeFilter = document.getElementById('outcomeFilter');
    const auditSearch = document.getElementById('auditSearch');
    if (!actionFilter || !outcomeFilter || !auditSearch) return;

    const newActionFilter = actionFilter.cloneNode(true);
    actionFilter.parentNode.replaceChild(newActionFilter, actionFilter);
    const newOutcomeFilter = outcomeFilter.cloneNode(true);
    outcomeFilter.parentNode.replaceChild(newOutcomeFilter, outcomeFilter);
    const newAuditSearch = auditSearch.cloneNode(true);
    auditSearch.parentNode.replaceChild(newAuditSearch, auditSearch);

    newActionFilter.addEventListener('change', applyAuditLogFilters);
    newOutcomeFilter.addEventListener('change', applyAuditLogFilters);
    newAuditSearch.addEventListener('input', debounce(applyAuditLogFilters, 300));
}

async function applyAuditLogFilters() {
    const actionFilter = document.getElementById('actionFilter');
    const outcomeFilter = document.getElementById('outcomeFilter');
    const auditSearch = document.getElementById('auditSearch');
    const filters = {};
    if (actionFilter && actionFilter.value) filters.action = actionFilter.value;
    if (outcomeFilter && outcomeFilter.value) filters.outcome = outcomeFilter.value;
    if (auditSearch && auditSearch.value.trim()) filters.search = auditSearch.value.trim();
    await loadAuditLogs(filters);
}

function showAuditLogDetails(log) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';
    const timestamp = new Date(log.timestamp);
    const hasMetadata = log.metadata && Object.keys(log.metadata).length > 0;
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3><i class="fas fa-file-alt"></i> Audit Log Details</h3>
                <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
            </div>
            <div class="modal-body">
                <div style="display: grid; gap: 20px;">
                    <div class="info-section">
                        <h4 style="color: #667eea; margin-bottom: 12px;"><i class="fas fa-user"></i> User Information</h4>
                        <div class="info-grid">
                            <div class="info-item">
                                <label>Name:</label>
                                <span>${escapeHtml(log.user_name || 'Unknown')}</span>
                            </div>
                            <div class="info-item">
                                <label>Role:</label>
                                <span>${escapeHtml(log.user_role)}</span>
                            </div>
                            ${log.users && log.users.email ? `
                            <div class="info-item">
                                <label>Email:</label>
                                <span>${escapeHtml(log.users.email)}</span>
                            </div>` : ''}
                            ${log.ip_address ? `
                            <div class="info-item">
                                <label>IP Address:</label>
                                <span style="font-family: monospace;">${escapeHtml(log.ip_address)}</span>
                            </div>` : ''}
                        </div>
                    </div>
                    <div class="info-section">
                        <h4 style="color: #667eea; margin-bottom: 12px;"><i class="fas fa-file-contract"></i> Claim Information</h4>
                        <div class="info-grid">
                            <div class="info-item">
                                <label>Claim Number:</label>
                                <span style="font-weight: 600;">${escapeHtml(log.claim_number)}</span>
                            </div>
                            <div class="info-item">
                                <label>Claim ID:</label>
                                <span style="font-family: monospace; font-size: 0.85rem;">${escapeHtml(log.claim_id)}</span>
                            </div>
                        </div>
                    </div>
                    <div class="info-section">
                        <h4 style="color: #667eea; margin-bottom: 12px;"><i class="fas fa-tasks"></i> Action Details</h4>
                        <div class="info-grid">
                            <div class="info-item">
                                <label>Action:</label>
                                <span>${getActionBadge(log.action)}</span>
                            </div>
                            <div class="info-item">
                                <label>Outcome:</label>
                                <span>${getStatusBadge(log.outcome)}</span>
                            </div>
                            ${log.status ? `
                            <div class="info-item">
                                <label>Related Status:</label>
                                <span>${getStatusBadge(log.status)}</span>
                            </div>` : ''}
                            ${log.action_description ? `
                            <div class="info-item" style="grid-column: 1 / -1;">
                                <label>Description:</label>
                                <span>${escapeHtml(log.action_description)}</span>
                            </div>` : ''}
                        </div>
                    </div>
                    <div class="info-section">
                        <h4 style="color: #667eea; margin-bottom: 12px;"><i class="fas fa-clock"></i> Timing</h4>
                        <div class="info-grid">
                            <div class="info-item">
                                <label>Timestamp:</label>
                                <span>${formatDate(timestamp)} at ${formatTime(timestamp)}</span>
                            </div>
                            <div class="info-item">
                                <label>Log ID:</label>
                                <span style="font-family: monospace; font-size: 0.85rem;">${escapeHtml(log.id)}</span>
                            </div>
                        </div>
                    </div>
                    ${hasMetadata ? `
                    <div class="info-section">
                        <h4 style="color: #667eea; margin-bottom: 12px;"><i class="fas fa-database"></i> Additional Data (Metadata)</h4>
                        <div style="background: #f8fafc; padding: 12px; border-radius: 6px; border: 1px solid #e2e8f0;">
                            <pre style="margin: 0; font-size: 0.9rem; white-space: pre-wrap; word-wrap: break-word;">${JSON.stringify(log.metadata, null, 2)}</pre>
                        </div>
                    </div>` : ''}
                    ${log.user_agent ? `
                    <div class="info-section">
                        <h4 style="color: #667eea; margin-bottom: 12px;"><i class="fas fa-desktop"></i> Browser/Client Information</h4>
                        <div style="background: #f8fafc; padding: 12px; border-radius: 6px; border: 1px solid #e2e8f0;">
                            <code style="font-size: 0.85rem; word-break: break-all;">${escapeHtml(log.user_agent)}</code>
                        </div>
                    </div>` : ''}
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

// Debounce helper
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => { clearTimeout(timeout); func(...args); };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Action badge helper
function getActionBadge(action) {
    const actionLabels = {
        'claim_created': { label: 'Claim Created', icon: 'fa-plus-circle', color: '#3b82f6' },
        'claim_submitted': { label: 'Claim Submitted', icon: 'fa-paper-plane', color: '#8b5cf6' },
        'claim_updated': { label: 'Claim Updated', icon: 'fa-edit', color: '#6366f1' },
        'claim_approved': { label: 'Claim Approved', icon: 'fa-check-circle', color: '#10b981' },
        'claim_rejected': { label: 'Claim Rejected', icon: 'fa-times-circle', color: '#ef4444' },
        'document_uploaded': { label: 'Document Uploaded', icon: 'fa-upload', color: '#3b82f6' },
        'document_verified': { label: 'Document Verified', icon: 'fa-check-square', color: '#10b981' },
        'document_rejected': { label: 'Document Rejected', icon: 'fa-ban', color: '#f59e0b' },
        'car_company_approval': { label: 'Car Co. Approval', icon: 'fa-car', color: '#10b981' },
        'car_company_rejection': { label: 'Car Co. Rejection', icon: 'fa-car', color: '#ef4444' },
        'insurance_company_approval': { label: 'Insurance Approval', icon: 'fa-shield', color: '#10b981' },
        'insurance_company_rejection': { label: 'Insurance Rejection', icon: 'fa-shield', color: '#ef4444' },
        'status_changed': { label: 'Status Changed', icon: 'fa-exchange-alt', color: '#6366f1' },
        'notes_added': { label: 'Notes Added', icon: 'fa-sticky-note', color: '#8b5cf6' },
        'other': { label: 'Other Action', icon: 'fa-circle', color: '#6b7280' }
    };
    const actionInfo = actionLabels[action] || actionLabels['other'];
    return `<span style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 4px; background-color: ${actionInfo.color}15; color: ${actionInfo.color}; font-size: 0.9rem; font-weight: 500;"><i class="fas ${actionInfo.icon}"></i> ${actionInfo.label}</span>`;
}

// Status badge helper
function getStatusBadge(status) {
    if (!status) return '<span style="color: #999;">—</span>';
    const statusColors = {
        'success': { bg: '#10b98115', color: '#10b981', label: 'Success' },
        'failure': { bg: '#ef444415', color: '#ef4444', label: 'Failed' },
        'pending': { bg: '#f59e0b15', color: '#f59e0b', label: 'Pending' },
        'cancelled': { bg: '#6b728015', color: '#6b7280', label: 'Cancelled' },
        'approved': { bg: '#10b98115', color: '#10b981', label: 'Approved' },
        'rejected': { bg: '#ef444415', color: '#ef4444', label: 'Rejected' },
        'under_review': { bg: '#3b82f615', color: '#3b82f6', label: 'Under Review' }
    };
    const statusInfo = statusColors[(status || '').toLowerCase()] || { bg: '#6b728015', color: '#6b7280', label: status };
    return `<span style="display: inline-block; padding: 4px 12px; border-radius: 12px; background-color: ${statusInfo.bg}; color: ${statusInfo.color}; font-size: 0.85rem; font-weight: 600;">${statusInfo.label}</span>`;
}

// Simple HTML escape
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Format time helper
function formatTime(date) {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

// End audit log feature

