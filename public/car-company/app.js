// Car Company Portal - Document Verification System
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
let currentDocuments = [];
let currentVehicleInfo = null;
let currentClaimApproved = false;
let currentClaimData = null;

// Car company verifiable document types
const CAR_COMPANY_DOCUMENT_TYPES = [
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
        if (role !== 'car_company') {
            const destination = ROLE_ROUTES[role] || '/';
            redirectTo(destination);
            return;
        }

        initializeApp();
    } catch (error) {
        console.error('Failed to initialise car company portal:', error);
        redirectTo('/');
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', bootstrapPortal);

async function initializeApp() {
    console.log('Initializing Car Company Portal...');
    
    // Ensure action buttons are hidden on init
    const decisionActions = document.getElementById('carClaimDecisionActions');
    if (decisionActions) {
        decisionActions.style.display = 'none';
    }
    
    // Set up event listeners
    setupEventListeners();
    
    // Check if we have any claims data, if not create test data
    const { data: existingClaims } = await supabaseClient
        .from('claims')
        .select('id')
        .limit(1);
    
    if (!existingClaims || existingClaims.length === 0) {
        console.log('No claims found, creating test data...');
        await createTestData();
    }
    
    // Load claims data
    await loadClaims();
}

async function createTestData() {
    try {
        // Create test users
        const testUsers = [
            {
                id: '11111111-1111-1111-1111-111111111111',
                name: 'John Doe',
                email: 'john.doe@example.com',
                phone: '+1-555-0123',
                created_at: new Date().toISOString()
            },
            {
                id: '22222222-2222-2222-2222-222222222222',
                name: 'Jane Smith',
                email: 'jane.smith@example.com',
                phone: '+1-555-0456',
                created_at: new Date().toISOString()
            }
        ];

        // Insert users (ignore conflicts)
        await supabaseClient
            .from('users')
            .upsert(testUsers, { onConflict: 'id' });

        // Create test claims
        const testClaims = [
            {
                id: 'claim-001',
                claim_number: 'CLM-2025-001',
                user_id: '11111111-1111-1111-1111-111111111111',
                status: 'submitted',
                is_approved_by_car_company: false,
                created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
                submitted_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
            },
            {
                id: 'claim-002',
                claim_number: 'CLM-2025-002',
                user_id: '22222222-2222-2222-2222-222222222222',
                status: 'under_review',
                is_approved_by_car_company: false,
                created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
                submitted_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()
            }
        ];

        await supabaseClient
            .from('claims')
            .upsert(testClaims, { onConflict: 'id' });

        // Create test documents
        const testDocuments = [
            // Claim 1 documents
            {
                id: 'doc-001',
                claim_id: 'claim-001',
                type: 'lto_or',
                file_name: 'lto_official_receipt_1757234240831_0_licensed-image.jpeg',
                file_size_bytes: 245760,
                format: 'jpeg',
                status: 'uploaded',
                remote_url: 'https://vvnsludqdidnqpbzzgeb.supabase.co/storage/v1/object/public/insurevis-documents/claim-001/doc-001/lto_official_receipt_1757234240831_0_licensed-image.jpeg',
                verified_by_car_company: false,
                is_primary: true,
                created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
            },
            {
                id: 'doc-002',
                claim_id: 'claim-001',
                type: 'lto_cr',
                file_name: 'lto_certificate_1757234240832_1_licensed-image.jpeg',
                file_size_bytes: 189440,
                format: 'jpeg',
                status: 'uploaded',
                remote_url: 'https://vvnsludqdidnqpbzzgeb.supabase.co/storage/v1/object/public/insurevis-documents/claim-001/doc-002/lto_certificate_1757234240832_1_licensed-image.jpeg',
                verified_by_car_company: true,
                car_company_verification_date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
                car_company_verification_notes: 'Document verified successfully against manufacturer records',
                is_primary: false,
                created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
            },
            {
                id: 'doc-003',
                claim_id: 'claim-001',
                type: 'damage_photos',
                file_name: 'damage_photo_1757234240833_2_licensed-image.jpeg',
                file_size_bytes: 312800,
                format: 'jpeg',
                status: 'uploaded',
                remote_url: 'https://vvnsludqdidnqpbzzgeb.supabase.co/storage/v1/object/public/insurevis-documents/claim-001/doc-003/damage_photo_1757234240833_2_licensed-image.jpeg',
                verified_by_car_company: false,
                is_primary: false,
                created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
            },
            {
                id: 'doc-004',
                claim_id: 'claim-001',
                type: 'job_estimate',
                file_name: 'repair_estimate_1757234240834_3_licensed-image.jpeg',
                file_size_bytes: 287340,
                format: 'jpeg',
                status: 'uploaded',
                remote_url: 'https://vvnsludqdidnqpbzzgeb.supabase.co/storage/v1/object/public/insurevis-documents/claim-001/doc-004/repair_estimate_1757234240834_3_licensed-image.jpeg',
                verified_by_car_company: false,
                is_primary: false,
                created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
            },
            // Claim 2 documents
            {
                id: 'doc-005',
                claim_id: 'claim-002',
                type: 'drivers_license',
                file_name: 'drivers_license_1757234240835_0_licensed-image.jpeg',
                file_size_bytes: 198600,
                format: 'jpeg',
                status: 'uploaded',
                remote_url: 'https://vvnsludqdidnqpbzzgeb.supabase.co/storage/v1/object/public/insurevis-documents/claim-002/doc-005/drivers_license_1757234240835_0_licensed-image.jpeg',
                verified_by_car_company: false,
                is_primary: true,
                created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()
            },
            {
                id: 'doc-006',
                claim_id: 'claim-002',
                type: 'owner_valid_id',
                file_name: 'owner_id_1757234240836_1_licensed-image.jpeg',
                file_size_bytes: 234560,
                format: 'jpeg',
                status: 'uploaded',
                remote_url: 'https://vvnsludqdidnqpbzzgeb.supabase.co/storage/v1/object/public/insurevis-documents/claim-002/doc-006/owner_id_1757234240836_1_licensed-image.jpeg',
                verified_by_car_company: true,
                car_company_verification_date: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
                car_company_verification_notes: 'ID verified - matches vehicle registration records',
                is_primary: false,
                created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()
            },
            {
                id: 'doc-007',
                claim_id: 'claim-002',
                type: 'stencil_strips',
                file_name: 'vehicle_stencils_1757234240837_2_licensed-image.jpeg',
                file_size_bytes: 267890,
                format: 'jpeg',
                status: 'uploaded',
                remote_url: 'https://vvnsludqdidnqpbzzgeb.supabase.co/storage/v1/object/public/insurevis-documents/claim-002/doc-007/vehicle_stencils_1757234240837_2_licensed-image.jpeg',
                verified_by_car_company: false,
                is_primary: false,
                created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()
            }
        ];

        await supabaseClient
            .from('documents')
            .upsert(testDocuments, { onConflict: 'id' });

        console.log('✅ Test data created successfully');
        
    } catch (error) {
        console.error('Error creating test data:', error);
        // Continue anyway - the app should still work without test data
    }
}

function setupEventListeners() {
    // Search functionality
    document.getElementById('claimsSearch').addEventListener('input', filterClaims);
    document.getElementById('statusFilter').addEventListener('change', filterClaims);
    
    // Navigation
    document.getElementById('backToClaims').addEventListener('click', showClaimsPage);

    // Audit Log button
    const auditLogBtn = document.getElementById('auditLogBtn');
    if (auditLogBtn) {
        auditLogBtn.addEventListener('click', toggleAuditLog);
    }

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
    
    // Document verification
    // document.getElementById('saveVerification').addEventListener('click', saveDocumentVerification); // Removed
    
    // Batch Verification Navigation
    document.getElementById('prevDocBtn').addEventListener('click', () => navigateDocument(-1));
    document.getElementById('nextDocBtn').addEventListener('click', () => navigateDocument(1));
    
    // Verification Actions
    document.getElementById('verifyDocBtn').addEventListener('click', () => handleDocumentDecision('verify'));
    document.getElementById('rejectDocumentBtn').addEventListener('click', () => openDocumentRejectionPane());

    // Claim decision buttons (approve/reject)
    setupClaimDecisionButtons();

    // Claim status dropdown/control removed from UI; status updates are handled elsewhere.
}

// Track current view state
let isShowingAuditLog = false;
let allAuditLogs = []; // Store full audit log data for filtering

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
        // Show audit log
        claimsTableContainer.style.display = 'none';
        auditLogTableContainer.style.display = 'block';
        if (auditLogControls) auditLogControls.style.display = 'block';
        loadingClaims.style.display = 'none';
        if (searchContainer) searchContainer.style.display = 'none';
        
        // Update button text
        auditLogBtn.innerHTML = '<i class="fas fa-table"></i> View Claims';
        
        // Set up filter listeners
        setupAuditLogFilters();
        
        // Load audit log data
        await loadAuditLogs();
    } else {
        // Show claims table
        claimsTableContainer.style.display = 'block';
        auditLogTableContainer.style.display = 'none';
        if (auditLogControls) auditLogControls.style.display = 'none';
        loadingAuditLog.style.display = 'none';
        if (searchContainer) searchContainer.style.display = 'flex';
        
        // Update button text
        auditLogBtn.innerHTML = '<i class="fas fa-list-ul"></i> Audit Log';
        
        // Reload claims
        await loadClaims();
    }
}

