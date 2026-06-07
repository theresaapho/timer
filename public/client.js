const socket = io();

let myId = '';
let roomId = '';
let username = '';
let isHost = false;
let roomState = null;
let wakeLock = null; 

let titleInterval = null;
const originalTitle = document.title;

let isMiniMode = false;

// Thông tin người dùng cục bộ sau khi đăng nhập thành công
let currentUser = null; 
let activeSelectedAvatar = 'default_avatar1';
let activeSelectedBg = 'default_background1';

// Danh sách Cache lưu tạm dữ liệu lịch sử đấu để hiển thị xem nhanh
let localMatchesHistoryCache = [];

// Danh sách 10 hệ màu nền vĩnh viễn dạng Gradient cực đẹp
const DEFAULT_BACKGROUNDS = {
    'default_background1': 'linear-gradient(135deg, #1f1c2c, #928dab)',
    'default_background2': 'linear-gradient(135deg, #0f2027, #203a43, #2c5364)',
    'default_background3': 'linear-gradient(135deg, #3a7bd5, #3a6073)',
    'default_background4': 'linear-gradient(135deg, #141e30, #243b55)',
    'default_background5': 'linear-gradient(135deg, #ef32d9, #89fffd)',
    'default_background6': 'linear-gradient(135deg, #4568dc, #b06ab3)',
    'default_background7': 'linear-gradient(135deg, #ff007f, #4568dc)',
    'default_background8': 'linear-gradient(135deg, #00f0ff, #0072ff)',
    'default_background9': 'linear-gradient(135deg, #f12711, #f5af19)',
    'default_background10': 'linear-gradient(135deg, #11998e, #38ef7d)'
};

// Danh sách 10 mẫu Avatar bằng Emoji động
const DEFAULT_AVATARS = {
    'default_avatar1': '🦊', 'default_avatar2': '🦁', 'default_avatar3': '🐼', 'default_avatar4': '🐨', 'default_avatar5': '🐙',
    'default_avatar6': '🐲', 'default_avatar7': '🧙', 'default_avatar8': '🚀', 'default_avatar9': '👻', 'default_avatar10': '⚔'
};

// 1. TỰ ĐỘNG KIỂM TRA PHIÊN ĐĂNG NHẬP CŨ (AUTO-LOGIN BY TOKEN)
const savedToken = localStorage.getItem('timer_session_token');
if (savedToken) {
    statusMessage("Authenticating session...", false);
    fetch('/api/verify-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: savedToken })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            loginSuccess(data.user);
        } else {
            localStorage.removeItem('timer_session_token');
            statusMessage("Session expired. Please log in.", true);
        }
    })
    .catch(() => {
        statusMessage("Network error. Offline mode active.", true);
    });
}

if (window.electronAPI) {
    document.getElementById('customTitlebar').style.display = 'flex';
    window.electronAPI.onMaximizeChange((isMaximized) => {
        const btnMax = document.getElementById('btnMaximize');
        if (btnMax) {
            btnMax.innerText = isMaximized ? "🗗" : "🗖";
        }
    });
} else {
    document.getElementById('customTitlebar').style.display = 'none';
}

if ('Notification' in window) {
    if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        Notification.requestPermission();
    }
}

async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
        }
    } catch (err) {}
}

function releaseWakeLock() {
    if (wakeLock !== null) {
        wakeLock.release();
        wakeLock = null;
    }
}

function playAlarmBeep() {
    if (roomState && !roomState.soundEnabled) return;
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = 460;
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.8);
    } catch (e) {}
}

function playSoftNotificationBeep() {
    if (roomState && !roomState.soundEnabled) return;
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 580;
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.15);
    } catch (e) {}
}

function startFlashingTitle() {
    if (titleInterval) clearInterval(titleInterval);
    let toggle = false;
    titleInterval = setInterval(() => {
        document.title = toggle ? "⚠ TIME'S UP! ⚠" : originalTitle;
        toggle = !toggle;
    }, 1000);
}

function stopFlashingTitle() {
    if (titleInterval) {
        clearInterval(titleInterval);
        titleInterval = null;
    }
    document.title = originalTitle;
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
        e.preventDefault();
        if (!isMiniMode) {
            document.getElementById('sidebar').classList.toggle('collapsed');
        }
    }
});

// ==========================================================================
// 2. LẬP TRÌNH API ĐĂNG KÝ / ĐĂNG NHẬP & SẢNH CHÍNH (AUTH & DASHBOARD LOGIC)
// ==========================================================================

