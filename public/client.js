const socket = io();

let myId = '';
let roomId = '';
let username = '';
let isHost = false;
let roomState = null;
let wakeLock = null; 

let titleInterval = null;
const originalTitle = document.title;

// Trạng thái cửa sổ nổi nội bộ
let isMiniMode = false;

// Tự động kiểm tra xem có đang chạy trong môi trường App Electron không để hiện thanh tiêu đề tùy chỉnh
if (window.electronAPI) {
    document.getElementById('customTitlebar').style.display = 'flex';
} else {
    document.getElementById('customTitlebar').style.display = 'none';
}

document.getElementById('inputUsername').value = localStorage.getItem('timer_pro_username') || '';
document.getElementById('inputRoomId').value = localStorage.getItem('timer_pro_roomid') || '';

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
        // Không cho phép đóng mở Sidebar bằng Tab khi đang ở chế độ nổi mini
        if (!isMiniMode) {
            document.getElementById('sidebar').classList.toggle('collapsed');
        }
    }
});

function joinRoom() {
    username = document.getElementById('inputUsername').value.trim();
    let rId = document.getElementById('inputRoomId').value.trim().toUpperCase();

    if (!username) { alert("Please enter your name!"); return; }
    
    if (!rId) {
        roomId = 'ROOM_' + Math.random().toString(36).substr(2, 5).toUpperCase();
        isHost = true;
    } else {
        roomId = rId;
        isHost = false;
    }

    localStorage.setItem('timer_pro_username', username);
    localStorage.setItem('timer_pro_roomid', roomId);

    myId = socket.id;
    socket.emit('join-room', { roomId, username, isHost });

    document.getElementById('screenJoin').style.display = 'none';
    document.getElementById('screenMain').style.display = 'flex';
    document.getElementById('lblRoomId').innerText = roomId;

    setupHostConfigListeners();
}

function setupHostConfigListeners() {
    if (!isHost) return;
    document.getElementById('hostConfig').style.display = 'block';
    document.getElementById('btnHostPause').style.display = 'block';

    document.getElementById('checkNotifyAll').addEventListener('change', (e) => {
        socket.emit('set-sync-fullscreen', e.target.checked);
    });

    document.getElementById('checkSound').addEventListener('change', (e) => {
        socket.emit('set-sound', e.target.checked);
    });

    const checkAccumulate = document.getElementById('checkAccumulate');
    const maxAccumulateGroup = document.getElementById('maxAccumulateGroup');
    const inputMaxAccumulate = document.getElementById('inputMaxAccumulate');

    checkAccumulate.addEventListener('change', () => {
        const isEnabled = checkAccumulate.checked;
        maxAccumulateGroup.style.display = isEnabled ? 'block' : 'none';
        socket.emit('set-accumulate', { enabled: isEnabled, maxSec: parseInt(inputMaxAccumulate.value) || 30 });
    });

    inputMaxAccumulate.addEventListener('input', () => {
        socket.emit('set-accumulate', { enabled: checkAccumulate.checked, maxSec: parseInt(inputMaxAccumulate.value) || 30 });
    });
}

socket.on('update-room', (state) => {
    roomState = state;
    renderPlayerList();
});

socket.on('update-sound', (enabled) => {
    if (isHost) return;
    document.getElementById('checkSound').checked = enabled;
});

socket.on('update-sync-fullscreen', (enabled) => {
    if (isHost) return;
    document.getElementById('checkNotifyAll').checked = enabled;
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

        const bonusText = roomState.accumulateUnused && player.timeBank > 0 ? ` (+${player.timeBank}s)` : '';

        item.innerHTML = `
            <span>${idx + 1}. ${player.name} ${player.id === socket.id ? '(You)' : ''} <span style="color:#ffcc00; font-weight:bold;">${bonusText}</span></span>
            ${player.isHost ? '<span class="badge">Host</span>' : ''}
        `;

        if (roomState.status === 'lobby' && isHost) {
            item.setAttribute('draggable', 'true');
            setupDragAndDropEvents(item, player.id);
        }

        container.appendChild(item);
    });
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
    document.getElementById('gameView').style.display = 'block';
    
    // Chỉ hiển thị nút chuyển đổi Mini Mode nếu đang chạy bằng bản App Electron
    if (window.electronAPI) {
        document.getElementById('btnMiniToggle').style.display = 'block';
    }

    requestWakeLock();
});

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

// ==========================================================================
// CÁC HÀM TƯƠNG TÁC NATIVE WINDOWS (ELECTRON CHUYÊN SÂU)
// ==========================================================================
function appMinimize() {
    if (window.electronAPI) window.electronAPI.minimizeApp();
}

function appClose() {
    if (confirm("Are you sure you want to exit the application?")) {
        releaseWakeLock();
        if (window.electronAPI) window.electronAPI.closeApp();
        else window.close();
    }
}

// Bật/Tắt chế độ cửa sổ nổi thu nhỏ (Mini Window Mode)
function toggleMiniLayout() {
    if (!window.electronAPI) return;
    
    isMiniMode = !isMiniMode;
    const body = document.body;
    const btnMini = document.getElementById('btnMiniToggle');
    const sidebar = document.getElementById('sidebar');

    if (isMiniMode) {
        body.classList.add('mini-active');
        sidebar.classList.add('collapsed'); // Buộc thu nhỏ sidebar
        btnMini.innerText = "NORMAL WINDOW";
        
        // Gửi lệnh lên Hệ điều hành bắt cửa sổ co lại kích thước 260x140
        window.electronAPI.toggleMini(true);
    } else {
        body.classList.remove('mini-active');
        sidebar.classList.remove('collapsed');
        btnMini.innerText = "MINI WINDOW";
        
        // Trả App về kích thước chuẩn 1000x700 ban đầu
        window.electronAPI.toggleMini(false);
    }
}