// Load audit logs from Supabase
async function loadAuditLogs(filters = {}) {
    const loadingElement = document.getElementById('loadingAuditLog');
    const tableBody = document.getElementById('auditLogTableBody');
    
    loadingElement.style.display = 'block';
    tableBody.innerHTML = '';
    
    try {
        // Build query with optional filters
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
            .limit(200); // Increased limit to 200 entries

        // Apply filters if provided
        if (filters.action) {
            query = query.eq('action', filters.action);
        }
        if (filters.outcome) {
            query = query.eq('outcome', filters.outcome);
        }
        if (filters.search) {
            query = query.or(`claim_number.ilike.%${filters.search}%,user_name.ilike.%${filters.search}%`);
        }

        const { data: auditLogs, error } = await query;

        if (error) {
            console.error('Error fetching audit logs:', error);
            showError('Failed to load audit logs');
            tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 40px; color: #666;">Failed to load audit logs. Please try again.</td></tr>';
            return;
        }

        if (!auditLogs || auditLogs.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 40px; color: #666;">No audit log entries found.</td></tr>';
            allAuditLogs = [];
            return;
        }

        console.log('Loaded audit logs:', auditLogs);
        allAuditLogs = auditLogs; // Store for filtering
        displayAuditLogs(auditLogs);
        
    } catch (error) {
        console.error('Error loading audit logs:', error);
        showError('Failed to load audit logs');
        tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 40px; color: #666;">An error occurred while loading audit logs.</td></tr>';
    } finally {
        loadingElement.style.display = 'none';
    }
}

// Display audit logs in the table
function displayAuditLogs(auditLogs) {
    const tableBody = document.getElementById('auditLogTableBody');
    tableBody.innerHTML = '';
    
    auditLogs.forEach(log => {
        const row = document.createElement('tr');
        row.style.cursor = 'pointer';
        row.title = 'Click to view details';
        
        // Add click handler to show detailed modal
        row.addEventListener('click', () => showAuditLogDetails(log));
        
        // User who handled transaction
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
        
        // Claim ID
        const claimCell = document.createElement('td');
        claimCell.innerHTML = `
            <div style="display: flex; flex-direction: column;">
                <span style="font-weight: 500;">${escapeHtml(log.claim_number)}</span>
                <span style="font-size: 0.75rem; color: #999; font-family: monospace;">${escapeHtml(log.claim_id.substring(0, 8))}...</span>
            </div>
        `;
        row.appendChild(claimCell);
        
        // Action
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
        
        // Timestamp
        const timestampCell = document.createElement('td');
        const timestamp = new Date(log.timestamp);
        const now = new Date();
        const diffHours = Math.floor((now - timestamp) / (1000 * 60 * 60));
        const timeAgo = diffHours < 1 ? 'Just now' : 
                        diffHours < 24 ? `${diffHours}h ago` : 
                        diffHours < 168 ? `${Math.floor(diffHours / 24)}d ago` : 
                        formatDate(timestamp);
        timestampCell.innerHTML = `
            <div style="display: flex; flex-direction: column;">
                <span style="font-weight: 500;">${formatDate(timestamp)}</span>
                <span style="font-size: 0.85rem; color: #666;">${formatTime(timestamp)}</span>
                <span style="font-size: 0.75rem; color: #999;">${timeAgo}</span>
            </div>
        `;
        row.appendChild(timestampCell);
        
        // Status/Outcome
        const statusCell = document.createElement('td');
        const statusBadge = getStatusBadge(log.outcome || log.status);
        statusCell.innerHTML = statusBadge;
        row.appendChild(statusCell);
        
        tableBody.appendChild(row);
    });
}

// Setup audit log filter listeners
function setupAuditLogFilters() {
    const actionFilter = document.getElementById('actionFilter');
    const outcomeFilter = document.getElementById('outcomeFilter');
    const auditSearch = document.getElementById('auditSearch');
    
    // Remove existing listeners to prevent duplicates
    const newActionFilter = actionFilter.cloneNode(true);
    actionFilter.parentNode.replaceChild(newActionFilter, actionFilter);
    
    const newOutcomeFilter = outcomeFilter.cloneNode(true);
    outcomeFilter.parentNode.replaceChild(newOutcomeFilter, outcomeFilter);
    
    const newAuditSearch = auditSearch.cloneNode(true);
    auditSearch.parentNode.replaceChild(newAuditSearch, auditSearch);
    
    // Add new listeners
    newActionFilter.addEventListener('change', applyAuditLogFilters);
    newOutcomeFilter.addEventListener('change', applyAuditLogFilters);
    newAuditSearch.addEventListener('input', debounce(applyAuditLogFilters, 300));
}

// Apply filters to audit logs
async function applyAuditLogFilters() {
    const actionFilter = document.getElementById('actionFilter');
    const outcomeFilter = document.getElementById('outcomeFilter');
    const auditSearch = document.getElementById('auditSearch');
    
    const filters = {};
    
    if (actionFilter && actionFilter.value) {
        filters.action = actionFilter.value;
    }
    if (outcomeFilter && outcomeFilter.value) {
        filters.outcome = outcomeFilter.value;
    }
    if (auditSearch && auditSearch.value.trim()) {
        filters.search = auditSearch.value.trim();
    }
    
    await loadAuditLogs(filters);
}

// Show detailed audit log modal
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
    
    // Close on background click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

// Debounce helper function
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Helper function to get action badge HTML
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
    return `<span style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 4px; background-color: ${actionInfo.color}15; color: ${actionInfo.color}; font-size: 0.9rem; font-weight: 500;">
        <i class="fas ${actionInfo.icon}"></i> ${actionInfo.label}
    </span>`;
}

// Helper function to get status badge HTML
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
    
    const statusInfo = statusColors[status.toLowerCase()] || { bg: '#6b728015', color: '#6b7280', label: status };
    return `<span style="display: inline-block; padding: 4px 12px; border-radius: 12px; background-color: ${statusInfo.bg}; color: ${statusInfo.color}; font-size: 0.85rem; font-weight: 600;">${statusInfo.label}</span>`;
}

// Helper function to escape HTML
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Helper function to format date
function formatDate(date) {
    return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
    });
}

// Helper function to format time
function formatTime(date) {
    return date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true 
    });
}

// Global realtime subscription tracker for car company portal
let claimsRealtimeSubscription = null;
let documentsRealtimeSubscription = null;
// Helper to coalesce rapid realtime events and avoid spamming DB loads
let claimsRealtimeReloadTimeout = null;
let documentsRealtimeReloadTimeout = null;
// Polling intervals as fallback
let claimsPollingInterval = null;
let documentsPollingInterval = null;