function switchAuthTab(tab) {
    const tabLogin = document.getElementById('tabLoginBtn');
    const tabRegister = document.getElementById('tabRegisterBtn');
    const formLogin = document.getElementById('formLogin');
    const formRegister = document.getElementById('formRegister');
    const msg = document.getElementById('authMessage');

    msg.innerText = '';

    if (tab === 'login') {
        tabLogin.classList.add('active');
        tabRegister.classList.remove('active');
        formLogin.style.display = 'block';
        formRegister.style.display = 'none';
    } else {
        tabLogin.classList.remove('active');
        tabRegister.classList.add('active');
        formLogin.style.display = 'none';
        formRegister.style.display = 'block';
    }
}

function statusMessage(text, isError) {
    const msg = document.getElementById('authMessage');
    msg.innerText = text;
    msg.style.color = isError ? "#ff3366" : "#00ffcc";
}

function submitRegister() {
    const usernameInput = document.getElementById('regUsername').value.trim();
    const emailInput = document.getElementById('regEmail').value.trim();
    const passwordInput = document.getElementById('regPassword').value.trim();

    if (!usernameInput || !emailInput || !passwordInput) {
        statusMessage("Please fill in all fields.", true);
        return;
    }

    statusMessage("Processing registration...", false);

    fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: usernameInput, email: emailInput, password: passwordInput })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            statusMessage("Registration successful! Switching to Login...", false);
            setTimeout(() => {
                document.getElementById('loginKey').value = usernameInput;
                switchAuthTab('login');
            }, 1500);
        } else {
            statusMessage(data.error || "Registration failed.", true);
        }
    })
    .catch(() => statusMessage("Connection error.", true));
}

function submitLogin() {
    const loginKeyInput = document.getElementById('loginKey').value.trim();
    const passwordInput = document.getElementById('loginPassword').value.trim();

    if (!loginKeyInput || !passwordInput) {
        statusMessage("Please enter your credentials.", true);
        return;
    }

    statusMessage("Logging in...", false);

    fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginKey: loginKeyInput, password: passwordInput })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            localStorage.setItem('timer_session_token', data.token);
            loginSuccess(data.user);
        } else {
            statusMessage(data.error || "Login failed.", true);
        }
    })
    .catch(() => statusMessage("Connection error.", true));
}

function loginSuccess(user) {
    currentUser = user;
    username = user.username;

    document.getElementById('screenAuth').style.display = 'none';
    document.getElementById('screenHome').style.display = 'flex';

    // Xác thực Socket thời gian thực sau khi đăng nhập thành công
    const token = localStorage.getItem('timer_session_token');
    socket.emit('authenticate', token);

    renderUserHeader();
    fetchFriendsList(); // Tải danh sách bạn bè vĩnh viễn
    fetchMatchHistory(); // Tải lịch sử đấu
}

function renderUserHeader() {
    document.getElementById('lblUsername').innerText = currentUser.username;
    
    const avatarDiv = document.getElementById('userAvatar');
    const cardDiv = document.getElementById('userProfileCard');

    avatarDiv.innerText = DEFAULT_AVATARS[currentUser.avatar] || '🦊';
    avatarDiv.style.display = 'flex';
    avatarDiv.style.justifyContent = 'center';
    avatarDiv.style.alignItems = 'center';
    avatarDiv.style.fontSize = '28px';

    cardDiv.style.background = DEFAULT_BACKGROUNDS[currentUser.background] || DEFAULT_BACKGROUNDS['default_background1'];
}

function logout() {
    if (confirm("Are you sure you want to log out?")) {
        localStorage.removeItem('timer_session_token');
        currentUser = null;
        closeProfileSettings();
        
        document.getElementById('screenHome').style.display = 'none';
        document.getElementById('screenJoin').style.display = 'none';
        document.getElementById('screenMain').style.display = 'none';
        document.getElementById('screenAuth').style.display = 'block';
        
        socket.disconnect(); 
        socket.connect();

        switchAuthTab('login');
        document.getElementById('loginPassword').value = '';
        document.getElementById('regPassword').value = '';
        statusMessage("Logged out successfully.", false);
    }
}

// Chuyển đổi giữa các Tab ở Sảnh chính (Home Dashboard)
function switchDashTab(tab) {
    const tabYour = document.getElementById('tabYourLobbyBtn');
    const tabTemp = document.getElementById('tabTempLobbyBtn');
    const tabRecent = document.getElementById('tabRecentBtn');

    const viewYour = document.getElementById('viewYourLobby');
    const viewTemp = document.getElementById('viewTempLobby');
    const viewRecent = document.getElementById('viewRecent');

    tabYour.classList.remove('active');
    tabTemp.classList.remove('active');
    tabRecent.classList.remove('active');

    viewYour.style.display = 'none';
    viewTemp.style.display = 'none';
    viewRecent.style.display = 'none';

    if (tab === 'your-lobby') {
        tabYour.classList.add('active');
        viewYour.style.display = 'block';
    } else if (tab === 'temp-lobby') {
        tabTemp.classList.add('active');
        viewTemp.style.display = 'block';
    } else {
        tabRecent.classList.add('active');
        viewRecent.style.display = 'block';
        fetchMatchHistory(); // Tự động làm mới lịch sử đấu khi click vào tab
    }
}