// Claims Management
async function loadClaims() {
    const loadingElement = document.getElementById('loadingClaims');
    const tableBody = document.getElementById('claimsTableBody');
    
    loadingElement.style.display = 'block';
    
    try {
        // First, migrate existing claims that have is_approved_by_car_company but no car_company_status
        try {
            const { data: claimsToMigrate, error: migrateCheckError } = await supabaseClient
                .from('claims')
                .select('id, is_approved_by_car_company, car_company_status, car_company_approval_notes')
                .or('car_company_status.is.null,car_company_status.eq.pending');
            
            if (!migrateCheckError && claimsToMigrate && claimsToMigrate.length > 0) {
                const updates = claimsToMigrate.map(claim => {
                    let newStatus = 'pending';
                    if (claim.is_approved_by_car_company === true) {
                        newStatus = 'approved';
                    } else if (claim.is_approved_by_car_company === false && claim.car_company_approval_notes) {
                        newStatus = 'rejected';
                    }
                    return { id: claim.id, car_company_status: newStatus };
                });
                
                // Update claims in batches
                for (const update of updates) {
                    await supabaseClient
                        .from('claims')
                        .update({ car_company_status: update.car_company_status })
                        .eq('id', update.id);
                }
                
                console.log(`✅ Migrated ${updates.length} claims to use car_company_status`);
            }
        } catch (migrateError) {
            console.warn('Migration check skipped:', migrateError);
        }
        
        // Fetch claims with user information and document counts
            const { data: claims, error } = await supabaseClient
                .from('claims')
                .select(`
                    *,
                    users:user_id (
                        name,
                        email,
                        phone
                    ),
                    documents (
                        id,
                        type,
                        verified_by_car_company,
                        car_company_verification_notes
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

        // --- NEW LOGIC: Check for unverified documents in approved claims ---
        if (claims && claims.length > 0) {
            const claimsToRevert = [];
            
            claims.forEach(claim => {
                const isApproved = claim.car_company_status === 'approved' || claim.is_approved_by_car_company === true;
                
                if (isApproved && claim.documents) {
                    // Check if there is ANY document relevant to car company that is NOT verified
                    const hasUnverifiedDocs = claim.documents.some(doc => 
                        CAR_COMPANY_DOCUMENT_TYPES.includes(doc.type) && 
                        !doc.verified_by_car_company
                    );

                    if (hasUnverifiedDocs) {
                        claimsToRevert.push(claim.id);
                        
                        // Update local object immediately so UI shows "pending"
                        claim.car_company_status = 'pending';
                        claim.is_approved_by_car_company = false;
                    }
                }
            });

            if (claimsToRevert.length > 0) {
                console.log(`🔄 Reverting ${claimsToRevert.length} approved claims to pending due to unverified documents.`);
                
                // Perform the update in background
                await supabaseClient
                    .from('claims')
                    .update({ 
                        car_company_status: 'pending',
                        is_approved_by_car_company: false,
                        car_company_approval_date: null
                    })
                    .in('id', claimsToRevert);
            }
        }
        // --- END NEW LOGIC ---

        console.log('Loaded claims:', claims);
        
        // Process claims data
        const processedClaims = claims.map(claim => {
            const carCompanyDocs = claim.documents.filter(doc => 
                CAR_COMPANY_DOCUMENT_TYPES.includes(doc.type)
            );
            const verifiedCarDocs = carCompanyDocs.filter(doc => 
                doc.verified_by_car_company
            );
            // FIX: Only count as rejected if NOT verified (avoids double counting)
            const rejectedCarDocs = carCompanyDocs.filter(doc => 
                !doc.verified_by_car_company && doc.car_company_verification_notes
            );
            
            return {
                ...claim,
                totalCarCompanyDocs: carCompanyDocs.length,
                verifiedCarCompanyDocs: verifiedCarDocs.length,
                rejectedCarCompanyDocs: rejectedCarDocs.length,
                pendingCarCompanyDocs: carCompanyDocs.length - verifiedCarDocs.length - rejectedCarDocs.length
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
                console.log('✅ Subscribed to claims realtime updates (car company)');
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
                    <p>No claims found</p>
                </td>
            </tr>
        `;
        return;
    }

    tableBody.innerHTML = claims.map(claim => `
        <tr class="claim-row ${
            claim.car_company_status === 'approved' ? 'approved-row' : 
            claim.car_company_status === 'rejected' ? 'rejected-row' : 
            claim.car_company_status === 'appealed' ? 'appealed-row' :
            ''
        }" data-claim-id="${claim.id}" data-car-company-status="${(claim.car_company_status || 'pending')}">
            <td>
                <strong>${claim.claim_number}</strong>
            </td>
            <td>
                <div class="user-info">
                    <span class="user-name">${claim.users?.name || 'Unknown'}</span>
                        <small>${claim.users?.email || ''}${claim.users?.phone ? ' · ' + claim.users.phone : ''}</small>
                </div>
            </td>
            <td>
                ${(() => {
                    const carStatus = claim.car_company_status || 'pending';
                    const normalized = String(carStatus).toLowerCase();
                    const label = formatStatus(normalized);
                    const klass = normalized.replace(/\s+/g, '_');
                    return `<span class="status-badge status-${klass}">${label}</span>`;
                })()}
            </td>
            <td>
                <span class="doc-count">${claim.totalCarCompanyDocs}</span>
            </td>
            <td>
                <span class="pending-count ${claim.pendingCarCompanyDocs > 0 ? 'has-pending' : ''}">
                    ${claim.pendingCarCompanyDocs}
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
    
    // Show documents page
    showDocumentsPage();
    
    // Load documents for this claim
    await loadClaimDocuments(claimId);
    
    // Set up real-time subscription for documents
    await setupDocumentsRealtimeSubscription();
}

async function loadClaimDocuments(claimId) {
    const loadingElement = document.getElementById('loadingDocuments');
    const documentsGrid = document.getElementById('documentsGrid');
    
    loadingElement.style.display = 'block';
    
    try {
        // Fetch claim details
        const { data: claim, error: claimError } = await supabaseClient
            .from('claims')
            .select(`
                *,
                users:user_id (name, email, phone)
            `)
            .eq('id', claimId)
            .single();

        if (claimError) {
            console.error('Error fetching claim:', claimError);
            showError('Failed to load claim details');
            return;
        }

    // Remember which claim is open and store claim data globally
        currentClaim = claim.id;
        currentClaimData = claim;
    // Track approval state for UI logic - both approved and rejected should be view-only
    const isApproved = claim.car_company_status === 'approved';
    const isRejected = claim.car_company_status === 'rejected';
    currentClaimApproved = isApproved || isRejected;

        // Update claim header
        document.getElementById('claimTitle').textContent = `Claim ${claim.claim_number}`;
        document.getElementById('claimDescription').textContent = 
            `Documents for ${claim.users?.name || 'Unknown User'} - Car Company Verification`;

        // (status pill update moved further down after summaryClaim is set)

        // Populate top-of-grid vehicle summary using fields from the claim
        try {
            // Prefer vehicle fields stored on the claim record. These attribute
            // names were provided: vehicle_make, vehicle_model, vehicle_year,
            // vehicle_plate_number.
            const vehicleMake = claim.vehicle_make || null;
            const vehicleModel = claim.vehicle_model || null;
            const vehicleYear = claim.vehicle_year || null;
            const vehiclePlate = claim.vehicle_plate_number || null;

            currentVehicleInfo = {
                make: vehicleMake || undefined,
                model: vehicleModel || undefined,
                year: vehicleYear || undefined,
                licensePlate: vehiclePlate || undefined
            };

            document.getElementById('summaryClaim').textContent = `Claim ${claim.claim_number}`;
            document.getElementById('summaryUser').textContent = `${claim.users?.name || 'Unknown User'} · ${claim.users?.email || ''}`;
            // Update small status pill next to the claim summary title (after setting summaryClaim)
            try {
                const pill = document.getElementById('statusPill');
                if (pill) {
                    // Map 'under_review' as the review state used throughout the UI
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
            } catch (err) {
                console.warn('Could not update status pill:', err);
            }
            document.getElementById('summaryMake').textContent = currentVehicleInfo.make || '-';
            document.getElementById('summaryModel').textContent = currentVehicleInfo.model || '-';
            document.getElementById('summaryYear').textContent = currentVehicleInfo.year || '-';
            document.getElementById('summaryPlate').textContent = currentVehicleInfo.licensePlate || '-';
        } catch (err) {
            console.warn('Could not populate vehicle summary:', err);
            currentVehicleInfo = null;
        }

        // Fetch documents that car company can verify
        const { data: documents, error: docsError } = await supabaseClient
            .from('documents')
            .select('*')
            .eq('claim_id', claimId)
            .in('type', CAR_COMPANY_DOCUMENT_TYPES)
            .order('is_primary', { ascending: false })
            .order('created_at', { ascending: true });

        if (docsError) {
            console.error('Error fetching documents:', docsError);
            showError('Failed to load documents');
            return;
        }

        console.log('Loaded documents:', documents);
        currentDocuments = documents;

        // Update stats (this will also handle decision actions visibility)
        updateDocumentStats(documents);
        
        // Display documents
        displayDocuments(documents);

        // Update decision buttons enabled/disabled state based on claim status
        try {
            setDecisionButtonsState(claim);
        } catch (e) {
            console.warn('Failed to set decision buttons state', e);
        }

        // Apply approved visual/banner and lock controls if approved
        try {
            applyApprovedState(claim);
        } catch (e) {
            console.warn('Failed to apply approved state UI', e);
        }
        
        // Ensure decision actions visibility is correct after all updates
        // This helps with the initial load issue
        // BUT only if the document viewer modal is NOT open
        setTimeout(() => {
            const decisionActions = document.getElementById('carClaimDecisionActions');
            const isModalOpen = document.getElementById('documentViewerModal').style.display === 'flex';
            if (decisionActions && !currentClaimApproved && currentClaim && !isModalOpen) {
                decisionActions.style.display = 'flex';
            }
        }, 100);

        // Show the claim status control for all claims when viewing the claim details.
        // If you later want to restrict this to claim owners or admins, add a
        // permission check here (e.g. compare current user id to claim.user_id).
        // Claim status control removed from the UI per user request.

    } catch (error) {
        console.error('Error loading claim documents:', error);
        showError('Failed to load documents');
    } finally {
        loadingElement.style.display = 'none';
    }
}

function updateDocumentStats(documents) {
    const total = documents.length;
    const verified = documents.filter(doc => doc.verified_by_car_company).length;
    // FIX: Only count rejected if NOT verified (avoids double counting)
    const rejected = documents.filter(doc => !doc.verified_by_car_company && doc.car_company_verification_notes).length;
    const pending = total - verified - rejected;

    document.getElementById('totalDocs').textContent = total;
    document.getElementById('verifiedDocs').textContent = verified;
    document.getElementById('pendingDocs').textContent = pending;
    document.getElementById('rejectedDocs').textContent = rejected;

    // Only show claim decision actions when a claim is actively viewed,
    // the claim has not already been approved/rejected,
    // AND the document viewer modal is NOT currently open
    const decisionActions = document.getElementById('carClaimDecisionActions');
    if (decisionActions) {
        const isClaimOpen = !!currentClaim;
        const isModalOpen = document.getElementById('documentViewerModal').style.display === 'flex';
        
        if (isClaimOpen && !currentClaimApproved && !isModalOpen) {
            decisionActions.style.display = 'flex';
        } else {
            decisionActions.style.display = 'none';
        }
    }
}

// Claim decision handlers
function setupClaimDecisionButtons() {
    const approveBtn = document.getElementById('approveClaimBtn');
    const rejectBtn = document.getElementById('rejectClaimBtn');

    if (approveBtn) approveBtn.addEventListener('click', () => openApprovalConfirm());
    if (rejectBtn) rejectBtn.addEventListener('click', () => openRejectionModal());
}

// Enable or disable decision buttons based on claim status
function setDecisionButtonsState(claim) {
    const approveBtn = document.getElementById('approveClaimBtn');
    const rejectBtn = document.getElementById('rejectClaimBtn');
    if (!approveBtn || !rejectBtn) return;

    // Approve button is enabled only when all car-company documents are verified
    // and the claim is not already approved (claim.is_approved_by_car_company !== true).
    const allDocsVerified = Array.isArray(currentDocuments) && currentDocuments.length > 0 && currentDocuments.every(d => !!d.verified_by_car_company);
    const claimApprovedFlag = !!(claim && claim.is_approved_by_car_company);
    const approveDisabled = !allDocsVerified || claimApprovedFlag;

    approveBtn.disabled = !!approveDisabled;
    if (approveBtn.disabled) approveBtn.classList.add('decision-btn--disabled'); else approveBtn.classList.remove('decision-btn--disabled');

    // Reject is always available to allow explicit rejection notification
    const rejectDisabled = claimApprovedFlag ? true : false;
    rejectBtn.disabled = !!rejectDisabled;
    if (rejectBtn.disabled) rejectBtn.classList.add('decision-btn--disabled'); else rejectBtn.classList.remove('decision-btn--disabled');
}

async function decideClaim(decision, notes = '') {
    if (!currentClaim) {
        showError('No claim selected');
        return;
    }

    try {
        const updateData = {};
        if (decision === 'approved') {
            // Mark claim as approved by car company
            updateData.car_company_status = 'approved';
            updateData.is_approved_by_car_company = true;
            updateData.car_company_approval_date = new Date().toISOString();
            updateData.approved_at = new Date().toISOString();
            if (notes) updateData.car_company_approval_notes = notes;
            // Also set a dedicated flag used earlier if exists
            // (already setting is_approved_by_car_company above)
            // Send notification to claim owner. Resolve user id from claim if possible.
            (async () => {
                try {
                    const { data: claimData, error: claimErr } = await supabaseClient
                        .from('claims')
                        .select('user_id, claim_number')
                        .eq('id', currentClaim)
                        .single();
                    const userId = claimData && claimData.user_id ? claimData.user_id : null;
                    const claimNumber = claimData && claimData.claim_number ? claimData.claim_number : currentClaim;
                    if (userId) {
                        sendNotifToUser(userId, 'Claim Approved', `Your claim ${claimNumber} has been approved by the Car Company.`, 'approved');
                    } else {
                        console.warn('decideClaim: could not determine user_id to notify (approved)');
                    }
                } catch (e) {
                    console.warn('decideClaim: error resolving claim user_id for approved notification', e);
                }
            })();
        } else if (decision === 'rejected') {
            // mark as not approved by car company and set main status to rejected
            console.log('🔴 Processing REJECTED decision');
            updateData.car_company_status = 'rejected';
            updateData.is_approved_by_car_company = false;
            updateData.status = 'rejected'; // Set main status so insurance company knows it's rejected
            updateData.car_company_approval_date = null;
            updateData.rejected_at = new Date().toISOString();
            console.log('📝 rejected_at set to:', updateData.rejected_at);
            if (notes) updateData.car_company_approval_notes = notes;
            (async () => {
                try {
                    const { data: claimData, error: claimErr } = await supabaseClient
                        .from('claims')
                        .select('user_id, claim_number')
                        .eq('id', currentClaim)
                        .single();
                    const userId = claimData && claimData.user_id ? claimData.user_id : null;
                    const claimNumber = claimData && claimData.claim_number ? claimData.claim_number : currentClaim;
                    if (userId) {
                        const message = notes 
                            ? `Your claim ${claimNumber} has been rejected by the Car Company. \n\nReason: \n${notes}`
                            : `Your claim ${claimNumber} has been rejected by the Car Company. Please contact support for details.`;
                        sendNotifToUser(userId, 'Claim Rejected', message, 'rejected');
                    } else {
                        console.warn('decideClaim: could not determine user_id to notify (rejected)');
                    }
                } catch (e) {
                    console.warn('decideClaim: error resolving claim user_id for rejected notification', e);
                }
            })();
        } else if (decision === 'under_review') {
            updateData.status = 'under_review';
            if (notes) updateData.car_company_approval_notes = notes;
            (async () => {
                try {
                    const { data: claimData, error: claimErr } = await supabaseClient
                        .from('claims')
                        .select('user_id, claim_number')
                        .eq('id', currentClaim)
                        .single();
                    const userId = claimData && claimData.user_id ? claimData.user_id : null;
                    const claimNumber = claimData && claimData.claim_number ? claimData.claim_number : currentClaim;
                    if (userId) {
                        sendNotifToUser(userId, 'Claim Under Review', `Your claim ${claimNumber} is marked as Under Review by the Car Company. We will get back to you soon.`, 'review');
                    } else {
                        console.warn('decideClaim: could not determine user_id to notify (under_review)');
                    }
                } catch (e) {
                    console.warn('decideClaim: error resolving claim user_id for under_review notification', e);
                }
            })();
            // Do not change verified flag on hold
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

        // Update UI: hide decision actions and redirect to home
        document.getElementById('carClaimDecisionActions').style.display = 'none';
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
                    // NOTE: custom headers can trigger CORS preflight failures if
                    // the server does not explicitly allow them. The `X-Client-Info`
                    // header caused a blocked preflight for localhost dev. Remove
                    // it unless your server's CORS allow-list includes it.
                    // 'X-Client-Info': 'insurevis-web-portal/1.0'
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

function displayDocuments(documents) {
    const documentsGrid = document.getElementById('documentsGrid');
    
    if (!documents || documents.length === 0) {
        documentsGrid.innerHTML = `
            <div class="no-data">
                <i class="fas fa-inbox"></i>
                <p>No car company verifiable documents found for this claim</p>
            </div>
        `;
        return;
    }

    documentsGrid.innerHTML = documents.map(doc => `
        <div class="document-list-item ${doc.verified_by_car_company ? 'verified' : 'pending'}" 
             data-document-id="${doc.id}">
            ${doc.is_primary ? '<div class="primary-badge">Primary</div>' : ''}
            
            <div class="document-icon">
                <i class="fas ${getDocumentIcon(doc.type)}"></i>
            </div>
            
            <div class="document-details">
                <div class="document-title">
                    <span class="doc-type-name">${DOCUMENT_TYPE_NAMES[doc.type] || doc.type}</span>
                    ${doc.verified_by_car_company ? 
                        '<span class="status-badge-mini verified"><i class="fas fa-check-circle"></i> Verified</span>' : 
                        (doc.car_company_verification_notes ? 
                            '<span class="status-badge-mini rejected"><i class="fas fa-times-circle"></i> Rejected</span>' :
                            (currentClaimApproved ? '' : '<span class="status-badge-mini pending"><i class="fas fa-clock"></i> Pending</span>')
                        )
                    }
                </div>
                <div class="document-meta">
                    <span class="file-name">${doc.file_name}</span>
                    <span class="meta-divider">•</span>
                    <span class="upload-date">Uploaded ${formatDate(doc.created_at)}</span>
                    ${doc.car_company_verification_date ? 
                        `<span class="meta-divider">•</span><span class="verified-date">Verified ${formatDate(doc.car_company_verification_date)}</span>` : 
                        ''
                    }
                </div>
            </div>

            <div class="document-list-actions">
                <button class="btn-view" onclick="viewDocument('${doc.id}')">
                    <i class="fas fa-eye"></i> ${currentClaimApproved ? 'View' : 'View & Verify'}
                </button>
            </div>
        </div>
    `).join('');
}

async function viewDocument(documentId) {
    console.log('🔍 ViewDocument called with ID:', documentId);
    
    const docIndex = currentDocuments.findIndex(doc => doc.id === documentId);
    const doc = currentDocuments[docIndex];

    if (!doc) {
        console.error('❌ Document not found:', documentId);
        showError('Document not found');
        return;
    }

    console.log('📄 Found document:', doc);

    // ALWAYS hide approve/reject buttons when document viewer modal opens
    const decisionActions = document.getElementById('carClaimDecisionActions');
    if (decisionActions) {
        decisionActions.style.display = 'none';
        console.log('🙈 Hidden Claim Decision Actions when opening document viewer');
    }

    // Populate modal with document information
    document.getElementById('documentTitle').textContent = DOCUMENT_TYPE_NAMES[doc.type] || doc.type;
    document.getElementById('docType').textContent = DOCUMENT_TYPE_NAMES[doc.type] || doc.type;
    document.getElementById('docFileName').textContent = doc.file_name;
    document.getElementById('docUploadDate').textContent = formatDate(doc.created_at);
    document.getElementById('docStatus').textContent = formatStatus(doc.status);

    // Populate vehicle information (this would normally come from the claim or document data)
    await populateVehicleInformation(currentClaim, doc);

    // Handle verification section visibility and rejection note display
    const verificationSection = document.querySelector('.verification-section');
    const rejectionNoteDisplay = document.getElementById('documentRejectionNoteDisplay');
    
    if (!currentClaimApproved) {
        // In edit mode - show verification controls
        if (verificationSection) verificationSection.style.display = 'block';
        if (rejectionNoteDisplay) rejectionNoteDisplay.style.display = 'none';
    } else {
        // In view mode - show rejection note if claim is rejected and document has a rejection note
        if (verificationSection) verificationSection.style.display = 'none';
        
        if (currentClaimData && currentClaimData.car_company_status === 'rejected' && doc.car_company_verification_notes) {
            if (rejectionNoteDisplay) {
                const rejectionNoteContent = document.getElementById('documentRejectionNoteContent');
                if (rejectionNoteContent) {
                    rejectionNoteContent.textContent = doc.car_company_verification_notes;
                }
                rejectionNoteDisplay.style.display = 'block';
            }
        } else if (rejectionNoteDisplay) {
            rejectionNoteDisplay.style.display = 'none';
        }
    }

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

        if (doc.verified_by_car_company) {
            verifyBtn.innerHTML = '<i class="fas fa-check-circle"></i> Verified';
            verifyBtn.classList.add('btn-success');
            verifyBtn.classList.remove('btn-outline-success');
            rejectBtn.style.opacity = '0.5';
        } else {
            verifyBtn.innerHTML = '<i class="fas fa-check"></i> Verify';
            // rejectBtn.style.opacity = '1';
        }

        // Handle Read-only state
        if (currentClaimApproved) {
            verifyBtn.disabled = true;
            rejectBtn.disabled = true;
        } else {
            verifyBtn.disabled = false;
            rejectBtn.disabled = false;
        }
    }
    
    // Store current document ID for actions
    document.getElementById('documentViewerModal').dataset.currentDocId = documentId;

    // --- NEW LOGIC END ---

    // Load document content
    console.log('🔄 Loading document content...');
    await loadDocumentContent(doc);

    // Show modal
    console.log('✅ Showing modal');
    document.getElementById('documentViewerModal').style.display = 'flex';
}

// Feature flag: prefer fallback blob download over signed URLs
const PREFER_STORAGE_DOWNLOAD = true;

async function loadDocumentContent(doc) {
    const contentDiv = document.getElementById('documentContent');
    console.log('📥 Loading document content for:', doc.file_name);
    
    // Show loading state briefly
    contentDiv.innerHTML = `
        <div class="document-preview loading-preview">
            <i class="fas fa-spinner fa-spin" style="font-size: 2rem; color: #667eea;"></i>
            <p>Loading document...</p>
        </div>
    `;
    
    try {
    // If we prefer storage download, skip generating signed URLs and go
    // straight to the fallback renderer.
    if (PREFER_STORAGE_DOWNLOAD) {
        const fileExtensionPref = getFileExtension(doc.file_name);
        await __fallbackDocView(doc.id, fileExtensionPref);
        return;
    }
    // Otherwise, generate a signed URL with a longer expiry.
       const fileUrl = await getDocumentUrl(doc, { expiresIn: 3600 }); // 1 hour
        
        if (!fileUrl) {
            console.error('❌ No URL found for document');
            contentDiv.innerHTML = `
                <div class="no-preview">
                    <i class="fas fa-file"></i>
                    <p>Document URL not available</p>
                    <p>File: ${doc.file_name}</p>
                    <p>Debug: remote_url = ${doc.remote_url || 'null'}</p>
                </div>
            `;
            return;
        }

        console.log('🌐 Using URL:', fileUrl);
        const fileExtension = getFileExtension(doc.file_name);
        console.log('📄 File extension:', fileExtension);
        
    if (isImageFile(fileExtension)) {
            console.log('🖼️ Displaying as image');
            // Display image directly
            contentDiv.innerHTML = `
                <div class="document-preview image-preview">
                    <img id="doc-img-${doc.id}" src="${fileUrl}" alt="${doc.file_name}" 
                         style="max-width: 100%; max-height: 600px; object-fit: contain; opacity: 0; transition: opacity 0.3s;"
                         onload="console.log('✅ Image loaded successfully'); this.style.opacity='1'" 
                         onerror="console.error('❌ Image failed to load:', '${fileUrl}'); __fallbackDocView('${doc.id}', '${fileExtension}')" />
                    <div class="image-info">
                        <p class="file-name">${doc.file_name}</p>
                        <p class="file-size">${formatFileSize(doc.file_size_bytes)}</p>
                        <button onclick="openDocumentInNewTab('${doc.id}')" class="btn-secondary">
                            <i class="fas fa-external-link-alt"></i> Open in New Tab
                        </button>
                        <button onclick="testImageUrl('${fileUrl}')" class="btn-secondary">
                            <i class="fas fa-vial"></i> Test URL
                        </button>
                    </div>
                </div>
            `;
        } else if (fileExtension === 'pdf') {
            console.log('📑 Displaying as PDF');
            // Display PDF using iframe with 125% zoom
            const pdfUrlWithZoom = fileUrl + '#zoom=125';
            contentDiv.innerHTML = `
                <div class="document-preview pdf-preview">
                    <iframe id="doc-pdf-${doc.id}" src="${pdfUrlWithZoom}" 
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
                        <button onclick="__fallbackDocView('${doc.id}', 'pdf')" class="btn-secondary">
                            <i class="fas fa-file-download"></i> Try Fallback
                        </button>
                    </div>
                </div>
            `;
        } else {
            console.log('📄 Displaying as file');
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
                        <button onclick="__fallbackDocView('${doc.id}', '${fileExtension}')" class="btn-secondary">
                            <i class="fas fa-file-download"></i> Try Fallback
                        </button>
                    </div>
                </div>
            `;
        }
        
    } catch (error) {
        console.error('❌ Error loading document content:', error);
        contentDiv.innerHTML = `
            <div class="error-preview">
                <i class="fas fa-exclamation-triangle"></i>
                <p>Error loading document</p>
                <p class="error-details">${error.message}</p>
            </div>
        `;
    }
}

// Parse a Supabase Storage URL and extract bucket + object path. Supports
// both public and signed URL formats and strips any query string.
function parseStorageUrl(url) {
    if (!url || typeof url !== 'string') return null;
    try {
        const u = new URL(url);
        // Drop query string when deriving object path
        const pathname = u.pathname;
        // Expected patterns:
        // - /storage/v1/object/public/<bucket>/<object>
        // - /storage/v1/object/sign/<bucket>/<object>
        const parts = pathname.split('/').filter(Boolean);
        const idx = parts.findIndex(p => p === 'object');
        if (idx === -1 || parts.length < idx + 3) return null;
        const kind = parts[idx + 1]; // 'public' or 'sign' or possibly bucket directly in older formats
        let bucket, objectPath;
        if (kind === 'public' || kind === 'sign') {
            bucket = parts[idx + 2];
            objectPath = parts.slice(idx + 3).join('/');
        } else {
            // Fallback: /object/<bucket>/<object>
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
    // Use remote_url directly if available. If it's missing or inaccessible
    // (for example the bucket is private), try to generate a short-lived
    // signed URL from Supabase Storage as a fallback.
    return (async function() {
        const initialUrl = doc.remote_url || doc.url || null;
        console.log('🔗 Getting document URL (initial):', initialUrl);

        // If there's an existing URL, do a lightweight HEAD check to detect
        // authorization errors (401/403). If the check fails or is blocked by
        // CORS, fall back to signed URL generation when possible.
        if (initialUrl && !forceSigned) {
            // If the initial URL already looks like a signed URL (has token
            // query string or uses /sign/), DON'T trust it (it may be expired).
            // We'll prefer generating a fresh signed URL below.
            const looksSigned = /[?&]token=/.test(initialUrl) || /\/storage\/v1\/object\/sign\//.test(initialUrl);
            if (!looksSigned) {
                try {
                    const resp = await fetch(initialUrl, { method: 'HEAD' });
                    if (resp.ok) {
                        console.log('✅ Remote URL is accessible:', initialUrl);
                        return initialUrl;
                    }
                    console.warn('⚠️ Remote URL returned non-ok status:', resp.status, initialUrl);
                    if (resp.status !== 401 && resp.status !== 403) {
                        // Return URL for non-auth errors (let iframe/img handle it)
                        return initialUrl;
                    }
                } catch (err) {
                    console.warn('⚠️ HEAD request failed (possible CORS or network):', err.message || err);
                    // Continue to attempt signed URL generation
                }
            } else {
                console.log('ℹ️ Stored URL appears to be signed; will generate a fresh one to avoid expired token.');
            }
        }

        // Try to determine object path for Supabase storage. Prefer explicit
        // fields saved in DB like `file_path` or `path`, otherwise attempt to
        // extract it from the stored remote_url.
        let objectPath = doc.file_path || doc.path || doc.filePath || null;
        let bucketName = doc.bucket || 'insurevis-documents';
        if (!objectPath && initialUrl) {
            const parsed = parseStorageUrl(initialUrl);
            if (parsed) {
                bucketName = parsed.bucket || bucketName;
                objectPath = parsed.path;
                console.log('🔎 Extracted from URL -> bucket:', bucketName, 'path:', objectPath);
            }
        }

        // If we have an object path and a Supabase client, request a signed URL
        if (objectPath && typeof supabaseClient !== 'undefined') {
            try {
                console.log('🔐 Attempting to create signed URL for:', objectPath, 'expiresIn:', expiresIn, 'bucket:', bucketName);
                const { data, error } = await supabaseClient.storage
                    .from(bucketName)
                    .createSignedUrl(objectPath, expiresIn);

                if (error) {
                    console.error('❌ Failed to create signed URL:', error.message || error);
                } else if (data && data.signedUrl) {
                    console.log('✅ Signed URL obtained');
                    return data.signedUrl;
                }
            } catch (err) {
                console.error('❌ Error while creating signed URL:', err.message || err);
            }
        }

        // Last resort: return whatever we have (may be null)
        return initialUrl;
    })();
}

function getFileExtension(filename) {
    return filename.split('.').pop().toLowerCase();
}

function isImageFile(extension) {
    const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'];
    return imageExtensions.includes(extension);
}

function navigateDocument(direction) {
    const currentDocId = document.getElementById('documentViewerModal').dataset.currentDocId;
    const currentIndex = currentDocuments.findIndex(d => d.id === currentDocId);
    
    if (currentIndex === -1) return;
    
    const newIndex = currentIndex + direction;
    
    if (newIndex >= 0 && newIndex < currentDocuments.length) {
        viewDocument(currentDocuments[newIndex].id);
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
            verified_by_car_company: isVerified,
            car_company_verified_by: user.id  // Track WHO verified it
        };

        if (isVerified) {
            updateData.car_company_verification_date = new Date().toISOString();
            updateData.car_company_verification_notes = null;
        } else {
            updateData.car_company_verification_date = null;
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

        // Update local state
        const docIndex = currentDocuments.findIndex(doc => doc.id === currentDocId);
        if (docIndex !== -1) {
            currentDocuments[docIndex] = { ...currentDocuments[docIndex], ...updateData };
        }

        // If this action unverified a document, immediately mark the claim as not approved by car company
        if (!isVerified && currentClaim) {
            try {
                await supabaseClient
                    .from('claims')
                    .update({ is_approved_by_car_company: false, car_company_approval_date: null })
                    .eq('id', currentClaim);
            } catch (e) {
                console.warn('Failed to set claim car-company approval to false after unverify:', e);
            }
        }

        // Safety guard: if the platform auto-flipped the claim to approved when all
        // docs are verified, revert it here. Only revert if the claim is not in a
        // final approved/submitted state (those are set explicitly via Approve).
        try {
            // Wait a moment for any DB triggers to fire
            await new Promise(r => setTimeout(r, 500));

            const allDocsVerified = Array.isArray(currentDocuments) && currentDocuments.length > 0 && currentDocuments.every(d => !!d.verified_by_car_company);
            if (currentClaim && allDocsVerified) {
                const { data: claimRow, error: claimFetchErr } = await supabaseClient
                    .from('claims')
                    .select('is_approved_by_car_company, status, car_company_status')
                    .eq('id', currentClaim)
                    .single();
                
                if (!claimFetchErr && claimRow) {
                    // Check if it was auto-approved (either flag or status column)
                    const isAutoApproved = claimRow.is_approved_by_car_company === true || claimRow.car_company_status === 'approved';
                    const globalStatus = (claimRow.status || '').toLowerCase();
                    
                    // Don't revert if claim was explicitly moved to submitted/approved via Approve button
                    // (Though we are in saveDocumentVerification, so explicit approval shouldn't have happened yet)
                    if (isAutoApproved && globalStatus !== 'submitted' && globalStatus !== 'approved') {
                        console.log('🛡️ Safety guard: Reverting auto-approval of claim');
                        await supabaseClient
                            .from('claims')
                            .update({ 
                                is_approved_by_car_company: false,
                                car_company_status: 'pending' 
                            })
                            .eq('id', currentClaim);
                    }
                }
            }
        } catch (guardErr) {
            console.warn('Guard: could not ensure claim approval stays manual-only:', guardErr);
        }

        // IMPORTANT: Keep decision actions hidden while we're still in the modal
        const decisionActions = document.getElementById('carClaimDecisionActions');
        if (decisionActions) {
            decisionActions.style.display = 'none';
        }
        
        // Refresh displays
        updateDocumentStats(currentDocuments);
        displayDocuments(currentDocuments);
        
        // Show success message with shorter timeout (1.5 seconds)
        notify('success', 'Success', isVerified ? 'Document verified successfully!' : 'Document verification removed', 1500);

        // NOTE: We don't reload claims here to avoid flickering.
        // The claims list will auto-update via real-time subscriptions or when navigating back.

        // Immediately refresh decision buttons state so Approve enables without navigation
        // BUT keep them hidden since we're still in the modal
        try {
            if (currentClaim) {
                const { data: freshClaim, error: freshErr } = await supabaseClient
                    .from('claims')
                    .select('id, status, is_approved_by_car_company')
                    .eq('id', currentClaim)
                    .single();
                if (!freshErr && freshClaim) {
                    setDecisionButtonsState(freshClaim);
                    // Don't call applyApprovedState here - it might show the actions
                }
            }
        } catch (btnErr) {
            console.warn('Could not refresh decision button state:', btnErr);
        }
        
        // Ensure decision actions stay hidden after all updates
        if (decisionActions) {
            decisionActions.style.display = 'none';
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
                if (decisionActions) {
                    decisionActions.style.display = 'flex';
                }
            }
        }

    } catch (error) {
        console.error('Error saving verification:', error);
        notify('error', 'Error', 'Failed to save verification status', 1500);
    }
}

// UI helpers for approval confirmation and approved state
function openApprovalConfirm() {
    const modal = document.getElementById('approvalConfirmModal');
    if (!modal) return decideClaim('approved');
    modal.style.display = 'flex';
    const confirmBtn = document.getElementById('confirmApproveBtn');
    if (confirmBtn) {
        const newBtn = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);
        newBtn.addEventListener('click', async () => {
            closeApprovalConfirm();
            await decideClaim('approved');
        });
    }
}