// ==========================================================================
// 3. ĐIỀU KHIỂN THIẾT LẬP HỒ SƠ CÁ NHÂN (PROFILE SETTINGS LOGIC)
// ==========================================================================

function openProfileSettings() {
    if (!currentUser) return;

    document.getElementById('profileSettingsModal').style.display = 'flex';
    document.getElementById('inputSettingsUsername').value = currentUser.username;
    document.getElementById('settingsMessage').innerText = '';

    activeSelectedAvatar = currentUser.avatar;
    activeSelectedBg = currentUser.background;

    renderAvatarPicker();
    renderBackgroundPicker();
}

function closeProfileSettings() {
    document.getElementById('profileSettingsModal').style.display = 'none';
}

function renderAvatarPicker() {
    const grid = document.getElementById('avatarPickerGrid');
    grid.innerHTML = '';
    for (let key in DEFAULT_AVATARS) {
        const opt = document.createElement('div');
        opt.className = `avatar-option ${key === activeSelectedAvatar ? 'selected' : ''}`;
        opt.innerText = DEFAULT_AVATARS[key];
        opt.style.display = 'flex';
        opt.style.justifyContent = 'center';
        opt.style.alignItems = 'center';
        opt.style.fontSize = '24px';
        
        opt.onclick = () => {
            activeSelectedAvatar = key;
            renderAvatarPicker();
        };
        grid.appendChild(opt);
    }
}

function renderBackgroundPicker() {
    const grid = document.getElementById('bgPickerGrid');
    grid.innerHTML = '';
    for (let key in DEFAULT_BACKGROUNDS) {
        const opt = document.createElement('div');
        opt.className = `bg-option ${key === activeSelectedBg ? 'selected' : ''}`;
        opt.style.background = DEFAULT_BACKGROUNDS[key];
        
        opt.onclick = () => {
            activeSelectedBg = key;
            renderBackgroundPicker();
        };
        grid.appendChild(opt);
    }
}

function saveProfileSettings() {
    const newUsername = document.getElementById('inputSettingsUsername').value.trim();
    const token = localStorage.getItem('timer_session_token');

    document.getElementById('settingsMessage').innerText = "Saving changes...";
    document.getElementById('settingsMessage').style.color = "#00ffcc";

    fetch('/api/user/update-profile', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            username: newUsername,
            avatar: activeSelectedAvatar,
            background: activeSelectedBg
        })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            currentUser.username = data.user.username;
            currentUser.avatar = data.user.avatar;
            currentUser.background = data.user.background;
            username = currentUser.username;

            renderUserHeader();
            closeProfileSettings();
        } else {
            document.getElementById('settingsMessage').innerText = data.error || "Failed to update profile.";
            document.getElementById('settingsMessage').style.color = "#ff3366";
        }
    })
    .catch(() => {
        document.getElementById('settingsMessage').innerText = "Connection error.";
        document.getElementById('settingsMessage').style.color = "#ff3366";
    });
}

// ==========================================================================
// 4. LẬP TRÌNH HỆ THỐNG BẠN BÈ & MỜI CHƠI (FRIENDS & INVITE ENGINE)
// ==========================================================================

function friendMessage(text, isError) {
    const msg = document.getElementById('friendActionMessage');
    msg.innerText = text;
    msg.style.color = isError ? "#ff3366" : "#00ffcc";
}

function sendFriendRequest() {
    const targetInput = document.getElementById('inputFriendUsername').value.trim();
    const token = localStorage.getItem('timer_session_token');

    if (!targetInput) return;

    friendMessage("Sending request...", false);

    fetch('/api/friends/add', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ targetUsername: targetInput })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            friendMessage(data.message || "Request sent!", false);
            document.getElementById('inputFriendUsername').value = '';
            fetchFriendsList(); 
        } else {
            friendMessage(data.error || "Failed to send request.", true);
        }
    })
    .catch(() => friendMessage("Network error.", true));
}

function fetchFriendsList() {
    const token = localStorage.getItem('timer_session_token');
    if (!token) return;

    fetch('/api/friends/list', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            renderFriendsUI(data.friends);
            renderPendingRequestsUI(data.pendingRequests);
        }
    })
    .catch(err => console.error("Error loading friends list:", err));
}