function closeApprovalConfirm() {
    const modal = document.getElementById('approvalConfirmModal');
    if (modal) modal.style.display = 'none';
}

function openRejectionModal() {
    console.log('openRejectionModal called, currentClaim:', currentClaim);
    if (!currentClaim) {
        console.error('No current claim selected');
        showError('Please select a claim first');
        return;
    }
    
    // Hide decision actions when rejection modal opens
    const decisionActions = document.getElementById('carClaimDecisionActions');
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
    
    // Get all rejected documents (those with car_company_verification_notes set)
    const rejectedDocs = currentDocuments.filter(doc => doc.car_company_verification_notes);
    
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
        let reason = doc.car_company_verification_notes || 'No reason provided';
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
        const decisionActions = document.getElementById('carClaimDecisionActions');
        if (decisionActions) {
            decisionActions.style.display = 'flex';
        }
    }
}

function applyApprovedState(claim) {
    const approved = !!(claim && (claim.is_verified_by_car_company || claim.isVerifiedByCarCompany || claim.is_approved_by_car_company));
    const rejected = !!(claim && claim.car_company_status === 'rejected');
    currentClaimApproved = approved || rejected; // Both approved and rejected should be read-only
    
    const approvedBanner = document.getElementById('approvedBanner');
    const rejectedBanner = document.getElementById('rejectedBanner');
    const rejectionNotesDisplay = document.getElementById('rejectionNotesDisplay');
    const rejectionNotesContent = document.getElementById('rejectionNotesContent');
    const page = document.getElementById('documentsPage');
    const decisionActions = document.getElementById('carClaimDecisionActions');

    // Reset all banners first
    if (approvedBanner) approvedBanner.style.display = 'none';
    if (rejectedBanner) rejectedBanner.style.display = 'none';
    if (rejectionNotesDisplay) rejectionNotesDisplay.style.display = 'none';

    if (approved) {
        if (approvedBanner) approvedBanner.style.display = '';
        if (page) page.classList.add('view-only');
        document.body.classList.add('view-only');
        if (decisionActions) decisionActions.style.display = 'none';
        // Disable controls in the document modal if open
        const checkbox = document.getElementById('verifyCheckbox');
        const saveBtn = document.getElementById('saveVerification');
        if (checkbox) checkbox.disabled = true;
        if (saveBtn) saveBtn.disabled = true;
    } else if (rejected) {
        if (rejectedBanner) rejectedBanner.style.display = '';
        if (page) page.classList.add('view-only');
        document.body.classList.add('view-only');
        if (decisionActions) decisionActions.style.display = 'none';
        
        // Show rejection notes if they exist
        console.log('Rejected claim, checking notes:', claim.car_company_approval_notes);
        if (claim.car_company_approval_notes) {
            if (rejectionNotesContent) {
                rejectionNotesContent.textContent = claim.car_company_approval_notes;
            }
            if (rejectionNotesDisplay) {
                rejectionNotesDisplay.style.display = 'block';
                console.log('Rejection notes display set to block');
            }
        } else {
            console.log('No rejection notes found');
        }
        
        // Disable controls in the document modal if open
        const checkbox = document.getElementById('verifyCheckbox');
        const saveBtn = document.getElementById('saveVerification');
        if (checkbox) checkbox.disabled = true;
        if (saveBtn) saveBtn.disabled = true;
    } else {
        if (page) page.classList.remove('view-only');
        document.body.classList.remove('view-only');
        
        // Only show decision actions if document viewer modal is NOT open
        const isModalOpen = document.getElementById('documentViewerModal').style.display === 'flex';
        if (decisionActions && !isModalOpen) {
            decisionActions.style.display = 'flex';
        }
        
        const checkbox = document.getElementById('verifyCheckbox');
        const saveBtn = document.getElementById('saveVerification');
        if (checkbox) checkbox.disabled = false;
        if (saveBtn) saveBtn.disabled = false;
    }
}