function renderFriendsUI(friends) {
    const container = document.getElementById('friendListContainer');
    container.innerHTML = '';

    if (friends.length === 0) {
        container.innerHTML = `<div style="text-align: center; color: #555; padding: 15px; font-size: 0.8rem;">Your friend list is empty.</div>`;
        return;
    }

    friends.forEach(friend => {
        const item = document.createElement('div');
        item.className = 'friend-item';

        let statusClass = 'offline';
        let statusText = 'Offline';
        if (friend.status === 'online') {
            statusClass = 'online';
            statusText = 'Online';
        } else if (friend.status === 'playing') {
            statusClass = 'playing';
            statusText = 'In Game';
        }

        let inviteBtnHtml = '';
        if (roomState && roomState.status === 'lobby' && friend.status === 'online') {
            inviteBtnHtml = `<button class="action-btn-mini" onclick="sendGameInvite(${friend.id})">Invite</button>`;
        }

        item.innerHTML = `
            <div class="friend-info">
                <div class="friend-avatar-mini">
                    ${DEFAULT_AVATARS[friend.avatar] || '🦊'}
                    <span class="status-dot ${statusClass}"></span>
                </div>
                <div>
                    <div class="friend-name">${friend.username}</div>
                    <div class="friend-sub-text">${statusText}</div>
                </div>
            </div>
            ${inviteBtnHtml}
        `;
        container.appendChild(item);
    });
}

function renderPendingRequestsUI(requests) {
    const container = document.getElementById('pendingRequestsList');
    const area = document.getElementById('pendingRequestsContainer');

    container.innerHTML = '';

    if (requests.length === 0) {
        area.style.display = 'none';
        return;
    }

    area.style.display = 'block';

    requests.forEach(req => {
        const item = document.createElement('div');
        item.className = 'friend-item';
        item.innerHTML = `
            <div class="friend-info">
                <div class="friend-avatar-mini">
                    ${DEFAULT_AVATARS[req.avatar] || '🦊'}
                </div>
                <div class="friend-name">${req.username}</div>
            </div>
            <div style="display: flex; gap: 4px;">
                <button class="action-btn-mini" onclick="respondFriendRequest(${req.id}, 'accept')">✔</button>
                <button class="action-btn-mini action-btn-red" onclick="respondFriendRequest(${req.id}, 'decline')">✕</button>
            </div>
        `;
        container.appendChild(item);
    });
}

function respondFriendRequest(requesterId, action) {
    const token = localStorage.getItem('timer_session_token');

    fetch('/api/friends/respond', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ requesterId, action })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            fetchFriendsList();
        }
    });
}

function sendGameInvite(friendId) {
    socket.emit('send-game-invite', { friendId: friendId, roomCode: roomId });
    alert("Game invitation sent!");
}

socket.on('receive-game-invite', (data) => {
    playSoftNotificationBeep();
    
    const modal = document.getElementById('invitePopupModal');
    document.getElementById('lblInviteMessage').innerText = `[ ${data.senderName} ] has invited you to join their game room: ${data.roomCode}`;
    modal.style.display = 'flex';

    document.getElementById('btnAcceptInvite').onclick = () => {
        modal.style.display = 'none';
        roomId = data.roomCode;
        isHost = false;

        myId = socket.id;
        socket.emit('join-room', { roomId, username, isHost });

        document.getElementById('screenHome').style.display = 'none';
        document.getElementById('screenMain').style.display = 'flex';
        document.getElementById('lblRoomId').innerText = roomId;

        setupHostConfigListeners();
    };
});

function declineInvite() {
    document.getElementById('invitePopupModal').style.display = 'none';
}

socket.on('friend-status-changed', () => {
    fetchFriendsList();
});

// ==========================================================================
// 5. THẺ HỒ SƠ THU NHỎ CỦA THÀNH VIÊN TRONG LOBBY (MINI PROFILE)
// ==========================================================================

function openMiniProfile(dbId, name) {
    if (!dbId) return; 
    
    socket.emit('get-mini-profile', dbId);
    
    socket.once('mini-profile-data', (data) => {
        document.getElementById('miniProfileModal').style.display = 'flex';
        document.getElementById('miniProfileName').innerText = data.username;
        
        const avatarDiv = document.getElementById('miniProfileAvatar');
        const headerDiv = document.getElementById('miniProfileHeader');

        avatarDiv.innerText = DEFAULT_AVATARS[data.avatar] || '🦊';
        avatarDiv.style.display = 'flex';
        avatarDiv.style.justifyContent = 'center';
        avatarDiv.style.alignItems = 'center';
        avatarDiv.style.fontSize = '26px';

        headerDiv.style.background = DEFAULT_BACKGROUNDS[data.background] || DEFAULT_BACKGROUNDS['default_background1'];

        const btnAdd = document.getElementById('btnAddFriendInLobby');
        if (data.username === currentUser.username) {
            btnAdd.style.display = 'none'; 
        } else {
            btnAdd.style.display = 'block';
            btnAdd.onclick = () => {
                const token = localStorage.getItem('timer_session_token');
                fetch('/api/friends/add', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ targetUsername: data.username })
                })
                .then(res => res.json())
                .then(resData => {
                    alert(resData.message || resData.error);
                    closeMiniProfile();
                });
            };
        }
    });
}

function closeMiniProfile() {
    document.getElementById('miniProfileModal').style.display = 'none';
}

// ==========================================================================
// 6. TRUY VẤN LỊCH SỬ ĐẤU (MATCH HISTORY CLIENT LOGIC)
// ==========================================================================

function fetchMatchHistory() {
    const token = localStorage.getItem('timer_session_token');
    if (!token) return;

    fetch('/api/match-history', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            localMatchesHistoryCache = data.history; // Lưu trữ tạm vào cache
            renderMatchHistoryUI(data.history);
        }
    })
    .catch(err => console.error("Error fetching match history:", err));
}

function renderMatchHistoryUI(history) {
    const container = document.getElementById('historyContainer');
    container.innerHTML = '';

    if (history.length === 0) {
        container.innerHTML = `<div style="text-align: center; color: #555; padding: 20px; font-size: 0.85rem;">No matches recorded yet.</div>`;
        return;
    }

    history.forEach((match, idx) => {
        const item = document.createElement('div');
        item.className = 'history-item';
        
        const dateStr = new Date(match.playedAt).toLocaleDateString();
        
        item.innerHTML = `
            <div>
                <div style="font-size: 0.85rem; font-weight: bold; color: #fff;">${match.roomName}</div>
                <div style="font-size: 0.7rem; color: #8c8f9f; margin-top: 2px;">Code: ${match.roomCode} | Date: ${dateStr}</div>
            </div>
            <button class="action-btn-mini" onclick="viewPastMatch(${idx})">View</button>
        `;
        container.appendChild(item);
    });
}

// Mở xem lại bảng điểm lịch sử cũ từ Cache cục bộ
function viewPastMatch(index) {
    const match = localMatchesHistoryCache[index];
    if (!match) return;

    document.getElementById('pastStatsModal').style.display = 'flex';
    document.getElementById('lblPastMatchTitle').innerText = `${match.roomName} - Scoreboard`;

    const table = document.getElementById('pastStatsTable');
    table.innerHTML = `
        <div class="stats-row-header">
            <span>Player</span>
            <span>Turns</span>
            <span>Total Time</span>
            <span>Avg Time</span>
        </div>
    `;

    match.scoreboard.forEach(p => {
        table.innerHTML += `
            <div class="stats-row">
                <span>${p.name}</span>
                <span>${p.turns}</span>
                <span>${p.totalTime}s</span>
                <span style="color:#00ffcc; font-weight:bold;">${p.avgTime}s/turn</span>
            </div>
        `;
    });
}

function closePastStatsModal() {
    document.getElementById('pastStatsModal').style.display = 'none';
}

// ==========================================================================
// 7. QUẢN LÝ TẠO / VÀO PHÒNG TRÊN HOME DASHBOARD (LOBBY ROUTING)
// ==========================================================================

function joinPermanentLobby() {
    roomId = currentUser.username.toUpperCase();
    isHost = true; 

    myId = socket.id;
    socket.emit('join-room', { roomId, username, isHost });

    document.getElementById('screenHome').style.display = 'none';
    document.getElementById('screenMain').style.display = 'flex';
    document.getElementById('lblRoomId').innerText = roomId;

    setupHostConfigListeners();
}

function createTempLobby() {
    roomId = Math.random().toString(36).substr(2, 5).toUpperCase();
    isHost = true;

    myId = socket.id;
    socket.emit('join-room', { roomId, username, isHost });

    document.getElementById('screenHome').style.display = 'none';
    document.getElementById('screenMain').style.display = 'flex';
    document.getElementById('lblRoomId').innerText = roomId;

    setupHostConfigListeners();
}

function joinTempLobbyByCode() {
    const code = document.getElementById('inputJoinCode').value.trim().toUpperCase();
    if (!code) {
        alert("Please enter a room code!");
        return;
    }

    roomId = code;
    isHost = false;

    myId = socket.id;
    socket.emit('join-room', { roomId, username, isHost });

    document.getElementById('screenHome').style.display = 'none';
    document.getElementById('screenMain').style.display = 'flex';
    document.getElementById('lblRoomId').innerText = roomId;

    setupHostConfigListeners();
}

// ==========================================================================
// 8. CỔNG SỰ KIỆN ĐỒNG BỘ GAME CHÍNH (SOCKET.IO TRANSITIONS)
// ==========================================================================