// Navigation functions
function showClaimsPage() {
    document.getElementById('claimsPage').classList.add('active');
    document.getElementById('documentsPage').classList.remove('active');
    currentClaim = null;
    document.body.classList.remove('claim-view-active');

    const decisionActions = document.getElementById('carClaimDecisionActions');
    if (decisionActions) {
        decisionActions.style.display = 'none';
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
    
    // ALWAYS restore decision actions visibility when closing viewer (if claim is open and not approved/rejected)
    if (currentClaim && !currentClaimApproved) {
        const decisionActions = document.getElementById('carClaimDecisionActions');
        if (decisionActions) {
            decisionActions.style.display = 'flex';
            console.log('👁️ Restored Claim Decision Actions after closing document viewer');
        }
    }
}

// Filter functions
function filterClaims() {
    const searchTerm = document.getElementById('claimsSearch').value.toLowerCase();
    const statusFilter = document.getElementById('statusFilter').value;
    
    const rows = document.querySelectorAll('.claim-row');
    
    rows.forEach(row => {
        const claimNumber = row.querySelector('td:first-child').textContent.toLowerCase();
        const userName = row.querySelector('.user-name').textContent.toLowerCase();
        const userEmail = row.querySelector('.user-info small').textContent.toLowerCase();
        const status = (row.dataset.carCompanyStatus || row.querySelector('.status-badge')?.textContent || '').toLowerCase();
        
        const matchesSearch = !searchTerm || 
            claimNumber.includes(searchTerm) || 
            userName.includes(searchTerm) || 
            userEmail.includes(searchTerm);
            
        // Compare normalized values (e.g. 'appealed', 'pending', 'approved')
        const normalizedFilter = (statusFilter || '').toLowerCase();
        const matchesStatus = !normalizedFilter || status.includes(normalizedFilter.replace('_', ' ')) || status.includes(normalizedFilter);
        
        row.style.display = matchesSearch && matchesStatus ? '' : 'none';
    });
}

// Utility functions
function formatStatus(status) {
    if (!status) return '';
    const normalized = String(status).toLowerCase();
    // Centralized display mapping for special cases
    const displayMap = {
        'under_review': 'In Review',
        'pending_documents': 'Pending',
        'submitted': 'Submitted',
        'draft': 'Draft',
        'approved': 'Approved',
        'rejected': 'Rejected',
        'appealed': 'Appealed'
    };
    if (displayMap[normalized]) return displayMap[normalized];
    // Fallback: convert snake_case or kebab-case to Title Case
    return normalized.split(/[_-]/).map(word =>
        word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
}

function testImageUrl(url) {
    console.log('🧪 Testing URL:', url);
    fetch(url, { method: 'HEAD' })
        .then(response => {
            if (response.ok) {
                console.log('✅ URL is accessible', response.status);
                showSuccess('URL is accessible! Status: ' + response.status);
            } else {
                console.log('❌ URL returned error:', response.status, response.statusText);
                showError('URL error: ' + response.status + ' - ' + response.statusText);
            }
        })
        .catch(error => {
            console.error('❌ Network error:', error);
            showError('Network error: ' + error.message + '\nThis could be CORS, network, or authentication issues.');
        });
}

// On-demand open in a new tab with a fresh signed URL to avoid expired tokens.
async function openDocumentInNewTab(documentId) {
    try {
        const doc = currentDocuments.find(d => d.id === documentId);
        if (!doc) return;
        if (typeof PREFER_STORAGE_DOWNLOAD !== 'undefined' && PREFER_STORAGE_DOWNLOAD) {
            const { bucketName, objectPath } = resolveStorageObject(doc);
            const { data, error } = await supabaseClient.storage.from(bucketName).download(objectPath);
            if (error || !data) {
                console.error('openDocumentInNewTab download error:', error || 'no data');
                showError('Unable to download the document for opening.');
                return;
            }
            const blobUrl = URL.createObjectURL(data);
            window.open(blobUrl, '_blank', 'noopener');
        } else {
            const freshUrl = await getDocumentUrl(doc, { expiresIn: 3600, forceSigned: true });
            if (freshUrl) {
                window.open(freshUrl, '_blank', 'noopener');
            } else if (doc.remote_url) {
                window.open(doc.remote_url, '_blank', 'noopener');
            } else {
                showError('Unable to generate URL for this document.');
            }
        }
    } catch (e) {
        console.error('openDocumentInNewTab error:', e);
        showError('Failed to open document: ' + (e.message || e));
    }
}

// Helper to resolve bucket and path for a document
function resolveStorageObject(doc) {
    let objectPath = doc.storage_path || doc.file_path || doc.path || doc.filePath || null;
    let bucketName = doc.bucket || 'insurevis-documents';
    const initialUrl = doc.remote_url || doc.url || null;
    if (!objectPath && initialUrl) {
        const parsed = parseStorageUrl(initialUrl);
        if (parsed) {
            bucketName = parsed.bucket || bucketName;
            objectPath = parsed.path;
        }
    }
    return { bucketName, objectPath };
}

// Fallback: download the file via Supabase Storage and render from a blob URL
async function __fallbackDocView(documentId, fileExtension) {
    try {
        const doc = currentDocuments.find(d => d.id === documentId);
        if (!doc) return;
        const { bucketName, objectPath } = resolveStorageObject(doc);
        if (!bucketName || !objectPath) {
            console.warn('Fallback cannot resolve storage object');
            showError('Unable to locate file path for fallback preview.');
            return;
        }
        console.log('↩️ Fallback download from bucket:', bucketName, 'path:', objectPath);
        const { data, error } = await supabaseClient.storage.from(bucketName).download(objectPath);
        if (error || !data) {
            console.error('Fallback download error:', error || 'no data');
            showError('Fallback download failed: ' + (error?.message || 'Unknown error'));
            return;
        }
        const blobUrl = URL.createObjectURL(data);
        const contentDiv = document.getElementById('documentContent');

        if (isImageFile(fileExtension)) {
            contentDiv.innerHTML = `
                <div class="document-preview image-preview">
                    <img src="${blobUrl}" alt="${doc.file_name}" 
                         style="max-width: 100%; max-height: 600px; object-fit: contain; opacity: 0; transition: opacity 0.3s;"
                         onload="this.style.opacity='1'" />
                    <div class="image-info">
                        <p class="file-name">${doc.file_name}</p>
                        <p class="file-size">${formatFileSize(doc.file_size_bytes)}</p>
                        <a href="${blobUrl}" download="${doc.file_name}" class="btn-secondary">
                            <i class="fas fa-download"></i> Download
                        </a>
                    </div>
                </div>`;
        } else if (fileExtension === 'pdf') {
            contentDiv.innerHTML = `
                <div class="document-preview pdf-preview">
                    <iframe src="${blobUrl}" 
                            style="width: 100%; height: 600px; border: 1px solid #ddd; border-radius: 8px;"
                            title="PDF Viewer - ${doc.file_name}">
                        <p>Your browser doesn't support PDF viewing. 
                           <a href="${blobUrl}" download="${doc.file_name}">Download PDF</a>
                        </p>
                    </iframe>
                    <div class="pdf-info">
                        <p class="file-name">${doc.file_name}</p>
                        <p class="file-size">${formatFileSize(doc.file_size_bytes)}</p>
                        <a href="${blobUrl}" download="${doc.file_name}" class="btn-secondary">
                            <i class="fas fa-download"></i> Download
                        </a>
                    </div>
                </div>`;
        } else {
            contentDiv.innerHTML = `
                <div class="document-preview file-preview">
                    <div class="file-icon">
                        <i class="fas fa-file-${getFileTypeIcon(fileExtension)}"></i>
                    </div>
                    <div class="file-details">
                        <p class="file-name">${doc.file_name}</p>
                        <p class="file-size">${formatFileSize(doc.file_size_bytes)}</p>
                        <p class="file-type">Type: ${fileExtension.toUpperCase()}</p>
                        <a href="${blobUrl}" download="${doc.file_name}" class="btn-secondary">
                            <i class="fas fa-download"></i> Download
                        </a>
                    </div>
                </div>`;
        }
    } catch (e) {
        console.error('Fallback view failed:', e);
        showError('Fallback preview failed: ' + (e.message || e));
    }
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

function getDocumentIcon(type) {
    const icons = {
        'lto_or': 'fa-receipt',
        'lto_cr': 'fa-certificate',
        'drivers_license': 'fa-id-card',
        'owner_valid_id': 'fa-id-badge',
        'stencil_strips': 'fa-barcode',
        'damage_photos': 'fa-images',
        'job_estimate': 'fa-calculator'
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

async function populateVehicleInformation(claimId, docObj) {
    try {
        // In a real application, this would fetch vehicle data from the database
        // For now, we'll use sample data based on the claim ID
    const vehicleInfo = currentVehicleInfo || getVehicleInfoForClaim(claimId);

    // Use the global `document` (DOM) to populate fields. The parameter
    // was renamed to `docObj` to avoid shadowing the browser `document`.
    document.getElementById('vehicleMake').textContent = vehicleInfo.make || '-';
    document.getElementById('vehicleModel').textContent = vehicleInfo.model || '-';
    document.getElementById('vehicleYear').textContent = vehicleInfo.year || '-';
    document.getElementById('licensePlate').textContent = vehicleInfo.licensePlate || '-';

    } catch (error) {
        console.error('Error populating vehicle information:', error);
        // Set default values if there's an error
        document.getElementById('vehicleMake').textContent = '-';
        document.getElementById('vehicleModel').textContent = '-';
        document.getElementById('vehicleYear').textContent = '-';
        document.getElementById('licensePlate').textContent = '-';
    }
}

function getVehicleInfoForClaim(claimId) {
    // Sample vehicle data - in a real application, this would come from the database
    const vehicleData = {
        'claim-001': {
            make: 'Toyota',
            model: 'Camry',
            year: '2020',
            licensePlate: 'ABC-1234'
        },
        'claim-002': {
            make: 'Honda',
            model: 'Civic',
            year: '2019',
            licensePlate: 'XYZ-5678'
        }
    };
    
    return vehicleData[claimId] || {
        make: 'Unknown',
        model: 'Unknown',
        year: 'Unknown',
        licensePlate: 'Unknown'
    };
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

function showError(message) { notify('error', 'Error', message); }
function showSuccess(message) { notify('success', 'Success', message); }

// Close modal when clicking outside
window.addEventListener('click', function(event) {
    const modal = document.getElementById('documentViewerModal');
    if (event.target === modal) {
        closeDocumentViewer();
    }
    const confirmModal = document.getElementById('approvalConfirmModal');
    if (event.target === confirmModal) {
        closeApprovalConfirm();
    }
    const rejectionModal = document.getElementById('rejectionModal');
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
                verified_by_car_company: false,
                car_company_verification_date: null,
                car_company_verification_notes: rejectionNotes
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
                verified_by_car_company: false,
                car_company_verification_date: null,
                car_company_verification_notes: rejectionNotes
            };
        }

        // Clear car company approval if any document is rejected
        if (currentClaim) {
            await supabaseClient
                .from('claims')
                .update({ is_approved_by_car_company: false, car_company_approval_date: null })
                .eq('id', currentClaim);
        }

        // Refresh displays
        updateDocumentStats(currentDocuments);
        displayDocuments(currentDocuments);
        
        showSuccess('Document rejected successfully!');

        // Auto-navigate to next document
        const currentIndex = currentDocuments.findIndex(d => d.id === currentDocId);
        if (currentIndex < currentDocuments.length - 1) {
            setTimeout(() => {
                navigateDocument(1);
            }, 500);
        } else {
            viewDocument(currentDocId);
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