socket.on('update-room', (state) => {
    roomState = state;
    renderPlayerList();
});

socket.on('update-sound', (enabled) => {
    if (isHost) return;
    document.getElementById('checkSound').checked = enabled;
});

socket.on('update-sync-notification', (enabled) => {
    if (isHost) return;
    document.getElementById('checkNotifyAll').checked = enabled;
});

socket.on('update-auto-sync', (enabled) => {
    if (isHost) return;
    document.getElementById('checkAutoSync').checked = enabled;
});

socket.on('update-bot-compensation', (data) => {
    if (isHost) return;
    document.getElementById('checkBotCompensation').checked = data.enabled;
    document.getElementById('botCompensationGroup').style.display = data.enabled ? 'block' : 'none';
    document.getElementById('inputBotDelay').value = data.delaySec;
});

socket.on('update-accumulate', (data) => {
    if (isHost) return;
    document.getElementById('checkAccumulate').checked = data.enabled;
    document.getElementById('maxAccumulateGroup').style.display = data.enabled ? 'block' : 'none';
    document.getElementById('inputMaxAccumulate').value = data.maxSec;
});

function renderPlayerList() {
    const container = document.getElementById('playerListContainer');
    container.innerHTML = '';

    roomState.players.forEach((player, idx) => {
        const item = document.createElement('div');
        item.className = 'player-item';
        if (roomState.status === 'playing' && idx === roomState.activePlayerIndex) {
            item.classList.add('active-turn');
        }

        const bonusText = !player.isBot && roomState.accumulateUnused && player.timeBank > 0 ? ` (+${player.timeBank}s)` : '';
        const isMe = player.id === socket.id;
        const isMeText = isMe ? '(You)' : '';
        const isBotText = player.isBot ? '🤖' : '';

        let kickBtnHtml = '';
        if (isHost && !isMe) {
            kickBtnHtml = `<button class="kick-btn" onclick="kickPlayer('${player.id}')">Kick</button>`;
        }

        item.innerHTML = `
            <div class="player-info-container" ${!player.isBot ? `onclick="openMiniProfile(${player.dbId}, '${player.name}')"` : ''} style="cursor: ${!player.isBot ? 'pointer' : 'grab'};">
                <span>${idx + 1}. ${isBotText} ${player.name} ${isMeText} <span style="color:#ffcc00; font-weight:bold;">${bonusText}</span></span>
                ${player.isHost ? '<span class="badge">Host</span>' : ''}
            </div>
            ${kickBtnHtml}
        `;

        if (roomState.status === 'lobby' && isHost) {
            item.setAttribute('draggable', 'true');
            setupDragAndDropEvents(item, player.id);
        }

        container.appendChild(item);
    });
}

function kickPlayer(targetId) {
    if (confirm("Are you sure you want to kick this player from the room?")) {
        socket.emit('kick-player', targetId);
    }
}

socket.on('kicked', () => {
    alert("You have been kicked from the lobby by the Host.");
    forceExitToDashboard();
});

function forceExitToDashboard() {
    if (window.electronAPI) {
        window.electronAPI.stopWatching();
    }
    socket.disconnect();
    socket.connect(); 
    
    isGameStarted = false;
    trace = [];

    document.getElementById('screenMain').style.display = 'none';
    document.getElementById('screenHome').style.display = 'flex'; 
    
    if (isMiniMode) {
        toggleMiniLayout();
    }
}

let dragSrcId = null;
function setupDragAndDropEvents(element, playerId) {
    element.addEventListener('dragstart', (e) => {
        element.classList.add('dragging');
        dragSrcId = playerId;
        e.dataTransfer.effectAllowed = 'move';
    });

    element.addEventListener('dragover', (e) => { e.preventDefault(); });

    element.addEventListener('drop', (e) => {
        e.preventDefault();
        const targetId = playerId;
        if (dragSrcId !== targetId) {
            const playerIds = roomState.players.map(p => p.id);
            const srcIdx = playerIds.indexOf(dragSrcId);
            const targetIdx = playerIds.indexOf(targetId);

            playerIds.splice(srcIdx, 1);
            playerIds.splice(targetIdx, 0, dragSrcId);

            socket.emit('reorder-players', playerIds);
        }
    });

    element.addEventListener('dragend', () => {
        element.classList.remove('dragging');
    });
}

function hostStartGame() {
    const duration = parseInt(document.getElementById('inputDuration').value) || 45;
    socket.emit('start-game', duration);
}

socket.on('game-started', (state) => {
    roomState = state;
    document.getElementById('lobbyView').style.display = 'none';
    document.getElementById('statsView').style.display = 'none';
    document.getElementById('gameView').style.display = 'block';
    
    if (window.electronAPI) {
        document.getElementById('btnMiniToggle').style.display = 'block';

        const checkAutoSync = document.getElementById('checkAutoSync');
        const inputAutoSyncPath = document.getElementById('inputAutoSyncPath');

        if (isHost && checkAutoSync && checkAutoSync.checked && inputAutoSyncPath.value.trim()) {
            window.electronAPI.startWatching(inputAutoSyncPath.value.trim());
        }
    }

    if (isHost) {
        document.getElementById('btnHostPause').style.display = 'block';
        document.getElementById('btnHostEndGame').style.display = 'block';
    } else {
        document.getElementById('btnHostPause').style.display = 'none';
        document.getElementById('btnHostEndGame').style.display = 'none';
    }

    requestWakeLock();
});

if (window.electronAPI) {
    window.electronAPI.onAutoSync((filename) => {
        console.log(`[Auto-Sync Event] Chuyển lượt tự động do phát hiện file đổi: ${filename}`);
        clientEndTurn(); 
    });
}

socket.on('start-countdown', (data) => {
    roomState.activePlayerIndex = data.activePlayerIndex;
    
    const activePlayer = roomState.players[data.activePlayerIndex];
    document.getElementById('activePlayerName').innerText = activePlayer.name;

    const badge = document.getElementById('bonusTimeBadge');
    if (roomState.accumulateUnused && data.timeBank > 0) {
        badge.style.display = 'inline-block';
        badge.innerText = `Time Bank: +${data.timeBank}s`;
    } else {
        badge.style.display = 'none';
    }

    renderPlayerList();
    updateTimerUI(data.duration, data.paused);

    const btnExtend = document.getElementById('btnExtend');
    btnExtend.disabled = false;
    btnExtend.style.opacity = '1';
    btnExtend.innerText = "15s EXTRA";

    const btnEndTurn = document.getElementById('btnEndTurn');
    if (activePlayer.id === socket.id) {
        btnEndTurn.disabled = false;
        btnEndTurn.style.opacity = '1';
    } else {
        btnEndTurn.disabled = true;
        btnEndTurn.style.opacity = '0.3';
    }
});

socket.on('timer-tick', (data) => {
    updateTimerUI(data.timeLeft, data.paused);
});

function updateTimerUI(timeLeft, paused) {
    const timerDisplay = document.getElementById('timerDisplay');
    timerDisplay.innerText = timeLeft < 10 ? `0${timeLeft}` : timeLeft;

    if (timeLeft <= 10) {
        timerDisplay.classList.add('warning');
    } else {
        timerDisplay.classList.remove('warning');
    }

    if (paused) {
        timerDisplay.classList.add('paused');
        document.getElementById('btnHostPause').innerText = "RESUME";
    } else {
        timerDisplay.classList.remove('paused');
        document.getElementById('btnHostPause').innerText = "PAUSE";
    }
}

socket.on('on-deck-alert', (currentPlayerName) => {
    playSoftNotificationBeep(); 

    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification("GET READY!", {
            body: `You are next in turn! [ ${currentPlayerName} ] has only 10s left.`,
            silent: true 
        });
    }
});

socket.on('time-out-alarm', (data) => {
    playAlarmBeep();
    
    const overlay = document.getElementById('alarmOverlay');
    const activePlayer = roomState.players[roomState.activePlayerIndex];

    document.getElementById('alarmMessage').innerText = `Turn time for [ ${data.activePlayerName} ] has expired!`;
    overlay.style.display = 'flex';

    if (activePlayer.id === socket.id) {
        document.getElementById('btnAlarmNext').style.display = 'block';
        document.getElementById('btnAlarmOK').style.display = 'none';
    } else {
        document.getElementById('btnAlarmNext').style.display = 'none';
        document.getElementById('btnAlarmOK').style.display = 'block';
    }

    startFlashingTitle(); 

    if ('Notification' in window && Notification.permission === 'granted') {
        const notification = new Notification("TIME'S UP!", {
            body: `Turn time for [ ${data.activePlayerName} ] has expired! Click here to return.`,
            requireInteraction: true 
        });

        notification.onclick = function() {
            window.focus(); 
            notification.close();
            stopFlashingTitle();
        };
    }
});

document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        stopFlashingTitle(); 
    }
});

socket.on('close-alarm-overlay', () => {
    document.getElementById('alarmOverlay').style.display = 'none';
    stopFlashingTitle();
});

socket.on('extension-applied', (usedCount) => {
    const btnExtend = document.getElementById('btnExtend');
    if (usedCount >= 2) {
        btnExtend.disabled = true;
        btnExtend.style.opacity = '0.3';
        btnExtend.innerText = "MAX LIMIT";
    } else {
        btnExtend.innerText = `15s EXTRA (${usedCount}/2)`;
    }
});

function requestExtension() {
    const activePlayer = roomState.players[roomState.activePlayerIndex];
    if (activePlayer && activePlayer.id === socket.id) {
        socket.emit('request-extension');
    }
}

function hostEndGame() {
    if (isHost && confirm("End game and view scoreboard?")) {
        socket.emit('end-game');
    }
}

socket.on('show-stats', (statsData) => {
    document.getElementById('lobbyView').style.display = 'none';
    document.getElementById('gameView').style.display = 'none';
    document.getElementById('statsView').style.display = 'block';

    if (isMiniMode) {
        toggleMiniLayout();
    }

    releaseWakeLock();

    let thinker = statsData[0];
    let runner = statsData[0];

    statsData.forEach(p => {
        if (p.avgTime > thinker.avgTime) thinker = p;
        if (p.avgTime < runner.avgTime) runner = p;
    });

    document.getElementById('thinkerName').innerText = thinker.name;
    document.getElementById('speedName').innerText = runner.name;

    const table = document.getElementById('statsTable');
    table.innerHTML = `
        <div class="stats-row-header">
            <span>Player</span>
            <span>Turns</span>
            <span>Total Time</span>
            <span>Avg Time</span>
        </div>
    `;

    statsData.forEach(p => {
        table.innerHTML += `
            <div class="stats-row">
                <span>${p.name}</span>
                <span>${p.turns}</span>
                <span>${p.totalTime}s</span>
                <span style="color:#00ffcc; font-weight:bold;">${p.avgTime}s/turn</span>
            </div>
        `;
    });
});

function backToLobby() {
    document.getElementById('statsView').style.display = 'none';
    document.getElementById('lobbyView').style.display = 'block';
    isGameStarted = false;
    socket.emit('join-room', { roomId, username, isHost });
}

function leaveLobby() {
    if (confirm("Are you sure you want to leave this lobby?")) {
        if (window.electronAPI) {
            window.electronAPI.stopWatching();
        }

        socket.emit('leave-room'); 
        socket.disconnect();
        socket.connect(); 
        
        isGameStarted = false;
        trace = [];

        document.getElementById('screenMain').style.display = 'none';
        document.getElementById('screenHome').style.display = 'flex';
        
        if (isMiniMode) {
            toggleMiniLayout();
        }

        const token = localStorage.getItem('timer_session_token');
        if (token) {
            socket.emit('authenticate', token);
        }
        fetchFriendsList();
    }
}

function togglePause() {
    if (isHost) socket.emit('toggle-pause');
}

function exitAlarmAndNext() {
    stopFlashingTitle();
    document.getElementById('alarmOverlay').style.display = 'none';
    socket.emit('end-turn');
}

function exitAlarmOK() {
    stopFlashingTitle();
    document.getElementById('alarmOverlay').style.display = 'none';
}

function clientEndTurn() {
    socket.emit('end-turn');
}

function appMinimize() {
    if (window.electronAPI) window.electronAPI.minimizeApp();
}

function appMaximize() {
    if (window.electronAPI) window.electronAPI.maximizeApp();
}

function appClose() {
    if (confirm("Are you sure you want to exit the application?")) {
        releaseWakeLock();
        if (window.electronAPI) {
            window.electronAPI.stopWatching();
            window.electronAPI.closeApp();
        }
        else window.close();
    }
}

function toggleMiniLayout() {
    if (!window.electronAPI) return;
    
    isMiniMode = !isMiniMode;
    const body = document.body;
    const btnMini = document.getElementById('btnMiniToggle');
    const sidebar = document.getElementById('sidebar');

    if (isMiniMode) {
        body.classList.add('mini-active');
        sidebar.classList.add('collapsed');
        btnMini.innerText = "NORMAL WINDOW";
        window.electronAPI.toggleMini(true);
    } else {
        body.classList.remove('mini-active');
        sidebar.classList.remove('collapsed');
        btnMini.innerText = "MINI WINDOW";
        window.electronAPI.toggleMini(false);
    }
}

function exitGame() {
    if (confirm("Are you sure you want to exit the room?")) {
        releaseWakeLock(); 
        if (window.electronAPI) {
            window.electronAPI.stopWatching();
        }
        
        socket.emit('leave-room');
        socket.disconnect();
        socket.connect();

        isGameStarted = false;
        trace = [];

        document.getElementById('screenMain').style.display = 'none';
        document.getElementById('screenHome').style.display = 'flex';
        
        if (isMiniMode) {
            toggleMiniLayout();
        }

        const token = localStorage.getItem('timer_session_token');
        if (token) {
            socket.emit('authenticate', token);
        }
        fetchFriendsList();
    }
}